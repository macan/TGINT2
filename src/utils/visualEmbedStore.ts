/**
 * Persistent IndexedDB Visual Profile Embedding Store, Resumable SigLIP ONNX Model Cache,
 * Entity Canonicalizer, and Cosine Similarity Search Engine for the Channels Tab.
 *
 * Model: `Xenova/siglip-base-patch16-224` (`onnx/vision_model_quantized.onnx`, ~95 MB INT8, 768-d)
 * Storage:
 *   1. Cache Storage (`gingko-visual-siglip-v1`) + IndexedDB chunks (`GingkoVisualEmbedChunksDB`)
 *      for resumable 8 MiB model weight downloads.
 *   2. IndexedDB (`GingkoVisualProfileDB`, store `profile_embeddings`) for L2-normalized
 *      768-dim Float32Array vectors paired with full channel/user metadata snapshots.
 */

export const VISUAL_EMBED_MODEL_ID = "Xenova/siglip-base-patch16-224::wasm-b1-v2";
export const VISUAL_EMBED_ONNX_URL =
  "https://huggingface.co/Xenova/siglip-base-patch16-224/resolve/main/onnx/vision_model_quantized.onnx";
export const VISUAL_EMBED_CACHE_NAME = "gingko-visual-siglip-v1";
export const VISUAL_EMBED_APPROX_BYTES = 95_500_000;
export const VISUAL_EMBED_MIN_VALID_BYTES = 28_000_000;
export const VISUAL_EMBED_DIM = 768;
export const VISUAL_EMBED_INPUT_SIZE = 224;

export const VISUAL_CHUNK_DB_NAME = "GingkoVisualEmbedChunksDB";
export const VISUAL_CHUNK_DB_VERSION = 1;
export const VISUAL_CHUNK_SIZE_BYTES = 8 * 1024 * 1024; // 8 MiB chunks
const VISUAL_MODEL_META_KEY = "siglip_base_patch16_224_vision_q8";
const STORE_META = "meta";
const STORE_CHUNKS = "chunks";

export const VISUAL_PROFILE_DB_NAME = "GingkoVisualProfileDB";
export const VISUAL_PROFILE_DB_VERSION = 2;
const STORE_PROFILES = "profile_embeddings";
export const MAX_VISUAL_PROFILES = 20_000;
export const MAX_VISUAL_PROFILE_AGE_MS = 90 * 24 * 3600 * 1000; // 90 days

export type VisualEntityType = "channel" | "user";
export type VisualSearchScope = "all" | "channel" | "user";

export interface VisualModelDownloadMeta {
  key: string;
  url: string;
  etag: string;
  totalBytes: number;
  chunkSize: number;
  numChunks: number;
  updatedAt: number;
}

export interface VisualModelCacheStatus {
  isCached: boolean;
  partialBytes: number;
  totalBytes: number;
  approxBytes: number;
}

export interface VisualProfileMetadataSnapshot {
  entityType: VisualEntityType;
  entityKey: string;
  id?: string | number;
  username?: string;
  name?: string;
  key?: string;
  title?: string;
  first_name?: string;
  last_name?: string;
  description?: string;
  about?: string;
  photo?: string;
  photoUrl: string;
  photoCandidates?: string[];
  members?: number;
  participants_count?: number;
  files?: number;
  photos?: number;
  videos?: number;
  links?: number;
  phone?: string;
  status?: { status?: string } | string;
  bot?: boolean;
  lang?: string;
  cdnNumber?: string | null;
  cdnRegion?: [string, string] | null;
  _type?: string;
}

export interface VisualProfileEmbeddingRecord {
  id: string; // `${modelId}::${entityType}::${entityKey}`
  modelId: string;
  entityType: VisualEntityType;
  entityKey: string;
  usernameLower: string;
  photoUrl: string;
  photoHash: string;
  vectorBuffer: ArrayBuffer;
  metadata: VisualProfileMetadataSnapshot;
  updatedAt: number;
}

export interface VisualSimilarityMatch {
  recordId: string;
  entityType: VisualEntityType;
  entityKey: string;
  score: number; // cosine similarity in [-1, 1], typically [0, 1]
  photoUrl: string;
  photoHash: string;
  updatedAt: number;
  metadata: VisualProfileMetadataSnapshot;
}

export interface VisualEmbeddingStoreStats {
  totalCount: number;
  channelCount: number;
  userCount: number;
  approxBytes: number;
}

export interface VisualEmbeddingExportItem {
  id: string;
  modelId: string;
  entityType: VisualEntityType;
  entityKey: string;
  usernameLower: string;
  photoUrl: string;
  photoHash: string;
  vectorB64: string;
  metadata: VisualProfileMetadataSnapshot;
  updatedAt: number;
}

export interface VisualEmbeddingExportBundle {
  schema: "gingko-visual-profile-embeddings-v2";
  version: 2;
  modelId: string;
  dim: number;
  exportedAt: string;
  count: number;
  items: VisualEmbeddingExportItem[];
}

export interface VisualEmbeddingImportSummary {
  added: number;
  updated: number;
  skipped: number;
  incompatible: number;
  totalImported: number;
}

