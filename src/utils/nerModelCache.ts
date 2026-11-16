/**
 * Persistent Cache Storage + IndexedDB Resumable Chunk Store for local NER models:
 *   1. `Xenova/bert-base-chinese-ner` (~98.2 MB INT8 ONNX for Chinese NER)
 *   2. `onnx-community/gliner_multi-v2.1` (~333 MB INT8 ONNX for Multilingual / JA / EN / RU NER)
 *
 * Persists completed 8 MiB chunks immediately as they stream in so slow or flaky
 * connections never lose downloaded progress across retries, pauses, or reloads.
 */

export type NerModelId = "cjkBert" | "gliner";

export interface NerModelSpec {
  id: NerModelId;
  repoId: string;
  onnxUrl: string;
  cacheName: string;
  metaKey: string;
  chunkPrefix: string;
  approxBytes: number;
  minValidBytes: number;
}

export const NER_MODEL_SPECS: Record<NerModelId, NerModelSpec> = {
  cjkBert: {
    id: "cjkBert",
    repoId: "Xenova/bert-base-chinese-ner",
    onnxUrl:
      "https://huggingface.co/Xenova/bert-base-chinese-ner/resolve/main/onnx/model_quantized.onnx",
    cacheName: "transformers-cache",
    metaKey: "cjk_bert_chinese_ner_quantized",
    chunkPrefix: "cjk:",
    approxBytes: 102_959_365,
    minValidBytes: 25_000_000,
  },
  gliner: {
    id: "gliner",
    repoId: "onnx-community/gliner_multi-v2.1",
    onnxUrl:
      "https://huggingface.co/onnx-community/gliner_multi-v2.1/resolve/main/onnx/model_quantized.onnx",
    cacheName: "gingko-ner-models-v1",
    metaKey: "gliner_multi_v2_1_quantized",
    chunkPrefix: "gliner:",
    approxBytes: 349_120_924,
    minValidBytes: 50_000_000,
  },
};

// Backwards-compatible legacy aliases for GLiNER
export const MODEL_TOKENIZER_ID = NER_MODEL_SPECS.gliner.repoId;
export const MODEL_ONNX_URL = NER_MODEL_SPECS.gliner.onnxUrl;
export const MODEL_CACHE_NAME = NER_MODEL_SPECS.gliner.cacheName;
export const APPROX_MODEL_BYTES = NER_MODEL_SPECS.gliner.approxBytes;

export const MODEL_CHUNK_DB_NAME = "GingkoNerModelChunksDB";
export const MODEL_CHUNK_DB_VERSION = 1;
export const CHUNK_SIZE_BYTES = 8 * 1024 * 1024; // 8 MiB per resumable chunk

const STORE_META = "meta";
const STORE_CHUNKS = "chunks";

export interface ModelDownloadMeta {
  key: string;
  url: string;
  etag: string;
  totalBytes: number;
  chunkSize: number;
  numChunks: number;
  updatedAt: number;
}

export interface SingleModelCacheStatus {
  isCached: boolean;
  partialBytes: number;
  totalBytes: number;
}

export interface ModelCacheInspection {
  isCached: boolean;
  cjkCached: boolean;
  glinerCached: boolean;
  partialBytes: number;
  totalBytes: number;
  cjk: SingleModelCacheStatus;
  gliner: SingleModelCacheStatus;
}

function makeChunkKey(modelId: NerModelId, index: number): string {
  return `${NER_MODEL_SPECS[modelId].chunkPrefix}${index}`;
}

function openChunkDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(MODEL_CHUNK_DB_NAME, MODEL_CHUNK_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(STORE_CHUNKS)) {
        db.createObjectStore(STORE_CHUNKS);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("Failed to open chunk DB"));
  });
}

