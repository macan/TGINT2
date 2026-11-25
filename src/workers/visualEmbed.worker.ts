/**
 * Dedicated Web Worker for Browser-Side Profile Photo Visual Embeddings:
 *   Model: `Xenova/siglip-base-patch16-224` (`onnx/vision_model_quantized.onnx`, ~95 MB INT8, 768-d)
 *
 * Capabilities:
 *   - Resumable 8 MiB HTTP Range model downloader with stall watchdog + exponential backoff
 *   - Browser Cache Storage (`gingko-visual-siglip-v1`) + IndexedDB chunk recovery
 *   - `onnxruntime-web` (WebGPU -> WASM automatic fallback)
 *   - Off-main-thread image decoding (`createImageBitmap` + `OffscreenCanvas` 224x224 RGB normalize)
 *   - Pausable background indexing queue that automatically yields to priority interactive queries
 */

import ortCpu from "onnxruntime-web";
import {
  VISUAL_CHUNK_SIZE_BYTES,
  VISUAL_EMBED_APPROX_BYTES,
  VISUAL_EMBED_CACHE_NAME,
  VISUAL_EMBED_DIM,
  VISUAL_EMBED_INPUT_SIZE,
  VISUAL_EMBED_MIN_VALID_BYTES,
  VISUAL_EMBED_MODEL_ID,
  VISUAL_EMBED_ONNX_URL,
  assembleVisualModelFromChunks,
  clearAllVisualMlCaches,
  clearVisualPartialChunksDb,
  computeVisualSavedBytes,
  deleteVisualModelChunk,
  expectedVisualChunkLength,
  getCompletedVisualChunkIndices,
  getExistingVisualProfileMap,
  hashBinaryBytes,
  isValidVisualVector,
  l2NormalizeVector,
  makeVisualProfileRecordId,
  putVisualModelChunk,
  readVisualModelMeta,
  refreshVisualProfileMetadataOnly,
  resolveProfilePhotoCandidates,
  saveVisualProfileEmbeddings,
  writeVisualModelMeta,
  type VisualModelDownloadMeta,
  type VisualProfileEmbeddingRecord,
  type VisualProfileMetadataSnapshot,
} from "../utils/visualEmbedStore";

export type VisualEmbedExecutorPreference = "auto" | "wasm" | "webgpu";

export type VisualEmbedWorkerInMessage =
  | { id: number; type: "warmup"; executor?: VisualEmbedExecutorPreference }
  | {
      id: number;
      type: "enqueue-index";
      items: VisualProfileMetadataSnapshot[];
      executor?: VisualEmbedExecutorPreference;
    }
  | {
      id: number;
      type: "embed-query";
      photoUrl?: string;
      photoUrls?: string[];
      imageBuffer?: ArrayBuffer;
      mimeType?: string;
      executor?: VisualEmbedExecutorPreference;
    }
  | { id: number; type: "pause" }
  | { id: number; type: "resume"; executor?: VisualEmbedExecutorPreference }
  | { id: number; type: "clear-cache"; includeModel?: boolean };

export type VisualEmbedWorkerOutMessage =
  | {
      type: "model-progress";
      stage:
        | "checking"
        | "downloading"
        | "retrying"
        | "loading_cache"
        | "initializing"
        | "ready";
      loadedBytes: number;
      totalBytes: number;
      percent: number;
      provider?: "webgpu" | "wasm" | null;
      cached?: boolean;
      retryAttempt?: number;
      maxRetries?: number;
    }
  | {
      type: "index-status";
      isIndexing: boolean;
      isPaused: boolean;
      pendingCount: number;
      processedCount: number;
      newlyEmbeddedCount: number;
      skippedCount: number;
      cachedHitsCount: number;
      provider: "webgpu" | "wasm" | null;
    }
  | {
      id: number;
      type: "warmup-done";
      provider: "webgpu" | "wasm";
      cached: boolean;
    }
  | {
      id: number;
      type: "query-done";
      vector: Float32Array;
      photoHash: string;
      resolvedPhotoUrl?: string;
      width: number;
      height: number;
      provider: "webgpu" | "wasm";
    }
  | {
      id: number;
      type: "clear-done";
    }
  | {
      id?: number;
      type: "error";
      scope: "model" | "query" | "index";
      message: string;
      aborted?: boolean;
    };

const ONNX_WASM_CDN = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.2/dist/";
const CHUNK_STALL_TIMEOUT_MS = 25_000;
const MAX_CHUNK_RETRIES = 5;
const PHOTO_FETCH_TIMEOUT_MS = 12_000;
const IMAGE_FETCH_CONCURRENCY = 4;
const INDEX_FETCH_SLICE_SIZE = 4;

