/**
 * Dedicated Web Worker for hybrid local NER inference:
 *   1. Chinese-native `Xenova/bert-base-chinese-ner` (~98.2 MB INT8 ONNX) for Han-dominant
 *      (Simplified / Traditional / Cantonese) posts -> 5-15x faster single-pass BIESO decoding.
 *   2. Segmented `onnx-community/gliner_multi-v2.1` (~333 MB INT8 ONNX) with native ICU
 *      `Intl.Segmenter` (`CjkAwareWordSplitter`) for Japanese, English, Russian, and mixed posts.
 *
 * Both models use 8 MiB HTTP Range resumable chunk downloading with stall watchdog,
 * IndexedDB chunk recovery, Browser Cache Storage persistence, and WebGPU/WASM execution.
 */

import { Gliner } from "gliner";
import { AutoTokenizer, env } from "@xenova/transformers";
import ortCpu from "onnxruntime-web";
import ortWebGpu from "onnxruntime-web/webgpu";
import {
  CHUNK_SIZE_BYTES,
  NER_MODEL_SPECS,
  assembleModelFromChunks,
  clearAllModelCaches,
  clearPartialChunksForModel,
  computeSavedBytes,
  deleteModelChunk,
  expectedChunkLength,
  getCompletedChunkIndices,
  putModelChunk,
  readModelMeta,
  writeModelMeta,
  type ModelDownloadMeta,
  type NerModelId,
} from "../utils/nerModelCache";
import {
  CJK_BERT_ID2LABEL,
  CjkAwareWordSplitter,
  decodeBiesoTokenLogits,
  isChineseDominantText,
  splitIntoCjkBertChunks,
  type BatchModelHint,
  type CjkWorkerNerClassId,
} from "../utils/nerCjkUtils";

export type WorkerNerClassId = CjkWorkerNerClassId;
export type WorkerMlModelFlavor = "cjk-bert" | "gliner";

export interface WorkerMlSpan {
  spanText: string;
  start: number;
  end: number;
  nerClass: WorkerNerClassId;
  rawLabel: string;
  score: number;
}

export interface WorkerPostInput {
  postKey: string;
  text: string;
}

export type WorkerExecutorPreference = "auto" | "wasm" | "webgpu";

export type WorkerInMessage =
  | {
      id: number;
      type: "warmup";
      executor?: WorkerExecutorPreference;
      modelHint?: BatchModelHint;
    }
  | {
      id: number;
      type: "infer-batch";
      posts: WorkerPostInput[];
      executor?: WorkerExecutorPreference;
    }
  | { id: number; type: "clear-cache" }
  | { id: number; type: "abort" };

export type WorkerOutMessage =
  | {
      type: "progress";
      stage: "checking" | "downloading" | "retrying" | "loading_cache" | "initializing" | "ready";
      loadedBytes: number;
      totalBytes: number;
      percent: number;
      modelId?: NerModelId;
      provider?: "webgpu" | "wasm" | null;
      cached?: boolean;
      cjkCached?: boolean;
      glinerCached?: boolean;
      retryAttempt?: number;
      maxRetries?: number;
    }
  | {
      id: number;
      type: "warmup-done";
      provider: "webgpu" | "wasm";
      cached: boolean;
      cjkCached: boolean;
      glinerCached: boolean;
    }
  | {
      id: number;
      type: "infer-done";
      provider: "webgpu" | "wasm";
      cjkCached: boolean;
      glinerCached: boolean;
      results: Array<{ postKey: string; spans: WorkerMlSpan[]; mlModel: WorkerMlModelFlavor }>;
    }
  | {
      id: number;
      type: "clear-done";
    }
  | {
      id: number;
      type: "error";
      message: string;
      aborted?: boolean;
    };

const ONNX_WASM_CDN = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.2/dist/";
const CHUNK_STALL_TIMEOUT_MS = 25_000;
const MAX_CHUNK_RETRIES = 5;
const MAX_TOKENIZER_RETRIES = 3;

// Sync @xenova/transformers runtime ONNX WASM paths to match gliner's onnxruntime-web@1.19.2
env.allowLocalModels = false;
env.useBrowserCache = true;
if ((env.backends as { onnx?: { wasm?: { wasmPaths?: string } } })?.onnx?.wasm) {
  (env.backends as { onnx: { wasm: { wasmPaths: string } } }).onnx.wasm.wasmPaths = ONNX_WASM_CDN;
}

// 11 zero-shot labels (well below model max_types = 25) mapped back to our 10 NER classes
const GLINER_LABEL_DEFS: Array<{ prompt: string; nerClass: WorkerNerClassId }> = [
  { prompt: "person", nerClass: "person" },
  { prompt: "organization", nerClass: "organization" },
  { prompt: "political party", nerClass: "organization" },
  { prompt: "military force", nerClass: "organization" },
  { prompt: "country", nerClass: "nation" },
  { prompt: "job title", nerClass: "job_position" },
  { prompt: "location", nerClass: "location" },
  { prompt: "street address or facility", nerClass: "address" },
  { prompt: "event", nerClass: "event" },
  { prompt: "law or treaty or product", nerClass: "asset_law" },
  { prompt: "financial metric", nerClass: "financial_metric" },
];

const ENTITY_PROMPTS = GLINER_LABEL_DEFS.map((d) => d.prompt);
const PROMPT_TO_NER_CLASS = new Map<string, WorkerNerClassId>(
  GLINER_LABEL_DEFS.map((d) => [d.prompt, d.nerClass])
);

const MAX_GLINER_CHUNK_WORDS = 95;
const MAX_GLINER_CHUNK_CHARS = 190;
const GLINER_OVERLAP_CHARS = 18;
const GLINER_SUBBATCH_SIZE = 4;
const CJK_BERT_SUBBATCH_SIZE = 8;
const ML_CONFIDENCE_THRESHOLD = 0.42;

// Session state for both neural models
let glinerInstance: Gliner | null = null;
let glinerProvider: "webgpu" | "wasm" | null = null;
let glinerInitPromise: Promise<{ provider: "webgpu" | "wasm"; cached: boolean }> | null = null;

type TransformersTokenizer = Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>> & {
  (
    texts: string | string[],
    opts?: Record<string, unknown>
  ): Promise<{
    input_ids: { data: ArrayLike<number | bigint>; dims: number[] };
    attention_mask: { data: ArrayLike<number | bigint>; dims: number[] };
    token_type_ids?: { data: ArrayLike<number | bigint>; dims: number[] };
  }>;
  model: {
    convert_ids_to_tokens(ids: number[]): string[];
  };
};

