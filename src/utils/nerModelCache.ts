/**
 * Persistent Cache Storage + IndexedDB Resumable Chunk Store for local GLiNER.js weights.
 *
 * Persists completed 8 MiB chunks immediately as they stream in so slow or flaky
 * connections never lose downloaded progress across retries, pauses, or reloads.
 */

export const MODEL_TOKENIZER_ID = "onnx-community/gliner_multi-v2.1";
export const MODEL_ONNX_URL =
  "https://huggingface.co/onnx-community/gliner_multi-v2.1/resolve/main/onnx/model_quantized.onnx";
export const MODEL_CACHE_NAME = "gingko-ner-models-v1";
export const MODEL_CHUNK_DB_NAME = "GingkoNerModelChunksDB";
export const MODEL_CHUNK_DB_VERSION = 1;
export const CHUNK_SIZE_BYTES = 8 * 1024 * 1024; // 8 MiB per resumable chunk
export const APPROX_MODEL_BYTES = 349_120_924;

const STORE_META = "meta";
const STORE_CHUNKS = "chunks";
const META_KEY = "gliner_multi_v2_1_quantized";

export interface ModelDownloadMeta {
  key: string;
  url: string;
  etag: string;
  totalBytes: number;
  chunkSize: number;
  numChunks: number;
  updatedAt: number;
}

export interface ModelCacheInspection {
  isCached: boolean;
  partialBytes: number;
  totalBytes: number;
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

export async function readModelMeta(): Promise<ModelDownloadMeta | null> {
  try {
    const db = await openChunkDb();
    try {
      return await new Promise<ModelDownloadMeta | null>((resolve, reject) => {
        const tx = db.transaction(STORE_META, "readonly");
        const req = tx.objectStore(STORE_META).get(META_KEY);
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

export async function writeModelMeta(meta: Omit<ModelDownloadMeta, "key">): Promise<void> {
  try {
    const db = await openChunkDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_META, "readwrite");
        tx.objectStore(STORE_META).put({ ...meta, key: META_KEY });
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

export async function getCompletedChunkIndices(): Promise<Set<number>> {
  try {
    const db = await openChunkDb();
    try {
      return await new Promise<Set<number>>((resolve, reject) => {
        const tx = db.transaction(STORE_CHUNKS, "readonly");
        const req = tx.objectStore(STORE_CHUNKS).getAllKeys();
        req.onsuccess = () => {
          const set = new Set<number>();
          for (const k of req.result || []) {
            if (typeof k === "number" && Number.isInteger(k) && k >= 0) {
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

export async function putModelChunk(index: number, data: ArrayBuffer): Promise<void> {
  const db = await openChunkDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_CHUNKS, "readwrite");
      tx.objectStore(STORE_CHUNKS).put(data, index);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("Failed to persist chunk"));
    });
  } finally {
    db.close();
  }
}

export async function deleteModelChunk(index: number): Promise<void> {
  try {
    const db = await openChunkDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_CHUNKS, "readwrite");
        tx.objectStore(STORE_CHUNKS).delete(index);
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

export async function getModelChunk(index: number): Promise<ArrayBuffer | null> {
  try {
    const db = await openChunkDb();
    try {
      return await new Promise<ArrayBuffer | null>((resolve, reject) => {
        const tx = db.transaction(STORE_CHUNKS, "readonly");
        const req = tx.objectStore(STORE_CHUNKS).get(index);
        req.onsuccess = () => resolve((req.result as ArrayBuffer | undefined) || null);
        req.onerror = () => reject(req.error);
      });
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

/**
 * Assembles all verified chunks sequentially into a single contiguous Uint8Array.
 * If any chunk is missing or size-corrupt, returns `{ missingIndices }` so caller
 * only re-downloads the missing slice(s).
 */
export async function assembleModelFromChunks(meta: ModelDownloadMeta): Promise<{
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
        const req = tx.objectStore(STORE_CHUNKS).get(idx);
        req.onsuccess = () => resolve((req.result as ArrayBuffer | undefined) || null);
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
    await caches.delete(MODEL_CACHE_NAME).catch(() => {});
  }
  await clearPartialChunksDb();
}

export async function inspectModelCacheState(): Promise<ModelCacheInspection> {
  if (typeof caches !== "undefined") {
    try {
      const cache = await caches.open(MODEL_CACHE_NAME);
      const match = await cache.match(MODEL_ONNX_URL);
      if (match) {
        const len = Number(match.headers.get("content-length") || "0");
        const resolvedTotal = len > 50_000_000 ? len : APPROX_MODEL_BYTES;
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

  const meta = await readModelMeta();
  if (!meta || meta.totalBytes <= 0) {
    return { isCached: false, partialBytes: 0, totalBytes: 0 };
  }

  const completed = await getCompletedChunkIndices();
  const partialBytes = computeSavedBytes(completed, meta.totalBytes, meta.chunkSize);
  const allChunksComplete = completed.size >= meta.numChunks && partialBytes >= meta.totalBytes;

  return {
    isCached: allChunksComplete,
    partialBytes,
    totalBytes: meta.totalBytes,
  };
}