let visionSession: ortCpu.InferenceSession | null = null;
let visionOrtRuntime: typeof ortCpu | null = null;
let visionProvider: "webgpu" | "wasm" | null = null;
let visionInitPromise: Promise<{ provider: "webgpu" | "wasm"; cached: boolean }> | null = null;
let downloadAbortController: AbortController | null = null;

// Background indexing queue state
const backgroundQueue: VisualProfileMetadataSnapshot[] = [];
const queuedKeySet = new Set<string>();
let isPaused = false;
let isIndexLoopRunning = false;
let currentExecutorPreference: VisualEmbedExecutorPreference = "auto";

let batchProcessedCount = 0;
let batchNewlyEmbeddedCount = 0;
let batchSkippedCount = 0;
let batchCachedHitsCount = 0;

// Priority gate so interactive queries preempt background micro-batches immediately
let activePriorityQueryCount = 0;
let priorityWaiters: Array<() => void> = [];

function emit(msg: VisualEmbedWorkerOutMessage) {
  (self as unknown as { postMessage: (m: unknown) => void }).postMessage(msg);
}

function emitIndexStatus() {
  emit({
    type: "index-status",
    isIndexing: isIndexLoopRunning && !isPaused,
    isPaused,
    pendingCount: backgroundQueue.length,
    processedCount: batchProcessedCount,
    newlyEmbeddedCount: batchNewlyEmbeddedCount,
    skippedCount: batchSkippedCount,
    cachedHitsCount: batchCachedHitsCount,
    provider: visionProvider,
  });
}

function notifyPriorityWaiters() {
  if (activePriorityQueryCount > 0) return;
  const waiters = priorityWaiters.splice(0, priorityWaiters.length);
  for (const w of waiters) w();
}

async function waitForPriorityQueriesToFinish(): Promise<void> {
  if (activePriorityQueryCount <= 0) return;
  await new Promise<void>((resolve) => {
    priorityWaiters.push(resolve);
  });
}

async function persistModelToCache(bytes: Uint8Array): Promise<boolean> {
  if (typeof caches === "undefined") return false;
  try {
    const cache = await caches.open(VISUAL_EMBED_CACHE_NAME);
    const bodyBuf = bytes.slice().buffer;
    const resp = new Response(bodyBuf, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(bytes.byteLength),
      },
    });
    await cache.put(VISUAL_EMBED_ONNX_URL, resp);
    return true;
  } catch {
    return false;
  }
}

