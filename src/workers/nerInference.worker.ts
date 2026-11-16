/**
 * Dedicated Web Worker for in-browser multilingual GLiNER.js NER inference.
 *
 * Streams & persists `onnx-community/gliner_multi-v2.1` quantized weights in
 * Browser Cache Storage (`gingko-ner-models-v1`), initializes ONNX Runtime Web
 * prioritizing WebGPU with automatic WASM SIMD fallback, and chunks input
 * posts safely within the mDeBERTa 384-token window so CJK, Cantonese (Yue),
 * Russian, and English texts extract cleanly without overflowing.
 */

import { Gliner } from "gliner";
import {
  APPROX_MODEL_BYTES,
  CHUNK_SIZE_BYTES,
  MODEL_CACHE_NAME,
  MODEL_ONNX_URL,
  MODEL_TOKENIZER_ID,
  assembleModelFromChunks,
  clearAllModelCaches,
  clearPartialChunksDb,
  computeSavedBytes,
  deleteModelChunk,
  expectedChunkLength,
  getCompletedChunkIndices,
  putModelChunk,
  readModelMeta,
  writeModelMeta,
  type ModelDownloadMeta,
} from "../utils/nerModelCache";

export type WorkerNerClassId =
  | "person"
  | "organization"
  | "nation"
  | "job_position"
  | "location"
  | "address"
  | "event"
  | "platform"
  | "asset_law"
  | "financial_metric";

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

export type WorkerInMessage =
  | { id: number; type: "warmup" }
  | { id: number; type: "infer-batch"; posts: WorkerPostInput[] }
  | { id: number; type: "clear-cache" }
  | { id: number; type: "abort" };

export type WorkerOutMessage =
  | {
      type: "progress";
      stage: "checking" | "downloading" | "retrying" | "loading_cache" | "initializing" | "ready";
      loadedBytes: number;
      totalBytes: number;
      percent: number;
      provider?: "webgpu" | "wasm" | null;
      cached?: boolean;
      retryAttempt?: number;
      maxRetries?: number;
    }
  | {
      id: number;
      type: "warmup-done";
      provider: "webgpu" | "wasm";
      cached: boolean;
    }
  | {
      id: number;
      type: "infer-done";
      provider: "webgpu" | "wasm";
      results: Array<{ postKey: string; spans: WorkerMlSpan[] }>;
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

const MAX_CHUNK_WORDS = 95;
const MAX_CHUNK_CHARS = 190;
const OVERLAP_CHARS = 18;
const INFER_SUBBATCH_SIZE = 4;
const ML_CONFIDENCE_THRESHOLD = 0.42;

let glinerInstance: Gliner | null = null;
let activeProvider: "webgpu" | "wasm" | null = null;
let initPromise: Promise<"webgpu" | "wasm"> | null = null;
let activeAbortController: AbortController | null = null;
let abortRequested = false;

function emit(msg: WorkerOutMessage) {
  (self as unknown as { postMessage: (m: unknown) => void }).postMessage(msg);
}

async function detectWebGpuSupport(): Promise<boolean> {
  try {
    const nav = (self as unknown as { navigator?: { gpu?: { requestAdapter?: () => Promise<unknown> } } }).navigator;
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
    const cache = await caches.open(MODEL_CACHE_NAME);
    const resp = new Response(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Length": String(bytes.byteLength),
        },
      }
    );
    await cache.put(MODEL_ONNX_URL, resp);
    return true;
  } catch {
    return false;
  }
}

