/**
 * Persistent IndexedDB Vector Store, Resumable ONNX Model Cache, Text Normalizer,
 * and Vector Math Utilities for Listen Tab Hots Mode Multilingual Embeddings.
 *
 * Model: `Xenova/paraphrase-multilingual-MiniLM-L12-v2` (quantized INT8 ONNX, ~113 MB, 384-d)
 * Storage:
 *   1. Cache Storage (`gingko-hots-embed-v1`) + IndexedDB chunks (`GingkoHotsEmbedChunksDB`)
 *      for resumable 8 MiB model weight downloads.
 *   2. IndexedDB (`GingkoHotsVectorDB`, store `post_embeddings`) for L2-normalized
 *      384-dim Float32Array vectors keyed by `${modelId}::${postKey}`, with contentHash
 *      invalidation and bounded LRU pruning.
 */

export const HOTS_EMBED_MODEL_ID = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";
export const HOTS_EMBED_ONNX_URL =
  "https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2/resolve/main/onnx/model_quantized.onnx";
export const HOTS_EMBED_CACHE_NAME = "gingko-hots-embed-v1";
export const HOTS_EMBED_APPROX_BYTES = 118_400_000;
export const HOTS_EMBED_MIN_VALID_BYTES = 35_000_000;
export const HOTS_EMBED_DIM = 384;

export const HOTS_EMBED_CHUNK_DB_NAME = "GingkoHotsEmbedChunksDB";
export const HOTS_EMBED_CHUNK_DB_VERSION = 1;
export const HOTS_CHUNK_SIZE_BYTES = 8 * 1024 * 1024; // 8 MiB chunks
const HOTS_MODEL_META_KEY = "multilingual_minilm_l12_v2_q8";
const STORE_META = "meta";
const STORE_CHUNKS = "chunks";

export const HOTS_VECTOR_DB_NAME = "GingkoHotsVectorDB";
export const HOTS_VECTOR_DB_VERSION = 1;
const STORE_EMBEDDINGS = "post_embeddings";
export const MAX_CACHED_VECTORS = 15_000;
export const MAX_VECTOR_AGE_MS = 30 * 24 * 3600 * 1000; // 30 days

export interface HotsModelDownloadMeta {
  key: string;
  url: string;
  etag: string;
  totalBytes: number;
  chunkSize: number;
  numChunks: number;
  updatedAt: number;
}

export interface HotsEmbedModelCacheStatus {
  isCached: boolean;
  partialBytes: number;
  totalBytes: number;
  approxBytes: number;
}

export interface CachedPostEmbeddingRecord {
  id: string; // `${modelId}::${postKey}`
  postKey: string;
  modelId: string;
  contentHash: string;
  vectorBuffer: ArrayBuffer;
  langHint?: string;
  updatedAt: number;
}

export interface HotsVectorCacheStats {
  count: number;
  approxBytes: number;
}

// ---------------------------------------------------------------------------
// Fast Content Hashing & Canonical Post Text Preparation
// ---------------------------------------------------------------------------

export function fnv1aHash64(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x811c9dc5 ^ 0x9e3779b9;
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    h1 ^= code;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= (code + i) & 0xffff;
    h2 = Math.imul(h2, 0x01000193);
  }
  return `${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}`;
}

export function detectCompactLangHint(text: string): string {
  if (!text) return "en";
  if (/[\u3040-\u30ff]/.test(text)) return "ja";
  if (/[\u4e00-\u9fff]/.test(text)) return "zh";
  if (/[\u0400-\u04ff]/.test(text)) return "ru";
  return "en";
}

/**
 * Produces a concise, high-signal text snippet for embedding:
 * prioritizes link preview headline, strips Telegram promotional footers/URLs,
 * and caps character length (~360 chars -> ~90–128 tokens) for rapid inference.
 */
