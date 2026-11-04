/**
 * IndexedDB utilities for bulk post access and listener synchronizations.
 */

export const initListenPostsIndexedDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB not supported in this environment'));
      return;
    }
    const request = indexedDB.open("GingkoListenPostsDB", 1);
    request.onupgradeneeded = (event: any) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains("posts")) {
        db.createObjectStore("posts");
      }
    };
    request.onsuccess = (event: any) => {
      resolve(event.target.result);
    };
    request.onerror = () => {
      reject(request.error || new Error("Failed to open GingkoListenPostsDB"));
    };
  });
};

export interface CachedChannelPosts {
  nodeId: string;
  posts: any[];
}

/**
 * Bulk-reads all cached channels and their post collections from GingkoListenPostsDB
 */
export const getAllCachedPostsIndexedDB = async (): Promise<CachedChannelPosts[]> => {
  try {
    const db = await initListenPostsIndexedDB();
    return new Promise((resolve) => {
      const transaction = db.transaction("posts", "readonly");
      const store = transaction.objectStore("posts");
      const results: CachedChannelPosts[] = [];

      // Modern bulk retrieval
      if (typeof store.getAllKeys === 'function' && typeof store.getAll === 'function') {
        const keysReq = store.getAllKeys();
        keysReq.onsuccess = () => {
          const keys = (keysReq.result || []) as (string | number)[];
          if (keys.length === 0) {
            resolve([]);
            return;
          }
          const valsReq = store.getAll();
          valsReq.onsuccess = () => {
            const vals = valsReq.result || [];
            for (let i = 0; i < keys.length; i++) {
              const postsArray = Array.isArray(vals[i]) ? vals[i] : [];
              results.push({
                nodeId: String(keys[i]),
                posts: postsArray
              });
            }
            resolve(results);
          };
          valsReq.onerror = () => resolve([]);
        };
        keysReq.onerror = () => resolve([]);
      } else {
        // Fallback using cursor iteration
        const cursorReq = store.openCursor();
        cursorReq.onsuccess = (event: any) => {
          const cursor = event.target.result;
          if (cursor) {
            results.push({
              nodeId: String(cursor.key),
              posts: Array.isArray(cursor.value) ? cursor.value : []
            });
            cursor.continue();
          } else {
            resolve(results);
          }
        };
        cursorReq.onerror = () => resolve([]);
      }
    });
  } catch (err) {
    console.error("Failed to getAllCachedPostsIndexedDB:", err);
    return [];
  }
};