export async function readModelMeta(modelId: NerModelId = "gliner"): Promise<ModelDownloadMeta | null> {
  const spec = NER_MODEL_SPECS[modelId];
  try {
    const db = await openChunkDb();
    try {
      return await new Promise<ModelDownloadMeta | null>((resolve, reject) => {
        const tx = db.transaction(STORE_META, "readonly");
        const req = tx.objectStore(STORE_META).get(spec.metaKey);
        req.onsuccess = () => resolve((req.result as ModelDownloadMeta | undefined) || null);
        req.onerror = () => reject(req.error);
      });
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

export async function writeModelMeta(
  meta: Omit<ModelDownloadMeta, "key">,
  modelId: NerModelId = "gliner"
): Promise<void> {
  const spec = NER_MODEL_SPECS[modelId];
  try {
    const db = await openChunkDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_META, "readwrite");
        tx.objectStore(STORE_META).put({ ...meta, key: spec.metaKey });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  } catch {
    // ignore IDB quota/privacy errors
  }
}

export async function getCompletedChunkIndices(modelId: NerModelId = "gliner"): Promise<Set<number>> {
  const spec = NER_MODEL_SPECS[modelId];
  try {
    const db = await openChunkDb();
    try {
      return await new Promise<Set<number>>((resolve, reject) => {
        const tx = db.transaction(STORE_CHUNKS, "readonly");
        const req = tx.objectStore(STORE_CHUNKS).getAllKeys();
        req.onsuccess = () => {
          const set = new Set<number>();
          for (const k of req.result || []) {
            if (typeof k === "string" && k.startsWith(spec.chunkPrefix)) {
              const idx = Number(k.slice(spec.chunkPrefix.length));
              if (Number.isInteger(idx) && idx >= 0) {
                set.add(idx);
              }
            } else if (modelId === "gliner" && typeof k === "number" && Number.isInteger(k) && k >= 0) {
              // Backwards compatibility with legacy unprefixed numeric chunk keys for GLiNER
              set.add(k);
            }
          }
          resolve(set);
        };
        req.onerror = () => reject(req.error);
      });
    } finally {
      db.close();
    }
  } catch {
    return new Set();
  }
}

export function expectedChunkLength(
  chunkIndex: number,
  totalBytes: number,
  chunkSize = CHUNK_SIZE_BYTES
): number {
  const start = chunkIndex * chunkSize;
  if (start >= totalBytes) return 0;
  return Math.min(chunkSize, totalBytes - start);
}

export function computeSavedBytes(
  completed: Set<number>,
  totalBytes: number,
  chunkSize = CHUNK_SIZE_BYTES
): number {
  let sum = 0;
  for (const idx of completed) {
    sum += expectedChunkLength(idx, totalBytes, chunkSize);
  }
  return sum;
}

export async function putModelChunk(
  index: number,
  data: ArrayBuffer,
  modelId: NerModelId = "gliner"
): Promise<void> {
  const db = await openChunkDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_CHUNKS, "readwrite");
      tx.objectStore(STORE_CHUNKS).put(data, makeChunkKey(modelId, index));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("Failed to persist chunk"));
    });
  } finally {
    db.close();
  }
}

export async function deleteModelChunk(
  index: number,
  modelId: NerModelId = "gliner"
): Promise<void> {
  try {
    const db = await openChunkDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_CHUNKS, "readwrite");
        const store = tx.objectStore(STORE_CHUNKS);
        store.delete(makeChunkKey(modelId, index));
        if (modelId === "gliner") {
          store.delete(index);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  } catch {
    // ignore
  }
}

/**
 * Assembles all verified chunks sequentially into a single contiguous Uint8Array.
 * If any chunk is missing or size-corrupt, returns `{ invalidIndices }` so caller
 * only re-downloads the missing slice(s).
 */
export async function assembleModelFromChunks(
  meta: ModelDownloadMeta,
  modelId: NerModelId = "gliner"
): Promise<{
  bytes: Uint8Array | null;
  invalidIndices: number[];
}> {
  const invalidIndices: number[] = [];
  const combined = new Uint8Array(meta.totalBytes);

  const db = await openChunkDb();
  try {
    for (let idx = 0; idx < meta.numChunks; idx++) {
      const expectedLen = expectedChunkLength(idx, meta.totalBytes, meta.chunkSize);
      const buf = await new Promise<ArrayBuffer | null>((resolve, reject) => {
        const tx = db.transaction(STORE_CHUNKS, "readonly");
        const store = tx.objectStore(STORE_CHUNKS);
        const req = store.get(makeChunkKey(modelId, idx));
        req.onsuccess = () => {
          const val = req.result as ArrayBuffer | undefined;
          if (val || modelId !== "gliner") {
            resolve(val || null);
            return;
          }
          // Fallback read for legacy numeric GLiNER key
          const legacyReq = store.get(idx);
          legacyReq.onsuccess = () => resolve((legacyReq.result as ArrayBuffer | undefined) || null);
          legacyReq.onerror = () => reject(legacyReq.error);
        };
        req.onerror = () => reject(req.error);
      });
      if (!buf || buf.byteLength !== expectedLen) {
        invalidIndices.push(idx);
      } else if (invalidIndices.length === 0) {
        combined.set(new Uint8Array(buf), idx * meta.chunkSize);
      }
    }
  } finally {
    db.close();
  }

  if (invalidIndices.length > 0) {
    return { bytes: null, invalidIndices };
  }
  return { bytes: combined, invalidIndices: [] };
}

