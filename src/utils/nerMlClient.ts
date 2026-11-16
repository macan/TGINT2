/**
 * Client-side controller for the dedicated Web Worker running hybrid local NER:
 *   - CJK-native BERT (`Xenova/bert-base-chinese-ner`, ~98 MB) for Chinese posts
 *   - Segmented GLiNER.js (`onnx-community/gliner_multi-v2.1`, ~333 MB) for JP/EN/RU/Mixed
 *
 * Manages opt-in preference persistence, Cache Storage detection, model download
 * progress telemetry, abort handling, and batched worker RPC calls.
 */

import {
  clearAllModelCaches,
  inspectModelCacheState,
  type NerModelId,
} from "./nerModelCache";
import type { BatchModelHint } from "./nerCjkUtils";
import type {
  WorkerExecutorPreference,
  WorkerInMessage,
  WorkerMlModelFlavor,
  WorkerMlSpan,
  WorkerOutMessage,
  WorkerPostInput,
} from "../workers/nerInference.worker";

export type { BatchModelHint, NerModelId, WorkerExecutorPreference, WorkerMlModelFlavor, WorkerMlSpan };

export const EXPLORER_NER_LOCAL_ML_KEY = "gingko_explorer_ner_local_ml";
export const EXPLORER_NER_LOCAL_ML_EXECUTOR_KEY = "gingko_explorer_ner_local_ml_executor";

export type NerMlStatus =
  | "disabled"
  | "idle"
  | "checking"
  | "downloading"
  | "retrying"
  | "loading_cache"
  | "initializing"
  | "ready"
  | "inferring"
  | "error";

export interface NerMlState {
  enabled: boolean;
  executorPreference: WorkerExecutorPreference;
  status: NerMlStatus;
  isModelCached: boolean;
  cjkCached: boolean;
  glinerCached: boolean;
  downloadingModel: NerModelId | null;
  executionProvider: "webgpu" | "wasm" | null;
  downloadPercent: number;
  loadedBytes: number;
  partialBytes: number;
  totalBytes: number;
  retryAttempt: number;
  maxRetries: number;
  error: string | null;
}

const listeners = new Set<(state: NerMlState) => void>();

function readInitialEnabled(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(EXPLORER_NER_LOCAL_ML_KEY) === "1";
  } catch {
    return false;
  }
}

function readInitialExecutorPreference(): WorkerExecutorPreference {
  try {
    const raw =
      typeof localStorage !== "undefined"
        ? localStorage.getItem(EXPLORER_NER_LOCAL_ML_EXECUTOR_KEY)
        : null;
    if (raw === "wasm" || raw === "webgpu" || raw === "auto") return raw;
  } catch {
    // ignore storage errors
  }
  return "auto";
}

let state: NerMlState = {
  enabled: readInitialEnabled(),
  executorPreference: readInitialExecutorPreference(),
  status: readInitialEnabled() ? "idle" : "disabled",
  isModelCached: false,
  cjkCached: false,
  glinerCached: false,
  downloadingModel: null,
  executionProvider: null,
  downloadPercent: 0,
  loadedBytes: 0,
  partialBytes: 0,
  totalBytes: 0,
  retryAttempt: 0,
  maxRetries: 0,
  error: null,
};

function notify() {
  const snapshot: NerMlState = { ...state };
  listeners.forEach((cb) => {
    try {
      cb(snapshot);
    } catch {
      // ignore subscriber errors
    }
  });
}

function patchState(partial: Partial<NerMlState>) {
  state = { ...state, ...partial };
  notify();
}

export function getNerMlState(): NerMlState {
  return { ...state };
}

export function subscribeNerMlState(cb: (s: NerMlState) => void): () => void {
  listeners.add(cb);
  cb({ ...state });
  return () => {
    listeners.delete(cb);
  };
}

export function getLocalMlEnabled(): boolean {
  return state.enabled;
}

