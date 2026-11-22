/**
 * Dedicated Web Worker for Multilingual Sentence Embeddings in Listen Tab Hots Mode:
 *   Model: `Xenova/paraphrase-multilingual-MiniLM-L12-v2` (~113 MB INT8 ONNX, 384-d vectors)
 *
 * Uses:
 *   - Resumable 8 MiB HTTP Range downloader with stall watchdog + exponential backoff
 *   - Browser Cache Storage (`gingko-hots-embed-v1`) + IndexedDB chunk persistence
 *   - `@xenova/transformers` AutoTokenizer + `onnxruntime-web` (WebGPU -> WASM auto-fallback)
 *   - IndexedDB post vector cache (`GingkoHotsVectorDB`) so already-embedded posts skip ONNX
 */

import { AutoTokenizer, env } from "@xenova/transformers";
import ortCpu from "onnxruntime-web";
import ortWebGpu from "onnxruntime-web/webgpu";
import {
  HOTS_CHUNK_SIZE_BYTES,
  HOTS_EMBED_APPROX_BYTES,
  HOTS_EMBED_CACHE_NAME,
  HOTS_EMBED_DIM,
  HOTS_EMBED_MIN_VALID_BYTES,
  HOTS_EMBED_MODEL_ID,
  HOTS_EMBED_ONNX_URL,
  assembleHotsModelFromChunks,
  clearAllHotsMlCaches,
  clearHotsPartialChunksDb,
  computeHotsSavedBytes,
  deleteHotsModelChunk,
  expectedHotsChunkLength,
  getCachedPostEmbeddings,
  getCompletedHotsChunkIndices,
  meanPoolAndNormalize,
  putHotsModelChunk,
  readHotsModelMeta,
  saveCachedPostEmbeddings,
  writeHotsModelMeta,
  type HotsModelDownloadMeta,
} from "../utils/hotsVectorStore";

export type HotsEmbedExecutorPreference = "auto" | "wasm" | "webgpu";

export interface HotsEmbedPostInput {
  postKey: string;
  text: string;
  contentHash: string;
  langHint?: string;
}

export type HotsEmbedWorkerInMessage =
  | {
      id: number;
      type: "warmup";
      executor?: HotsEmbedExecutorPreference;
    }
  | {
      id: number;
      type: "embed-batch";
      items: HotsEmbedPostInput[];
      executor?: HotsEmbedExecutorPreference;
    }
  | { id: number; type: "clear-cache" }
  | { id: number; type: "abort" };