export async function clearPartialChunksForModel(modelId: NerModelId): Promise<void> {
  const spec = NER_MODEL_SPECS[modelId];
  try {
    const db = await openChunkDb();
    try {
      const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
        const tx = db.transaction(STORE_CHUNKS, "readonly");
        const req = tx.objectStore(STORE_CHUNKS).getAllKeys();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction([STORE_META, STORE_CHUNKS], "readwrite");
        tx.objectStore(STORE_META).delete(spec.metaKey);
        const chunkStore = tx.objectStore(STORE_CHUNKS);
        for (const k of keys) {
          if (
            (typeof k === "string" && k.startsWith(spec.chunkPrefix)) ||
            (modelId === "gliner" && typeof k === "number")
          ) {
            chunkStore.delete(k);
          }
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  } catch {
    // ignore
  }
}

export async function clearPartialChunksDb(): Promise<void> {
  try {
    const db = await openChunkDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction([STORE_META, STORE_CHUNKS], "readwrite");
        tx.objectStore(STORE_META).clear();
        tx.objectStore(STORE_CHUNKS).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  } catch {
    // ignore
  }
}

export async function clearAllModelCaches(): Promise<void> {
  if (typeof caches !== "undefined") {
    await caches.delete(NER_MODEL_SPECS.gliner.cacheName).catch(() => {});
    try {
      const cache = await caches.open(NER_MODEL_SPECS.cjkBert.cacheName);
      const reqs = await cache.keys();
      await Promise.all(
        reqs
          .filter(
            (r) =>
              r.url.includes("bert-base-chinese-ner") ||
              r.url.includes("gliner_multi")
          )
          .map((r) => cache.delete(r))
      );
    } catch {
      // ignore Cache Storage errors
    }
  }
  await clearPartialChunksDb();
}

async function inspectSingleModelCache(modelId: NerModelId): Promise<SingleModelCacheStatus> {
  const spec = NER_MODEL_SPECS[modelId];
  if (typeof caches !== "undefined") {
    try {
      const cache = await caches.open(spec.cacheName);
      const match = await cache.match(spec.onnxUrl);
      if (match) {
        const len = Number(match.headers.get("content-length") || "0");
        const resolvedTotal = len > spec.minValidBytes ? len : spec.approxBytes;
        return {
          isCached: true,
          partialBytes: resolvedTotal,
          totalBytes: resolvedTotal,
        };
      }
    } catch {
      // ignore Cache Storage errors
    }
  }

  const meta = await readModelMeta(modelId);
  if (!meta || meta.totalBytes <= 0) {
    return { isCached: false, partialBytes: 0, totalBytes: 0 };
  }

  const completed = await getCompletedChunkIndices(modelId);
  const partialBytes = computeSavedBytes(completed, meta.totalBytes, meta.chunkSize);
  const allChunksComplete = completed.size >= meta.numChunks && partialBytes >= meta.totalBytes;

  return {
    isCached: allChunksComplete,
    partialBytes,
    totalBytes: meta.totalBytes,
  };
}

export async function inspectModelCacheState(): Promise<ModelCacheInspection> {
  const [cjk, gliner] = await Promise.all([
    inspectSingleModelCache("cjkBert"),
    inspectSingleModelCache("gliner"),
  ]);

  // Prefer surfacing any active partial progress or whichever model is cached
  let partialBytes = 0;
  let totalBytes = 0;
  if (!cjk.isCached && cjk.partialBytes > 0) {
    partialBytes = cjk.partialBytes;
    totalBytes = cjk.totalBytes;
  } else if (!gliner.isCached && gliner.partialBytes > 0) {
    partialBytes = gliner.partialBytes;
    totalBytes = gliner.totalBytes;
  } else if (cjk.isCached && gliner.isCached) {
    partialBytes = cjk.totalBytes + gliner.totalBytes;
    totalBytes = cjk.totalBytes + gliner.totalBytes;
  } else if (cjk.isCached) {
    partialBytes = cjk.totalBytes;
    totalBytes = cjk.totalBytes;
  } else if (gliner.isCached) {
    partialBytes = gliner.totalBytes;
    totalBytes = gliner.totalBytes;
  }

  return {
    isCached: cjk.isCached || gliner.isCached,
    cjkCached: cjk.isCached,
    glinerCached: gliner.isCached,
    partialBytes,
    totalBytes,
    cjk,
    gliner,
  };
}
