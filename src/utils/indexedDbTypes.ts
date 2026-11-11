/**
 * High-performance IndexedDB database for Types classification dataset:
 * - Database: GingkoTypesDB (version 1)
 * - Object stores:
 *   1. 'classified_channels': Full ClassifiedChannel objects keyed by normalized channel
 *   2. 'lz4_blob': Raw compressed classify.json.lz4 blob for instant offline recovery
 *   3. 'meta': Metadata tracking ETag, Last-Modified, record counts, and sync timestamps
 */

export interface ClassifiedChannel {
  channel: string;
  topic: string;
  topicConf: number;
  topicProbs: Record<string, number>;
  country: string;
  countryConf: number;
  countryProbs: Record<string, number>;
  domestic: number;
  hasReadValue: boolean;
  readValueScore: number | null;
  readValueProbs: Record<string, number>;
  readValueLegend?: Record<string, string> | null;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  model: string;
}

export const TYPES_DB_NAME = "GingkoTypesDB";
export const TYPES_DB_VERSION = 1;

export const STORE_CHANNELS = "classified_channels";
export const STORE_LZ4_BLOB = "lz4_blob";
export const STORE_META = "meta";

export interface TypesCacheMeta {
  id: string; // usually "classify_meta"
  etag: string | null;
  lastModified: string | null;
  contentLength: number | null;
  totalChannels: number;
  cachedAt: number;
  lastCheckedAt: number;
  isUsingLz4: boolean;
}

export interface CompactChannelRecord {
  channel: string;
  topic: string;
  country: string;
  topicConf: number;
  countryConf: number;
  domestic: number;
  hasReadValue: boolean;
  readValueScore: number | null;
  latencyMs: number;
}

let dbInstance: IDBDatabase | null = null;
let dbPromise: Promise<IDBDatabase> | null = null;

/**
 * Initializes and opens GingkoTypesDB with required object stores and indexes.
 */
export function initTypesDB(): Promise<IDBDatabase> {
  if (dbInstance) {
    return Promise.resolve(dbInstance);
  }
  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not supported in this environment"));
      return;
    }

    const request = indexedDB.open(TYPES_DB_NAME, TYPES_DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // 1. Channels table (keyed by normalized channel name)
      if (!db.objectStoreNames.contains(STORE_CHANNELS)) {
        const channelStore = db.createObjectStore(STORE_CHANNELS, { keyPath: "channel" });
        channelStore.createIndex("by_topic", "topic", { unique: false });
        channelStore.createIndex("by_country", "country", { unique: false });
        channelStore.createIndex("by_read_value", "readValueScore", { unique: false });
        channelStore.createIndex("by_domestic", "domestic", { unique: false });
      }

      // 2. Raw LZ4 blob store (single record keyed by "latest_blob")
      if (!db.objectStoreNames.contains(STORE_LZ4_BLOB)) {
        db.createObjectStore(STORE_LZ4_BLOB, { keyPath: "id" });
      }

      // 3. Metadata store
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: "id" });
      }
    };

    request.onsuccess = (event) => {
      dbInstance = (event.target as IDBOpenDBRequest).result;

      dbInstance.onversionchange = () => {
        dbInstance?.close();
        dbInstance = null;
        dbPromise = null;
      };

      resolve(dbInstance);
    };

    request.onerror = (event) => {
      console.warn("Failed to open GingkoTypesDB:", (event.target as IDBOpenDBRequest).error);
      dbPromise = null;
      reject((event.target as IDBOpenDBRequest).error);
    };
  });

  return dbPromise;
}

/**
 * Normalizes a channel identifier (lowercased, no @, trimmed).
 */
export function normalizeChannelKey(channel: string): string {
  if (!channel) return "";
  let clean = String(channel).trim().toLowerCase();
  clean = clean.replace(/^https?:\/\/(?:t\.me|telegram\.me)\//i, "");
  clean = clean.replace(/^@/, "");
  return clean;
}

/**
 * Saves or updates cache metadata record.
 */
export async function saveTypesCacheMeta(meta: TypesCacheMeta): Promise<void> {
  const db = await initTypesDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_META, "readwrite");
    const store = tx.objectStore(STORE_META);
    const req = store.put(meta);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/**
 * Retrieves cache metadata record if present.
 */
export async function getTypesCacheMeta(): Promise<TypesCacheMeta | null> {
  const db = await initTypesDB();
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_META, "readonly");
      const store = tx.objectStore(STORE_META);
      const req = store.get("classify_meta");
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/**
 * Saves a batch of parsed ClassifiedChannel records into IndexedDB.
 * Uses a single readwrite transaction for high throughput (thousands per sec).
 */
export async function batchSaveClassifiedChannels(channels: ClassifiedChannel[]): Promise<number> {
  if (!channels || channels.length === 0) return 0;
  const db = await initTypesDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CHANNELS, "readwrite");
    const store = tx.objectStore(STORE_CHANNELS);
    let count = 0;

    for (let i = 0; i < channels.length; i++) {
      const item = channels[i];
      if (!item || !item.channel) continue;
      // Ensure normalized channel key
      const normalizedChannel = normalizeChannelKey(item.channel);
      if (!normalizedChannel) continue;

      const record: ClassifiedChannel = {
        ...item,
        channel: normalizedChannel
      };

      store.put(record);
      count++;
    }

    tx.oncomplete = () => resolve(count);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(new Error("IndexedDB transaction aborted"));
  });
}