export function setLocalMlEnabled(enabled: boolean): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(EXPLORER_NER_LOCAL_ML_KEY, enabled ? "1" : "0");
    }
  } catch {
    // ignore storage errors
  }

  if (!enabled) {
    abortLocalMlModel();
    patchState({
      enabled: false,
      status: "disabled",
      downloadingModel: null,
      error: null,
    });
    return;
  }

  patchState({
    enabled: true,
    status: state.executionProvider ? "ready" : "idle",
    error: null,
  });
}

export function setLocalMlExecutorPreference(pref: WorkerExecutorPreference): void {
  if (state.executorPreference === pref) return;
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(EXPLORER_NER_LOCAL_ML_EXECUTOR_KEY, pref);
    }
  } catch {
    // ignore storage errors
  }

  const mismatch =
    (pref === "wasm" && state.executionProvider !== "wasm") ||
    (pref === "webgpu" && state.executionProvider !== "webgpu");

  patchState({
    executorPreference: pref,
    ...(mismatch ? { executionProvider: null, status: state.enabled ? "idle" : "disabled" } : {}),
    error: null,
  });

  if (state.enabled && state.isModelCached && mismatch && !activeWarmupPromise) {
    const hint: BatchModelHint =
      state.cjkCached && state.glinerCached
        ? "both"
        : state.glinerCached
          ? "gliner"
          : "cjk";
    warmupLocalMlModel(hint).catch(() => {});
  }
}

export async function checkLocalMlModelCached(): Promise<boolean> {
  try {
    const info = await inspectModelCacheState();
    const pct =
      info.isCached
        ? 100
        : info.totalBytes > 0 && info.partialBytes > 0
          ? Math.min(99, Math.round((info.partialBytes / info.totalBytes) * 100))
          : 0;
    const partialModel: NerModelId | null =
      !info.cjk.isCached && info.cjk.partialBytes > 0
        ? "cjkBert"
        : !info.gliner.isCached && info.gliner.partialBytes > 0
          ? "gliner"
          : null;
    patchState({
      isModelCached: info.isCached,
      cjkCached: info.cjkCached,
      glinerCached: info.glinerCached,
      downloadingModel: partialModel ?? state.downloadingModel,
      partialBytes: info.partialBytes,
      totalBytes: info.totalBytes || state.totalBytes,
      loadedBytes: info.partialBytes || state.loadedBytes,
      downloadPercent: info.isCached ? 100 : pct,
    });
    return info.isCached;
  } catch {
    patchState({ isModelCached: false, cjkCached: false, glinerCached: false });
    return false;
  }
}

let workerInstance: Worker | null = null;
let rpcSeq = 1;
const pendingRpcs = new Map<
  number,
  { resolve: (msg: WorkerOutMessage) => void; reject: (err: Error) => void }
>();

function handleWorkerMessage(ev: MessageEvent<WorkerOutMessage>) {
  const msg = ev.data;
  if (!msg) return;

  if (msg.type === "progress") {
    patchState({
      status: msg.stage,
      loadedBytes: msg.loadedBytes,
      ...(msg.modelId !== undefined ? { downloadingModel: msg.modelId } : {}),
      ...(msg.loadedBytes > 0 ? { partialBytes: msg.loadedBytes } : {}),
      ...(msg.totalBytes > 0 ? { totalBytes: msg.totalBytes } : {}),
      downloadPercent: msg.percent,
      retryAttempt: msg.retryAttempt || 0,
      maxRetries: msg.maxRetries || 0,
      ...(msg.provider !== undefined ? { executionProvider: msg.provider } : {}),
      ...(msg.cached !== undefined ? { isModelCached: msg.cached } : {}),
      ...(msg.cjkCached !== undefined ? { cjkCached: msg.cjkCached } : {}),
      ...(msg.glinerCached !== undefined ? { glinerCached: msg.glinerCached } : {}),
      ...(msg.stage === "ready" || msg.stage === "downloading" ? { error: null } : {}),
    });
    return;
  }

  if ("id" in msg && typeof msg.id === "number") {
    const pending = pendingRpcs.get(msg.id);
    if (!pending) return;
    pendingRpcs.delete(msg.id);

    if (msg.type === "error") {
      const err = msg.aborted
        ? new DOMException("Aborted", "AbortError")
        : new Error(msg.message);
      pending.reject(err as unknown as Error);
      return;
    }
    pending.resolve(msg);
  }
}