let cjkTokenizer: TransformersTokenizer | null = null;
let cjkSession: ortCpu.InferenceSession | null = null;
let cjkOrtRuntime: typeof ortCpu | null = null;
let cjkProvider: "webgpu" | "wasm" | null = null;
let cjkInitPromise: Promise<{ provider: "webgpu" | "wasm"; cached: boolean }> | null = null;

let activeAbortController: AbortController | null = null;
let abortRequested = false;

function emit(msg: WorkerOutMessage) {
  (self as unknown as { postMessage: (m: unknown) => void }).postMessage(msg);
}

async function detectWebGpuSupport(): Promise<boolean> {
  try {
    const nav = (
      self as unknown as { navigator?: { gpu?: { requestAdapter?: () => Promise<unknown> } } }
    ).navigator;
    if (!nav?.gpu || typeof nav.gpu.requestAdapter !== "function") {
      return false;
    }
    const adapter = await nav.gpu.requestAdapter();
    return Boolean(adapter);
  } catch {
    return false;
  }
}

async function persistModelToCache(modelId: NerModelId, bytes: Uint8Array): Promise<boolean> {
  if (typeof caches === "undefined") return false;
  const spec = NER_MODEL_SPECS[modelId];
  try {
    const cache = await caches.open(spec.cacheName);
    const resp = new Response(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Length": String(bytes.byteLength),
        },
      }
    );
    await cache.put(spec.onnxUrl, resp);
    return true;
  } catch {
    return false;
  }
}

async function readModelFromCacheStorage(modelId: NerModelId): Promise<Uint8Array | null> {
  if (typeof caches === "undefined") return null;
  const spec = NER_MODEL_SPECS[modelId];
  try {
    const cache = await caches.open(spec.cacheName);
    const cached = await cache.match(spec.onnxUrl);
    if (!cached) return null;
    emit({
      type: "progress",
      stage: "loading_cache",
      loadedBytes: 0,
      totalBytes: 0,
      percent: 100,
      modelId,
      cached: true,
      cjkCached: modelId === "cjkBert" ? true : undefined,
      glinerCached: modelId === "gliner" ? true : undefined,
    });
    const buf = await cached.arrayBuffer();
    if (buf.byteLength > spec.minValidBytes) {
      return new Uint8Array(buf);
    }
    await cache.delete(spec.onnxUrl).catch(() => {});
  } catch {
    // Cache Storage unavailable
  }
  return null;
}

function sleepWithAbort(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function waitForReconnectOrDelay(ms: number, signal: AbortSignal): Promise<void> {
  const nav = (self as unknown as { navigator?: { onLine?: boolean } }).navigator;
  if (nav && nav.onLine === false && typeof self.addEventListener === "function") {
    await new Promise<void>((resolve, reject) => {
      if (signal.aborted) {
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }
      const fallbackTimer = setTimeout(() => {
        cleanup();
        resolve();
      }, Math.max(ms, 15_000));
      const onOnline = () => {
        cleanup();
        resolve();
      };
      const onAbort = () => {
        cleanup();
        reject(new DOMException("Aborted", "AbortError"));
      };
      const cleanup = () => {
        clearTimeout(fallbackTimer);
        self.removeEventListener("online", onOnline);
        signal.removeEventListener("abort", onAbort);
      };
      self.addEventListener("online", onOnline, { once: true });
      signal.addEventListener("abort", onAbort, { once: true });
    });
    return;
  }
  await sleepWithAbort(ms, signal);
}

interface RemoteProbeInfo {
  totalBytes: number;
  etag: string;
  supportsRange: boolean;
}

async function probeRemoteModelInfo(
  modelId: NerModelId,
  signal: AbortSignal
): Promise<RemoteProbeInfo> {
  const spec = NER_MODEL_SPECS[modelId];
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= 2; attempt++) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    const stallCtrl = new AbortController();
    const timer = setTimeout(() => stallCtrl.abort(), 15_000);
    const onUserAbort = () => stallCtrl.abort();
    signal.addEventListener("abort", onUserAbort, { once: true });
    try {
      const res = await fetch(spec.onnxUrl, {
        method: "GET",
        headers: { Range: "bytes=0-0" },
        signal: stallCtrl.signal,
        mode: "cors",
        credentials: "omit",
      });

      if (res.status === 206) {
        await res.body?.cancel().catch(() => {});
        const cr = res.headers.get("content-range") || "";
        const match = cr.match(/\/(\d+)\s*$/);
        const totalBytes = match ? Number(match[1]) : spec.approxBytes;
        const etag = (res.headers.get("etag") || "").replace(/"/g, "");
        return {
          totalBytes:
            Number.isFinite(totalBytes) && totalBytes > 0 ? totalBytes : spec.approxBytes,
          etag,
          supportsRange: true,
        };
      }

      if (res.ok) {
        const len = Number(res.headers.get("content-length") || "0");
        const etag = (res.headers.get("etag") || "").replace(/"/g, "");
        await res.body?.cancel().catch(() => {});
        return {
          totalBytes: Number.isFinite(len) && len > 0 ? len : spec.approxBytes,
          etag,
          supportsRange: false,
        };
      }

      throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      lastErr = err;
      if (attempt < 2) {
        await waitForReconnectOrDelay(1500 * (attempt + 1), signal);
      }
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", onUserAbort);
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error("Unable to reach Hugging Face CDN");
}

async function fetchSingleRangeChunkWithWatchdog(
  modelId: NerModelId,
  startByte: number,
  endByte: number,
  expectedLen: number,
  baseLoadedBytes: number,
  totalBytes: number,
  signal: AbortSignal
): Promise<ArrayBuffer> {
  const spec = NER_MODEL_SPECS[modelId];
  const chunkCtrl = new AbortController();
  let timedOut = false;
  let stallTimer: ReturnType<typeof setTimeout> | null = null;

  const resetWatchdog = () => {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      timedOut = true;
      chunkCtrl.abort();
    }, CHUNK_STALL_TIMEOUT_MS);
  };

  const onUserAbort = () => chunkCtrl.abort();
  signal.addEventListener("abort", onUserAbort, { once: true });
  resetWatchdog();

  try {
    const res = await fetch(spec.onnxUrl, {
      method: "GET",
      headers: { Range: `bytes=${startByte}-${endByte}` },
      signal: chunkCtrl.signal,
      mode: "cors",
      credentials: "omit",
    });

    if (res.status !== 206 && !res.ok) {
      const err = new Error(`Failed chunk fetch (HTTP ${res.status})`);
      (err as Error & { status?: number }).status = res.status;
      throw err;
    }

    if (!res.body) {
      const buf = await res.arrayBuffer();
      if (res.status === 200 && buf.byteLength > expectedLen && startByte === 0) {
        return buf;
      }
      if (buf.byteLength !== expectedLen) {
        throw new Error(`Incomplete chunk (${buf.byteLength}/${expectedLen} bytes)`);
      }
      return buf;
    }

    const reader = res.body.getReader();
    const parts: Uint8Array[] = [];
    let chunkReceived = 0;
    let lastEmit = 0;

    while (true) {
      if (signal.aborted) {
        await reader.cancel().catch(() => {});
        throw new DOMException("Download aborted", "AbortError");
      }
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.byteLength > 0) {
        resetWatchdog();
        parts.push(value);
        chunkReceived += value.byteLength;
        const now = performance.now();
        if (now - lastEmit >= 120) {
          lastEmit = now;
          const totalLoaded = Math.min(totalBytes, baseLoadedBytes + chunkReceived);
          const pct = Math.min(
            99,
            Math.round((totalLoaded / Math.max(totalLoaded, totalBytes)) * 100)
          );
          emit({
            type: "progress",
            stage: "downloading",
            modelId,
            loadedBytes: totalLoaded,
            totalBytes,
            percent: pct,
          });
        }
      }
    }

    if (res.status === 200 && chunkReceived > expectedLen && startByte === 0) {
      const fullBuf = new Uint8Array(chunkReceived);
      let off = 0;
      for (const p of parts) {
        fullBuf.set(p, off);
        off += p.byteLength;
      }
      return fullBuf.buffer;
    }

    if (chunkReceived !== expectedLen) {
      throw new Error(`Truncated chunk (${chunkReceived}/${expectedLen} bytes)`);
    }

    const out = new Uint8Array(chunkReceived);
    let offset = 0;
    for (const p of parts) {
      out.set(p, offset);
      offset += p.byteLength;
    }
    return out.buffer;
  } catch (err: unknown) {
    if (signal.aborted) {
      throw new DOMException("Download aborted", "AbortError");
    }
    if (timedOut) {
      throw new Error("Connection stalled while downloading chunk");
    }
    throw err;
  } finally {
    if (stallTimer) clearTimeout(stallTimer);
    signal.removeEventListener("abort", onUserAbort);
  }
}