export type HotsEmbedWorkerOutMessage =
  | {
      type: "progress";
      id?: number;
      stage:
        | "checking"
        | "downloading"
        | "retrying"
        | "loading_cache"
        | "initializing"
        | "ready"
        | "embedding";
      loadedBytes: number;
      totalBytes: number;
      percent: number;
      provider?: "webgpu" | "wasm" | null;
      cached?: boolean;
      retryAttempt?: number;
      maxRetries?: number;
      embedDone?: number;
      embedTotal?: number;
      cachedHits?: number;
    }
  | {
      id: number;
      type: "warmup-done";
      provider: "webgpu" | "wasm";
      cached: boolean;
    }
  | {
      id: number;
      type: "partial-vectors";
      provider: "webgpu" | "wasm";
      cachedHits: number;
      embedDone: number;
      embedTotal: number;
      vectors: Array<{ postKey: string; vector: Float32Array }>;
    }
  | {
      id: number;
      type: "embed-done";
      provider: "webgpu" | "wasm";
      modelCached: boolean;
      cachedHits: number;
      newlyEmbedded: number;
      vectors: Array<{ postKey: string; vector: Float32Array }>;
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
const EMBED_BATCH_SIZE = 16;
const EMBED_MAX_SEQ_LEN = 128;

env.allowLocalModels = false;
env.useBrowserCache = true;
if ((env.backends as { onnx?: { wasm?: { wasmPaths?: string } } })?.onnx?.wasm) {
  (env.backends as { onnx: { wasm: { wasmPaths: string } } }).onnx.wasm.wasmPaths = ONNX_WASM_CDN;
}

type EmbedTokenizer = Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>> & {
  (
    texts: string | string[],
    opts?: Record<string, unknown>
  ): Promise<{
    input_ids: { data: ArrayLike<number | bigint>; dims: number[] };
    attention_mask: { data: ArrayLike<number | bigint>; dims: number[] };
    token_type_ids?: { data: ArrayLike<number | bigint>; dims: number[] };
  }>;
};

let embedTokenizer: EmbedTokenizer | null = null;
let embedSession: ortCpu.InferenceSession | null = null;
let embedOrtRuntime: typeof ortCpu | null = null;
let embedProvider: "webgpu" | "wasm" | null = null;
let embedInitPromise: Promise<{ provider: "webgpu" | "wasm"; cached: boolean }> | null = null;

let activeAbortController: AbortController | null = null;
let abortRequested = false;

function emit(msg: HotsEmbedWorkerOutMessage) {
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

async function persistModelToCache(bytes: Uint8Array): Promise<boolean> {
  if (typeof caches === "undefined") return false;
  try {
    const cache = await caches.open(HOTS_EMBED_CACHE_NAME);
    const bodyBuf = bytes.slice().buffer;
    const resp = new Response(bodyBuf, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(bytes.byteLength),
      },
    });
    await cache.put(HOTS_EMBED_ONNX_URL, resp);
    return true;
  } catch {
    return false;
  }
}