function getOrCreateWorker(): Worker {
  if (workerInstance) return workerInstance;
  const w = new Worker(
    new URL("../workers/nerInference.worker.ts", import.meta.url),
    { type: "module" }
  );
  w.addEventListener("message", handleWorkerMessage);
  w.addEventListener("error", (ev) => {
    const msg = ev.message || "ML worker crashed";
    patchState({ status: "error", downloadingModel: null, error: msg });
    for (const [, p] of pendingRpcs) {
      p.reject(new Error(msg));
    }
    pendingRpcs.clear();
    workerInstance?.terminate();
    workerInstance = null;
  });
  workerInstance = w;
  return w;
}

function callWorker(
  payload: Omit<WorkerInMessage, "id"> & Record<string, unknown>,
  signal?: AbortSignal
): Promise<WorkerOutMessage> {
  const w = getOrCreateWorker();
  const id = rpcSeq++;

  return new Promise<WorkerOutMessage>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError") as unknown as Error);
      return;
    }

    const onAbort = () => {
      try {
        w.postMessage({ id: 0, type: "abort" } satisfies WorkerInMessage);
      } catch {
        // ignore
      }
      pendingRpcs.delete(id);
      reject(new DOMException("Aborted", "AbortError") as unknown as Error);
    };

    signal?.addEventListener("abort", onAbort, { once: true });

    pendingRpcs.set(id, {
      resolve: (res) => {
        signal?.removeEventListener("abort", onAbort);
        resolve(res);
      },
      reject: (err) => {
        signal?.removeEventListener("abort", onAbort);
        reject(err);
      },
    });

    w.postMessage({ ...payload, id } as WorkerInMessage);
  });
}

let activeWarmupPromise: Promise<{ provider: "webgpu" | "wasm" }> | null = null;
let warmupAbortController: AbortController | null = null;

export async function warmupLocalMlModel(
  modelHintOrSignal?: BatchModelHint | AbortSignal,
  externalSignal?: AbortSignal
): Promise<{ provider: "webgpu" | "wasm" }> {
  const modelHint: BatchModelHint =
    typeof modelHintOrSignal === "string" ? modelHintOrSignal : "cjk";
  const resolvedSignal =
    typeof modelHintOrSignal === "string" ? externalSignal : modelHintOrSignal;

  const pref = state.executorPreference;
  const providerMatchesPref =
    state.executionProvider !== null &&
    (pref === "auto" || pref === state.executionProvider);
  const modelSatisfied =
    (modelHint === "cjk" && state.cjkCached) ||
    (modelHint === "gliner" && state.glinerCached) ||
    (modelHint === "both" && state.cjkCached && state.glinerCached);

  if (providerMatchesPref && state.status === "ready" && modelSatisfied) {
    return { provider: state.executionProvider! };
  }
  if (activeWarmupPromise) {
    return activeWarmupPromise;
  }

  warmupAbortController = new AbortController();
  const signal = resolvedSignal || warmupAbortController.signal;
  patchState({ error: null });

  activeWarmupPromise = (async () => {
    try {
      const msg = await callWorker(
        { type: "warmup", executor: state.executorPreference, modelHint },
        signal
      );
      if (msg.type === "warmup-done") {
        patchState({
          status: state.enabled ? "ready" : "disabled",
          executionProvider: msg.provider,
          isModelCached: msg.cjkCached || msg.glinerCached,
          cjkCached: msg.cjkCached,
          glinerCached: msg.glinerCached,
          downloadingModel: null,
          downloadPercent: 100,
          retryAttempt: 0,
          maxRetries: 0,
          error: null,
        });
        return { provider: msg.provider };
      }
      throw new Error("Unexpected response during model warmup");
    } catch (err: unknown) {
      const e = err as { name?: string; message?: string };
      await checkLocalMlModelCached().catch(() => {});
      if (e?.name === "AbortError") {
        patchState({
          status: state.enabled ? "idle" : "disabled",
          downloadingModel: null,
          retryAttempt: 0,
          maxRetries: 0,
          error: null,
        });
      } else {
        patchState({
          status: "error",
          downloadingModel: null,
          retryAttempt: 0,
          maxRetries: 0,
          error: e?.message || "Failed to load ML model",
        });
      }
      throw err;
    } finally {
      activeWarmupPromise = null;
      warmupAbortController = null;
    }
  })();

  return activeWarmupPromise;
}