/**
 * Stores the compressed LZ4 blob.
 */
export async function saveLz4Blob(blob: Blob): Promise<void> {
  const db = await initTypesDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_LZ4_BLOB, "readwrite");
    const store = tx.objectStore(STORE_LZ4_BLOB);
    const req = store.put({
      id: "latest_blob",
      blob,
      size: blob.size,
      updatedAt: Date.now()
    });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/**
 * Retrieves the cached LZ4 blob if available.
 */
export async function getLz4Blob(): Promise<Blob | null> {
  const db = await initTypesDB();
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_LZ4_BLOB, "readonly");
      const store = tx.objectStore(STORE_LZ4_BLOB);
      const req = store.get("latest_blob");
      req.onsuccess = () => {
        resolve(req.result?.blob || null);
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/**
 * Retrieves the total count of cached channels in IndexedDB.
 */
export async function getCachedChannelsCount(): Promise<number> {
  const db = await initTypesDB();
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_CHANNELS, "readonly");
      const store = tx.objectStore(STORE_CHANNELS);
      const req = store.count();
      req.onsuccess = () => resolve(req.result || 0);
      req.onerror = () => resolve(0);
    } catch {
      resolve(0);
    }
  });
}

/**
 * Extracts a lightweight compact index of ALL channels from IndexedDB using a cursor.
 * Only pulls minimal fields into memory (~5MB for 100K channels), avoiding
 * the heavy nested dictionaries.
 */
export async function loadAllCompactRecords(): Promise<{
  records: CompactChannelRecord[];
  total: number;
}> {
  const db = await initTypesDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CHANNELS, "readonly");
    const store = tx.objectStore(STORE_CHANNELS);
    const records: CompactChannelRecord[] = [];

    const request = store.openCursor();

    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
      if (cursor) {
        const val = cursor.value;
        if (val && val.channel) {
          records.push({
            channel: val.channel,
            topic: val.topic || "unknown",
            country: val.country || "unknown",
            topicConf: Number(val.topicConf || 0),
            countryConf: Number(val.countryConf || 0),
            domestic: Number(val.domestic || 0),
            hasReadValue: Boolean(val.hasReadValue),
            readValueScore: val.readValueScore !== undefined ? val.readValueScore : null,
            latencyMs: Number(val.latencyMs || 0)
          });
        }
        cursor.continue();
      } else {
        resolve({ records, total: records.length });
      }
    };

    request.onerror = () => reject(request.error);
  });
}

/**
 * Retrieves full ClassifiedChannel records for an array of channel handles (e.g. current page).
 */
export async function getChannelsByHandles(
  channels: string[]
): Promise<Record<string, ClassifiedChannel>> {
  if (!channels || channels.length === 0) return {};
  const db = await initTypesDB();

  return new Promise((resolve) => {
    const tx = db.transaction(STORE_CHANNELS, "readonly");
    const store = tx.objectStore(STORE_CHANNELS);
    const result: Record<string, ClassifiedChannel> = {};
    let pending = channels.length;

    for (const rawCh of channels) {
      const ch = normalizeChannelKey(rawCh);
      const req = store.get(ch);
      req.onsuccess = () => {
        if (req.result) {
          result[ch] = req.result;
        }
        pending--;
        if (pending === 0) {
          resolve(result);
        }
      };
      req.onerror = () => {
        pending--;
        if (pending === 0) {
          resolve(result);
        }
      };
    }
  });
}

/**
 * Retrieves a single full channel record from IndexedDB (e.g. for inspection drawer).
 */
export async function getChannelByHandle(channel: string): Promise<ClassifiedChannel | null> {
  const norm = normalizeChannelKey(channel);
  if (!norm) return null;
  const db = await initTypesDB();

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_CHANNELS, "readonly");
      const store = tx.objectStore(STORE_CHANNELS);
      const req = store.get(norm);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/**
 * Clears all cached channels, blobs, and metadata.
 */
export async function clearTypesCache(): Promise<void> {
  const db = await initTypesDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_CHANNELS, STORE_LZ4_BLOB, STORE_META], "readwrite");
    tx.objectStore(STORE_CHANNELS).clear();
    tx.objectStore(STORE_LZ4_BLOB).clear();
    tx.objectStore(STORE_META).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Returns overall statistics of the Types database.
 */
export async function getTypesDbStats(): Promise<{
  channelCount: number;
  blobSize: number | null;
  lastSyncTime: number | null;
  etag: string | null;
}> {
  try {
    const [meta, count, blob] = await Promise.all([
      getTypesCacheMeta(),
      getCachedChannelsCount(),
      getLz4Blob()
    ]);

    return {
      channelCount: count,
      blobSize: blob ? blob.size : null,
      lastSyncTime: meta?.cachedAt || null,
      etag: meta?.etag || null
    };
  } catch {
    return {
      channelCount: 0,
      blobSize: null,
      lastSyncTime: null,
      etag: null
    };
  }
}