async function readModelFromCacheStorage(): Promise<Uint8Array | null> {
  if (typeof caches === "undefined") return null;
  try {
    const cache = await caches.open(MODEL_CACHE_NAME);
    const cached = await cache.match(MODEL_ONNX_URL);
    if (!cached) return null;
    emit({
      type: "progress",
      stage: "loading_cache",
      loadedBytes: 0,
      totalBytes: 0,
      percent: 100,
      cached: true,
    });
    const buf = await cached.arrayBuffer();
    if (buf.byteLength > 50_000_000) {
      return new Uint8Array(buf);
    }
    await cache.delete(MODEL_ONNX_URL).catch(() => {});
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

async function probeRemoteModelInfo(signal: AbortSignal): Promise<RemoteProbeInfo> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= 2; attempt++) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    const stallCtrl = new AbortController();
    const timer = setTimeout(() => stallCtrl.abort(), 15_000);
    const onUserAbort = () => stallCtrl.abort();
    signal.addEventListener("abort", onUserAbort, { once: true });
    try {
      // Tiny 1-byte Range GET reliably resolves redirects + Content-Range + ETag across CORS proxies
      const res = await fetch(MODEL_ONNX_URL, {
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
        const totalBytes = match ? Number(match[1]) : APPROX_MODEL_BYTES;
        const etag = (res.headers.get("etag") || "").replace(/"/g, "");
        return {
          totalBytes: Number.isFinite(totalBytes) && totalBytes > 0 ? totalBytes : APPROX_MODEL_BYTES,
          etag,
          supportsRange: true,
        };
      }

      if (res.ok) {
        const len = Number(res.headers.get("content-length") || "0");
        const etag = (res.headers.get("etag") || "").replace(/"/g, "");
        await res.body?.cancel().catch(() => {});
        return {
          totalBytes: Number.isFinite(len) && len > 0 ? len : APPROX_MODEL_BYTES,
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
    const res = await fetch(MODEL_ONNX_URL, {
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

    // If intermediary proxy returned 200 full file even though Range was requested
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
  totalBytesHint: number,
  signal: AbortSignal
): Promise<Uint8Array> {
  const res = await fetch(MODEL_ONNX_URL, {
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
  signal: AbortSignal
): Promise<{ bytes: Uint8Array; fromCache: boolean }> {
  emit({
    type: "progress",
    stage: "checking",
    loadedBytes: 0,
    totalBytes: 0,
    percent: 0,
  });

  // 1. Fast path: assembled model already in Cache Storage
  const fromCacheStorage = await readModelFromCacheStorage();
  if (fromCacheStorage) {
    await clearPartialChunksDb();
    return { bytes: fromCacheStorage, fromCache: true };
  }

  // 2. Check if IndexedDB already holds all verified chunks (offline/private Cache Storage fallback)
  const existingMeta = await readModelMeta();
  if (existingMeta && existingMeta.totalBytes > 50_000_000) {
    const completed = await getCompletedChunkIndices();
    if (completed.size >= existingMeta.numChunks) {
      const assembled = await assembleModelFromChunks(existingMeta);
      if (assembled.bytes) {
        const persisted = await persistModelToCache(assembled.bytes);
        if (persisted) await clearPartialChunksDb();
        return { bytes: assembled.bytes, fromCache: true };
      }
      for (const badIdx of assembled.invalidIndices) {
        await deleteModelChunk(badIdx);
      }
    }
  }

  // 3. Probe remote metadata (totalBytes, ETag, Range support)
  const probe = await probeRemoteModelInfo(signal);
  const numChunks = Math.ceil(probe.totalBytes / CHUNK_SIZE_BYTES);

  let meta: ModelDownloadMeta = {
    key: "gliner_multi_v2_1_quantized",
    url: MODEL_ONNX_URL,
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
    completed = await getCompletedChunkIndices();
    meta = { ...existingMeta, etag: probe.etag || existingMeta.etag, updatedAt: Date.now() };
    await writeModelMeta(meta);
  } else {
    await clearPartialChunksDb();
    await writeModelMeta(meta);
  }

  let completedBytes = computeSavedBytes(completed, meta.totalBytes, meta.chunkSize);
  emit({
    type: "progress",
    stage: "downloading",
    loadedBytes: completedBytes,
    totalBytes: meta.totalBytes,
    percent: Math.min(99, Math.round((completedBytes / meta.totalBytes) * 100)),
  });

  if (!probe.supportsRange && completed.size === 0) {
    const fullBytes = await streamFullFallbackWithChunkSaves(meta.totalBytes, signal);
    emit({
      type: "progress",
      stage: "downloading",
      loadedBytes: fullBytes.byteLength,
      totalBytes: fullBytes.byteLength,
      percent: 100,
    });
    const persisted = await persistModelToCache(fullBytes);
    if (persisted) await clearPartialChunksDb();
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
          const delayMs = Math.min(20_000, 1500 * Math.pow(2, attempt)) + Math.round(Math.random() * 400);
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

      // Handle rare 200 full-body response from proxy ignoring Range header
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
        if (persisted) await clearPartialChunksDb();
        return { bytes: full, fromCache: false };
      }

      await putModelChunk(idx, chunkBuf);
      completed.add(idx);
      completedBytes = computeSavedBytes(completed, meta.totalBytes, meta.chunkSize);

      emit({
        type: "progress",
        stage: "downloading",
        loadedBytes: completedBytes,
        totalBytes: meta.totalBytes,
        percent: completed.size >= meta.numChunks
          ? 100
          : Math.min(99, Math.round((completedBytes / meta.totalBytes) * 100)),
      });
    }

    // Assemble & verify all chunks
    const assembled = await assembleModelFromChunks(meta);
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
        await clearPartialChunksDb();
      }
      return { bytes: assembled.bytes, fromCache: false };
    }

    for (const badIdx of assembled.invalidIndices) {
      completed.delete(badIdx);
      await deleteModelChunk(badIdx);
    }
    completedBytes = computeSavedBytes(completed, meta.totalBytes, meta.chunkSize);
  }

  throw new Error("Model verification failed after assembling chunks");
}

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
        tokenizerPath: MODEL_TOKENIZER_ID,
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
      return gliner;
    } catch (err) {
      lastErr = err;
      // Don't retry if WebGPU execution provider itself is unsupported; let caller fall back to WASM immediately
      const msg = String((err as { message?: string })?.message || "").toLowerCase();
      if (provider === "webgpu" && (msg.includes("webgpu") || msg.includes("gpu") || msg.includes("adapter") || msg.includes("session"))) {
        throw err;
      }
      if (attempt < MAX_TOKENIZER_RETRIES - 1) {
        await waitForReconnectOrDelay(1500 * (attempt + 1), signal);
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Failed initializing GLiNER session");
}

async function ensureInitialized(signal: AbortSignal): Promise<{
  provider: "webgpu" | "wasm";
  cached: boolean;
}> {
  if (glinerInstance && activeProvider) {
    return { provider: activeProvider, cached: true };
  }

  if (initPromise) {
    const provider = await initPromise;
    return { provider, cached: true };
  }

  let wasCached = false;
  initPromise = (async () => {
    const { bytes, fromCache } = await loadOrDownloadModelBytes(signal);
    wasCached = fromCache;

    if (signal.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    const canWebGpu = await detectWebGpuSupport();
    const preferred: "webgpu" | "wasm" = canWebGpu ? "webgpu" : "wasm";

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
        glinerInstance = await createGlinerSession(bytes, "webgpu", signal);
        activeProvider = "webgpu";
      } catch (err) {
        if (signal.aborted || (err as { name?: string })?.name === "AbortError") {
          throw err;
        }
        emit({
          type: "progress",
          stage: "initializing",
          loadedBytes: bytes.byteLength,
          totalBytes: bytes.byteLength,
          percent: 100,
          provider: "wasm",
          cached: true,
        });
        // Reload from Cache Storage/IDB cleanly without keeping a second 333 MB buffer alive during WebGPU attempt
        const fallbackBytes = (await readModelFromCacheStorage()) || bytes;
        glinerInstance = await createGlinerSession(fallbackBytes, "wasm", signal);
        activeProvider = "wasm";
      }
    } else {
      glinerInstance = await createGlinerSession(bytes, "wasm", signal);
      activeProvider = "wasm";
    }

    emit({
      type: "progress",
      stage: "ready",
      loadedBytes: bytes.byteLength,
      totalBytes: bytes.byteLength,
      percent: 100,
      provider: activeProvider,
      cached: fromCache,
    });

    return activeProvider;
  })();

  try {
    const provider = await initPromise;
    return { provider, cached: wasCached };
  } catch (err) {
    glinerInstance = null;
    activeProvider = null;
    throw err;
  } finally {
    initPromise = null;
  }
}

function countApproxSplitterWords(s: string): number {
  const matches = s.match(/\w+(?:[-_]\w+)*|\S/g);
  return matches ? matches.length : 0;
}

interface TextChunk {
  chunkText: string;
  startOffset: number;
}

/**
 * Splits post text into clause-sized chunks whose token length stays comfortably
 * inside GLiNER's 384-token mDeBERTa window across Latin, CJK, and Cyrillic scripts.
 */
function splitIntoGlinerChunks(text: string): TextChunk[] {
  if (!text || text.trim().length < 2) return [];
  const rawSegments: Array<{ text: string; startOffset: number }> = [];

  // 1. Split first along newlines and major sentence punctuation
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

  // 2. Further split oversized segments at clause punctuation or sliding window
  const finalChunks: TextChunk[] = [];
  for (const seg of rawSegments) {
    if (
      seg.text.length <= MAX_CHUNK_CHARS &&
      countApproxSplitterWords(seg.text) <= MAX_CHUNK_WORDS
    ) {
      finalChunks.push({ chunkText: seg.text, startOffset: seg.startOffset });
      continue;
    }

    // Try splitting by clause punctuation first
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
        part.text.length <= MAX_CHUNK_CHARS &&
        countApproxSplitterWords(part.text) <= MAX_CHUNK_WORDS
      ) {
        finalChunks.push({ chunkText: part.text, startOffset: part.startOffset });
        continue;
      }

      // Sliding window slice with boundary snap on ASCII spaces
      let pos = 0;
      while (pos < part.text.length) {
        let end = Math.min(part.text.length, pos + MAX_CHUNK_CHARS);
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
        pos = Math.max(pos + 24, end - OVERLAP_CHARS);
      }
    }
  }

  return finalChunks;
}

async function runInferenceWithAutoFallback(
  texts: string[],
  signal: AbortSignal
): ReturnType<Gliner["inference"]> {
  if (!glinerInstance) {
    await ensureInitialized(signal);
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
    // Some WebGPU drivers fail on int8 DeBERTa ops during first inference rather than session create
    if (activeProvider === "webgpu") {
      glinerInstance = null;
      activeProvider = null;
      const { bytes, fromCache } = await loadOrDownloadModelBytes(signal);
      emit({
        type: "progress",
        stage: "initializing",
        loadedBytes: bytes.byteLength,
        totalBytes: bytes.byteLength,
        percent: 100,
        provider: "wasm",
        cached: fromCache,
      });
      glinerInstance = await createGlinerSession(bytes, "wasm", signal);
      activeProvider = "wasm";
      emit({
        type: "progress",
        stage: "ready",
        loadedBytes: bytes.byteLength,
        totalBytes: bytes.byteLength,
        percent: 100,
        provider: "wasm",
        cached: fromCache,
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

async function handleInferBatch(posts: WorkerPostInput[], signal: AbortSignal) {
  const { provider } = await ensureInitialized(signal);
  let resolvedProvider = provider;

  interface ChunkJob {
    postIndex: number;
    chunkText: string;
    startOffset: number;
  }

  const allJobs: ChunkJob[] = [];
  const perPostRawSpans: WorkerMlSpan[][] = posts.map(() => []);

  posts.forEach((p, idx) => {
    const chunks = splitIntoGlinerChunks(p.text || "");
    for (const ch of chunks) {
      allJobs.push({
        postIndex: idx,
        chunkText: ch.chunkText,
        startOffset: ch.startOffset,
      });
    }
  });

  for (let i = 0; i < allJobs.length; i += INFER_SUBBATCH_SIZE) {
    if (abortRequested || signal.aborted) {
      throw new DOMException("Inference aborted", "AbortError");
    }

    const batchJobs = allJobs.slice(i, i + INFER_SUBBATCH_SIZE);
    const batchResults = await runInferenceWithAutoFallback(
      batchJobs.map((j) => j.chunkText),
      signal
    );
    if (activeProvider) {
      resolvedProvider = activeProvider;
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

  // Deduplicate overlapping window hits inside each post, keeping highest score
  const output = posts.map((p, idx) => {
    const spans = perPostRawSpans[idx].sort((a, b) => b.score - a.score);
    const kept: WorkerMlSpan[] = [];
    for (const s of spans) {
      const overlaps = kept.some(
        (k) =>
          (s.start < k.end && s.end > k.start) ||
          (s.nerClass === k.nerClass &&
            s.spanText.toLowerCase() === k.spanText.toLowerCase() &&
            Math.abs(s.start - k.start) <= OVERLAP_CHARS)
      );
      if (!overlaps) {
        kept.push(s);
      }
    }
    kept.sort((a, b) => a.start - b.start);
    return { postKey: p.postKey, spans: kept };
  });

  return { provider: resolvedProvider, results: output };
}

// Serialize async operations inside worker so ONNX session isn't mutated concurrently
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
        activeProvider = null;
        await clearAllModelCaches();
        emit({ id: msg.id, type: "clear-done" });
        return;
      }

      if (msg.type === "warmup") {
        const { provider, cached } = await ensureInitialized(signal);
        emit({ id: msg.id, type: "warmup-done", provider, cached });
        return;
      }

      if (msg.type === "infer-batch") {
        const { provider, results } = await handleInferBatch(msg.posts, signal);
        emit({ id: msg.id, type: "infer-done", provider, results });
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