export function buildPostEmbeddingInput(post: {
  text?: string;
  cleanSnippet?: string;
  linkPreview?: {
    title?: string;
    description?: string;
    domain?: string;
  };
}): { text: string; contentHash: string; langHint: string } {
  const lpTitle = (post.linkPreview?.title || "").trim();
  const lpDesc = (post.linkPreview?.description || "").trim();
  const rawBody = (post.text || post.cleanSnippet || "").trim();

  // Extract hashtags cleanly to preserve explicit topic anchors
  const hashtags = Array.from(
    new Set((rawBody.match(/#[\p{L}\p{N}_]{2,32}/gu) || []).map((h) => h.trim()))
  ).slice(0, 5);

  const cleanBody = rawBody
    .replace(/<[^>]*>?/gm, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/t\.me\/\S+/gi, " ")
    // Common Telegram boilerplate promotional tails
    .replace(
      /(?:^|\n|\s)(?:subscribe|join|follow|read more|source|via|подписаться|подпишись|подписывайтесь|источник|читать далее|关注|订阅|来源|加入频道|点击查看)\s*[:：\-—]?\s*@?[a-zA-Z0-9_]{0,32}.*$/gim,
      " "
    )
    .replace(/@[a-zA-Z0-9_]+/g, " ")
    .replace(/[#*`_~|•►▪▶⚡🔥🚀📢🚨📸🎥👇👉]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const segments: string[] = [];
  if (lpTitle.length >= 6) {
    segments.push(lpTitle);
  }
  if (cleanBody && cleanBody.toLowerCase() !== lpTitle.toLowerCase()) {
    // Avoid duplicating when cleanBody starts identically with lpTitle
    const bodyTrim =
      lpTitle && cleanBody.toLowerCase().startsWith(lpTitle.toLowerCase())
        ? cleanBody.slice(lpTitle.length).trim()
        : cleanBody;
    if (bodyTrim) {
      segments.push(bodyTrim);
    }
  }
  if (segments.length === 0 && lpDesc) {
    segments.push(lpDesc);
  }
  if (hashtags.length > 0) {
    segments.push(hashtags.join(" "));
  }

  let combined = segments.join(" — ").replace(/\s+/g, " ").trim();
  if (combined.length > 380) {
    combined = combined.slice(0, 380).trim();
  }

  return {
    text: combined,
    contentHash: fnv1aHash64(combined),
    langHint: detectCompactLangHint(combined),
  };
}

// ---------------------------------------------------------------------------
// Dense Vector Math Utilities (L2-Normalized Cosine via Dot Product)
// ---------------------------------------------------------------------------

export function l2Normalize(vec: Float32Array): Float32Array {
  let sumSq = 0;
  for (let i = 0; i < vec.length; i++) {
    const v = vec[i];
    sumSq += v * v;
  }
  const norm = Math.sqrt(sumSq);
  if (norm <= 1e-12) return vec;
  const out = new Float32Array(vec.length);
  const inv = 1 / norm;
  for (let i = 0; i < vec.length; i++) {
    out[i] = vec[i] * inv;
  }
  return out;
}

export function dotProductVectors(a: Float32Array, b: Float32Array): number {
  const len = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < len; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

/**
 * Attention-masked mean pooling + L2 normalization over transformer last_hidden_state.
 */
export function meanPoolAndNormalize(
  lastHiddenState: Float32Array,
  attentionMask: ArrayLike<number | bigint>,
  batchSize: number,
  seqLen: number,
  hiddenDim: number = HOTS_EMBED_DIM
): Float32Array[] {
  const results: Float32Array[] = new Array(batchSize);
  const rowStride = seqLen * hiddenDim;

  for (let b = 0; b < batchSize; b++) {
    const pooled = new Float32Array(hiddenDim);
    let maskSum = 0;
    const batchOffset = b * rowStride;
    const maskOffset = b * seqLen;

    for (let t = 0; t < seqLen; t++) {
      const m = Number(attentionMask[maskOffset + t] ?? 0);
      if (m <= 0) continue;
      maskSum += m;
      const tokOffset = batchOffset + t * hiddenDim;
      for (let d = 0; d < hiddenDim; d++) {
        pooled[d] += lastHiddenState[tokOffset + d] * m;
      }
    }

    const denom = Math.max(1e-9, maskSum);
    for (let d = 0; d < hiddenDim; d++) {
      pooled[d] /= denom;
    }
    results[b] = l2Normalize(pooled);
  }

  return results;
}

// ---------------------------------------------------------------------------
// 1. Model Weight Cache (IndexedDB 8 MiB Chunks + Browser Cache Storage)
// ---------------------------------------------------------------------------

function openHotsChunkDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(HOTS_EMBED_CHUNK_DB_NAME, HOTS_EMBED_CHUNK_DB_VERSION);
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
    req.onerror = () => reject(req.error || new Error("Failed to open Hots chunk DB"));
  });
}

export function expectedHotsChunkLength(
  chunkIndex: number,
  totalBytes: number,
  chunkSize: number = HOTS_CHUNK_SIZE_BYTES
): number {
  const start = chunkIndex * chunkSize;
  if (start >= totalBytes) return 0;
  return Math.min(chunkSize, totalBytes - start);
}

export function computeHotsSavedBytes(
  completed: Set<number>,
  totalBytes: number,
  chunkSize: number = HOTS_CHUNK_SIZE_BYTES
): number {
  let sum = 0;
  for (const idx of completed) {
    sum += expectedHotsChunkLength(idx, totalBytes, chunkSize);
  }
  return sum;
}

export async function readHotsModelMeta(): Promise<HotsModelDownloadMeta | null> {
  try {
    const db = await openHotsChunkDb();
    try {
      return await new Promise<HotsModelDownloadMeta | null>((resolve, reject) => {
        const tx = db.transaction(STORE_META, "readonly");
        const req = tx.objectStore(STORE_META).get(HOTS_MODEL_META_KEY);
        req.onsuccess = () => resolve((req.result as HotsModelDownloadMeta | undefined) || null);
        req.onerror = () => reject(req.error);
      });
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

export async function writeHotsModelMeta(
  meta: Omit<HotsModelDownloadMeta, "key">
): Promise<void> {
  try {
    const db = await openHotsChunkDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_META, "readwrite");
        tx.objectStore(STORE_META).put({ ...meta, key: HOTS_MODEL_META_KEY });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  } catch {
    // ignore storage errors
  }
}

export async function getCompletedHotsChunkIndices(): Promise<Set<number>> {
  try {
    const db = await openHotsChunkDb();
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

export async function putHotsModelChunk(index: number, data: ArrayBuffer): Promise<void> {
  const db = await openHotsChunkDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_CHUNKS, "readwrite");
      tx.objectStore(STORE_CHUNKS).put(data, index);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("Failed to persist model chunk"));
    });
  } finally {
    db.close();
  }
}

export async function deleteHotsModelChunk(index: number): Promise<void> {
  try {
    const db = await openHotsChunkDb();
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

export async function assembleHotsModelFromChunks(
  meta: HotsModelDownloadMeta
): Promise<{ bytes: Uint8Array | null; invalidIndices: number[] }> {
  const invalidIndices: number[] = [];
  const combined = new Uint8Array(meta.totalBytes);

  const db = await openHotsChunkDb();
  try {
    for (let idx = 0; idx < meta.numChunks; idx++) {
      const expectedLen = expectedHotsChunkLength(idx, meta.totalBytes, meta.chunkSize);
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

export async function clearHotsPartialChunksDb(): Promise<void> {
  try {
    const db = await openHotsChunkDb();
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

export async function clearHotsEmbedModelCaches(): Promise<void> {
  if (typeof caches !== "undefined") {
    await caches.delete(HOTS_EMBED_CACHE_NAME).catch(() => {});
  }
  await clearHotsPartialChunksDb();
}

export async function inspectHotsEmbedModelCache(): Promise<HotsEmbedModelCacheStatus> {
  if (typeof caches !== "undefined") {
    try {
      const cache = await caches.open(HOTS_EMBED_CACHE_NAME);
      const match = await cache.match(HOTS_EMBED_ONNX_URL);
      if (match) {
        const len = Number(match.headers.get("content-length") || "0");
        const resolvedTotal = len > HOTS_EMBED_MIN_VALID_BYTES ? len : HOTS_EMBED_APPROX_BYTES;
        return {
          isCached: true,
          partialBytes: resolvedTotal,
          totalBytes: resolvedTotal,
          approxBytes: HOTS_EMBED_APPROX_BYTES,
        };
      }
    } catch {
      // ignore Cache Storage errors
    }
  }

  const meta = await readHotsModelMeta();
  if (!meta || meta.totalBytes <= 0) {
    return {
      isCached: false,
      partialBytes: 0,
      totalBytes: 0,
      approxBytes: HOTS_EMBED_APPROX_BYTES,
    };
  }

  const completed = await getCompletedHotsChunkIndices();
  const partialBytes = computeHotsSavedBytes(completed, meta.totalBytes, meta.chunkSize);
  const allComplete = completed.size >= meta.numChunks && partialBytes >= meta.totalBytes;

  return {
    isCached: allComplete,
    partialBytes,
    totalBytes: meta.totalBytes,
    approxBytes: HOTS_EMBED_APPROX_BYTES,
  };
}

// ---------------------------------------------------------------------------
// 2. Post Embedding Vector Store (IndexedDB: GingkoHotsVectorDB)
// ---------------------------------------------------------------------------

function openVectorDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(HOTS_VECTOR_DB_NAME, HOTS_VECTOR_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_EMBEDDINGS)) {
        const store = db.createObjectStore(STORE_EMBEDDINGS, { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("Failed to open Hots vector DB"));
  });
}

export function makeVectorRecordId(postKey: string, modelId: string = HOTS_EMBED_MODEL_ID): string {
  return `${modelId}::${postKey}`;
}

export async function getCachedPostEmbeddings(
  items: Array<{ postKey: string; contentHash: string }>,
  modelId: string = HOTS_EMBED_MODEL_ID
): Promise<Map<string, Float32Array>> {
  const result = new Map<string, Float32Array>();
  if (!Array.isArray(items) || items.length === 0) return result;

  try {
    const db = await openVectorDb();
    try {
      const expectedHashes = new Map<string, string>();
      for (const it of items) {
        expectedHashes.set(it.postKey, it.contentHash);
      }

      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_EMBEDDINGS, "readonly");
        const store = tx.objectStore(STORE_EMBEDDINGS);

        if (items.length > 250) {
          // Single scan fast-path when querying large windows
          const req = store.getAll();
          req.onsuccess = () => {
            const rows = (req.result || []) as CachedPostEmbeddingRecord[];
            for (const row of rows) {
              if (!row || row.modelId !== modelId) continue;
              const expectedHash = expectedHashes.get(row.postKey);
              if (expectedHash && row.contentHash === expectedHash && row.vectorBuffer) {
                result.set(row.postKey, new Float32Array(row.vectorBuffer));
              }
            }
            resolve();
          };
          req.onerror = () => reject(req.error);
        } else {
          for (const it of items) {
            const req = store.get(makeVectorRecordId(it.postKey, modelId));
            req.onsuccess = () => {
              const row = req.result as CachedPostEmbeddingRecord | undefined;
              if (row && row.contentHash === it.contentHash && row.vectorBuffer) {
                result.set(it.postKey, new Float32Array(row.vectorBuffer));
              }
            };
          }
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        }
      });
    } finally {
      db.close();
    }
  } catch {
    // Graceful fallback when IndexedDB is unavailable
  }

  return result;
}

export async function saveCachedPostEmbeddings(
  records: Array<{
    postKey: string;
    contentHash: string;
    vector: Float32Array;
    langHint?: string;
  }>,
  modelId: string = HOTS_EMBED_MODEL_ID
): Promise<void> {
  if (!Array.isArray(records) || records.length === 0) return;
  try {
    const db = await openVectorDb();
    try {
      const now = Date.now();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_EMBEDDINGS, "readwrite");
        const store = tx.objectStore(STORE_EMBEDDINGS);
        for (const rec of records) {
          const copyBuf = rec.vector.slice().buffer;
          const row: CachedPostEmbeddingRecord = {
            id: makeVectorRecordId(rec.postKey, modelId),
            postKey: rec.postKey,
            modelId,
            contentHash: rec.contentHash,
            vectorBuffer: copyBuf,
            langHint: rec.langHint,
            updatedAt: now,
          };
          store.put(row);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });

      // Bounded LRU + TTL cleanup
      await pruneVectorStoreIfNeeded(db);
    } finally {
      db.close();
    }
  } catch {
    // Ignore quota errors cleanly
  }
}

async function pruneVectorStoreIfNeeded(db: IDBDatabase): Promise<void> {
  try {
    const count = await new Promise<number>((resolve, reject) => {
      const tx = db.transaction(STORE_EMBEDDINGS, "readonly");
      const req = tx.objectStore(STORE_EMBEDDINGS).count();
      req.onsuccess = () => resolve(req.result || 0);
      req.onerror = () => reject(req.error);
    });

    if (count <= MAX_CACHED_VECTORS) return;

    const cutoff = Date.now() - MAX_VECTOR_AGE_MS;
    const excessTarget = count - Math.floor(MAX_CACHED_VECTORS * 0.85);
    let deleted = 0;

    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_EMBEDDINGS, "readwrite");
      const store = tx.objectStore(STORE_EMBEDDINGS);
      const index = store.index("updatedAt");
      const cursorReq = index.openCursor();
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) return;
        const val = cursor.value as CachedPostEmbeddingRecord;
        if (deleted < excessTarget || (val.updatedAt || 0) < cutoff) {
          cursor.delete();
          deleted++;
          cursor.continue();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // ignore cleanup failures
  }
}

export async function getHotsVectorCacheStats(
  modelId: string = HOTS_EMBED_MODEL_ID
): Promise<HotsVectorCacheStats> {
  try {
    const db = await openVectorDb();
    try {
      const count = await new Promise<number>((resolve, reject) => {
        const tx = db.transaction(STORE_EMBEDDINGS, "readonly");
        const req = tx.objectStore(STORE_EMBEDDINGS).count();
        req.onsuccess = () => resolve(req.result || 0);
        req.onerror = () => reject(req.error);
      });
      // Each record is ~1.5 KiB vector + ~200 B metadata
      void modelId;
      return {
        count,
        approxBytes: count * (HOTS_EMBED_DIM * 4 + 200),
      };
    } finally {
      db.close();
    }
  } catch {
    return { count: 0, approxBytes: 0 };
  }
}

export async function clearHotsVectorCache(): Promise<void> {
  try {
    const db = await openVectorDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_EMBEDDINGS, "readwrite");
        tx.objectStore(STORE_EMBEDDINGS).clear();
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

export async function clearAllHotsMlCaches(): Promise<void> {
  await Promise.all([clearHotsEmbedModelCaches(), clearHotsVectorCache()]);
}

// ---------------------------------------------------------------------------
// 3. Optional Read-Only Lookup of Cached Explorer NER Entities
// ---------------------------------------------------------------------------

export interface CachedNerPostSummary {
  persons: string[];
  entities: string[];
}

export async function loadCachedNerEntitiesForPosts(
  posts: Array<{ key: string; channelUsername?: string; channelName?: string }>
): Promise<Map<string, CachedNerPostSummary>> {
  const out = new Map<string, CachedNerPostSummary>();
  if (typeof indexedDB === "undefined" || !Array.isArray(posts) || posts.length === 0) {
    return out;
  }

  try {
    // Only read GingkoExplorerNerDB if it already exists so we never trigger spurious creation/upgrades
    if (typeof indexedDB.databases === "function") {
      const dbs = await indexedDB.databases();
      if (!dbs.some((d) => d.name === "GingkoExplorerNerDB")) {
        return out;
      }
    }

    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("GingkoExplorerNerDB");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    try {
      if (!db.objectStoreNames.contains("post_extractions")) {
        return out;
      }

      const keySet = new Map<string, string>(); // recordId -> post.key
      for (const p of posts) {
        const chan = (p.channelUsername || p.channelName || "")
          .trim()
          .toLowerCase()
          .replace(/^https?:\/\/(?:t\.me|telegram\.me)\//i, "")
          .replace(/^@/, "");
        if (chan && p.key) {
          keySet.set(`${chan}::${p.key}`, p.key);
        }
      }

      if (keySet.size === 0) return out;

      await new Promise<void>((resolve) => {
        const tx = db.transaction("post_extractions", "readonly");
        const store = tx.objectStore("post_extractions");

        for (const [recId, postKey] of keySet.entries()) {
          const req = store.get(recId);
          req.onsuccess = () => {
            const rec = req.result as {
              entities?: Array<{ canonical?: string; name?: string; nerClass?: string }>;
            } | undefined;
            if (!rec || !Array.isArray(rec.entities) || rec.entities.length === 0) return;

            const persons: string[] = [];
            const entities: string[] = [];
            for (const ent of rec.entities) {
              const label = (ent.canonical || ent.name || "").trim();
              if (!label || label.length < 2) continue;
              if (ent.nerClass === "person") {
                if (!persons.includes(label)) persons.push(label);
              } else if (
                ent.nerClass === "organization" ||
                ent.nerClass === "nation" ||
                ent.nerClass === "event" ||
                ent.nerClass === "platform"
              ) {
                if (!entities.includes(label)) entities.push(label);
              }
            }

            if (persons.length > 0 || entities.length > 0) {
              out.set(postKey, { persons, entities });
            }
          };
        }

        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } finally {
      db.close();
    }
  } catch {
    // Non-critical enrichment: silently ignore if DB unavailable
  }

  return out;
}
