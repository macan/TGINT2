/**
 * Background Execution Client & In-Memory Cache for Listen Tab Hots Mode.
 * Coordinates Web Worker execution, structured cloning sanitization,
 * stale-while-revalidate caching, and resilient fallback to ensure
 * the main UI thread never drops frames and never crashes on non-serializable objects.
 */

import {
  HotsAnalysisResult,
  HotsDateRange,
  HotsEngineProgress,
  HotPostItem,
  HotChannelItem,
  processListenHotsData
} from './hotsEngine';

export interface ComputeHotsBackgroundOptions {
  cachedChannels: { nodeId: string; posts: any[] }[];
  dateRange: HotsDateRange;
  geminiApiKey?: string;
  useAiMode?: boolean;
  listenItems?: any[];
  channelMetadataCache?: Record<string, any>;
  onProgress?: (p: HotsEngineProgress) => void;
  onPartialResult?: (partial: {
    hotPosts: HotPostItem[];
    hotChannels: HotChannelItem[];
    totalPostsAnalyzed: number;
    filteredPostsCount: number;
    meaninglessPostsCount?: number;
    substantivePostsCount?: number;
    totalChannelsScanned: number;
    activeChannelsCount: number;
  }) => void;
}

// ---------------------------------------------------------------------------
// In-Memory Stale-While-Revalidate Cache
// ---------------------------------------------------------------------------

const hotsMemoryCache = new Map<string, HotsAnalysisResult>();

export function getHotsCacheKey(dateRange: HotsDateRange, useAiMode: boolean): string {
  return `${dateRange}_${useAiMode ? 'ai' : 'rule'}`;
}

export function getCachedHotsAnalysis(
  dateRange: HotsDateRange,
  useAiMode: boolean
): HotsAnalysisResult | undefined {
  return hotsMemoryCache.get(getHotsCacheKey(dateRange, useAiMode));
}

export function setCachedHotsAnalysis(
  result: HotsAnalysisResult,
  useAiMode: boolean
): void {
  hotsMemoryCache.set(getHotsCacheKey(result.dateRange, useAiMode), result);
}

export function clearHotsAnalysisCache(): void {
  hotsMemoryCache.clear();
}

// ---------------------------------------------------------------------------
// Structured Cloning Sanitizers
// (Strips Vue 3 Reactive Proxies, Functions, and Circular Graph References)
// ---------------------------------------------------------------------------

function sanitizeListenItems(
  items: any[] | undefined
): Array<{ id: string; name: string; argument?: string; enableHotTopics?: boolean }> {
  if (!Array.isArray(items)) return [];
  return items.map(it => ({
    id: String(it?.id || ''),
    name: String(it?.name || it?.title || it?.argument || ''),
    argument: it?.argument ? String(it.argument) : undefined,
    enableHotTopics: it?.enableHotTopics !== false
  }));
}

function sanitizeChannelMetadataCache(
  cache: Record<string, any> | undefined
): Record<string, any> {
  if (!cache || typeof cache !== 'object') return {};
  const clean: Record<string, any> = {};
  for (const [k, v] of Object.entries(cache)) {
    if (!v || typeof v !== 'object') continue;
    clean[k] = {
      title: v.title ? String(v.title) : undefined,
      name: v.name ? String(v.name) : undefined,
      photo: typeof v.photo === 'string' ? v.photo : undefined,
      subscribers:
        typeof v.subscribers === 'number'
          ? v.subscribers
          : typeof v.members === 'number'
            ? v.members
            : undefined,
      online:
        typeof v.online === 'number'
          ? v.online
          : typeof v.online_count === 'number'
            ? v.online_count
            : undefined,
      description:
        v.description || v.about ? String(v.description || v.about) : undefined,
      date: v.date || v.createdAt,
      _type: v._type ? String(v._type) : undefined
    };
  }
  return clean;
}

function sanitizeCachedChannels(
  channels: Array<{ nodeId: string; posts: any[] }>
): Array<{ nodeId: string; posts: any[] }> {
  if (!Array.isArray(channels)) return [];
  try {
    // Attempt fast standard JSON strip (unwraps all reactive proxies and strips functions)
    return JSON.parse(JSON.stringify(channels));
  } catch {
    // Fallback if circular references exist in channel objects
    return channels.map(ch => ({
      nodeId: String(ch?.nodeId || ''),
      posts: Array.isArray(ch?.posts)
        ? ch.posts.map(p => {
            try {
              return JSON.parse(JSON.stringify(p));
            } catch {
              return {
                id: p?.id,
                key: p?.key,
                date: p?.date,
                views: p?.views,
                forwards: p?.forwards,
                reply: p?.reply,
                message: typeof p?.message === 'string' ? p.message : undefined,
                data: p?.data
                  ? {
                      date: p.data.date,
                      views: p.data.views,
                      forwards: p.data.forwards,
                      reply: p.data.reply,
                      message:
                        typeof p.data.message === 'string'
                          ? p.data.message
                          : undefined,
                      text:
                        typeof p.data.text === 'string'
                          ? p.data.text
                          : undefined,
                      url: p.data.url,
                      user: p.data.user,
                      author: p.data.author,
                      photos: Array.isArray(p.data.photos)
                        ? p.data.photos
                        : undefined,
                      videos: Array.isArray(p.data.videos)
                        ? p.data.videos
                        : undefined,
                      linkPreview: p.data.linkPreview
                    }
                  : undefined,
                photos: Array.isArray(p?.photos) ? p.photos : undefined,
                videos: Array.isArray(p?.videos) ? p.videos : undefined,
                linkPreview: p?.linkPreview
              };
            }
          })
        : []
    }));
  }
}