export function abortLocalMlModel(): void {
  if (warmupAbortController) {
    warmupAbortController.abort();
    warmupAbortController = null;
  }
  if (workerInstance) {
    try {
      workerInstance.postMessage({ id: 0, type: "abort" } satisfies WorkerInMessage);
    } catch {
      // ignore
    }
  }
  if (
    state.status === "downloading" ||
    state.status === "retrying" ||
    state.status === "initializing" ||
    state.status === "inferring"
  ) {
    patchState({
      status: state.enabled ? (state.executionProvider ? "ready" : "idle") : "disabled",
      downloadingModel: null,
      retryAttempt: 0,
      maxRetries: 0,
    });
  }
}

export async function clearLocalMlModelCache(): Promise<void> {
  abortLocalMlModel();
  if (workerInstance) {
    try {
      await callWorker({ type: "clear-cache" });
    } catch {
      // ignore
    }
  }
  await clearAllModelCaches();
  patchState({
    isModelCached: false,
    cjkCached: false,
    glinerCached: false,
    downloadingModel: null,
    executionProvider: null,
    downloadPercent: 0,
    loadedBytes: 0,
    partialBytes: 0,
    totalBytes: 0,
    retryAttempt: 0,
    maxRetries: 0,
    status: state.enabled ? "idle" : "disabled",
    error: null,
  });
}

export interface WorkerPostInferenceOutput {
  spans: WorkerMlSpan[];
  mlModel: WorkerMlModelFlavor;
}

export async function inferEntitiesWithMlWorker(
  posts: WorkerPostInput[],
  signal?: AbortSignal
): Promise<{
  provider: "webgpu" | "wasm";
  results: Map<string, WorkerPostInferenceOutput>;
}> {
  if (!posts || posts.length === 0) {
    return {
      provider: state.executionProvider || "wasm",
      results: new Map(),
    };
  }

  patchState({
    status: state.executionProvider ? "inferring" : state.status,
    error: null,
  });

  try {
    const msg = await callWorker(
      { type: "infer-batch", posts, executor: state.executorPreference },
      signal
    );
    if (msg.type === "infer-done") {
      const resultsMap = new Map<string, WorkerPostInferenceOutput>();
      for (const item of msg.results) {
        resultsMap.set(item.postKey, {
          spans: item.spans,
          mlModel: item.mlModel,
        });
      }
      patchState({
        status: state.enabled ? "ready" : "disabled",
        executionProvider: msg.provider,
        isModelCached: msg.cjkCached || msg.glinerCached,
        cjkCached: msg.cjkCached,
        glinerCached: msg.glinerCached,
        downloadingModel: null,
        downloadPercent: 100,
        error: null,
      });
      return { provider: msg.provider, results: resultsMap };
    }
    throw new Error("Unexpected ML inference worker response");
  } catch (err: unknown) {
    const e = err as { name?: string; message?: string };
    if (e?.name === "AbortError") {
      patchState({
        status: state.enabled ? (state.executionProvider ? "ready" : "idle") : "disabled",
        downloadingModel: null,
      });
    } else {
      patchState({
        status: "error",
        downloadingModel: null,
        error: e?.message || "Local ML inference failed",
      });
    }
    throw err;
  }
}