async function readModelFromCacheStorage(): Promise<Uint8Array | null> {
  if (typeof caches === "undefined") return null;
  try {
    const cache = await caches.open(HOTS_EMBED_CACHE_NAME);
    const cached = await cache.match(HOTS_EMBED_ONNX_URL);
    if (!cached) return null;
    emit({
      type: "progress",
      stage: "loading_cache",
      loadedBytes: HOTS_EMBED_APPROX_BYTES,
      totalBytes: HOTS_EMBED_APPROX_BYTES,
      percent: 100,
      cached: true,
    });
    const buf = await cached.arrayBuffer();
    if (buf.byteLength > HOTS_EMBED_MIN_VALID_BYTES) {
      return new Uint8Array(buf);
    }
    await cache.delete(HOTS_EMBED_ONNX_URL).catch(() => {});
  } catch {
    // ignore Cache Storage unavailability
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

async function probeRemoteModelInfo(signal: AbortSignal): Promise<RemoteProbeInfo> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= 2; attempt++) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    const stallCtrl = new AbortController();
    const timer = setTimeout(() => stallCtrl.abort(), 15_000);
    const onUserAbort = () => stallCtrl.abort();
    signal.addEventListener("abort", onUserAbort, { once: true });
    try {
      const res = await fetch(HOTS_EMBED_ONNX_URL, {
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
        const totalBytes = match ? Number(match[1]) : HOTS_EMBED_APPROX_BYTES;
        const etag = (res.headers.get("etag") || "").replace(/"/g, "");
        return {
          totalBytes:
            Number.isFinite(totalBytes) && totalBytes > 0 ? totalBytes : HOTS_EMBED_APPROX_BYTES,
          etag,
          supportsRange: true,
        };
      }

      if (res.ok) {
        const len = Number(res.headers.get("content-length") || "0");
        const etag = (res.headers.get("etag") || "").replace(/"/g, "");
        await res.body?.cancel().catch(() => {});
        return {
          totalBytes: Number.isFinite(len) && len > 0 ? len : HOTS_EMBED_APPROX_BYTES,
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

async function fetchSingleRangeChunk(
  startByte: number,
  endByte: number,
  expectedLen: number,
  baseLoadedBytes: number,
  totalBytes: number,
  signal: AbortSignal
): Promise<ArrayBuffer> {
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
    const res = await fetch(HOTS_EMBED_ONNX_URL, {
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
      throw new Error("Connection stalled while downloading embedding model chunk");
    }
    throw err;
  } finally {
    if (stallTimer) clearTimeout(stallTimer);
    signal.removeEventListener("abort", onUserAbort);
  }
}

async function streamFullFallback(totalBytesHint: number, signal: AbortSignal): Promise<Uint8Array> {
  const res = await fetch(HOTS_EMBED_ONNX_URL, {
    signal,
    mode: "cors",
    credentials: "omit",
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch embedding model weights (HTTP ${res.status})`);
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
          loadedBytes: loaded,
          totalBytes: Math.max(loaded, totalBytes),
          percent: Math.min(99, Math.round((loaded / Math.max(loaded, totalBytes)) * 100)),
        });
      }
    }
  }
  return loaded === out.byteLength ? out : out.slice(0, loaded);
}

async function loadOrDownloadEmbedModelBytes(
  signal: AbortSignal
): Promise<{ bytes: Uint8Array; fromCache: boolean }> {
  emit({
    type: "progress",
    stage: "checking",
    loadedBytes: 0,
    totalBytes: 0,
    percent: 0,
  });

  const fromCacheStorage = await readModelFromCacheStorage();
  if (fromCacheStorage) {
    await clearHotsPartialChunksDb();
    return { bytes: fromCacheStorage, fromCache: true };
  }

  const existingMeta = await readHotsModelMeta();
  if (existingMeta && existingMeta.totalBytes > HOTS_EMBED_MIN_VALID_BYTES) {
    const completed = await getCompletedHotsChunkIndices();
    if (completed.size >= existingMeta.numChunks) {
      const assembled = await assembleHotsModelFromChunks(existingMeta);
      if (assembled.bytes) {
        const persisted = await persistModelToCache(assembled.bytes);
        if (persisted) await clearHotsPartialChunksDb();
        return { bytes: assembled.bytes, fromCache: true };
      }
      for (const badIdx of assembled.invalidIndices) {
        await deleteHotsModelChunk(badIdx);
      }
    }
  }

  const probe = await probeRemoteModelInfo(signal);
  const numChunks = Math.ceil(probe.totalBytes / HOTS_CHUNK_SIZE_BYTES);

  let meta: HotsModelDownloadMeta = {
    key: "multilingual_minilm_l12_v2_q8",
    url: HOTS_EMBED_ONNX_URL,
    etag: probe.etag,
    totalBytes: probe.totalBytes,
    chunkSize: HOTS_CHUNK_SIZE_BYTES,
    numChunks,
    updatedAt: Date.now(),
  };

  let completed = new Set<number>();
  if (
    existingMeta &&
    existingMeta.totalBytes === probe.totalBytes &&
    existingMeta.chunkSize === HOTS_CHUNK_SIZE_BYTES &&
    (!probe.etag || !existingMeta.etag || existingMeta.etag === probe.etag)
  ) {
    completed = await getCompletedHotsChunkIndices();
    meta = { ...existingMeta, etag: probe.etag || existingMeta.etag, updatedAt: Date.now() };
    await writeHotsModelMeta(meta);
  } else {
    await clearHotsPartialChunksDb();
    await writeHotsModelMeta(meta);
  }

  let completedBytes = computeHotsSavedBytes(completed, meta.totalBytes, meta.chunkSize);
  emit({
    type: "progress",
    stage: "downloading",
    loadedBytes: completedBytes,
    totalBytes: meta.totalBytes,
    percent: Math.min(99, Math.round((completedBytes / meta.totalBytes) * 100)),
  });

  if (!probe.supportsRange && completed.size === 0) {
    const fullBytes = await streamFullFallback(meta.totalBytes, signal);
    emit({
      type: "progress",
      stage: "downloading",
      loadedBytes: fullBytes.byteLength,
      totalBytes: fullBytes.byteLength,
      percent: 100,
    });
    const persisted = await persistModelToCache(fullBytes);
    if (persisted) await clearHotsPartialChunksDb();
    return { bytes: fullBytes, fromCache: false };
  }

  for (let pass = 0; pass < 2; pass++) {
    for (let idx = 0; idx < meta.numChunks; idx++) {
      if (completed.has(idx)) continue;
      if (signal.aborted) {
        throw new DOMException("Download aborted", "AbortError");
      }

      const startByte = idx * meta.chunkSize;
      const expectedLen = expectedHotsChunkLength(idx, meta.totalBytes, meta.chunkSize);
      const endByte = startByte + expectedLen - 1;

      let chunkBuf: ArrayBuffer | null = null;
      let lastErr: unknown = null;

      for (let attempt = 0; attempt <= MAX_CHUNK_RETRIES; attempt++) {
        try {
          chunkBuf = await fetchSingleRangeChunk(
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
          loadedBytes: full.byteLength,
          totalBytes: full.byteLength,
          percent: 100,
        });
        const persisted = await persistModelToCache(full);
        if (persisted) await clearHotsPartialChunksDb();
        return { bytes: full, fromCache: false };
      }

      await putHotsModelChunk(idx, chunkBuf);
      completed.add(idx);
      completedBytes = computeHotsSavedBytes(completed, meta.totalBytes, meta.chunkSize);

      emit({
        type: "progress",
        stage: "downloading",
        loadedBytes: completedBytes,
        totalBytes: meta.totalBytes,
        percent:
          completed.size >= meta.numChunks
            ? 100
            : Math.min(99, Math.round((completedBytes / meta.totalBytes) * 100)),
      });
    }

    const assembled = await assembleHotsModelFromChunks(meta);
    if (assembled.bytes) {
      emit({
        type: "progress",
        stage: "downloading",
        loadedBytes: assembled.bytes.byteLength,
        totalBytes: assembled.bytes.byteLength,
        percent: 100,
      });
      const persisted = await persistModelToCache(assembled.bytes);
      if (persisted) {
        await clearHotsPartialChunksDb();
      }
      return { bytes: assembled.bytes, fromCache: false };
    }

    for (const badIdx of assembled.invalidIndices) {
      completed.delete(badIdx);
      await deleteHotsModelChunk(badIdx);
    }
    completedBytes = computeHotsSavedBytes(completed, meta.totalBytes, meta.chunkSize);
  }

  throw new Error("Embedding model verification failed after assembling chunks");
}

async function resolveTargetProvider(
  preference: HotsEmbedExecutorPreference
): Promise<"webgpu" | "wasm"> {
  if (preference === "wasm") return "wasm";
  const canWebGpu = await detectWebGpuSupport();
  if (preference === "webgpu") {
    if (!canWebGpu) {
      throw new Error("WebGPU adapter unavailable; switch executor to Auto or WASM.");
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

async function createEmbedSession(
  bytes: Uint8Array,
  provider: "webgpu" | "wasm",
  signal: AbortSignal
): Promise<{
  tokenizer: EmbedTokenizer;
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
    const maxThreads = self.navigator?.hardwareConcurrency ?? 2;
    ortRuntime.env.wasm.numThreads = isCrossOriginIsolated ? Math.min(4, maxThreads) : 1;
  }

  let lastErr: unknown = null;
  for (let attempt = 0; attempt < MAX_TOKENIZER_RETRIES; attempt++) {
    if (signal.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    try {
      const tokenizer = (await AutoTokenizer.from_pretrained(
        HOTS_EMBED_MODEL_ID
      )) as unknown as EmbedTokenizer;
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
    : new Error("Failed initializing multilingual MiniLM embedding session");
}

async function ensureEmbedModelInitialized(
  signal: AbortSignal,
  preference: HotsEmbedExecutorPreference = "auto"
): Promise<{ provider: "webgpu" | "wasm"; cached: boolean }> {
  const needsSwitch =
    Boolean(embedSession && embedTokenizer && embedProvider) &&
    ((preference === "wasm" && embedProvider !== "wasm") ||
      (preference === "webgpu" && embedProvider !== "webgpu"));

  if (needsSwitch) {
    embedSession = null;
    embedOrtRuntime = null;
    embedProvider = null;
  }

  if (embedSession && embedTokenizer && embedProvider) {
    return { provider: embedProvider, cached: true };
  }

  if (embedInitPromise) {
    return await embedInitPromise;
  }

  embedInitPromise = (async () => {
    const { bytes, fromCache } = await loadOrDownloadEmbedModelBytes(signal);
    if (signal.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    const preferred = await resolveTargetProvider(preference);
    emit({
      type: "progress",
      stage: "initializing",
      loadedBytes: bytes.byteLength,
      totalBytes: bytes.byteLength,
      percent: 100,
      provider: preferred,
      cached: true,
    });

    if (preferred === "webgpu") {
      try {
        const res = await createEmbedSession(bytes, "webgpu", signal);
        embedTokenizer = res.tokenizer;
        embedSession = res.session;
        embedOrtRuntime = res.ortRuntime;
        embedProvider = "webgpu";
      } catch (err) {
        if (signal.aborted || (err as { name?: string })?.name === "AbortError") {
          throw err;
        }
        if (preference === "webgpu") throw err;
        emit({
          type: "progress",
          stage: "initializing",
          loadedBytes: bytes.byteLength,
          totalBytes: bytes.byteLength,
          percent: 100,
          provider: "wasm",
          cached: true,
        });
        const fallbackBytes = (await readModelFromCacheStorage()) || bytes;
        const res = await createEmbedSession(fallbackBytes, "wasm", signal);
        embedTokenizer = res.tokenizer;
        embedSession = res.session;
        embedOrtRuntime = res.ortRuntime;
        embedProvider = "wasm";
      }
    } else {
      const res = await createEmbedSession(bytes, "wasm", signal);
      embedTokenizer = res.tokenizer;
      embedSession = res.session;
      embedOrtRuntime = res.ortRuntime;
      embedProvider = "wasm";
    }

    emit({
      type: "progress",
      stage: "ready",
      loadedBytes: bytes.byteLength,
      totalBytes: bytes.byteLength,
      percent: 100,
      provider: embedProvider,
      cached: fromCache,
    });

    return { provider: embedProvider, cached: fromCache };
  })();

  try {
    return await embedInitPromise;
  } catch (err) {
    embedSession = null;
    embedOrtRuntime = null;
    embedProvider = null;
    throw err;
  } finally {
    embedInitPromise = null;
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

async function runEmbedForwardPass(
  texts: string[],
  signal: AbortSignal,
  preference: HotsEmbedExecutorPreference
): Promise<Float32Array[]> {
  if (!embedSession || !embedTokenizer || !embedOrtRuntime) {
    await ensureEmbedModelInitialized(signal, preference);
  }

  const execOnce = async (): Promise<Float32Array[]> => {
    const tokenizer = embedTokenizer!;
    const session = embedSession!;
    const ortMod = embedOrtRuntime!;

    const encoded = await tokenizer(texts, {
      padding: true,
      truncation: true,
      max_length: EMBED_MAX_SEQ_LEN,
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
    const outName = session.outputNames?.[0] || "last_hidden_state";
    const hiddenTensor =
      outputs.last_hidden_state || outputs.token_embeddings || outputs[outName];
    if (!hiddenTensor || !hiddenTensor.data) {
      return texts.map(() => new Float32Array(HOTS_EMBED_DIM));
    }

    const outDims = hiddenTensor.dims || [batchSize, seqLen, HOTS_EMBED_DIM];
    // Handle models returning either [batch, seq, dim] or already pooled [batch, dim]
    if (outDims.length === 2) {
      const hiddenDim = outDims[1] || HOTS_EMBED_DIM;
      const raw = hiddenTensor.data as Float32Array;
      const res: Float32Array[] = [];
      for (let b = 0; b < batchSize; b++) {
        const slice = raw.slice(b * hiddenDim, (b + 1) * hiddenDim);
        let sumSq = 0;
        for (let i = 0; i < slice.length; i++) sumSq += slice[i] * slice[i];
        const norm = Math.sqrt(sumSq);
        if (norm > 1e-12) {
          for (let i = 0; i < slice.length; i++) slice[i] /= norm;
        }
        res.push(slice);
      }
      return res;
    }

    const hiddenDim = outDims[2] || HOTS_EMBED_DIM;
    const maskData = encoded.attention_mask?.data || new Array(batchSize * seqLen).fill(1);
    return meanPoolAndNormalize(
      hiddenTensor.data as Float32Array,
      maskData,
      batchSize,
      seqLen,
      hiddenDim
    );
  };

  try {
    return await execOnce();
  } catch (err) {
    if (signal.aborted || (err as { name?: string })?.name === "AbortError") {
      throw err;
    }
    if (embedProvider === "webgpu" && preference === "auto") {
      embedSession = null;
      embedOrtRuntime = null;
      embedProvider = null;
      await ensureEmbedModelInitialized(signal, "wasm");
      return await execOnce();
    }
    throw err;
  }
}

self.onmessage = async (ev: MessageEvent<HotsEmbedWorkerInMessage>) => {
  const msg = ev.data;
  if (!msg) return;

  if (msg.type === "abort") {
    abortRequested = true;
    activeAbortController?.abort();
    return;
  }

  if (msg.type === "clear-cache") {
    abortRequested = true;
    activeAbortController?.abort();
    embedSession = null;
    embedTokenizer = null;
    embedOrtRuntime = null;
    embedProvider = null;
    await clearAllHotsMlCaches();
    emit({ id: msg.id, type: "clear-done" });
    return;
  }

  abortRequested = false;
  activeAbortController?.abort();
  const controller = new AbortController();
  activeAbortController = controller;

  try {
    if (msg.type === "warmup") {
      const res = await ensureEmbedModelInitialized(controller.signal, msg.executor || "auto");
      emit({
        id: msg.id,
        type: "warmup-done",
        provider: res.provider,
        cached: res.cached,
      });
      return;
    }

    if (msg.type === "embed-batch") {
      const items = Array.isArray(msg.items) ? msg.items : [];
      const vectorsMap = await getCachedPostEmbeddings(
        items.map((it) => ({ postKey: it.postKey, contentHash: it.contentHash }))
      );

      const missing = items.filter((it) => !vectorsMap.has(it.postKey) && it.text.trim().length > 0);
      const cachedHits = vectorsMap.size;

      let provider: "webgpu" | "wasm" = embedProvider || "wasm";
      let modelCached = Boolean(embedSession && embedTokenizer);

      const collectCurrentVectors = (): Array<{ postKey: string; vector: Float32Array }> => {
        const out: Array<{ postKey: string; vector: Float32Array }> = [];
        for (const it of items) {
          const v = vectorsMap.get(it.postKey);
          if (v) {
            out.push({ postKey: it.postKey, vector: v });
          }
        }
        return out;
      };

      if (missing.length > 0) {
        // Immediately emit cached vectors so existing Neural clusters appear right away while new posts embed
        let lastPartialEmitAt = 0;
        let lastPartialEmbedCount = 0;
        if (cachedHits >= 3) {
          emit({
            id: msg.id,
            type: "partial-vectors",
            provider,
            cachedHits,
            embedDone: cachedHits,
            embedTotal: items.length,
            vectors: collectCurrentVectors(),
          });
          lastPartialEmitAt = Date.now();
          lastPartialEmbedCount = cachedHits;
        }

        const initInfo = await ensureEmbedModelInitialized(
          controller.signal,
          msg.executor || "auto"
        );
        provider = initInfo.provider;
        modelCached = initInfo.cached;

        const newlyComputed: Array<{
          postKey: string;
          contentHash: string;
          vector: Float32Array;
          langHint?: string;
        }> = [];

        for (let i = 0; i < missing.length; i += EMBED_BATCH_SIZE) {
          if (abortRequested || controller.signal.aborted) {
            throw new DOMException("Aborted", "AbortError");
          }

          const batch = missing.slice(i, i + EMBED_BATCH_SIZE);
          const batchTexts = batch.map((b) => b.text);
          const batchVectors = await runEmbedForwardPass(
            batchTexts,
            controller.signal,
            msg.executor || "auto"
          );

          const chunkToSave: Array<{
            postKey: string;
            contentHash: string;
            vector: Float32Array;
            langHint?: string;
          }> = [];

          for (let j = 0; j < batch.length; j++) {
            const vec = batchVectors[j] || new Float32Array(HOTS_EMBED_DIM);
            vectorsMap.set(batch[j].postKey, vec);
            const rec = {
              postKey: batch[j].postKey,
              contentHash: batch[j].contentHash,
              vector: vec,
              langHint: batch[j].langHint,
            };
            newlyComputed.push(rec);
            chunkToSave.push(rec);
          }

          await saveCachedPostEmbeddings(chunkToSave);

          const doneCount = Math.min(missing.length, i + batch.length);
          const totalEmbeddedNow = cachedHits + doneCount;
          emit({
            type: "progress",
            id: msg.id,
            stage: "embedding",
            loadedBytes: 0,
            totalBytes: 0,
            percent: Math.min(99, Math.round((doneCount / missing.length) * 100)),
            provider,
            cached: modelCached,
            embedDone: totalEmbeddedNow,
            embedTotal: items.length,
            cachedHits,
          });

          // Emit throttled progressive Neural snapshots while more batches remain
          const hasMoreBatches = i + batch.length < missing.length;
          if (hasMoreBatches) {
            const nowMs = Date.now();
            const newlyAddedSincePartial = totalEmbeddedNow - lastPartialEmbedCount;
            const isFirstColdSnapshot =
              lastPartialEmbedCount === 0 && totalEmbeddedNow >= Math.min(32, items.length);
            const isPeriodicSnapshot =
              lastPartialEmbedCount > 0 &&
              newlyAddedSincePartial >= 32 &&
              nowMs - lastPartialEmitAt >= 2800;

            if (isFirstColdSnapshot || isPeriodicSnapshot) {
              emit({
                id: msg.id,
                type: "partial-vectors",
                provider,
                cachedHits,
                embedDone: totalEmbeddedNow,
                embedTotal: items.length,
                vectors: collectCurrentVectors(),
              });
              lastPartialEmitAt = nowMs;
              lastPartialEmbedCount = totalEmbeddedNow;
            }
          }
        }
      } else {
        // Check active provider or cache status quickly if everything was a vector cache hit
        provider = embedProvider || ((await detectWebGpuSupport()) ? "webgpu" : "wasm");
      }

      emit({
        id: msg.id,
        type: "embed-done",
        provider,
        modelCached,
        cachedHits,
        newlyEmbedded: missing.length,
        vectors: collectCurrentVectors(),
      });
    }
  } catch (err: unknown) {
    const isAbort =
      abortRequested ||
      controller.signal.aborted ||
      (err as { name?: string })?.name === "AbortError";
    emit({
      id: msg.id,
      type: "error",
      message: err instanceof Error ? err.message : String(err),
      aborted: isAbort,
    });
  } finally {
    if (activeAbortController === controller) {
      activeAbortController = null;
    }
  }
};