async function readModelFromCacheStorage(): Promise<Uint8Array | null> {
  if (typeof caches === "undefined") return null;
  try {
    const cache = await caches.open(VISUAL_EMBED_CACHE_NAME);
    const cached = await cache.match(VISUAL_EMBED_ONNX_URL);
    if (!cached) return null;
    emit({
      type: "model-progress",
      stage: "loading_cache",
      loadedBytes: VISUAL_EMBED_APPROX_BYTES,
      totalBytes: VISUAL_EMBED_APPROX_BYTES,
      percent: 100,
      cached: true,
    });
    const buf = await cached.arrayBuffer();
    if (buf.byteLength > VISUAL_EMBED_MIN_VALID_BYTES) {
      return new Uint8Array(buf);
    }
    await cache.delete(VISUAL_EMBED_ONNX_URL).catch(() => {});
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
      const res = await fetch(VISUAL_EMBED_ONNX_URL, {
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
        const totalBytes = match ? Number(match[1]) : VISUAL_EMBED_APPROX_BYTES;
        const etag = (res.headers.get("etag") || "").replace(/"/g, "");
        return {
          totalBytes:
            Number.isFinite(totalBytes) && totalBytes > 0
              ? totalBytes
              : VISUAL_EMBED_APPROX_BYTES,
          etag,
          supportsRange: true,
        };
      }

      if (res.ok) {
        const len = Number(res.headers.get("content-length") || "0");
        const etag = (res.headers.get("etag") || "").replace(/"/g, "");
        await res.body?.cancel().catch(() => {});
        return {
          totalBytes: Number.isFinite(len) && len > 0 ? len : VISUAL_EMBED_APPROX_BYTES,
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
  throw lastErr instanceof Error ? lastErr : new Error("Unable to reach Hugging Face CDN");
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
    const res = await fetch(VISUAL_EMBED_ONNX_URL, {
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
            type: "model-progress",
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
      throw new Error("Connection stalled while downloading SigLIP vision model chunk");
    }
    throw err;
  } finally {
    if (stallTimer) clearTimeout(stallTimer);
    signal.removeEventListener("abort", onUserAbort);
  }
}

async function streamFullFallback(totalBytesHint: number, signal: AbortSignal): Promise<Uint8Array> {
  const res = await fetch(VISUAL_EMBED_ONNX_URL, {
    signal,
    mode: "cors",
    credentials: "omit",
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch SigLIP vision weights (HTTP ${res.status})`);
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
          type: "model-progress",
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

async function loadOrDownloadVisionModelBytes(
  signal: AbortSignal
): Promise<{ bytes: Uint8Array; fromCache: boolean }> {
  emit({
    type: "model-progress",
    stage: "checking",
    loadedBytes: 0,
    totalBytes: 0,
    percent: 0,
  });

  const fromCacheStorage = await readModelFromCacheStorage();
  if (fromCacheStorage) {
    await clearVisualPartialChunksDb();
    return { bytes: fromCacheStorage, fromCache: true };
  }

  const existingMeta = await readVisualModelMeta();
  if (existingMeta && existingMeta.totalBytes > VISUAL_EMBED_MIN_VALID_BYTES) {
    const completed = await getCompletedVisualChunkIndices();
    if (completed.size >= existingMeta.numChunks) {
      const assembled = await assembleVisualModelFromChunks(existingMeta);
      if (assembled.bytes) {
        const persisted = await persistModelToCache(assembled.bytes);
        if (persisted) await clearVisualPartialChunksDb();
        return { bytes: assembled.bytes, fromCache: true };
      }
      for (const badIdx of assembled.invalidIndices) {
        await deleteVisualModelChunk(badIdx);
      }
    }
  }

  const probe = await probeRemoteModelInfo(signal);
  const numChunks = Math.ceil(probe.totalBytes / VISUAL_CHUNK_SIZE_BYTES);

  let meta: VisualModelDownloadMeta = {
    key: "siglip_base_patch16_224_vision_q8",
    url: VISUAL_EMBED_ONNX_URL,
    etag: probe.etag,
    totalBytes: probe.totalBytes,
    chunkSize: VISUAL_CHUNK_SIZE_BYTES,
    numChunks,
    updatedAt: Date.now(),
  };

  let completed = new Set<number>();
  if (
    existingMeta &&
    existingMeta.totalBytes === probe.totalBytes &&
    existingMeta.chunkSize === VISUAL_CHUNK_SIZE_BYTES &&
    (!probe.etag || !existingMeta.etag || existingMeta.etag === probe.etag)
  ) {
    completed = await getCompletedVisualChunkIndices();
    meta = { ...existingMeta, etag: probe.etag || existingMeta.etag, updatedAt: Date.now() };
    await writeVisualModelMeta(meta);
  } else {
    await clearVisualPartialChunksDb();
    await writeVisualModelMeta(meta);
  }

  let completedBytes = computeVisualSavedBytes(completed, meta.totalBytes, meta.chunkSize);
  emit({
    type: "model-progress",
    stage: "downloading",
    loadedBytes: completedBytes,
    totalBytes: meta.totalBytes,
    percent: Math.min(99, Math.round((completedBytes / meta.totalBytes) * 100)),
  });

  if (!probe.supportsRange && completed.size === 0) {
    const fullBytes = await streamFullFallback(meta.totalBytes, signal);
    emit({
      type: "model-progress",
      stage: "downloading",
      loadedBytes: fullBytes.byteLength,
      totalBytes: fullBytes.byteLength,
      percent: 100,
    });
    const persisted = await persistModelToCache(fullBytes);
    if (persisted) await clearVisualPartialChunksDb();
    return { bytes: fullBytes, fromCache: false };
  }

  for (let pass = 0; pass < 2; pass++) {
    for (let idx = 0; idx < meta.numChunks; idx++) {
      if (completed.has(idx)) continue;
      if (signal.aborted) {
        throw new DOMException("Download aborted", "AbortError");
      }

      const startByte = idx * meta.chunkSize;
      const expectedLen = expectedVisualChunkLength(idx, meta.totalBytes, meta.chunkSize);
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
            type: "model-progress",
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
          type: "model-progress",
          stage: "downloading",
          loadedBytes: full.byteLength,
          totalBytes: full.byteLength,
          percent: 100,
        });
        const persisted = await persistModelToCache(full);
        if (persisted) await clearVisualPartialChunksDb();
        return { bytes: full, fromCache: false };
      }

      await putVisualModelChunk(idx, chunkBuf);
      completed.add(idx);
      completedBytes = computeVisualSavedBytes(completed, meta.totalBytes, meta.chunkSize);

      emit({
        type: "model-progress",
        stage: "downloading",
        loadedBytes: completedBytes,
        totalBytes: meta.totalBytes,
        percent:
          completed.size >= meta.numChunks
            ? 100
            : Math.min(99, Math.round((completedBytes / meta.totalBytes) * 100)),
      });
    }

    const assembled = await assembleVisualModelFromChunks(meta);
    if (assembled.bytes) {
      emit({
        type: "model-progress",
        stage: "downloading",
        loadedBytes: assembled.bytes.byteLength,
        totalBytes: assembled.bytes.byteLength,
        percent: 100,
      });
      const persisted = await persistModelToCache(assembled.bytes);
      if (persisted) await clearVisualPartialChunksDb();
      return { bytes: assembled.bytes, fromCache: false };
    }

    for (const badIdx of assembled.invalidIndices) {
      completed.delete(badIdx);
      await deleteVisualModelChunk(badIdx);
    }
    completedBytes = computeVisualSavedBytes(completed, meta.totalBytes, meta.chunkSize);
  }

  throw new Error("SigLIP vision model verification failed after assembling chunks");
}

/**
 * Always run INT8 dynamic-quantized SigLIP (`DynamicQuantizeLinear`, `MatMulInteger`,
 * `ConvInteger`) on deterministic WASM SIMD CPU EP. Running INT8 quantized ViT graphs
 * on onnxruntime-web 1.19.2 WebGPU EP causes numerical corruption and stale buffer reuse
 * across dynamic shapes, whereas WASM EP delivers exact, reproducible cosine rankings.
 */
async function createVisionSession(
  bytes: Uint8Array
): Promise<{
  session: ortCpu.InferenceSession;
  ortRuntime: typeof ortCpu;
}> {
  const isCrossOriginIsolated = Boolean(
    (self as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated
  );
  const ortRuntime: typeof ortCpu = ortCpu;

  ortRuntime.env.wasm.wasmPaths = ONNX_WASM_CDN;
  const maxThreads = self.navigator?.hardwareConcurrency ?? 2;
  ortRuntime.env.wasm.numThreads = isCrossOriginIsolated ? Math.min(4, maxThreads) : 1;

  const session = await ortRuntime.InferenceSession.create(bytes, {
    executionProviders: ["wasm"],
  });
  return { session, ortRuntime };
}

async function ensureVisionModelInitialized(
  _preference: VisualEmbedExecutorPreference = "wasm"
): Promise<{ provider: "webgpu" | "wasm"; cached: boolean }> {
  if (visionSession && visionProvider) {
    return { provider: visionProvider, cached: true };
  }

  if (visionInitPromise) {
    return await visionInitPromise;
  }

  const controller = new AbortController();
  downloadAbortController = controller;

  visionInitPromise = (async () => {
    const { bytes, fromCache } = await loadOrDownloadVisionModelBytes(controller.signal);
    if (controller.signal.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    emit({
      type: "model-progress",
      stage: "initializing",
      loadedBytes: bytes.byteLength,
      totalBytes: bytes.byteLength,
      percent: 100,
      provider: "wasm",
      cached: fromCache,
    });

    const res = await createVisionSession(bytes);
    visionSession = res.session;
    visionOrtRuntime = res.ortRuntime;
    visionProvider = "wasm";

    emit({
      type: "model-progress",
      stage: "ready",
      loadedBytes: bytes.byteLength,
      totalBytes: bytes.byteLength,
      percent: 100,
      provider: visionProvider,
      cached: fromCache,
    });

    return { provider: visionProvider, cached: fromCache };
  })();

  try {
    return await visionInitPromise;
  } catch (err) {
    visionSession = null;
    visionOrtRuntime = null;
    visionProvider = null;
    throw err;
  } finally {
    visionInitPromise = null;
    if (downloadAbortController === controller) {
      downloadAbortController = null;
    }
  }
}

// ---------------------------------------------------------------------------
// Image Decoding & SigLIP Preprocessing (224x224 RGB, mean=0.5, std=0.5)
// ---------------------------------------------------------------------------

interface PreprocessedImage {
  chwData: Float32Array; // 3 * 224 * 224
  photoHash: string;
  width: number;
  height: number;
}

let sharedOffscreenCanvas: OffscreenCanvas | null = null;
let sharedOffscreenCtx: OffscreenCanvasRenderingContext2D | null = null;

function getSharedCanvasCtx(): OffscreenCanvasRenderingContext2D {
  if (!sharedOffscreenCanvas || !sharedOffscreenCtx) {
    sharedOffscreenCanvas = new OffscreenCanvas(VISUAL_EMBED_INPUT_SIZE, VISUAL_EMBED_INPUT_SIZE);
    sharedOffscreenCtx = sharedOffscreenCanvas.getContext("2d", {
      willReadFrequently: true,
    });
    if (!sharedOffscreenCtx) {
      throw new Error("OffscreenCanvas 2D context unavailable");
    }
  }
  return sharedOffscreenCtx;
}

async function decodeBlobToSiglipTensor(blob: Blob): Promise<PreprocessedImage | null> {
  if (!blob || blob.size < 250) return null;
  const mime = (blob.type || "").toLowerCase();
  if (mime.includes("svg") || mime.includes("html") || mime.includes("json") || mime.includes("text/")) {
    return null;
  }

  const rawBuf = await blob.arrayBuffer();
  const rawBytes = new Uint8Array(rawBuf);
  if (rawBytes.byteLength < 250) return null;

  // Quick check against inline XML/SVG/HTML text responses served with generic content-type
  if (rawBytes[0] === 0x3c /* '<' */ || rawBytes[0] === 0x7b /* '{' */) {
    return null;
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    return null;
  }

  const origW = bitmap.width;
  const origH = bitmap.height;
  if (origW < 16 || origH < 16) {
    bitmap.close();
    return null;
  }

  const size = VISUAL_EMBED_INPUT_SIZE;
  const ctx = getSharedCanvasCtx();
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, size, size);
  bitmap.close();

  const imgData = ctx.getImageData(0, 0, size, size).data;
  const planeSize = size * size;
  const chw = new Float32Array(3 * planeSize);

  // Also check simple luminance variance to skip solid-color blank placeholders
  let lumSum = 0;
  let lumSqSum = 0;
  const sampleStep = 17;
  let sampleCount = 0;

  // SigLIP normalization: rescale = 1/255, mean = 0.5, std = 0.5 -> (v / 255 - 0.5) / 0.5 = v / 127.5 - 1
  const invHalfByte = 1 / 127.5;
  for (let p = 0; p < planeSize; p++) {
    const rgbaIdx = p * 4;
    const r = imgData[rgbaIdx];
    const g = imgData[rgbaIdx + 1];
    const b = imgData[rgbaIdx + 2];

    chw[p] = r * invHalfByte - 1.0;
    chw[planeSize + p] = g * invHalfByte - 1.0;
    chw[planeSize * 2 + p] = b * invHalfByte - 1.0;

    if (p % sampleStep === 0) {
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      lumSum += lum;
      lumSqSum += lum * lum;
      sampleCount++;
    }
  }

  if (sampleCount > 0) {
    const mean = lumSum / sampleCount;
    const variance = lumSqSum / sampleCount - mean * mean;
    if (variance < 1.0) {
      return null;
    }
  }

  return {
    chwData: chw,
    photoHash: hashBinaryBytes(rawBytes),
    width: origW,
    height: origH,
  };
}

async function fetchAndPreprocessPhotoUrl(photoUrl: string): Promise<PreprocessedImage | null> {
  if (!photoUrl) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PHOTO_FETCH_TIMEOUT_MS);
  try {
    const isDataUrl = photoUrl.startsWith("data:");
    const res = await fetch(photoUrl, {
      method: "GET",
      mode: isDataUrl ? undefined : "cors",
      credentials: "omit",
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const contentType = (res.headers.get("content-type") || "").toLowerCase();
    if (
      contentType &&
      !isDataUrl &&
      !contentType.startsWith("image/") &&
      !contentType.includes("octet-stream")
    ) {
      return null;
    }
    if (contentType.includes("svg")) return null;
    const blob = await res.blob();
    return await decodeBlobToSiglipTensor(blob);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchAndPreprocessPhotoCandidates(
  urls: string[]
): Promise<{ preprocessed: PreprocessedImage; resolvedPhotoUrl: string } | null> {
  const seen = new Set<string>();
  for (const url of urls) {
    const trimmed = (url || "").trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    const decoded = await fetchAndPreprocessPhotoUrl(trimmed);
    if (decoded) {
      return { preprocessed: decoded, resolvedPhotoUrl: trimmed };
    }
  }
  return null;
}

/**
 * Runs a single image (strict batchSize = 1) through SigLIP vision encoder.
 * Using batchSize = 1 avoids cross-image activation scale drift inside INT8
 * DynamicQuantizeLinear layers so indexed vectors and query vectors match identically.
 */
async function runSingleVisionForwardPass(
  image: PreprocessedImage,
  preference: VisualEmbedExecutorPreference
): Promise<Float32Array | null> {
  if (!visionSession || !visionOrtRuntime) {
    await ensureVisionModelInitialized(preference);
  }

  const session = visionSession!;
  const ortMod = visionOrtRuntime!;
  const inputName = session.inputNames?.[0] || "pixel_values";
  const tensor = new ortMod.Tensor("float32", image.chwData, [
    1,
    3,
    VISUAL_EMBED_INPUT_SIZE,
    VISUAL_EMBED_INPUT_SIZE,
  ]);

  let outputs: Record<string, ortCpu.Tensor> | null = null;
  try {
    outputs = await session.run({ [inputName]: tensor });
    const outTensor =
      outputs.pooler_output ||
      outputs.image_embeds ||
      outputs[session.outputNames?.[1] || ""] ||
      outputs[session.outputNames?.[0] || ""];

    if (!outTensor) {
      throw new Error("SigLIP vision model returned empty output tensor");
    }

    const rawData =
      typeof outTensor.getData === "function"
        ? ((await outTensor.getData()) as Float32Array)
        : (outTensor.data as Float32Array);

    if (!rawData || rawData.length === 0) {
      throw new Error("SigLIP vision model output tensor had no data");
    }

    const dims = outTensor.dims || [1, VISUAL_EMBED_DIM];
    let normalized: Float32Array;

    if (dims.length === 2) {
      const dim = dims[1] || VISUAL_EMBED_DIM;
      normalized = l2NormalizeVector(rawData.slice(0, dim));
    } else {
      // Fallback for 3D [1, tokens, dim] output: mean pool over tokens then L2-normalize
      const seqLen = dims[1] || 1;
      const dim = dims[2] || VISUAL_EMBED_DIM;
      const pooled = new Float32Array(dim);
      for (let t = 0; t < seqLen; t++) {
        const tokOff = t * dim;
        for (let d = 0; d < dim; d++) {
          pooled[d] += rawData[tokOff + d];
        }
      }
      const inv = 1 / Math.max(1, seqLen);
      for (let d = 0; d < dim; d++) pooled[d] *= inv;
      normalized = l2NormalizeVector(pooled);
    }

    return isValidVisualVector(normalized) ? normalized : null;
  } finally {
    try {
      if (typeof tensor.dispose === "function") tensor.dispose();
    } catch {
      // ignore
    }
    if (outputs) {
      for (const k of Object.keys(outputs)) {
        try {
          if (typeof outputs[k]?.dispose === "function") outputs[k].dispose();
        } catch {
          // ignore
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Background Indexing Loop (Pausable, Deduplicated, Priority-Yielding)
// ---------------------------------------------------------------------------

async function fetchBatchConcurrently<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await mapper(items[idx]);
    }
  });
  await Promise.all(workers);
  return results;
}

async function runBackgroundIndexLoop(): Promise<void> {
  if (isIndexLoopRunning || isPaused || backgroundQueue.length === 0) {
    emitIndexStatus();
    return;
  }

  isIndexLoopRunning = true;
  emitIndexStatus();

  try {
    while (!isPaused && backgroundQueue.length > 0) {
      // Yield immediately if user triggered an interactive query
      await waitForPriorityQueriesToFinish();
      if (isPaused || backgroundQueue.length === 0) break;

      // Take a small slice to check against IndexedDB first
      const sliceSize = Math.min(24, backgroundQueue.length);
      const candidates = backgroundQueue.splice(0, sliceSize);
      for (const c of candidates) {
        queuedKeySet.delete(makeVisualProfileRecordId(c.entityType, c.entityKey));
      }

      const recordIds = candidates.map((c) =>
        makeVisualProfileRecordId(c.entityType, c.entityKey)
      );
      const existingMap = await getExistingVisualProfileMap(recordIds);

      const toProcess: VisualProfileMetadataSnapshot[] = [];
      const metadataUpdates: VisualProfileEmbeddingRecord[] = [];

      for (let i = 0; i < candidates.length; i++) {
        const cand = candidates[i];
        const recId = recordIds[i];
        const existing = existingMap.get(recId);
        if (existing) {
          batchCachedHitsCount++;
          batchProcessedCount++;
          // Refresh metadata snapshot if richer fields arrived (e.g. description/members)
          metadataUpdates.push({
            ...existing,
            metadata: {
              ...existing.metadata,
              ...cand,
              description: cand.description || existing.metadata.description,
              title: cand.title || existing.metadata.title,
            },
            updatedAt: Date.now(),
          });
        } else {
          toProcess.push(cand);
        }
      }

      if (metadataUpdates.length > 0) {
        await refreshVisualProfileMetadataOnly(metadataUpdates);
      }

      if (toProcess.length === 0) {
        emitIndexStatus();
        continue;
      }

      // Ensure SigLIP model is ready before decoding & embedding missing avatars
      await waitForPriorityQueriesToFinish();
      if (isPaused) {
        // Put remaining candidates back at front of queue so resume finishes them
        for (let i = toProcess.length - 1; i >= 0; i--) {
          const item = toProcess[i];
          const key = makeVisualProfileRecordId(item.entityType, item.entityKey);
          if (!queuedKeySet.has(key)) {
            queuedKeySet.add(key);
            backgroundQueue.unshift(item);
          }
        }
        break;
      }

      await ensureVisionModelInitialized(currentExecutorPreference);

      // Fetch photos in small slices concurrently, then embed strictly 1-by-1 (batch=1)
      // so INT8 DynamicQuantizeLinear scales never drift across images.
      for (let i = 0; i < toProcess.length; i += INDEX_FETCH_SLICE_SIZE) {
        await waitForPriorityQueriesToFinish();
        if (isPaused) {
          for (let k = toProcess.length - 1; k >= i; k--) {
            const item = toProcess[k];
            const key = makeVisualProfileRecordId(item.entityType, item.entityKey);
            if (!queuedKeySet.has(key)) {
              queuedKeySet.add(key);
              backgroundQueue.unshift(item);
            }
          }
          break;
        }

        const slice = toProcess.slice(i, i + INDEX_FETCH_SLICE_SIZE);
        const decodedList = await fetchBatchConcurrently(
          slice,
          IMAGE_FETCH_CONCURRENCY,
          (item) => {
            const candidates =
              Array.isArray(item.photoCandidates) && item.photoCandidates.length > 0
                ? item.photoCandidates
                : resolveProfilePhotoCandidates(item);
            return fetchAndPreprocessPhotoCandidates(
              candidates.length > 0 ? candidates : [item.photoUrl]
            );
          }
        );

        const toSave: Array<{
          metadata: VisualProfileMetadataSnapshot;
          photoHash: string;
          vector: Float32Array;
        }> = [];

        for (let j = 0; j < slice.length; j++) {
          const item = slice[j];
          const decoded = decodedList[j];
          if (!decoded) {
            batchSkippedCount++;
            batchProcessedCount++;
            continue;
          }

          await waitForPriorityQueriesToFinish();
          if (isPaused) {
            // Re-queue current and remaining items in this slice + rest of toProcess
            for (let k = toProcess.length - 1; k >= i + j; k--) {
              const rem = toProcess[k];
              const key = makeVisualProfileRecordId(rem.entityType, rem.entityKey);
              if (!queuedKeySet.has(key)) {
                queuedKeySet.add(key);
                backgroundQueue.unshift(rem);
              }
            }
            break;
          }

          const vec = await runSingleVisionForwardPass(
            decoded.preprocessed,
            currentExecutorPreference
          );
          if (vec && isValidVisualVector(vec)) {
            const updatedMeta: VisualProfileMetadataSnapshot = {
              ...item,
              photoUrl: decoded.resolvedPhotoUrl || item.photoUrl,
            };
            toSave.push({
              metadata: updatedMeta,
              photoHash: decoded.preprocessed.photoHash,
              vector: vec,
            });
            batchNewlyEmbeddedCount++;
          } else {
            batchSkippedCount++;
          }
          batchProcessedCount++;
        }

        if (toSave.length > 0) {
          await saveVisualProfileEmbeddings(toSave, VISUAL_EMBED_MODEL_ID);
        }

        emitIndexStatus();
        if (isPaused) break;
      }
    }
  } catch (err: unknown) {
    const isAbort = (err as { name?: string })?.name === "AbortError";
    if (!isAbort) {
      emit({
        type: "error",
        scope: "index",
        message: err instanceof Error ? err.message : String(err),
        aborted: false,
      });
    }
  } finally {
    isIndexLoopRunning = false;
    emitIndexStatus();
  }
}

// ---------------------------------------------------------------------------
// Worker Message Router
// ---------------------------------------------------------------------------

self.onmessage = async (ev: MessageEvent<VisualEmbedWorkerInMessage>) => {
  const msg = ev.data;
  if (!msg) return;

  if (msg.type === "pause") {
    isPaused = true;
    emitIndexStatus();
    return;
  }

  if (msg.type === "resume") {
    isPaused = false;
    if (msg.executor) currentExecutorPreference = msg.executor;
    emitIndexStatus();
    void runBackgroundIndexLoop();
    return;
  }

  if (msg.type === "clear-cache") {
    isPaused = true;
    backgroundQueue.length = 0;
    queuedKeySet.clear();
    batchProcessedCount = 0;
    batchNewlyEmbeddedCount = 0;
    batchSkippedCount = 0;
    batchCachedHitsCount = 0;
    downloadAbortController?.abort();
    if (msg.includeModel) {
      visionSession = null;
      visionOrtRuntime = null;
      visionProvider = null;
      await clearAllVisualMlCaches();
    }
    isPaused = false;
    emitIndexStatus();
    emit({ id: msg.id, type: "clear-done" });
    return;
  }

  if (msg.type === "enqueue-index") {
    if (msg.executor) currentExecutorPreference = msg.executor;
    const incoming = Array.isArray(msg.items) ? msg.items : [];
    for (const item of incoming) {
      if (!item || !item.entityKey || !item.photoUrl) continue;
      const key = makeVisualProfileRecordId(item.entityType, item.entityKey);
      if (queuedKeySet.has(key)) continue;
      queuedKeySet.add(key);
      backgroundQueue.push(item);
    }
    emitIndexStatus();
    if (!isPaused) {
      void runBackgroundIndexLoop();
    }
    return;
  }

  if (msg.type === "warmup") {
    try {
      const pref = msg.executor || currentExecutorPreference;
      const res = await ensureVisionModelInitialized(pref);
      emit({
        id: msg.id,
        type: "warmup-done",
        provider: res.provider,
        cached: res.cached,
      });
    } catch (err: unknown) {
      const isAbort = (err as { name?: string })?.name === "AbortError";
      emit({
        id: msg.id,
        type: "error",
        scope: "model",
        message: err instanceof Error ? err.message : String(err),
        aborted: isAbort,
      });
    }
    return;
  }

  if (msg.type === "embed-query") {
    activePriorityQueryCount++;
    try {
      const pref = msg.executor || currentExecutorPreference;
      let preprocessed: PreprocessedImage | null = null;
      let resolvedPhotoUrl: string | undefined = msg.photoUrl;

      if (msg.imageBuffer) {
        const blob = new Blob([msg.imageBuffer], { type: msg.mimeType || "image/jpeg" });
        preprocessed = await decodeBlobToSiglipTensor(blob);
      } else {
        const candidates: string[] = [];
        if (Array.isArray(msg.photoUrls)) {
          for (const u of msg.photoUrls) {
            if (u && !candidates.includes(u)) candidates.push(u);
          }
        }
        if (msg.photoUrl && !candidates.includes(msg.photoUrl)) {
          candidates.unshift(msg.photoUrl);
        }
        if (candidates.length > 0) {
          const res = await fetchAndPreprocessPhotoCandidates(candidates);
          if (res) {
            preprocessed = res.preprocessed;
            resolvedPhotoUrl = res.resolvedPhotoUrl;
          }
        }
      }

      if (!preprocessed) {
        throw new Error("NO_VALID_PROFILE_PHOTO");
      }

      const initInfo = await ensureVisionModelInitialized(pref);
      const vec = await runSingleVisionForwardPass(preprocessed, pref);
      if (!vec || !isValidVisualVector(vec)) {
        throw new Error("Failed to compute visual embedding vector");
      }

      emit({
        id: msg.id,
        type: "query-done",
        vector: vec,
        photoHash: preprocessed.photoHash,
        resolvedPhotoUrl,
        width: preprocessed.width,
        height: preprocessed.height,
        provider: initInfo.provider,
      });
    } catch (err: unknown) {
      const isAbort = (err as { name?: string })?.name === "AbortError";
      emit({
        id: msg.id,
        type: "error",
        scope: "query",
        message: err instanceof Error ? err.message : String(err),
        aborted: isAbort,
      });
    } finally {
      activePriorityQueryCount = Math.max(0, activePriorityQueryCount - 1);
      notifyPriorityWaiters();
    }
  }
};