// ---------------------------------------------------------------------------
// Hashing, Entity Canonicalization & Vector Math
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

export function hashBinaryBytes(bytes: Uint8Array): string {
  let h1 = 0x811c9dc5 ^ bytes.byteLength;
  let h2 = 0x9e3779b9 ^ bytes.byteLength;
  const step = Math.max(1, Math.floor(bytes.byteLength / 2048));
  for (let i = 0; i < bytes.byteLength; i += step) {
    const b = bytes[i];
    h1 ^= b;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= (b + i) & 0xff;
    h2 = Math.imul(h2, 0x01000193);
  }
  return `${bytes.byteLength.toString(36)}_${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}`;
}

export function cleanHandle(value: unknown): string {
  if (value == null) return "";
  return String(value)
    .trim()
    .replace(/^https?:\/\/(?:t\.me|telegram\.me)\//i, "")
    .replace(/^@+/, "")
    .split(/[/?#]/)[0]
    .trim();
}

export function buildTelegramProfileCandidatesForIdentifier(identifier: string): string[] {
  const trimmed = String(identifier || "").trim();
  if (!trimmed) return [];
  const out: string[] = [];
  const pushUrl = (idStr: string) => {
    const clean = idStr.trim();
    if (!clean) return;
    const encoded = `https://i.gogingko.net/api/v1/v/telegram-profile/${encodeURIComponent(clean)}`;
    if (!out.includes(encoded)) out.push(encoded);
    // For invite hashes containing '+', also include literal '+' form as fallback
    if (clean.includes("+")) {
      const literal = `https://i.gogingko.net/api/v1/v/telegram-profile/${clean}`;
      if (!out.includes(literal)) out.push(literal);
    }
  };

  pushUrl(trimmed);

  // Match App.vue handleImageError: toggle '-100' prefix for numeric Telegram IDs
  if (/^-?\d+$/.test(trimmed)) {
    if (trimmed.startsWith("-100")) {
      pushUrl(trimmed.slice(4));
    } else if (!trimmed.startsWith("-")) {
      pushUrl(`-100${trimmed}`);
    }
  }

  return out;
}

export function resolveProfilePhotoCandidates(raw: any): string[] {
  if (!raw || typeof raw !== "object") return [];
  const urls: string[] = [];
  const addUrl = (u: string) => {
    if (u && !urls.includes(u)) urls.push(u);
  };

  // Inline raster data URI (skip SVG placeholders so real profile URLs can still be tried)
  if (
    typeof raw.photo === "string" &&
    raw.photo.startsWith("data:image/") &&
    !raw.photo.toLowerCase().startsWith("data:image/svg")
  ) {
    addUrl(raw.photo);
  }

  if (typeof raw.photoUrl === "string" && raw.photoUrl.trim()) {
    const existing = raw.photoUrl.trim();
    if (!existing.toLowerCase().startsWith("data:image/svg")) {
      addUrl(existing);
    }
  }

  if (Array.isArray(raw.photoCandidates)) {
    for (const c of raw.photoCandidates) {
      if (typeof c === "string" && c.trim() && !c.toLowerCase().startsWith("data:image/svg")) {
        addUrl(c.trim());
      }
    }
  }

  const identifiers: string[] = [];
  const addIdent = (v: unknown) => {
    if (v === undefined || v === null) return;
    const s = String(v).trim();
    if (s && !identifiers.includes(s)) identifiers.push(s);
  };

  if (raw.id !== undefined && raw.id !== null && String(raw.id).trim() !== "") {
    addIdent(raw.id);
  }
  addIdent(cleanHandle(raw.username));
  addIdent(cleanHandle(raw.key));
  addIdent(cleanHandle(raw.name));

  for (const ident of identifiers) {
    for (const u of buildTelegramProfileCandidatesForIdentifier(ident)) {
      addUrl(u);
    }
  }

  return urls;
}

export function resolveProfilePhotoUrl(raw: any): string {
  const candidates = resolveProfilePhotoCandidates(raw);
  return candidates[0] || "";
}

export function inferVisualEntityType(
  raw: any,
  fallbackType: VisualEntityType = "channel"
): VisualEntityType {
  if (!raw || typeof raw !== "object") return fallbackType;
  if (raw.entityType === "channel" || raw.entityType === "user") {
    return raw.entityType;
  }
  if (raw.isChannel === true) return "channel";
  if (raw.isChannel === false) return "user";
  const t = String(raw._type || "");
  if (t.includes("TelegramChannel") || t.includes("TelegramGroup")) {
    return "channel";
  }
  if (
    "first_name" in raw ||
    "last_name" in raw ||
    "bot" in raw ||
    "phone" in raw ||
    ("about" in raw && !("members" in raw) && !("participants_count" in raw))
  ) {
    return "user";
  }
  return fallbackType;
}

export function canonicalizeVisualEntity(
  raw: any,
  fallbackType: VisualEntityType = "channel"
): VisualProfileMetadataSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const entityType = inferVisualEntityType(raw, fallbackType);
  const username = cleanHandle(raw.username || raw.key || "");
  const name = cleanHandle(raw.name || "");
  const idVal =
    raw.id !== undefined && raw.id !== null && String(raw.id).trim() !== ""
      ? raw.id
      : undefined;

  const primaryKeyRaw = username || (idVal !== undefined ? String(idVal) : "") || name;
  const entityKey = primaryKeyRaw.trim().toLowerCase();
  if (!entityKey) return null;

  const photoCandidates = resolveProfilePhotoCandidates(raw);
  const photoUrl = photoCandidates[0] || "";
  if (!photoUrl) return null;

  const inlinePhoto =
    typeof raw.photo === "string" &&
    raw.photo.startsWith("data:image/") &&
    !raw.photo.toLowerCase().startsWith("data:image/svg") &&
    raw.photo.length <= 280_000
      ? raw.photo
      : undefined;

  const fullName = `${raw.first_name || ""} ${raw.last_name || ""}`.trim();
  const title =
    (typeof raw.title === "string" && raw.title.trim()) ||
    fullName ||
    (typeof raw.name === "string" && raw.name.trim()) ||
    username ||
    (idVal !== undefined ? String(idVal) : entityKey);

  const description =
    typeof raw.description === "string" && raw.description.trim()
      ? raw.description.trim()
      : typeof raw.about === "string" && raw.about.trim()
        ? raw.about.trim()
        : undefined;

  const toNum = (v: unknown): number | undefined => {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "") {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
    return undefined;
  };

  let cdnRegion: [string, string] | null | undefined = undefined;
  if (Array.isArray(raw.cdnRegion) && raw.cdnRegion.length >= 2) {
    cdnRegion = [String(raw.cdnRegion[0] ?? ""), String(raw.cdnRegion[1] ?? "")];
  }

  let statusVal: { status?: string } | string | undefined = undefined;
  if (typeof raw.status === "string" && raw.status.trim()) {
    statusVal = raw.status.trim();
  } else if (raw.status && typeof raw.status === "object" && typeof raw.status.status === "string") {
    statusVal = { status: raw.status.status };
  }

  return {
    entityType,
    entityKey,
    id: idVal,
    username: username || undefined,
    name: name || undefined,
    key: typeof raw.key === "string" ? raw.key : undefined,
    title,
    first_name: typeof raw.first_name === "string" ? raw.first_name : undefined,
    last_name: typeof raw.last_name === "string" ? raw.last_name : undefined,
    description,
    about: typeof raw.about === "string" ? raw.about : undefined,
    photo: inlinePhoto,
    photoUrl,
    photoCandidates,
    members: toNum(raw.members),
    participants_count: toNum(raw.participants_count),
    files: toNum(raw.files),
    photos: toNum(raw.photos),
    videos: toNum(raw.videos),
    links: toNum(raw.links),
    phone: typeof raw.phone === "string" && raw.phone.trim() ? raw.phone.trim() : undefined,
    status: statusVal,
    bot: typeof raw.bot === "boolean" ? raw.bot : undefined,
    lang: typeof raw.lang === "string" && raw.lang.trim() ? raw.lang.trim() : undefined,
    cdnNumber: raw.cdnNumber != null ? String(raw.cdnNumber) : null,
    cdnRegion: cdnRegion ?? null,
    _type: typeof raw._type === "string" ? raw._type : undefined,
  };
}

export function makeVisualProfileRecordId(
  entityType: VisualEntityType,
  entityKey: string,
  modelId: string = VISUAL_EMBED_MODEL_ID
): string {
  return `${modelId}::${entityType}::${entityKey.trim().toLowerCase()}`;
}

export function isValidVisualVector(vec: Float32Array | null | undefined): vec is Float32Array {
  if (!vec || vec.length !== VISUAL_EMBED_DIM) return false;
  let sumSq = 0;
  let minVal = Infinity;
  let maxVal = -Infinity;
  for (let i = 0; i < vec.length; i++) {
    const v = vec[i];
    if (!Number.isFinite(v)) return false;
    sumSq += v * v;
    if (v < minVal) minVal = v;
    if (v > maxVal) maxVal = v;
  }
  const norm = Math.sqrt(sumSq);
  // Must be unit-normalized and non-degenerate (not all-zeros or constant)
  if (norm < 0.95 || norm > 1.05) return false;
  if (maxVal - minVal < 1e-4) return false;
  return true;
}

export function readVisualVector(raw: unknown): Float32Array | null {
  if (!raw) return null;
  let vec: Float32Array | null = null;
  if (raw instanceof Float32Array) {
    vec = raw;
  } else if (raw instanceof ArrayBuffer) {
    if (raw.byteLength === VISUAL_EMBED_DIM * 4) {
      vec = new Float32Array(raw);
    }
  } else if (ArrayBuffer.isView(raw)) {
    if (raw.byteLength === VISUAL_EMBED_DIM * 4) {
      vec = new Float32Array(
        raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)
      );
    }
  }
  if (!vec || !isValidVisualVector(vec)) return null;
  return vec;
}

export function l2NormalizeVector(vec: Float32Array): Float32Array {
  let sumSq = 0;
  for (let i = 0; i < vec.length; i++) {
    const v = vec[i];
    if (!Number.isFinite(v)) return new Float32Array(vec.length);
    sumSq += v * v;
  }
  const norm = Math.sqrt(sumSq);
  if (norm <= 1e-12 || !Number.isFinite(norm)) return new Float32Array(vec.length);
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

// ---------------------------------------------------------------------------
// 1. Resumable SigLIP Model Weight Cache (IndexedDB 8 MiB Chunks + Cache Storage)
// ---------------------------------------------------------------------------

function openVisualChunkDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(VISUAL_CHUNK_DB_NAME, VISUAL_CHUNK_DB_VERSION);
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
    req.onerror = () => reject(req.error || new Error("Failed to open visual chunk DB"));
  });
}