async function streamFullFallbackWithChunkSaves(
  modelId: NerModelId,
  totalBytesHint: number,
  signal: AbortSignal
): Promise<Uint8Array> {
  const spec = NER_MODEL_SPECS[modelId];
  const res = await fetch(spec.onnxUrl, {
    signal,
    mode: "cors",
    credentials: "omit",
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch model weights (HTTP ${res.status})`);
  }
  const len = Number(res.headers.get("content-length") || "0");
  const totalBytes = len > 0 ? len : totalBytesHint;
  const reader = res.body?.getReader();
  if (!reader) {
    return new Uint8Array(await res.arrayBuffer());
  }

  const out = new Uint8Array(totalBytes);
  let loaded = 0;
  let lastEmit = 0;
  while (true) {
    if (signal.aborted) {
      await reader.cancel().catch(() => {});
      throw new DOMException("Download aborted", "AbortError");
    }
    const { done, value } = await reader.read();
    if (done) break;
    if (value && value.byteLength > 0) {
      if (loaded + value.byteLength <= out.byteLength) {
        out.set(value, loaded);
      }
      loaded += value.byteLength;
      const now = performance.now();
      if (now - lastEmit >= 150) {
        lastEmit = now;
        emit({
          type: "progress",
          stage: "downloading",
          modelId,
          loadedBytes: loaded,
          totalBytes: Math.max(loaded, totalBytes),
          percent: Math.min(99, Math.round((loaded / Math.max(loaded, totalBytes)) * 100)),
        });
      }
    }
  }
  return loaded === out.byteLength ? out : out.slice(0, loaded);
}

async function loadOrDownloadModelBytes(
  modelId: NerModelId,
  signal: AbortSignal
): Promise<{ bytes: Uint8Array; fromCache: boolean }> {
  const spec = NER_MODEL_SPECS[modelId];
  emit({
    type: "progress",
    stage: "checking",
    modelId,
    loadedBytes: 0,
    totalBytes: 0,
    percent: 0,
  });

  // 1. Fast path: assembled model already in Cache Storage
  const fromCacheStorage = await readModelFromCacheStorage(modelId);
  if (fromCacheStorage) {
    await clearPartialChunksForModel(modelId);
    return { bytes: fromCacheStorage, fromCache: true };
  }

  // 2. Check if IndexedDB already holds all verified chunks for this model
  const existingMeta = await readModelMeta(modelId);
  if (existingMeta && existingMeta.totalBytes > spec.minValidBytes) {
    const completed = await getCompletedChunkIndices(modelId);
    if (completed.size >= existingMeta.numChunks) {
      const assembled = await assembleModelFromChunks(existingMeta, modelId);
      if (assembled.bytes) {
        const persisted = await persistModelToCache(modelId, assembled.bytes);
        if (persisted) await clearPartialChunksForModel(modelId);
        return { bytes: assembled.bytes, fromCache: true };
      }
      for (const badIdx of assembled.invalidIndices) {
        await deleteModelChunk(badIdx, modelId);
      }
    }
  }

  // 3. Probe remote metadata (totalBytes, ETag, Range support)
  const probe = await probeRemoteModelInfo(modelId, signal);
  const numChunks = Math.ceil(probe.totalBytes / CHUNK_SIZE_BYTES);

  let meta: ModelDownloadMeta = {
    key: spec.metaKey,
    url: spec.onnxUrl,
    etag: probe.etag,
    totalBytes: probe.totalBytes,
    chunkSize: CHUNK_SIZE_BYTES,
    numChunks,
    updatedAt: Date.now(),
  };

  let completed = new Set<number>();
  if (
    existingMeta &&
    existingMeta.totalBytes === probe.totalBytes &&
    existingMeta.chunkSize === CHUNK_SIZE_BYTES &&
    (!probe.etag || !existingMeta.etag || existingMeta.etag === probe.etag)
  ) {
    completed = await getCompletedChunkIndices(modelId);
    meta = { ...existingMeta, etag: probe.etag || existingMeta.etag, updatedAt: Date.now() };
    await writeModelMeta(meta, modelId);
  } else {
    await clearPartialChunksForModel(modelId);
    await writeModelMeta(meta, modelId);
  }

  let completedBytes = computeSavedBytes(completed, meta.totalBytes, meta.chunkSize);
  emit({
    type: "progress",
    stage: "downloading",
    modelId,
    loadedBytes: completedBytes,
    totalBytes: meta.totalBytes,
    percent: Math.min(99, Math.round((completedBytes / meta.totalBytes) * 100)),
  });

  if (!probe.supportsRange && completed.size === 0) {
    const fullBytes = await streamFullFallbackWithChunkSaves(modelId, meta.totalBytes, signal);
    emit({
      type: "progress",
      stage: "downloading",
      modelId,
      loadedBytes: fullBytes.byteLength,
      totalBytes: fullBytes.byteLength,
      percent: 100,
    });
    const persisted = await persistModelToCache(modelId, fullBytes);
    if (persisted) await clearPartialChunksForModel(modelId);
    return { bytes: fullBytes, fromCache: false };
  }

  // 4. Download missing 8 MiB chunks sequentially with stall timeout + exponential backoff retries
  for (let pass = 0; pass < 2; pass++) {
    for (let idx = 0; idx < meta.numChunks; idx++) {
      if (completed.has(idx)) continue;
      if (signal.aborted) {
        throw new DOMException("Download aborted", "AbortError");
      }

      const startByte = idx * meta.chunkSize;
      const expectedLen = expectedChunkLength(idx, meta.totalBytes, meta.chunkSize);
      const endByte = startByte + expectedLen - 1;

      let chunkBuf: ArrayBuffer | null = null;
      let lastErr: unknown = null;

      for (let attempt = 0; attempt <= MAX_CHUNK_RETRIES; attempt++) {
        try {
          chunkBuf = await fetchSingleRangeChunkWithWatchdog(
            modelId,
            startByte,
            endByte,
            expectedLen,
            completedBytes,
            meta.totalBytes,
            signal
          );
          break;
        } catch (err: unknown) {
          if (signal.aborted || (err as { name?: string })?.name === "AbortError") {
            throw new DOMException("Download aborted", "AbortError");
          }
          const status = (err as { status?: number })?.status;
          if (status === 404 || status === 403 || status === 416) {
            throw err;
          }
          lastErr = err;
          if (attempt >= MAX_CHUNK_RETRIES) {
            throw err;
          }
          const delayMs =
            Math.min(20_000, 1500 * Math.pow(2, attempt)) + Math.round(Math.random() * 400);
          const pct = Math.min(99, Math.round((completedBytes / meta.totalBytes) * 100));
          emit({
            type: "progress",
            stage: "retrying",
            modelId,
            loadedBytes: completedBytes,
            totalBytes: meta.totalBytes,
            percent: pct,
            retryAttempt: attempt + 1,
            maxRetries: MAX_CHUNK_RETRIES,
          });
          await waitForReconnectOrDelay(delayMs, signal);
        }
      }

      if (!chunkBuf) {
        throw lastErr instanceof Error ? lastErr : new Error("Failed downloading model chunk");
      }

      if (idx === 0 && chunkBuf.byteLength === meta.totalBytes && expectedLen < meta.totalBytes) {
        const full = new Uint8Array(chunkBuf);
        emit({
          type: "progress",
          stage: "downloading",
          modelId,
          loadedBytes: full.byteLength,
          totalBytes: full.byteLength,
          percent: 100,
        });
        const persisted = await persistModelToCache(modelId, full);
        if (persisted) await clearPartialChunksForModel(modelId);
        return { bytes: full, fromCache: false };
      }

      await putModelChunk(idx, chunkBuf, modelId);
      completed.add(idx);
      completedBytes = computeSavedBytes(completed, meta.totalBytes, meta.chunkSize);

      emit({
        type: "progress",
        stage: "downloading",
        modelId,
        loadedBytes: completedBytes,
        totalBytes: meta.totalBytes,
        percent:
          completed.size >= meta.numChunks
            ? 100
            : Math.min(99, Math.round((completedBytes / meta.totalBytes) * 100)),
      });
    }

    // Assemble & verify all chunks
    const assembled = await assembleModelFromChunks(meta, modelId);
    if (assembled.bytes) {
      emit({
        type: "progress",
        stage: "downloading",
        modelId,
        loadedBytes: assembled.bytes.byteLength,
        totalBytes: assembled.bytes.byteLength,
        percent: 100,
      });
      const persisted = await persistModelToCache(modelId, assembled.bytes);
      if (persisted) {
        await clearPartialChunksForModel(modelId);
      }
      return { bytes: assembled.bytes, fromCache: false };
    }

    for (const badIdx of assembled.invalidIndices) {
      completed.delete(badIdx);
      await deleteModelChunk(badIdx, modelId);
    }
    completedBytes = computeSavedBytes(completed, meta.totalBytes, meta.chunkSize);
  }

  throw new Error("Model verification failed after assembling chunks");
}

async function resolveTargetProvider(
  preference: WorkerExecutorPreference
): Promise<"webgpu" | "wasm"> {
  if (preference === "wasm") return "wasm";
  const canWebGpu = await detectWebGpuSupport();
  if (preference === "webgpu") {
    if (!canWebGpu) {
      throw new Error(
        "WebGPU adapter unavailable in this browser; switch executor to WASM or Auto."
      );
    }
    return "webgpu";
  }
  return canWebGpu ? "webgpu" : "wasm";
}

function isWebGpuSessionError(err: unknown, provider: "webgpu" | "wasm"): boolean {
  if (provider !== "webgpu") return false;
  const msg = String((err as { message?: string })?.message || "").toLowerCase();
  return (
    msg.includes("webgpu") ||
    msg.includes("gpu") ||
    msg.includes("adapter") ||
    msg.includes("session")
  );
}

// ---------------------------------------------------------------------------
// 1. CJK-Native BERT Token Classifier (`Xenova/bert-base-chinese-ner`)
// ---------------------------------------------------------------------------

async function createCjkBertSession(
  bytes: Uint8Array,
  provider: "webgpu" | "wasm",
  signal: AbortSignal
): Promise<{
  tokenizer: TransformersTokenizer;
  session: ortCpu.InferenceSession;
  ortRuntime: typeof ortCpu;
}> {
  const isCrossOriginIsolated = Boolean(
    (self as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated
  );
  const ortRuntime: typeof ortCpu =
    provider === "webgpu" ? (ortWebGpu as unknown as typeof ortCpu) : ortCpu;

  ortRuntime.env.wasm.wasmPaths = ONNX_WASM_CDN;
  if (provider === "wasm") {
    const maxThreads = (self.navigator?.hardwareConcurrency ?? 2);
    ortRuntime.env.wasm.numThreads = isCrossOriginIsolated ? Math.min(4, maxThreads) : 1;
  }

  let lastErr: unknown = null;
  for (let attempt = 0; attempt < MAX_TOKENIZER_RETRIES; attempt++) {
    if (signal.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    try {
      const tokenizer = (await AutoTokenizer.from_pretrained(
        NER_MODEL_SPECS.cjkBert.repoId
      )) as unknown as TransformersTokenizer;
      const session = await ortRuntime.InferenceSession.create(bytes, {
        executionProviders: [provider],
      });
      return { tokenizer, session, ortRuntime };
    } catch (err) {
      lastErr = err;
      if (isWebGpuSessionError(err, provider)) {
        throw err;
      }
      if (attempt < MAX_TOKENIZER_RETRIES - 1) {
        await waitForReconnectOrDelay(1500 * (attempt + 1), signal);
      }
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error("Failed initializing CJK BERT NER session");
}

async function ensureCjkBertInitialized(
  signal: AbortSignal,
  preference: WorkerExecutorPreference = "auto"
): Promise<{ provider: "webgpu" | "wasm"; cached: boolean }> {
  const needsSwitch =
    Boolean(cjkSession && cjkTokenizer && cjkProvider) &&
    ((preference === "wasm" && cjkProvider !== "wasm") ||
      (preference === "webgpu" && cjkProvider !== "webgpu"));

  if (needsSwitch) {
    cjkSession = null;
    cjkOrtRuntime = null;
    cjkProvider = null;
  }

  if (cjkSession && cjkTokenizer && cjkProvider) {
    return { provider: cjkProvider, cached: true };
  }

  if (cjkInitPromise) {
    return await cjkInitPromise;
  }

  cjkInitPromise = (async () => {
    const { bytes, fromCache } = await loadOrDownloadModelBytes("cjkBert", signal);
    if (signal.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    const preferred = await resolveTargetProvider(preference);
    emit({
      type: "progress",
      stage: "initializing",
      modelId: "cjkBert",
      loadedBytes: bytes.byteLength,
      totalBytes: bytes.byteLength,
      percent: 100,
      provider: preferred,
      cached: true,
    });

    if (preferred === "webgpu") {
      try {
        const res = await createCjkBertSession(bytes, "webgpu", signal);
        cjkTokenizer = res.tokenizer;
        cjkSession = res.session;
        cjkOrtRuntime = res.ortRuntime;
        cjkProvider = "webgpu";
      } catch (err) {
        if (signal.aborted || (err as { name?: string })?.name === "AbortError") {
          throw err;
        }
        if (preference === "webgpu") {
          throw err;
        }
        emit({
          type: "progress",
          stage: "initializing",
          modelId: "cjkBert",
          loadedBytes: bytes.byteLength,
          totalBytes: bytes.byteLength,
          percent: 100,
          provider: "wasm",
          cached: true,
        });
        const fallbackBytes = (await readModelFromCacheStorage("cjkBert")) || bytes;
        const res = await createCjkBertSession(fallbackBytes, "wasm", signal);
        cjkTokenizer = res.tokenizer;
        cjkSession = res.session;
        cjkOrtRuntime = res.ortRuntime;
        cjkProvider = "wasm";
      }
    } else {
      const res = await createCjkBertSession(bytes, "wasm", signal);
      cjkTokenizer = res.tokenizer;
      cjkSession = res.session;
      cjkOrtRuntime = res.ortRuntime;
      cjkProvider = "wasm";
    }

    emit({
      type: "progress",
      stage: "ready",
      modelId: "cjkBert",
      loadedBytes: bytes.byteLength,
      totalBytes: bytes.byteLength,
      percent: 100,
      provider: cjkProvider,
      cached: fromCache,
      cjkCached: true,
      glinerCached: Boolean(glinerInstance),
    });

    return { provider: cjkProvider, cached: fromCache };
  })();

  try {
    return await cjkInitPromise;
  } catch (err) {
    cjkSession = null;
    cjkOrtRuntime = null;
    cjkProvider = null;
    throw err;
  } finally {
    cjkInitPromise = null;
  }
}

function toInt64Tensor(
  ortMod: typeof ortCpu,
  tensorLike: { data: ArrayLike<number | bigint>; dims: number[] }
) {
  const src = tensorLike.data;
  const big =
    src instanceof BigInt64Array
      ? src
      : BigInt64Array.from({ length: src.length }, (_, k) => BigInt(src[k]));
  return new ortMod.Tensor("int64", big, tensorLike.dims);
}

async function runCjkBertBatchWithAutoFallback(
  texts: string[],
  signal: AbortSignal,
  preference: WorkerExecutorPreference
): Promise<WorkerMlSpan[][]> {
  if (!cjkSession || !cjkTokenizer || !cjkOrtRuntime) {
    await ensureCjkBertInitialized(signal, preference);
  }

  const execOnce = async (): Promise<WorkerMlSpan[][]> => {
    const tokenizer = cjkTokenizer!;
    const session = cjkSession!;
    const ortMod = cjkOrtRuntime!;

    const encoded = await tokenizer(texts, {
      padding: true,
      truncation: true,
      max_length: 512,
    });

    const dims = encoded.input_ids.dims || [texts.length, 0];
    const batchSize = dims[0] || texts.length;
    const seqLen = dims[1] || Math.floor(encoded.input_ids.data.length / Math.max(1, batchSize));

    const feeds: Record<string, ortCpu.Tensor> = {};
    const expectedInputs = new Set(session.inputNames || ["input_ids", "attention_mask"]);
    if (expectedInputs.has("input_ids")) {
      feeds.input_ids = toInt64Tensor(ortMod, {
        data: encoded.input_ids.data,
        dims: [batchSize, seqLen],
      });
    }
    if (expectedInputs.has("attention_mask") && encoded.attention_mask) {
      feeds.attention_mask = toInt64Tensor(ortMod, {
        data: encoded.attention_mask.data,
        dims: [batchSize, seqLen],
      });
    }
    if (expectedInputs.has("token_type_ids")) {
      if (encoded.token_type_ids) {
        feeds.token_type_ids = toInt64Tensor(ortMod, {
          data: encoded.token_type_ids.data,
          dims: [batchSize, seqLen],
        });
      } else {
        feeds.token_type_ids = new ortMod.Tensor(
          "int64",
          new BigInt64Array(batchSize * seqLen),
          [batchSize, seqLen]
        );
      }
    }

    const outputs = await session.run(feeds);
    const outName = session.outputNames?.[0] || "logits";
    const logitsTensor = outputs.logits || outputs[outName];
    if (!logitsTensor || !logitsTensor.data) {
      return texts.map(() => []);
    }

    const logitsData = logitsTensor.data as Float32Array;
    const outDims = logitsTensor.dims || [batchSize, seqLen, 73];
    const numLabels = outDims[2] || 73;

    const batchDecoded: WorkerMlSpan[][] = [];
    for (let b = 0; b < batchSize; b++) {
      const rowOffset = b * seqLen;
      const rowIds: number[] = new Array(seqLen);
      const rowMask: number[] = new Array(seqLen);
      for (let t = 0; t < seqLen; t++) {
        rowIds[t] = Number(encoded.input_ids.data[rowOffset + t]);
        rowMask[t] = encoded.attention_mask
          ? Number(encoded.attention_mask.data[rowOffset + t])
          : 1;
      }
      const tokens = tokenizer.model.convert_ids_to_tokens(rowIds);
      const spans = decodeBiesoTokenLogits({
        text: texts[b],
        tokens,
        attentionMask: rowMask,
        logitsData,
        batchIndex: b,
        seqLen,
        numLabels,
        id2label: CJK_BERT_ID2LABEL,
        confidenceThreshold: 0.48,
      });
      batchDecoded.push(spans);
    }
    return batchDecoded;
  };

  try {
    return await execOnce();
  } catch (err) {
    if (cjkProvider === "webgpu" && preference !== "webgpu") {
      cjkSession = null;
      cjkOrtRuntime = null;
      cjkProvider = null;
      const { bytes, fromCache } = await loadOrDownloadModelBytes("cjkBert", signal);
      emit({
        type: "progress",
        stage: "initializing",
        modelId: "cjkBert",
        loadedBytes: bytes.byteLength,
        totalBytes: bytes.byteLength,
        percent: 100,
        provider: "wasm",
        cached: fromCache,
      });
      const res = await createCjkBertSession(bytes, "wasm", signal);
      cjkTokenizer = res.tokenizer;
      cjkSession = res.session;
      cjkOrtRuntime = res.ortRuntime;
      cjkProvider = "wasm";
      emit({
        type: "progress",
        stage: "ready",
        modelId: "cjkBert",
        loadedBytes: bytes.byteLength,
        totalBytes: bytes.byteLength,
        percent: 100,
        provider: "wasm",
        cached: fromCache,
        cjkCached: true,
      });
      return await execOnce();
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// 2. Multilingual Segmented GLiNER (`onnx-community/gliner_multi-v2.1`)
// ---------------------------------------------------------------------------

async function createGlinerSession(
  bytes: Uint8Array,
  provider: "webgpu" | "wasm",
  signal: AbortSignal
): Promise<Gliner> {
  const isCrossOriginIsolated = Boolean(
    (self as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated
  );
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < MAX_TOKENIZER_RETRIES; attempt++) {
    if (signal.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    try {
      const gliner = new Gliner({
        tokenizerPath: NER_MODEL_SPECS.gliner.repoId,
        modelType: "span-level",
        maxWidth: 12,
        onnxSettings: {
          modelPath: bytes,
          executionProvider: provider,
          wasmPaths: ONNX_WASM_CDN,
          multiThread: provider === "wasm" ? isCrossOriginIsolated : false,
          fetchBinary: false,
        },
        transformersSettings: {
          allowLocalModels: false,
          useBrowserCache: true,
        },
      });
      await gliner.initialize();
      // Swap default character-splitting WhitespaceTokenSplitter with native ICU Intl.Segmenter splitter
      const glinerInternal = gliner as unknown as {
        model?: { processor?: { wordsSplitter?: unknown } };
      };
      if (glinerInternal.model?.processor) {
        glinerInternal.model.processor.wordsSplitter = new CjkAwareWordSplitter();
      }
      return gliner;
    } catch (err) {
      lastErr = err;
      if (isWebGpuSessionError(err, provider)) {
        throw err;
      }
      if (attempt < MAX_TOKENIZER_RETRIES - 1) {
        await waitForReconnectOrDelay(1500 * (attempt + 1), signal);
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Failed initializing GLiNER session");
}

async function ensureGlinerInitialized(
  signal: AbortSignal,
  preference: WorkerExecutorPreference = "auto"
): Promise<{
  provider: "webgpu" | "wasm";
  cached: boolean;
}> {
  const needsSwitch =
    Boolean(glinerInstance && glinerProvider) &&
    ((preference === "wasm" && glinerProvider !== "wasm") ||
      (preference === "webgpu" && glinerProvider !== "webgpu"));

  if (needsSwitch) {
    glinerInstance = null;
    glinerProvider = null;
  }

  if (glinerInstance && glinerProvider) {
    return { provider: glinerProvider, cached: true };
  }

  if (glinerInitPromise) {
    return await glinerInitPromise;
  }

  glinerInitPromise = (async () => {
    const { bytes, fromCache } = await loadOrDownloadModelBytes("gliner", signal);
    if (signal.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    const preferred = await resolveTargetProvider(preference);
    emit({
      type: "progress",
      stage: "initializing",
      modelId: "gliner",
      loadedBytes: bytes.byteLength,
      totalBytes: bytes.byteLength,
      percent: 100,
      provider: preferred,
      cached: true,
    });

    if (preferred === "webgpu") {
      try {
        glinerInstance = await createGlinerSession(bytes, "webgpu", signal);
        glinerProvider = "webgpu";
      } catch (err) {
        if (signal.aborted || (err as { name?: string })?.name === "AbortError") {
          throw err;
        }
        if (preference === "webgpu") {
          throw err;
        }
        emit({
          type: "progress",
          stage: "initializing",
          modelId: "gliner",
          loadedBytes: bytes.byteLength,
          totalBytes: bytes.byteLength,
          percent: 100,
          provider: "wasm",
          cached: true,
        });
        const fallbackBytes = (await readModelFromCacheStorage("gliner")) || bytes;
        glinerInstance = await createGlinerSession(fallbackBytes, "wasm", signal);
        glinerProvider = "wasm";
      }
    } else {
      glinerInstance = await createGlinerSession(bytes, "wasm", signal);
      glinerProvider = "wasm";
    }

    emit({
      type: "progress",
      stage: "ready",
      modelId: "gliner",
      loadedBytes: bytes.byteLength,
      totalBytes: bytes.byteLength,
      percent: 100,
      provider: glinerProvider,
      cached: fromCache,
      cjkCached: Boolean(cjkSession),
      glinerCached: true,
    });

    return { provider: glinerProvider, cached: fromCache };
  })();

  try {
    return await glinerInitPromise;
  } catch (err) {
    glinerInstance = null;
    glinerProvider = null;
    throw err;
  } finally {
    glinerInitPromise = null;
  }
}

const cjkWordSplitter = new CjkAwareWordSplitter();

function countSegmentedWords(s: string): number {
  let n = 0;
  for (const _tok of cjkWordSplitter.call(s)) {
    n += 1;
  }
  return n;
}

interface TextChunk {
  chunkText: string;
  startOffset: number;
}

/**
 * Splits post text into clause-sized chunks whose token length stays comfortably
 * inside GLiNER's 384-token mDeBERTa window across Latin, Japanese, CJK, and Cyrillic scripts.
 */
function splitIntoGlinerChunks(text: string): TextChunk[] {
  if (!text || text.trim().length < 2) return [];
  const rawSegments: Array<{ text: string; startOffset: number }> = [];

  const rxBoundary = /[^\n.!?。！？]+(?:[.!?。！？]+|$)/g;
  let m: RegExpExecArray | null;
  while ((m = rxBoundary.exec(text)) !== null) {
    const seg = m[0];
    if (seg.trim().length < 2) continue;
    rawSegments.push({ text: seg, startOffset: m.index });
  }

  if (rawSegments.length === 0) {
    rawSegments.push({ text, startOffset: 0 });
  }

  const finalChunks: TextChunk[] = [];
  for (const seg of rawSegments) {
    if (
      seg.text.length <= MAX_GLINER_CHUNK_CHARS &&
      countSegmentedWords(seg.text) <= MAX_GLINER_CHUNK_WORDS
    ) {
      finalChunks.push({ chunkText: seg.text, startOffset: seg.startOffset });
      continue;
    }

    const subParts: Array<{ text: string; startOffset: number }> = [];
    const rxClause = /[^,，;；:：\n]+(?:[,，;；:：]+|$)/g;
    let cm: RegExpExecArray | null;
    while ((cm = rxClause.exec(seg.text)) !== null) {
      if (cm[0].trim().length >= 2) {
        subParts.push({ text: cm[0], startOffset: seg.startOffset + cm.index });
      }
    }

    const partsToPack = subParts.length > 1 ? subParts : [seg];
    for (const part of partsToPack) {
      if (
        part.text.length <= MAX_GLINER_CHUNK_CHARS &&
        countSegmentedWords(part.text) <= MAX_GLINER_CHUNK_WORDS
      ) {
        finalChunks.push({ chunkText: part.text, startOffset: part.startOffset });
        continue;
      }

      let pos = 0;
      while (pos < part.text.length) {
        let end = Math.min(part.text.length, pos + MAX_GLINER_CHUNK_CHARS);
        if (end < part.text.length) {
          const spaceBack = part.text.lastIndexOf(" ", end);
          if (spaceBack > pos + 40) {
            end = spaceBack + 1;
          }
        }
        const slice = part.text.slice(pos, end);
        if (slice.trim().length >= 2) {
          finalChunks.push({
            chunkText: slice,
            startOffset: part.startOffset + pos,
          });
        }
        if (end >= part.text.length) break;
        pos = Math.max(pos + 24, end - GLINER_OVERLAP_CHARS);
      }
    }
  }

  return finalChunks;
}

async function runGlinerInferenceWithAutoFallback(
  texts: string[],
  signal: AbortSignal,
  preference: WorkerExecutorPreference = "auto"
): ReturnType<Gliner["inference"]> {
  if (!glinerInstance) {
    await ensureGlinerInitialized(signal, preference);
  }
  try {
    return await glinerInstance!.inference({
      texts,
      entities: ENTITY_PROMPTS,
      flatNer: true,
      threshold: ML_CONFIDENCE_THRESHOLD,
      multiLabel: false,
    });
  } catch (err) {
    if (glinerProvider === "webgpu" && preference !== "webgpu") {
      glinerInstance = null;
      glinerProvider = null;
      const { bytes, fromCache } = await loadOrDownloadModelBytes("gliner", signal);
      emit({
        type: "progress",
        stage: "initializing",
        modelId: "gliner",
        loadedBytes: bytes.byteLength,
        totalBytes: bytes.byteLength,
        percent: 100,
        provider: "wasm",
        cached: fromCache,
      });
      glinerInstance = await createGlinerSession(bytes, "wasm", signal);
      glinerProvider = "wasm";
      emit({
        type: "progress",
        stage: "ready",
        modelId: "gliner",
        loadedBytes: bytes.byteLength,
        totalBytes: bytes.byteLength,
        percent: 100,
        provider: "wasm",
        cached: fromCache,
        cjkCached: Boolean(cjkSession),
        glinerCached: true,
      });
      return await glinerInstance.inference({
        texts,
        entities: ENTITY_PROMPTS,
        flatNer: true,
        threshold: ML_CONFIDENCE_THRESHOLD,
        multiLabel: false,
      });
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// 3. Unified Batch Dispatcher (Chinese BERT + Multilingual Segmented GLiNER)
// ---------------------------------------------------------------------------

function deduplicatePostSpans(rawSpans: WorkerMlSpan[], overlapWindow: number): WorkerMlSpan[] {
  const spans = [...rawSpans].sort((a, b) => b.score - a.score);
  const kept: WorkerMlSpan[] = [];
  for (const s of spans) {
    const overlaps = kept.some(
      (k) =>
        (s.start < k.end && s.end > k.start) ||
        (s.nerClass === k.nerClass &&
          s.spanText.toLowerCase() === k.spanText.toLowerCase() &&
          Math.abs(s.start - k.start) <= overlapWindow)
    );
    if (!overlaps) {
      kept.push(s);
    }
  }
  kept.sort((a, b) => a.start - b.start);
  return kept;
}

async function handleInferBatch(
  posts: WorkerPostInput[],
  signal: AbortSignal,
  preference: WorkerExecutorPreference = "auto"
) {
  interface ChunkJob {
    postIndex: number;
    chunkText: string;
    startOffset: number;
  }

  const cjkJobs: ChunkJob[] = [];
  const glinerJobs: ChunkJob[] = [];
  const perPostModelFlavor: WorkerMlModelFlavor[] = posts.map(() => "gliner");
  const perPostRawSpans: WorkerMlSpan[][] = posts.map(() => []);

  posts.forEach((p, idx) => {
    const text = p.text || "";
    if (isChineseDominantText(text)) {
      perPostModelFlavor[idx] = "cjk-bert";
      for (const ch of splitIntoCjkBertChunks(text)) {
        cjkJobs.push({
          postIndex: idx,
          chunkText: ch.chunkText,
          startOffset: ch.startOffset,
        });
      }
    } else {
      perPostModelFlavor[idx] = "gliner";
      for (const ch of splitIntoGlinerChunks(text)) {
        glinerJobs.push({
          postIndex: idx,
          chunkText: ch.chunkText,
          startOffset: ch.startOffset,
        });
      }
    }
  });

  let resolvedProvider: "webgpu" | "wasm" =
    cjkProvider || glinerProvider || (preference === "webgpu" ? "webgpu" : "wasm");

  // 1. Fast CJK BERT Token Classification Pass
  if (cjkJobs.length > 0) {
    const cjkInit = await ensureCjkBertInitialized(signal, preference);
    resolvedProvider = cjkInit.provider;

    cjkJobs.sort((a, b) => a.chunkText.length - b.chunkText.length);
    for (let i = 0; i < cjkJobs.length; i += CJK_BERT_SUBBATCH_SIZE) {
      if (abortRequested || signal.aborted) {
        throw new DOMException("Inference aborted", "AbortError");
      }
      const batchJobs = cjkJobs.slice(i, i + CJK_BERT_SUBBATCH_SIZE);
      const batchSpans = await runCjkBertBatchWithAutoFallback(
        batchJobs.map((j) => j.chunkText),
        signal,
        preference
      );
      if (cjkProvider) {
        resolvedProvider = cjkProvider;
      }

      for (let j = 0; j < batchJobs.length; j++) {
        const job = batchJobs[j];
        const entities = batchSpans[j] || [];
        for (const ent of entities) {
          perPostRawSpans[job.postIndex].push({
            spanText: ent.spanText,
            start: job.startOffset + Math.max(0, ent.start),
            end: job.startOffset + Math.max(0, ent.end),
            nerClass: ent.nerClass,
            rawLabel: ent.rawLabel,
            score: ent.score,
          });
        }
      }
    }
  }

  // 2. Segmented Multilingual GLiNER Pass (Japanese, English, Russian, Mixed)
  if (glinerJobs.length > 0) {
    const glInit = await ensureGlinerInitialized(signal, preference);
    resolvedProvider = glInit.provider;

    glinerJobs.sort((a, b) => a.chunkText.length - b.chunkText.length);
    for (let i = 0; i < glinerJobs.length; i += GLINER_SUBBATCH_SIZE) {
      if (abortRequested || signal.aborted) {
        throw new DOMException("Inference aborted", "AbortError");
      }
      const batchJobs = glinerJobs.slice(i, i + GLINER_SUBBATCH_SIZE);
      const batchResults = await runGlinerInferenceWithAutoFallback(
        batchJobs.map((j) => j.chunkText),
        signal,
        preference
      );
      if (glinerProvider) {
        resolvedProvider = glinerProvider;
      }

      for (let j = 0; j < batchJobs.length; j++) {
        const job = batchJobs[j];
        const entities = batchResults[j] || [];
        for (const ent of entities) {
          const nerClass = PROMPT_TO_NER_CLASS.get(ent.label);
          if (!nerClass) continue;
          const cleanSpan = String(ent.spanText || "").trim();
          if (cleanSpan.length < 2) continue;
          perPostRawSpans[job.postIndex].push({
            spanText: cleanSpan,
            start: job.startOffset + Math.max(0, ent.start),
            end: job.startOffset + Math.max(0, ent.end),
            nerClass,
            rawLabel: ent.label,
            score: Number(ent.score || 0),
          });
        }
      }
    }
  }

  const results = posts.map((p, idx) => ({
    postKey: p.postKey,
    mlModel: perPostModelFlavor[idx],
    spans: deduplicatePostSpans(perPostRawSpans[idx], 24),
  }));

  return {
    provider: resolvedProvider,
    cjkCached: Boolean(cjkSession),
    glinerCached: Boolean(glinerInstance),
    results,
  };
}

// Serialize async operations inside worker so ONNX sessions aren't mutated concurrently
let taskQueue: Promise<void> = Promise.resolve();

self.addEventListener("message", (ev: MessageEvent<WorkerInMessage>) => {
  const msg = ev.data;
  if (!msg) return;

  if (msg.type === "abort") {
    abortRequested = true;
    activeAbortController?.abort();
    return;
  }

  taskQueue = taskQueue.then(async () => {
    abortRequested = false;
    activeAbortController = new AbortController();
    const signal = activeAbortController.signal;

    try {
      if (msg.type === "clear-cache") {
        glinerInstance = null;
        glinerProvider = null;
        cjkSession = null;
        cjkTokenizer = null;
        cjkOrtRuntime = null;
        cjkProvider = null;
        await clearAllModelCaches();
        emit({ id: msg.id, type: "clear-done" });
        return;
      }

      if (msg.type === "warmup") {
        const pref = msg.executor || "auto";
        const hint: BatchModelHint = msg.modelHint || "cjk";

        let provider: "webgpu" | "wasm" = pref === "webgpu" ? "webgpu" : "wasm";
        let cached = true;

        if (hint === "cjk" || hint === "both") {
          const cjkRes = await ensureCjkBertInitialized(signal, pref);
          provider = cjkRes.provider;
          cached = cjkRes.cached;
        }
        if (hint === "gliner" || (hint === "both" && !signal.aborted)) {
          const glRes = await ensureGlinerInitialized(signal, pref);
          provider = glRes.provider;
          cached = hint === "both" ? cached && glRes.cached : glRes.cached;
        }

        emit({
          id: msg.id,
          type: "warmup-done",
          provider,
          cached,
          cjkCached: Boolean(cjkSession),
          glinerCached: Boolean(glinerInstance),
        });
        return;
      }

      if (msg.type === "infer-batch") {
        const { provider, cjkCached, glinerCached, results } = await handleInferBatch(
          msg.posts,
          signal,
          msg.executor || "auto"
        );
        emit({
          id: msg.id,
          type: "infer-done",
          provider,
          cjkCached,
          glinerCached,
          results,
        });
      }
    } catch (err: unknown) {
      const e = err as { name?: string; message?: string };
      const aborted = e?.name === "AbortError" || abortRequested;
      emit({
        id: msg.id,
        type: "error",
        aborted,
        message: aborted ? "Aborted" : e?.message || "Local ML inference error",
      });
    } finally {
      activeAbortController = null;
    }
  });
});