// ---------------------------------------------------------------------------
// Worker Singleton & Lifecycle Management
// ---------------------------------------------------------------------------

let activeWorker: Worker | null = null;
let currentRequestId = 0;

function createWorker(): Worker | null {
  try {
    if (typeof Worker === 'undefined') {
      return null;
    }
    return new Worker(
      new URL('../workers/hots.worker.ts', import.meta.url),
      { type: 'module' }
    );
  } catch (err) {
    console.warn('Web Worker creation failed, using main-thread fallback:', err);
    return null;
  }
}

/**
 * Computes hot intelligence and semantic topic clusters in a background Web Worker.
 * If previous computation is still in progress, safely cancels it to eliminate redundant CPU work.
 * Cleans all input data into pristine cloneable JSON, and falls back seamlessly to deferred
 * main thread processing if Workers or postMessage clone fails.
 */
export async function computeListenHotsInBackground(
  options: ComputeHotsBackgroundOptions
): Promise<HotsAnalysisResult> {
  const {
    cachedChannels,
    dateRange,
    geminiApiKey,
    useAiMode = false,
    listenItems,
    channelMetadataCache,
    onProgress,
    onPartialResult
  } = options;

  currentRequestId++;
  const requestId = currentRequestId;

  // Sanitize payloads to ensure 100% cloneable data without Vue Proxies or circular refs
  const cleanChannels = sanitizeCachedChannels(cachedChannels);
  const cleanListenItems = sanitizeListenItems(listenItems);
  const cleanMetadataCache = sanitizeChannelMetadataCache(channelMetadataCache);

  // Helper for running deferred fallback on main thread
  const runMainThreadFallback = (
    resolve: (res: HotsAnalysisResult) => void,
    reject: (err: any) => void
  ) => {
    setTimeout(async () => {
      try {
        const result = await processListenHotsData({
          cachedChannels: cleanChannels,
          dateRange,
          geminiApiKey,
          useAiMode,
          listenItems: cleanListenItems,
          channelMetadataCache: cleanMetadataCache,
          onProgress,
          onPartialResult
        });
        setCachedHotsAnalysis(result, !!useAiMode);
        resolve(result);
      } catch (err) {
        reject(err);
      }
    }, 0);
  };

  // Terminate previous worker if running to immediately abort stale calculations
  if (activeWorker) {
    try {
      activeWorker.terminate();
    } catch {}
    activeWorker = null;
  }

  const worker = createWorker();

  if (worker) {
    activeWorker = worker;

    return new Promise<HotsAnalysisResult>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent) => {
        const msg = e.data;
        if (!msg || msg.id !== requestId) return;

        if (msg.type === 'progress') {
          onProgress?.(msg.data);
        } else if (msg.type === 'partial_result') {
          onPartialResult?.(msg.data);
        } else if (msg.type === 'success') {
          setCachedHotsAnalysis(msg.data, !!useAiMode);
          if (activeWorker === worker) {
            activeWorker.terminate();
            activeWorker = null;
          }
          resolve(msg.data);
        } else if (msg.type === 'error') {
          if (activeWorker === worker) {
            activeWorker.terminate();
            activeWorker = null;
          }
          console.warn('Worker reported error, executing fallback:', msg.error);
          runMainThreadFallback(resolve, reject);
        }
      };

      worker.onerror = (err: ErrorEvent) => {
        console.warn('Hots Web Worker encountered an error, falling back to main thread:', err);
        if (activeWorker === worker) {
          activeWorker.terminate();
          activeWorker = null;
        }
        runMainThreadFallback(resolve, reject);
      };

      try {
        // Post sanitized cloneable payload to background thread
        worker.postMessage({
          id: requestId,
          action: 'compute',
          payload: {
            cachedChannels: cleanChannels,
            dateRange,
            geminiApiKey,
            useAiMode,
            listenItems: cleanListenItems,
            channelMetadataCache: cleanMetadataCache
          }
        });
      } catch (postErr) {
        console.warn('worker.postMessage failed with DataCloneError, executing main-thread fallback:', postErr);
        if (activeWorker === worker) {
          activeWorker.terminate();
          activeWorker = null;
        }
        runMainThreadFallback(resolve, reject);
      }
    });
  }

  // Fallback: If Worker constructor is unavailable, run with deferred non-blocking microtasks
  return new Promise<HotsAnalysisResult>((resolve, reject) => {
    runMainThreadFallback(resolve, reject);
  });
}