export function expectedVisualChunkLength(
  chunkIndex: number,
  totalBytes: number,
  chunkSize: number = VISUAL_CHUNK_SIZE_BYTES
): number {
  const start = chunkIndex * chunkSize;
  if (start >= totalBytes) return 0;
  return Math.min(chunkSize, totalBytes - start);
}

export function computeVisualSavedBytes(
  completed: Set<number>,
  totalBytes: number,
  chunkSize: number = VISUAL_CHUNK_SIZE_BYTES
): number {
  let sum = 0;
  for (const idx of completed) {
    sum += expectedVisualChunkLength(idx, totalBytes, chunkSize);
  }
  return sum;
}

export async function readVisualModelMeta(): Promise<VisualModelDownloadMeta | null> {
  try {
    const db = await openVisualChunkDb();
    try {
      return await new Promise<VisualModelDownloadMeta | null>((resolve, reject) => {
        const tx = db.transaction(STORE_META, "readonly");
        const req = tx.objectStore(STORE_META).get(VISUAL_MODEL_META_KEY);
        req.onsuccess = () => resolve((req.result as VisualModelDownloadMeta | undefined) || null);
        req.onerror = () => reject(req.error);
      });
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

export async function writeVisualModelMeta(
  meta: Omit<VisualModelDownloadMeta, "key">
): Promise<void> {
  try {
    const db = await openVisualChunkDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_META, "readwrite");
        tx.objectStore(STORE_META).put({ ...meta, key: VISUAL_MODEL_META_KEY });
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

export async function getCompletedVisualChunkIndices(): Promise<Set<number>> {
  try {
    const db = await openVisualChunkDb();
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

export async function putVisualModelChunk(index: number, data: ArrayBuffer): Promise<void> {
  const db = await openVisualChunkDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_CHUNKS, "readwrite");
      tx.objectStore(STORE_CHUNKS).put(data, index);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("Failed to persist visual model chunk"));
    });
  } finally {
    db.close();
  }
}

export async function deleteVisualModelChunk(index: number): Promise<void> {
  try {
    const db = await openVisualChunkDb();
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

export async function assembleVisualModelFromChunks(
  meta: VisualModelDownloadMeta
): Promise<{ bytes: Uint8Array | null; invalidIndices: number[] }> {
  const invalidIndices: number[] = [];
  const combined = new Uint8Array(meta.totalBytes);

  const db = await openVisualChunkDb();
  try {
    for (let idx = 0; idx < meta.numChunks; idx++) {
      const expectedLen = expectedVisualChunkLength(idx, meta.totalBytes, meta.chunkSize);
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

export async function clearVisualPartialChunksDb(): Promise<void> {
  try {
    const db = await openVisualChunkDb();
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

export async function clearVisualModelCaches(): Promise<void> {
  if (typeof caches !== "undefined") {
    await caches.delete(VISUAL_EMBED_CACHE_NAME).catch(() => {});
  }
  await clearVisualPartialChunksDb();
}

export async function inspectVisualModelCache(): Promise<VisualModelCacheStatus> {
  if (typeof caches !== "undefined") {
    try {
      const cache = await caches.open(VISUAL_EMBED_CACHE_NAME);
      const match = await cache.match(VISUAL_EMBED_ONNX_URL);
      if (match) {
        const len = Number(match.headers.get("content-length") || "0");
        const resolvedTotal = len > VISUAL_EMBED_MIN_VALID_BYTES ? len : VISUAL_EMBED_APPROX_BYTES;
        return {
          isCached: true,
          partialBytes: resolvedTotal,
          totalBytes: resolvedTotal,
          approxBytes: VISUAL_EMBED_APPROX_BYTES,
        };
      }
    } catch {
      // ignore Cache Storage errors
    }
  }

  const meta = await readVisualModelMeta();
  if (!meta || meta.totalBytes <= 0) {
    return {
      isCached: false,
      partialBytes: 0,
      totalBytes: 0,
      approxBytes: VISUAL_EMBED_APPROX_BYTES,
    };
  }

  const completed = await getCompletedVisualChunkIndices();
  const partialBytes = computeVisualSavedBytes(completed, meta.totalBytes, meta.chunkSize);
  const allComplete = completed.size >= meta.numChunks && partialBytes >= meta.totalBytes;

  return {
    isCached: allComplete,
    partialBytes,
    totalBytes: meta.totalBytes,
    approxBytes: VISUAL_EMBED_APPROX_BYTES,
  };
}

// ---------------------------------------------------------------------------
// 2. Visual Profile Embedding & Metadata Store (IndexedDB: GingkoVisualProfileDB)
// ---------------------------------------------------------------------------

function openVisualProfileDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(VISUAL_PROFILE_DB_NAME, VISUAL_PROFILE_DB_VERSION);
    req.onupgradeneeded = (ev) => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_PROFILES)) {
        const store = db.createObjectStore(STORE_PROFILES, { keyPath: "id" });
        store.createIndex("entityType", "entityType", { unique: false });
        store.createIndex("usernameLower", "usernameLower", { unique: false });
        store.createIndex("updatedAt", "updatedAt", { unique: false });
        store.createIndex("photoHash", "photoHash", { unique: false });
      } else if (ev.oldVersion < 2 && req.transaction) {
        // Purge v1 vectors computed under older WebGPU/micro-batched quantization so they re-index cleanly
        req.transaction.objectStore(STORE_PROFILES).clear();
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("Failed to open visual profile DB"));
  });
}

export async function getExistingVisualProfileMap(
  recordIds: string[]
): Promise<Map<string, VisualProfileEmbeddingRecord>> {
  const out = new Map<string, VisualProfileEmbeddingRecord>();
  if (!Array.isArray(recordIds) || recordIds.length === 0) return out;
  try {
    const db = await openVisualProfileDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_PROFILES, "readonly");
        const store = tx.objectStore(STORE_PROFILES);
        for (const id of recordIds) {
          const req = store.get(id);
          req.onsuccess = () => {
            const row = req.result as VisualProfileEmbeddingRecord | undefined;
            if (
              row &&
              row.modelId === VISUAL_EMBED_MODEL_ID &&
              readVisualVector(row.vectorBuffer)
            ) {
              out.set(id, row);
            }
          };
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  } catch {
    // graceful fallback
  }
  return out;
}

export async function findVisualProfileRecordByHandle(
  handleOrKey: string,
  modelId: string = VISUAL_EMBED_MODEL_ID
): Promise<VisualProfileEmbeddingRecord | null> {
  const clean = cleanHandle(handleOrKey).toLowerCase();
  if (!clean) return null;

  const candidateKeys = [clean];
  if (/^-?\d+$/.test(clean)) {
    if (clean.startsWith("-100")) {
      candidateKeys.push(clean.slice(4));
    } else if (!clean.startsWith("-")) {
      candidateKeys.push(`-100${clean}`);
    }
  }

  try {
    const db = await openVisualProfileDb();
    try {
      // 1. Direct primary key lookups for both channel & user across key variants
      for (const k of candidateKeys) {
        const directIds = [
          makeVisualProfileRecordId("channel", k, modelId),
          makeVisualProfileRecordId("user", k, modelId),
        ];
        for (const id of directIds) {
          const rec = await new Promise<VisualProfileEmbeddingRecord | null>((resolve) => {
            const tx = db.transaction(STORE_PROFILES, "readonly");
            const req = tx.objectStore(STORE_PROFILES).get(id);
            req.onsuccess = () =>
              resolve((req.result as VisualProfileEmbeddingRecord | undefined) || null);
            req.onerror = () => resolve(null);
          });
          if (rec && rec.modelId === modelId && readVisualVector(rec.vectorBuffer)) {
            return rec;
          }
        }
      }

      // 2. Fallback secondary index lookup on usernameLower
      const byIdx = await new Promise<VisualProfileEmbeddingRecord | null>((resolve) => {
        const tx = db.transaction(STORE_PROFILES, "readonly");
        const idx = tx.objectStore(STORE_PROFILES).index("usernameLower");
        const req = idx.getAll(clean);
        req.onsuccess = () => {
          const rows = (req.result || []) as VisualProfileEmbeddingRecord[];
          const found = rows.find(
            (r) => r && r.modelId === modelId && Boolean(readVisualVector(r.vectorBuffer))
          );
          resolve(found || null);
        };
        req.onerror = () => resolve(null);
      });
      if (byIdx) return byIdx;

      return null;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

export async function saveVisualProfileEmbeddings(
  records: Array<{
    metadata: VisualProfileMetadataSnapshot;
    photoHash: string;
    vector: Float32Array;
  }>,
  modelId: string = VISUAL_EMBED_MODEL_ID
): Promise<void> {
  if (!Array.isArray(records) || records.length === 0) return;
  try {
    const db = await openVisualProfileDb();
    try {
      const now = Date.now();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_PROFILES, "readwrite");
        const store = tx.objectStore(STORE_PROFILES);
        for (const rec of records) {
          const normalized = l2NormalizeVector(rec.vector);
          if (!isValidVisualVector(normalized)) continue;
          const meta = rec.metadata;
          const id = makeVisualProfileRecordId(meta.entityType, meta.entityKey, modelId);
          const copyBuf = normalized.slice().buffer;
          const row: VisualProfileEmbeddingRecord = {
            id,
            modelId,
            entityType: meta.entityType,
            entityKey: meta.entityKey,
            usernameLower: (meta.username || meta.entityKey || "").trim().toLowerCase(),
            photoUrl: meta.photoUrl,
            photoHash: rec.photoHash,
            vectorBuffer: copyBuf,
            metadata: meta,
            updatedAt: now,
          };
          store.put(row);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });

      await pruneVisualProfilesIfNeeded(db);
    } finally {
      db.close();
    }
  } catch {
    // ignore quota errors gracefully
  }
}

export async function refreshVisualProfileMetadataOnly(
  records: VisualProfileEmbeddingRecord[]
): Promise<void> {
  if (!Array.isArray(records) || records.length === 0) return;
  try {
    const db = await openVisualProfileDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_PROFILES, "readwrite");
        const store = tx.objectStore(STORE_PROFILES);
        for (const rec of records) {
          store.put(rec);
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

async function pruneVisualProfilesIfNeeded(db: IDBDatabase): Promise<void> {
  try {
    const count = await new Promise<number>((resolve, reject) => {
      const tx = db.transaction(STORE_PROFILES, "readonly");
      const req = tx.objectStore(STORE_PROFILES).count();
      req.onsuccess = () => resolve(req.result || 0);
      req.onerror = () => reject(req.error);
    });
    if (count <= MAX_VISUAL_PROFILES) return;

    const cutoff = Date.now() - MAX_VISUAL_PROFILE_AGE_MS;
    const excessTarget = count - Math.floor(MAX_VISUAL_PROFILES * 0.85);
    let deleted = 0;

    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_PROFILES, "readwrite");
      const idx = tx.objectStore(STORE_PROFILES).index("updatedAt");
      const cursorReq = idx.openCursor();
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) return;
        const val = cursor.value as VisualProfileEmbeddingRecord;
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

/**
 * Loads all stored visual profile embeddings and computes exact L2 cosine similarity
 * against the query vector. Returns sorted top-K matches above threshold.
 */
export async function searchSimilarVisualProfiles(
  queryVector: Float32Array,
  options: {
    threshold: number; // 0..1
    topK: number;
    scope?: VisualSearchScope;
    excludeRecordId?: string | null;
    excludeEntityKey?: string | null;
    excludeId?: string | number | null;
    modelId?: string;
  }
): Promise<{ matches: VisualSimilarityMatch[]; scannedCount: number }> {
  const {
    threshold,
    topK,
    scope = "all",
    excludeRecordId = null,
    excludeEntityKey = null,
    excludeId = null,
    modelId = VISUAL_EMBED_MODEL_ID,
  } = options;

  const normQuery = l2NormalizeVector(queryVector);
  if (!isValidVisualVector(normQuery)) {
    return { matches: [], scannedCount: 0 };
  }

  const matches: VisualSimilarityMatch[] = [];
  let scannedCount = 0;

  // Build normalized self-exclusion set (handles numeric IDs with/without -100 prefix too)
  const excludeTokens = new Set<string>();
  const addExcludeToken = (v: unknown) => {
    if (v === undefined || v === null) return;
    const s = cleanHandle(v).toLowerCase();
    if (!s) return;
    excludeTokens.add(s);
    if (/^-?\d+$/.test(s)) {
      if (s.startsWith("-100")) excludeTokens.add(s.slice(4));
      else if (!s.startsWith("-")) excludeTokens.add(`-100${s}`);
    }
  };
  addExcludeToken(excludeEntityKey);
  addExcludeToken(excludeId);

  try {
    const db = await openVisualProfileDb();
    try {
      const rows = await new Promise<VisualProfileEmbeddingRecord[]>((resolve, reject) => {
        const tx = db.transaction(STORE_PROFILES, "readonly");
        const store = tx.objectStore(STORE_PROFILES);
        const req =
          scope === "all"
            ? store.getAll()
            : store.index("entityType").getAll(scope);
        req.onsuccess = () => resolve((req.result || []) as VisualProfileEmbeddingRecord[]);
        req.onerror = () => reject(req.error);
      });

      for (const row of rows) {
        if (!row || row.modelId !== modelId || !row.vectorBuffer) continue;
        const candidateVec = readVisualVector(row.vectorBuffer);
        if (!candidateVec) continue;

        scannedCount++;
        if (excludeRecordId && row.id === excludeRecordId) continue;

        if (excludeTokens.size > 0) {
          const rowIdStr =
            row.metadata?.id !== undefined && row.metadata?.id !== null
              ? String(row.metadata.id).trim().toLowerCase()
              : "";
          if (
            excludeTokens.has(row.entityKey) ||
            excludeTokens.has(row.usernameLower) ||
            (rowIdStr && excludeTokens.has(rowIdStr))
          ) {
            continue;
          }
        }

        const rawScore = dotProductVectors(normQuery, candidateVec);
        if (!Number.isFinite(rawScore)) continue;
        const clamped = Math.max(0, Math.min(1, rawScore));
        if (clamped >= threshold) {
          matches.push({
            recordId: row.id,
            entityType: row.entityType,
            entityKey: row.entityKey,
            score: clamped,
            photoUrl: row.photoUrl || row.metadata?.photoUrl || "",
            photoHash: row.photoHash,
            updatedAt: row.updatedAt,
            metadata: row.metadata,
          });
        }
      }
    } finally {
      db.close();
    }
  } catch {
    // return empty gracefully
  }

  matches.sort((a, b) => b.score - a.score);
  return {
    matches: matches.slice(0, Math.max(1, topK)),
    scannedCount,
  };
}

export async function getVisualEmbeddingStats(): Promise<VisualEmbeddingStoreStats> {
  try {
    const db = await openVisualProfileDb();
    try {
      const [totalCount, channelCount, userCount] = await new Promise<[number, number, number]>(
        (resolve, reject) => {
          const tx = db.transaction(STORE_PROFILES, "readonly");
          const store = tx.objectStore(STORE_PROFILES);
          const typeIdx = store.index("entityType");
          let total = 0;
          let channels = 0;
          let users = 0;

          const rTotal = store.count();
          rTotal.onsuccess = () => {
            total = rTotal.result || 0;
          };
          const rChan = typeIdx.count("channel");
          rChan.onsuccess = () => {
            channels = rChan.result || 0;
          };
          const rUser = typeIdx.count("user");
          rUser.onsuccess = () => {
            users = rUser.result || 0;
          };

          tx.oncomplete = () => resolve([total, channels, users]);
          tx.onerror = () => reject(tx.error);
        }
      );

      return {
        totalCount,
        channelCount,
        userCount,
        // 768 * 4 bytes vector + ~1 KiB metadata average
        approxBytes: totalCount * (VISUAL_EMBED_DIM * 4 + 1024),
      };
    } finally {
      db.close();
    }
  } catch {
    return { totalCount: 0, channelCount: 0, userCount: 0, approxBytes: 0 };
  }
}

export async function clearVisualEmbeddingStore(): Promise<void> {
  try {
    const db = await openVisualProfileDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_PROFILES, "readwrite");
        tx.objectStore(STORE_PROFILES).clear();
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

export async function clearAllVisualMlCaches(): Promise<void> {
  await Promise.all([clearVisualModelCaches(), clearVisualEmbeddingStore()]);
}

// ---------------------------------------------------------------------------
// 3. IndexedDB Visual Embedding Archive Export & Import (Lossless Float32 Base64)
// ---------------------------------------------------------------------------

export function encodeFloat32ToBase64(vec: Float32Array): string {
  const bytes = new Uint8Array(vec.buffer, vec.byteOffset, vec.byteLength);
  let binary = "";
  const chunkSize = 0x4000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, Math.min(bytes.length, i + chunkSize));
    binary += String.fromCharCode.apply(null, Array.from(slice));
  }
  return btoa(binary);
}

export function decodeBase64ToFloat32(b64: string): Float32Array | null {
  if (typeof b64 !== "string" || !b64.trim()) return null;
  try {
    const binary = atob(b64.trim());
    if (binary.length !== VISUAL_EMBED_DIM * 4) return null;
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Float32Array(bytes.buffer);
  } catch {
    return null;
  }
}

export async function exportVisualEmbeddingsBundle(): Promise<VisualEmbeddingExportBundle> {
  const db = await openVisualProfileDb();
  try {
    const rows = await new Promise<VisualProfileEmbeddingRecord[]>((resolve, reject) => {
      const tx = db.transaction(STORE_PROFILES, "readonly");
      const req = tx.objectStore(STORE_PROFILES).getAll();
      req.onsuccess = () => resolve((req.result || []) as VisualProfileEmbeddingRecord[]);
      req.onerror = () => reject(req.error);
    });

    const items: VisualEmbeddingExportItem[] = [];
    for (const row of rows) {
      if (!row || row.modelId !== VISUAL_EMBED_MODEL_ID || !row.vectorBuffer) continue;
      const vec = readVisualVector(row.vectorBuffer);
      if (!vec) continue;
      items.push({
        id: row.id,
        modelId: row.modelId,
        entityType: row.entityType,
        entityKey: row.entityKey,
        usernameLower: row.usernameLower || row.entityKey,
        photoUrl: row.photoUrl || row.metadata?.photoUrl || "",
        photoHash: row.photoHash || "",
        vectorB64: encodeFloat32ToBase64(vec),
        metadata: row.metadata,
        updatedAt: Number.isFinite(row.updatedAt) ? row.updatedAt : Date.now(),
      });
    }

    return {
      schema: "gingko-visual-profile-embeddings-v2",
      version: 2,
      modelId: VISUAL_EMBED_MODEL_ID,
      dim: VISUAL_EMBED_DIM,
      exportedAt: new Date().toISOString(),
      count: items.length,
      items,
    };
  } finally {
    db.close();
  }
}

export async function importVisualEmbeddingsBundle(
  raw: unknown
): Promise<VisualEmbeddingImportSummary> {
  let rawItems: unknown[] | null = null;
  let bundleModelId: string | null = null;

  if (Array.isArray(raw)) {
    rawItems = raw;
  } else if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (typeof obj.modelId === "string" && obj.modelId.trim()) {
      bundleModelId = obj.modelId.trim();
    }
    if (Array.isArray(obj.items)) {
      rawItems = obj.items;
    } else if (Array.isArray(obj.records)) {
      rawItems = obj.records;
    }
  }

  if (!rawItems) {
    throw new Error("INVALID_VISUAL_ARCHIVE_FORMAT");
  }

  let skipped = 0;
  let incompatible = 0;
  const parsedRows: VisualProfileEmbeddingRecord[] = [];
  const seenIds = new Set<string>();
  const now = Date.now();

  for (const entry of rawItems) {
    if (!entry || typeof entry !== "object") {
      skipped++;
      continue;
    }
    const item = entry as Record<string, unknown>;
    const itemModelId =
      typeof item.modelId === "string" && item.modelId.trim()
        ? item.modelId.trim()
        : bundleModelId;

    if (itemModelId && itemModelId !== VISUAL_EMBED_MODEL_ID) {
      incompatible++;
      continue;
    }

    let rawVec: Float32Array | null = null;
    if (typeof item.vectorB64 === "string") {
      rawVec = decodeBase64ToFloat32(item.vectorB64);
    } else if (Array.isArray(item.vector) && item.vector.length === VISUAL_EMBED_DIM) {
      const arr = new Float32Array(VISUAL_EMBED_DIM);
      let ok = true;
      for (let i = 0; i < VISUAL_EMBED_DIM; i++) {
        const v = Number(item.vector[i]);
        if (!Number.isFinite(v)) {
          ok = false;
          break;
        }
        arr[i] = v;
      }
      if (ok) rawVec = arr;
    }

    if (!rawVec) {
      skipped++;
      continue;
    }

    const normalized = l2NormalizeVector(rawVec);
    if (!isValidVisualVector(normalized)) {
      skipped++;
      continue;
    }

    const entityType: VisualEntityType =
      item.entityType === "user"
        ? "user"
        : item.entityType === "channel"
          ? "channel"
          : inferVisualEntityType(item.metadata, "channel");

    const rawMeta =
      item.metadata && typeof item.metadata === "object"
        ? (item.metadata as Record<string, unknown>)
        : {};
    const canonicalMeta = canonicalizeVisualEntity(
      {
        ...rawMeta,
        entityType,
        photoUrl:
          (typeof item.photoUrl === "string" && item.photoUrl) ||
          (typeof rawMeta.photoUrl === "string" && rawMeta.photoUrl) ||
          undefined,
        username:
          (typeof rawMeta.username === "string" && rawMeta.username) ||
          (typeof item.usernameLower === "string" && item.usernameLower) ||
          undefined,
        key:
          (typeof rawMeta.key === "string" && rawMeta.key) ||
          (typeof item.entityKey === "string" && item.entityKey) ||
          undefined,
      },
      entityType
    );

    const entityKey = (
      (typeof item.entityKey === "string" && item.entityKey.trim()) ||
      canonicalMeta?.entityKey ||
      ""
    )
      .trim()
      .toLowerCase();

    if (!entityKey || !canonicalMeta) {
      skipped++;
      continue;
    }

    const id = makeVisualProfileRecordId(entityType, entityKey, VISUAL_EMBED_MODEL_ID);
    if (seenIds.has(id)) continue;
    seenIds.add(id);

    const photoUrl =
      (typeof item.photoUrl === "string" && item.photoUrl.trim()) || canonicalMeta.photoUrl;

    const finalMeta: VisualProfileMetadataSnapshot = {
      ...canonicalMeta,
      entityType,
      entityKey,
      photoUrl,
    };

    const updatedAt =
      typeof item.updatedAt === "number" && Number.isFinite(item.updatedAt) && item.updatedAt > 0
        ? item.updatedAt
        : now;

    parsedRows.push({
      id,
      modelId: VISUAL_EMBED_MODEL_ID,
      entityType,
      entityKey,
      usernameLower: (finalMeta.username || entityKey).trim().toLowerCase(),
      photoUrl,
      photoHash: typeof item.photoHash === "string" ? item.photoHash : "",
      vectorBuffer: normalized.slice().buffer,
      metadata: finalMeta,
      updatedAt,
    });
  }

  let added = 0;
  let updated = 0;

  if (parsedRows.length > 0) {
    const db = await openVisualProfileDb();
    try {
      const BATCH_SIZE = 500;
      for (let i = 0; i < parsedRows.length; i += BATCH_SIZE) {
        const batch = parsedRows.slice(i, i + BATCH_SIZE);
        const existingKeys = new Set<string>();
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE_PROFILES, "readwrite");
          const store = tx.objectStore(STORE_PROFILES);
          for (const row of batch) {
            const checkReq = store.getKey(row.id);
            checkReq.onsuccess = () => {
              if (checkReq.result !== undefined) {
                existingKeys.add(row.id);
                updated++;
              } else {
                added++;
              }
              store.put(row);
            };
          }
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error || new Error("Failed importing visual embeddings"));
        });
      }
      await pruneVisualProfilesIfNeeded(db);
    } finally {
      db.close();
    }
  }

  return {
    added,
    updated,
    skipped,
    incompatible,
    totalImported: added + updated,
  };
}
