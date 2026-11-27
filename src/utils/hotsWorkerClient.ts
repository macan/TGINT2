/**
 * Background Execution Client, Progressive Two-Stage Orchestrator, and Cache Manager
 * for Listen Tab Hots Mode.
 *
 * Stage 1 (<50ms): Fast multilingual Intl.Segmenter + TF-IDF/SimHash clustering in `hots.worker.ts`.
 * Stage 2 (Async): Multilingual ONNX sentence embeddings (`Xenova/paraphrase-multilingual-MiniLM-L12-v2`)
 *                  in `hotsEmbed.worker.ts` + IndexedDB vector cache -> refined clusters in `hots.worker.ts`.
 */

import {
  attachChineseTranslationsForForeignTitles,
  clusterPostsWithEmbeddings,
  getLocalCalendarDayKey,
  isRelativeCalendarDateRange,
  type HotChannelItem,
  type HotPostItem,
  type HotTopicCluster,
  type HotsAnalysisResult,
  type HotsClusterMode,
  type HotsDateRange,
  type HotsEngineProgress,
  processListenHotsData,
} from './hotsEngine';
import {
  buildPostEmbeddingInput,
  clearAllHotsMlCaches,
  getHotsVectorCacheStats,
  inspectHotsEmbedModelCache,
  type HotsEmbedModelCacheStatus,
} from './hotsVectorStore';
import {
  classifyPostsWithSystemOneBatch,
  computeSpamContentHash,
  evaluateBatchHeuristicSpam,
  fuseLocalSpamScores,
  getCachedSpamEvaluations,
  getSpamThreshold,
  isPostAmbiguousForLocalSpam,
  saveCachedSpamEvaluations,
  type FilteredSpamPostItem,
  type HotsSpamFilterMode,
  type HotsSpamSensitivity,
  type SemanticSpamScore,
  type SpamEvaluationResult,
} from './hotsSpamFilter';
import type {
  HotsEmbedExecutorPreference,
  HotsEmbedPostInput,
  HotsEmbedWorkerInMessage,
  HotsEmbedWorkerOutMessage,
} from '../workers/hotsEmbed.worker';

export type {
  HotsClusterMode,
  HotsEmbedExecutorPreference,
  HotsSpamFilterMode,
  HotsSpamSensitivity,
  FilteredSpamPostItem,
};

export interface HotsNeuralCacheStatus extends HotsEmbedModelCacheStatus {
  count: number;
  vectorBytes: number;
  provider: 'webgpu' | 'wasm' | null;
}

export interface ComputeHotsBackgroundOptions {
  cachedChannels: { nodeId: string; posts: any[] }[];
  dateRange: HotsDateRange;
  geminiApiKey?: string;
  useAiMode?: boolean;
  clusterMode?: HotsClusterMode;
  allowModelDownload?: boolean;
  executorPreference?: HotsEmbedExecutorPreference;
  spamFilterMode?: HotsSpamFilterMode;
  spamSensitivity?: HotsSpamSensitivity;
  listenItems?: any[];
  channelMetadataCache?: Record<string, any>;
  onProgress?: (p: HotsEngineProgress) => void;
  onPartialResult?: (partial: {
    hotPosts: HotPostItem[];
    hotChannels: HotChannelItem[];
    hotTopics?: HotTopicCluster[];
    clusterModeUsed?: HotsClusterMode;
    filteredSpamPosts?: FilteredSpamPostItem[];
    totalPostsAnalyzed: number;
    filteredPostsCount: number;
    meaninglessPostsCount?: number;
    spamPostsCount?: number;
    substantivePostsCount?: number;
    totalChannelsScanned: number;
    activeChannelsCount: number;
  }) => void;
  onNeedsModelDownload?: (info: { approxBytes: number; partialBytes: number; totalBytes: number }) => void;
}

// ---------------------------------------------------------------------------
// In-Memory Stale-While-Revalidate Cache
// ---------------------------------------------------------------------------

const hotsMemoryCache = new Map<string, HotsAnalysisResult>();

export function getHotsCacheKey(
  dateRange: HotsDateRange,
  modeOrAi: boolean | HotsClusterMode,
  dayKey: string = getLocalCalendarDayKey(),
  spamFilterMode: HotsSpamFilterMode = 'local',
  spamSensitivity: HotsSpamSensitivity = 'balanced'
): string {
  const mode: HotsClusterMode =
    typeof modeOrAi === 'boolean' ? (modeOrAi ? 'ai' : 'rule') : modeOrAi;
  const spamSuffix = `${spamFilterMode}_${spamSensitivity}`;
  return isRelativeCalendarDateRange(dateRange)
    ? `${dateRange}_${mode}_${spamSuffix}_${dayKey}`
    : `${dateRange}_${mode}_${spamSuffix}`;
}

export function pruneStaleDayHotsCache(currentDayKey: string = getLocalCalendarDayKey()): number {
  let removed = 0;
  for (const [key, entry] of hotsMemoryCache.entries()) {
    if (!isRelativeCalendarDateRange(entry.dateRange)) continue;
    const entryDayKey = entry.computedAt ? getLocalCalendarDayKey(new Date(entry.computedAt)) : '';
    if (entryDayKey !== currentDayKey || !key.endsWith(`_${currentDayKey}`)) {
      hotsMemoryCache.delete(key);
      removed++;
    }
  }
  return removed;
}

export function getCachedHotsAnalysis(
  dateRange: HotsDateRange,
  modeOrAi: boolean | HotsClusterMode,
  spamFilterMode: HotsSpamFilterMode = 'local',
  spamSensitivity: HotsSpamSensitivity = 'balanced'
): HotsAnalysisResult | undefined {
  const todayKey = getLocalCalendarDayKey();
  pruneStaleDayHotsCache(todayKey);
  const key = getHotsCacheKey(dateRange, modeOrAi, todayKey, spamFilterMode, spamSensitivity);
  const cached = hotsMemoryCache.get(key);
  if (!cached) return undefined;
  if (
    isRelativeCalendarDateRange(dateRange) &&
    cached.computedAt &&
    getLocalCalendarDayKey(new Date(cached.computedAt)) !== todayKey
  ) {
    hotsMemoryCache.delete(key);
    return undefined;
  }
  return cached;
}

export function setCachedHotsAnalysis(
  result: HotsAnalysisResult,
  modeOrAi: boolean | HotsClusterMode,
  spamFilterMode: HotsSpamFilterMode = 'local',
  spamSensitivity: HotsSpamSensitivity = 'balanced'
): void {
  const dayKey = result.computedAt
    ? getLocalCalendarDayKey(new Date(result.computedAt))
    : getLocalCalendarDayKey();
  pruneStaleDayHotsCache(getLocalCalendarDayKey());
  hotsMemoryCache.set(
    getHotsCacheKey(result.dateRange, modeOrAi, dayKey, spamFilterMode, spamSensitivity),
    result
  );
}

export function clearHotsAnalysisCache(): void {
  hotsMemoryCache.clear();
}

// ---------------------------------------------------------------------------
// Structured Cloning Sanitizers
// ---------------------------------------------------------------------------

function sanitizeListenItems(
  items: any[] | undefined
): Array<{
  id: string;
  name: string;
  argument?: string;
  enableHotTopics?: boolean;
  auto_class?: { class?: string; confidence?: number };
}> {
  if (!Array.isArray(items)) return [];
  return items.map((it) => ({
    id: String(it?.id || ''),
    name: String(it?.name || it?.title || it?.argument || ''),
    argument: it?.argument ? String(it.argument) : undefined,
    enableHotTopics: it?.enableHotTopics !== false,
    auto_class: it?.auto_class?.class
      ? {
          class: String(it.auto_class.class),
          confidence:
            typeof it.auto_class.confidence === 'number' ? it.auto_class.confidence : undefined,
        }
      : undefined,
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
      _type: v._type ? String(v._type) : undefined,
    };
  }
  return clean;
}

function sanitizeCachedChannels(
  channels: Array<{ nodeId: string; posts: any[] }>
): Array<{ nodeId: string; posts: any[] }> {
  if (!Array.isArray(channels)) return [];
  try {
    return JSON.parse(JSON.stringify(channels));
  } catch {
    return channels.map((ch) => ({
      nodeId: String(ch?.nodeId || ''),
      posts: Array.isArray(ch?.posts)
        ? ch.posts.map((p) => {
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
                      message: typeof p.data.message === 'string' ? p.data.message : undefined,
                      text: typeof p.data.text === 'string' ? p.data.text : undefined,
                      url: p.data.url,
                      user: p.data.user,
                      author: p.data.author,
                      photos: Array.isArray(p.data.photos) ? p.data.photos : undefined,
                      videos: Array.isArray(p.data.videos) ? p.data.videos : undefined,
                      linkPreview: p.data.linkPreview,
                    }
                  : undefined,
                photos: Array.isArray(p?.photos) ? p.photos : undefined,
                videos: Array.isArray(p?.videos) ? p.videos : undefined,
                linkPreview: p?.linkPreview,
              };
            }
          })
        : [],
    }));
  }
}

// ---------------------------------------------------------------------------
// Persistent Embedding Worker Singleton (keeps MiniLM ONNX session warm!)
// ---------------------------------------------------------------------------

let embedWorkerInstance: Worker | null = null;
let embedRpcCounter = 0;
let lastKnownEmbedProvider: 'webgpu' | 'wasm' | null = null;

function getOrCreateEmbedWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  if (embedWorkerInstance) return embedWorkerInstance;
  try {
    const w = new Worker(new URL('../workers/hotsEmbed.worker.ts', import.meta.url), {
      type: 'module',
    });
    w.addEventListener('error', () => {
      if (embedWorkerInstance === w) {
        embedWorkerInstance.terminate();
        embedWorkerInstance = null;
      }
    });
    embedWorkerInstance = w;
    return w;
  } catch (err) {
    console.warn('Embedding Web Worker creation failed:', err);
    return null;
  }
}

let activeSpamAbortController: AbortController | null = null;

export function abortHotsEmbedWorker(): void {
  if (activeSpamAbortController) {
    try {
      activeSpamAbortController.abort();
    } catch {
      // ignore
    }
    activeSpamAbortController = null;
  }
  if (!embedWorkerInstance) return;
  try {
    embedWorkerInstance.postMessage({ id: 0, type: 'abort' } satisfies HotsEmbedWorkerInMessage);
  } catch {
    // ignore
  }
}

export async function getHotsEmbedCacheStatus(): Promise<HotsNeuralCacheStatus> {
  const [model, vecs] = await Promise.all([
    inspectHotsEmbedModelCache(),
    getHotsVectorCacheStats(),
  ]);
  return {
    ...model,
    count: vecs.count,
    vectorBytes: vecs.approxBytes,
    provider: lastKnownEmbedProvider,
  };
}

export async function clearHotsEmbedAndVectorCache(): Promise<void> {
  clearHotsAnalysisCache();
  if (embedWorkerInstance) {
    const w = embedWorkerInstance;
    const id = ++embedRpcCounter;
    await new Promise<void>((resolve) => {
      const handler = (ev: MessageEvent<HotsEmbedWorkerOutMessage>) => {
        if (ev.data?.type === 'clear-done' && ev.data.id === id) {
          w.removeEventListener('message', handler);
          resolve();
        }
      };
      w.addEventListener('message', handler);
      w.postMessage({ id, type: 'clear-cache' } satisfies HotsEmbedWorkerInMessage);
      setTimeout(() => {
        w.removeEventListener('message', handler);
        resolve();
      }, 2500);
    });
  }
  await clearAllHotsMlCaches();
}

export async function warmupHotsEmbedModel(
  executor: HotsEmbedExecutorPreference = 'auto',
  onProgress?: (p: HotsEngineProgress) => void
): Promise<{ provider: 'webgpu' | 'wasm'; cached: boolean }> {
  const w = getOrCreateEmbedWorker();
  if (!w) {
    throw new Error('Web Worker is unavailable in this browser environment');
  }
  const id = ++embedRpcCounter;

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      w.removeEventListener('message', onMsg);
      w.removeEventListener('error', onErr);
    };

    const onErr = (ev: ErrorEvent) => {
      cleanup();
      reject(new Error(ev.message || 'Embedding worker crashed'));
    };

    const onMsg = (ev: MessageEvent<HotsEmbedWorkerOutMessage>) => {
      const m = ev.data;
      if (!m) return;
      if (m.type === 'progress') {
        if (m.provider) lastKnownEmbedProvider = m.provider;
        const stageMsg =
          m.stage === 'downloading'
            ? `Downloading multilingual embedding model (${m.percent}%)...`
            : m.stage === 'retrying'
              ? `Retrying model download (${m.retryAttempt || 1}/${m.maxRetries || 5})...`
              : m.stage === 'loading_cache'
                ? 'Loading cached embedding model...'
                : m.stage === 'initializing'
                  ? 'Initializing ONNX embedding runtime...'
                  : 'Checking model cache...';
        onProgress?.({
          step: 'embedding_download',
          stage: 'stage2',
          percent: m.percent,
          message: stageMsg,
          loadedBytes: m.loadedBytes,
          totalBytes: m.totalBytes,
          provider: m.provider,
        });
        return;
      }

      if (m.id !== id) return;
      if (m.type === 'warmup-done') {
        lastKnownEmbedProvider = m.provider;
        cleanup();
        resolve({ provider: m.provider, cached: m.cached });
      } else if (m.type === 'error') {
        cleanup();
        reject(new Error(m.aborted ? 'Model download aborted' : m.message));
      }
    };

    w.addEventListener('message', onMsg);
    w.addEventListener('error', onErr);
    w.postMessage({ id, type: 'warmup', executor } satisfies HotsEmbedWorkerInMessage);
  });
}

async function computePostEmbeddingsInWorker(
  posts: HotPostItem[],
  executor: HotsEmbedExecutorPreference,
  requestId: number,
  includeSpamScores: boolean,
  onProgress?: (p: HotsEngineProgress) => void,
  onPartialVectors?: (snap: {
    vectors: Array<{ postKey: string; vector: Float32Array }>;
    embedDone: number;
    embedTotal: number;
    cachedHits: number;
    provider: 'webgpu' | 'wasm';
  }) => void
): Promise<{
  vectors: Array<{ postKey: string; vector: Float32Array }>;
  semanticSpamScores?: SemanticSpamScore[];
  provider: 'webgpu' | 'wasm';
  cachedHits: number;
  newlyEmbedded: number;
}> {
  const w = getOrCreateEmbedWorker();
  if (!w) {
    throw new Error('Embedding Web Worker unavailable');
  }

  const items: HotsEmbedPostInput[] = posts.map((p) => {
    const prep = buildPostEmbeddingInput(p);
    return {
      postKey: p.key,
      text: prep.text,
      contentHash: prep.contentHash,
      langHint: prep.langHint,
    };
  });

  const rpcId = ++embedRpcCounter;

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      w.removeEventListener('message', onMsg);
      w.removeEventListener('error', onErr);
    };

    const onErr = (ev: ErrorEvent) => {
      cleanup();
      reject(new Error(ev.message || 'Embedding worker failed'));
    };

    const onMsg = (ev: MessageEvent<HotsEmbedWorkerOutMessage>) => {
      if (requestId !== currentRequestId) {
        cleanup();
        reject(new DOMException('Superseded by newer request', 'AbortError'));
        return;
      }

      const m = ev.data;
      if (!m) return;

      if (m.type === 'progress') {
        if (m.provider) lastKnownEmbedProvider = m.provider;
        if (m.stage === 'embedding') {
          const pct = 48 + Math.round((m.percent / 100) * 28);
          onProgress?.({
            step: 'embedding',
            stage: 'stage2',
            percent: pct,
            message: `Embedding posts (${m.embedDone ?? 0}/${m.embedTotal ?? posts.length}, ${m.cachedHits ?? 0} cached)...`,
            embedDone: m.embedDone,
            embedTotal: m.embedTotal,
            cachedHits: m.cachedHits,
            provider: m.provider,
          });
        } else {
          const dlMsg =
            m.stage === 'downloading'
              ? `Downloading semantic model (${m.percent}%)...`
              : m.stage === 'retrying'
                ? `Retrying model download (${m.retryAttempt || 1}/${m.maxRetries || 5})...`
                : m.stage === 'loading_cache'
                  ? 'Loading semantic model from cache...'
                  : 'Initializing ONNX embedding engine...';
          onProgress?.({
            step: 'embedding_download',
            stage: 'stage2',
            percent: m.stage === 'downloading' ? m.percent : 44,
            message: dlMsg,
            loadedBytes: m.loadedBytes,
            totalBytes: m.totalBytes,
            provider: m.provider,
          });
        }
        return;
      }

      if (m.id !== rpcId) return;

      if (m.type === 'partial-vectors') {
        lastKnownEmbedProvider = m.provider;
        onPartialVectors?.({
          vectors: m.vectors,
          embedDone: m.embedDone,
          embedTotal: m.embedTotal,
          cachedHits: m.cachedHits,
          provider: m.provider,
        });
      } else if (m.type === 'embed-done') {
        lastKnownEmbedProvider = m.provider;
        cleanup();
        resolve({
          vectors: m.vectors,
          semanticSpamScores: m.semanticSpamScores,
          provider: m.provider,
          cachedHits: m.cachedHits,
          newlyEmbedded: m.newlyEmbedded,
        });
      } else if (m.type === 'error') {
        cleanup();
        if (m.aborted) {
          reject(new DOMException('Embedding aborted', 'AbortError'));
        } else {
          reject(new Error(m.message));
        }
      }
    };

    w.addEventListener('message', onMsg);
    w.addEventListener('error', onErr);
    w.postMessage({
      id: rpcId,
      type: 'embed-batch',
      items,
      executor,
      includeSpamScores,
    } satisfies HotsEmbedWorkerInMessage);
  });
}

async function scorePostsSpamInEmbedWorker(
  posts: HotPostItem[],
  executor: HotsEmbedExecutorPreference,
  requestId: number
): Promise<SemanticSpamScore[]> {
  if (!posts.length) return [];
  const w = getOrCreateEmbedWorker();
  if (!w) return [];

  const items: HotsEmbedPostInput[] = posts.map((p) => {
    const prep = buildPostEmbeddingInput(p);
    return {
      postKey: p.key,
      text: prep.text,
      contentHash: prep.contentHash,
      langHint: prep.langHint,
    };
  });

  const rpcId = ++embedRpcCounter;

  return new Promise((resolve) => {
    const cleanup = () => {
      w.removeEventListener('message', onMsg);
      w.removeEventListener('error', onErr);
    };

    const onErr = () => {
      cleanup();
      resolve([]);
    };

    const onMsg = (ev: MessageEvent<HotsEmbedWorkerOutMessage>) => {
      if (requestId !== currentRequestId) {
        cleanup();
        resolve([]);
        return;
      }
      const m = ev.data;
      if (!m || !('id' in m) || m.id !== rpcId) return;
      if (m.type === 'spam-scores-done') {
        lastKnownEmbedProvider = m.provider;
        cleanup();
        resolve(m.scores || []);
      } else if (m.type === 'error') {
        cleanup();
        resolve([]);
      }
    };

    w.addEventListener('message', onMsg);
    w.addEventListener('error', onErr);
    w.postMessage({
      id: rpcId,
      type: 'score-spam',
      items,
      executor,
    } satisfies HotsEmbedWorkerInMessage);
  });
}

/**
 * Applies Stage-2 Local Neural semantic fusion and/or Kev SystemOne API verification
 * over surviving substantive posts before final clustering.
 */
async function applyStage2SpamRefinement(options: {
  posts: HotPostItem[];
  stage1Filtered: FilteredSpamPostItem[];
  spamFilterMode: HotsSpamFilterMode;
  spamSensitivity: HotsSpamSensitivity;
  semanticScores?: SemanticSpamScore[];
  listenItems?: any[];
  signal: AbortSignal;
  onProgress?: (p: HotsEngineProgress) => void;
}): Promise<{
  cleanPosts: HotPostItem[];
  allFilteredSpam: FilteredSpamPostItem[];
  newlyFilteredCount: number;
}> {
  const {
    posts,
    stage1Filtered,
    spamFilterMode,
    spamSensitivity,
    semanticScores,
    listenItems,
    signal,
    onProgress,
  } = options;

  if (spamFilterMode === 'off' || posts.length === 0) {
    return {
      cleanPosts: posts,
      allFilteredSpam: stage1Filtered,
      newlyFilteredCount: 0,
    };
  }

  const threshold = getSpamThreshold(spamSensitivity);
  const spamChannelKeys = new Set<string>();
  if (Array.isArray(listenItems)) {
    for (const it of listenItems) {
      if (String(it?.auto_class?.class || '').toLowerCase() === 'spam') {
        const k1 = String(it?.argument || '').toLowerCase().replace(/^@/, '');
        const k2 = String(it?.name || '').toLowerCase().replace(/^@/, '');
        if (k1) spamChannelKeys.add(k1);
        if (k2) spamChannelKeys.add(k2);
      }
    }
  }

  const heuristicMap = evaluateBatchHeuristicSpam(posts, spamChannelKeys);
  const semanticMap = new Map<string, SemanticSpamScore>();
  if (Array.isArray(semanticScores)) {
    for (const s of semanticScores) {
      semanticMap.set(s.postKey, s);
    }
  }

  const cachedMap = await getCachedSpamEvaluations(
    posts.map((p) => ({
      postKey: p.key,
      contentHash: computeSpamContentHash(p),
    }))
  );

  const evalMap = new Map<string, SpamEvaluationResult>();
  const toPersistLocal: SpamEvaluationResult[] = [];
  const systemOneCandidates: Array<{ post: HotPostItem; priority: number }> = [];
  const nowTs = Date.now();

  for (const post of posts) {
    const cached = cachedMap.get(post.key);
    const heur = heuristicMap.get(post.key)!;
    const sem = semanticMap.get(post.key);
    const contentHash = computeSpamContentHash(post);

    if (cached?.userOverride) {
      evalMap.set(post.key, cached);
      continue;
    }

    if (cached?.source === 'systemone') {
      evalMap.set(post.key, { ...cached, isSpam: cached.spamScore >= threshold });
      continue;
    }

    const fused = fuseLocalSpamScores(heur, sem, threshold);
    const evaluation: SpamEvaluationResult = {
      postKey: post.key,
      contentHash,
      spamScore: fused.spamScore,
      isSpam: fused.isSpam,
      label: fused.label,
      source: fused.source,
      reasons: fused.reasons,
      localRuleScore: heur.score,
      localNeuralScore: sem?.neuralScore,
      updatedAt: nowTs,
    };
    evalMap.set(post.key, evaluation);

    if (sem) {
      toPersistLocal.push(evaluation);
    }

    // Queue candidates for SystemOne remote verification if enabled
    if (spamFilterMode === 'hybrid') {
      // ONLY invoke SystemOne (single post per call) when Local Rule + Local AI genuinely find the post ambiguous
      const ambiguity = isPostAmbiguousForLocalSpam(heur, sem, fused.spamScore, threshold);
      if (ambiguity.ambiguous) {
        systemOneCandidates.push({ post, priority: ambiguity.uncertaintyPriority });
      }
    } else if (spamFilterMode === 'systemone') {
      // Tag uncached posts via SystemOne, prioritizing suspicious/high-view posts first
      const priority = fused.spamScore * 2 + (heur.hasPromoCues ? 0.5 : 0) + Math.min(0.4, (post.views || 0) / 50000);
      systemOneCandidates.push({ post, priority });
    }
  }

  if (toPersistLocal.length > 0) {
    await saveCachedSpamEvaluations(toPersistLocal);
  }

  // Optional Layer 3: SystemOne remote tagging (1 single post per request) on uncertain candidates
  if (systemOneCandidates.length > 0 && !signal.aborted) {
    systemOneCandidates.sort((a, b) => b.priority - a.priority);
    const maxRemote = spamFilterMode === 'hybrid' ? 10 : 40;
    const batchPosts = systemOneCandidates.slice(0, maxRemote).map((c) => c.post);

    onProgress?.({
      step: 'spam_filtering',
      stage: 'stage2',
      percent: 79,
      message: `Verifying ${batchPosts.length} ambiguous post${batchPosts.length === 1 ? '' : 's'} via SystemOne API...`,
    });

    const sysResults = await classifyPostsWithSystemOneBatch(batchPosts, {
      threshold,
      concurrency: 3,
      signal,
      onProgress: (done, total) => {
        onProgress?.({
          step: 'spam_filtering',
          stage: 'stage2',
          percent: 79 + Math.round((done / Math.max(1, total)) * 8),
          message: `SystemOne spam verification (${done}/${total})...`,
        });
      },
    });

    for (const [k, ev] of sysResults.entries()) {
      const prev = evalMap.get(k);
      evalMap.set(k, {
        ...ev,
        localRuleScore: prev?.localRuleScore,
        localNeuralScore: prev?.localNeuralScore,
      });
    }
  }

  const cleanPosts: HotPostItem[] = [];
  const newlyFiltered: FilteredSpamPostItem[] = [];

  for (const post of posts) {
    const ev = evalMap.get(post.key);
    if (ev && ev.isSpam) {
      newlyFiltered.push({ post, evaluation: ev });
    } else {
      cleanPosts.push(post);
    }
  }

  const combinedMap = new Map<string, FilteredSpamPostItem>();
  for (const item of stage1Filtered) {
    combinedMap.set(item.post.key, item);
  }
  for (const item of newlyFiltered) {
    combinedMap.set(item.post.key, item);
  }

  const allFilteredSpam = Array.from(combinedMap.values()).sort(
    (a, b) => b.evaluation.spamScore - a.evaluation.spamScore
  );

  return {
    cleanPosts,
    allFilteredSpam,
    newlyFilteredCount: newlyFiltered.length,
  };
}

/**
 * On-demand SystemOne verification triggered by the user from the Spam Filter Inspector modal.
 */
export async function verifyPostsWithSystemOneOnDemand(
  posts: HotPostItem[],
  sensitivity: HotsSpamSensitivity,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal
): Promise<{ checked: number; flaggedSpam: number }> {
  if (!Array.isArray(posts) || posts.length === 0) {
    return { checked: 0, flaggedSpam: 0 };
  }
  const threshold = getSpamThreshold(sensitivity);
  const cachedMap = await getCachedSpamEvaluations(
    posts.map((p) => ({ postKey: p.key, contentHash: computeSpamContentHash(p) }))
  );
  const heuristicMap = evaluateBatchHeuristicSpam(posts);

  // Pick uncached posts not overridden by user, prioritizing highest heuristic/promo signals
  const uncached = posts
    .filter((p) => {
      const c = cachedMap.get(p.key);
      return !c?.userOverride && c?.source !== 'systemone';
    })
    .map((p) => ({
      post: p,
      score: heuristicMap.get(p.key)?.score || 0,
      hasPromo: heuristicMap.get(p.key)?.hasPromoCues ? 1 : 0,
    }))
    .sort((a, b) => (b.score + b.hasPromo * 0.35) - (a.score + a.hasPromo * 0.35))
    .slice(0, 40)
    .map((x) => x.post);

  if (uncached.length === 0) {
    return { checked: 0, flaggedSpam: 0 };
  }

  const results = await classifyPostsWithSystemOneBatch(uncached, {
    threshold,
    concurrency: 4,
    signal,
    onProgress,
  });

  let flaggedSpam = 0;
  for (const ev of results.values()) {
    if (ev.isSpam) flaggedSpam++;
  }
  return { checked: results.size, flaggedSpam };
}

// ---------------------------------------------------------------------------
// Hots Compute Worker Lifecycle & Progressive Neural Embedding Pipeline
// ---------------------------------------------------------------------------

let activeHotsWorker: Worker | null = null;
let progressiveRefineWorker: Worker | null = null;
let currentRequestId = 0;

function terminateProgressiveRefineWorker() {
  if (progressiveRefineWorker) {
    try {
      progressiveRefineWorker.terminate();
    } catch {}
    progressiveRefineWorker = null;
  }
}

function createHotsWorker(): Worker | null {
  try {
    if (typeof Worker === 'undefined') return null;
    return new Worker(new URL('../workers/hots.worker.ts', import.meta.url), {
      type: 'module',
    });
  } catch (err) {
    console.warn('Hots Web Worker creation failed, using main-thread fallback:', err);
    return null;
  }
}

async function runStage1Compute(options: {
  requestId: number;
  cleanChannels: Array<{ nodeId: string; posts: any[] }>;
  dateRange: HotsDateRange;
  geminiApiKey?: string;
  clusterMode: HotsClusterMode;
  skipTopicClustering?: boolean;
  suppressDoneProgress?: boolean;
  spamFilterMode?: HotsSpamFilterMode;
  spamSensitivity?: HotsSpamSensitivity;
  listenItems: any[];
  channelMetadataCache: Record<string, any>;
  onProgress?: (p: HotsEngineProgress) => void;
  onPartialResult?: ComputeHotsBackgroundOptions['onPartialResult'];
}): Promise<HotsAnalysisResult> {
  const {
    requestId,
    cleanChannels,
    dateRange,
    geminiApiKey,
    clusterMode,
    skipTopicClustering = false,
    suppressDoneProgress = false,
    spamFilterMode = 'local',
    spamSensitivity = 'balanced',
    listenItems,
    channelMetadataCache,
    onProgress,
    onPartialResult,
  } = options;

  const stage1Mode: HotsClusterMode = clusterMode === 'ai' ? 'ai' : 'rule';

  if (activeHotsWorker) {
    try {
      activeHotsWorker.terminate();
    } catch {}
    activeHotsWorker = null;
  }

  const worker = createHotsWorker();
  if (worker) {
    activeHotsWorker = worker;
    return new Promise<HotsAnalysisResult>((resolve, reject) => {
      const cleanup = () => {
        if (activeHotsWorker === worker) {
          worker.terminate();
          activeHotsWorker = null;
        }
      };

      worker.onmessage = (e: MessageEvent) => {
        const msg = e.data;
        if (!msg || msg.id !== requestId) return;
        if (requestId !== currentRequestId) {
          cleanup();
          reject(new DOMException('Superseded', 'AbortError'));
          return;
        }

        if (msg.type === 'progress') {
          onProgress?.(msg.data);
        } else if (msg.type === 'partial_result') {
          onPartialResult?.(msg.data);
        } else if (msg.type === 'success') {
          cleanup();
          resolve(msg.data);
        } else if (msg.type === 'error') {
          cleanup();
          processListenHotsData({
            cachedChannels: cleanChannels,
            dateRange,
            geminiApiKey,
            useAiMode: stage1Mode === 'ai',
            clusterMode: stage1Mode,
            skipTopicClustering,
            suppressDoneProgress,
            spamFilterMode,
            spamSensitivity,
            listenItems,
            channelMetadataCache,
            onProgress,
            onPartialResult,
          })
            .then(resolve)
            .catch(reject);
        }
      };

      worker.onerror = () => {
        cleanup();
        processListenHotsData({
          cachedChannels: cleanChannels,
          dateRange,
          geminiApiKey,
          useAiMode: stage1Mode === 'ai',
          clusterMode: stage1Mode,
          skipTopicClustering,
          suppressDoneProgress,
          spamFilterMode,
          spamSensitivity,
          listenItems,
          channelMetadataCache,
          onProgress,
          onPartialResult,
        })
          .then(resolve)
          .catch(reject);
      };

      try {
        worker.postMessage({
          id: requestId,
          action: 'compute',
          payload: {
            cachedChannels: cleanChannels,
            dateRange,
            geminiApiKey,
            useAiMode: stage1Mode === 'ai',
            clusterMode: stage1Mode,
            skipTopicClustering,
            suppressDoneProgress,
            spamFilterMode,
            spamSensitivity,
            listenItems,
            channelMetadataCache,
          },
        });
      } catch {
        cleanup();
        processListenHotsData({
          cachedChannels: cleanChannels,
          dateRange,
          geminiApiKey,
          useAiMode: stage1Mode === 'ai',
          clusterMode: stage1Mode,
          skipTopicClustering,
          suppressDoneProgress,
          spamFilterMode,
          spamSensitivity,
          listenItems,
          channelMetadataCache,
          onProgress,
          onPartialResult,
        })
          .then(resolve)
          .catch(reject);
      }
    });
  }

  return processListenHotsData({
    cachedChannels: cleanChannels,
    dateRange,
    geminiApiKey,
    useAiMode: stage1Mode === 'ai',
    clusterMode: stage1Mode,
    skipTopicClustering,
    suppressDoneProgress,
    spamFilterMode,
    spamSensitivity,
    listenItems,
    channelMetadataCache,
    onProgress,
    onPartialResult,
  });
}

async function runStage2VectorClustering(options: {
  requestId: number;
  substantivePosts: HotPostItem[];
  vectors: Array<{ postKey: string; vector: Float32Array }>;
  dateRange: HotsDateRange;
  skipTranslation?: boolean;
  isProgressive?: boolean;
  onProgress?: (p: HotsEngineProgress) => void;
}): Promise<HotTopicCluster[]> {
  const {
    requestId,
    substantivePosts,
    vectors,
    dateRange,
    skipTranslation = true,
    isProgressive = false,
    onProgress,
  } = options;

  const worker = createHotsWorker();
  if (worker) {
    if (isProgressive) {
      terminateProgressiveRefineWorker();
      progressiveRefineWorker = worker;
    } else {
      if (activeHotsWorker) {
        try {
          activeHotsWorker.terminate();
        } catch {}
      }
      activeHotsWorker = worker;
    }

    return new Promise<HotTopicCluster[]>((resolve, reject) => {
      const cleanup = () => {
        try {
          worker.terminate();
        } catch {}
        if (isProgressive) {
          if (progressiveRefineWorker === worker) {
            progressiveRefineWorker = null;
          }
        } else if (activeHotsWorker === worker) {
          activeHotsWorker = null;
        }
      };

      worker.onmessage = (e: MessageEvent) => {
        const msg = e.data;
        if (!msg || msg.id !== requestId) return;
        if (requestId !== currentRequestId) {
          cleanup();
          reject(new DOMException('Superseded', 'AbortError'));
          return;
        }
        if (msg.type === 'progress') {
          if (!isProgressive) onProgress?.(msg.data);
        } else if (msg.type === 'refine_success') {
          cleanup();
          resolve(msg.hotTopics || []);
        } else if (msg.type === 'error') {
          cleanup();
          reject(new Error(msg.error || 'Vector clustering error'));
        }
      };

      worker.onerror = (err) => {
        cleanup();
        reject(new Error(err.message || 'Stage-2 clustering worker error'));
      };

      worker.postMessage({
        id: requestId,
        action: 'refine-clusters',
        payload: {
          substantivePosts,
          vectors,
          dateRange,
          skipTranslation,
        },
      });
    });
  }

  const vectorsMap = new Map<string, Float32Array>(
    vectors.map((v) => [v.postKey, v.vector])
  );
  const refined = await clusterPostsWithEmbeddings(substantivePosts, vectorsMap, dateRange);
  if (!skipTranslation) {
    await attachChineseTranslationsForForeignTitles(refined);
  }
  return refined;
}

/**
 * Computes Hots Intelligence progressively:
 *  - In `rule` or `ai` mode: runs Stage-1 (and optional Gemini AI refinement).
 *  - In `neural` mode (when model is cached or authorized): skips throwaway Rule clustering so
 *    topic rankings stay strictly Neural and update progressively as sentence embeddings complete.
 */
export async function computeListenHotsInBackground(
  options: ComputeHotsBackgroundOptions
): Promise<HotsAnalysisResult> {
  const {
    cachedChannels,
    dateRange,
    geminiApiKey,
    useAiMode = false,
    clusterMode: explicitMode,
    allowModelDownload = false,
    executorPreference = 'auto',
    spamFilterMode = 'local',
    spamSensitivity = 'balanced',
    listenItems,
    channelMetadataCache,
    onProgress,
    onPartialResult,
    onNeedsModelDownload,
  } = options;

  const clusterMode: HotsClusterMode = explicitMode || (useAiMode ? 'ai' : 'rule');

  currentRequestId++;
  const requestId = currentRequestId;
  abortHotsEmbedWorker();
  terminateProgressiveRefineWorker();

  const spamAbortCtrl = new AbortController();
  activeSpamAbortController = spamAbortCtrl;

  // Check whether multilingual ONNX model is already cached BEFORE running Stage 1
  // (used both for Neural clustering and for zero-download Local Neural spam scoring).
  let modelCacheState: Awaited<ReturnType<typeof inspectHotsEmbedModelCache>> | null = null;
  if (clusterMode === 'neural' || spamFilterMode === 'local' || spamFilterMode === 'hybrid') {
    modelCacheState = await inspectHotsEmbedModelCache();
    if (requestId !== currentRequestId) {
      throw new DOMException('Superseded', 'AbortError');
    }
  }

  const neuralReadyToRun =
    clusterMode === 'neural' &&
    Boolean(modelCacheState?.isCached || allowModelDownload);

  const cleanChannels = sanitizeCachedChannels(cachedChannels);
  const cleanListenItems = sanitizeListenItems(listenItems);
  const cleanMetadataCache = sanitizeChannelMetadataCache(channelMetadataCache);

  // Monotonic single-pass progress wrapper so a loop never jumps backwards or replays stages
  let highestProgressPct = 5;
  const reportProgress = (p: HotsEngineProgress) => {
    if (!onProgress) return;
    if (p.step === 'embedding_download' && p.totalBytes) {
      onProgress(p);
      return;
    }
    const clampedPct = p.step === 'done'
      ? 100
      : Math.max(highestProgressPct, Math.min(99, p.percent));
    highestProgressPct = clampedPct;
    onProgress({ ...p, percent: clampedPct });
  };

  const willRunStage2 = neuralReadyToRun || spamFilterMode !== 'off';

  const stage1Result = await runStage1Compute({
    requestId,
    cleanChannels,
    dateRange,
    geminiApiKey,
    clusterMode,
    skipTopicClustering: neuralReadyToRun,
    suppressDoneProgress: willRunStage2,
    spamFilterMode,
    spamSensitivity,
    listenItems: cleanListenItems,
    channelMetadataCache: cleanMetadataCache,
    onProgress: reportProgress,
    onPartialResult,
  });

  if (requestId !== currentRequestId) {
    throw new DOMException('Superseded', 'AbortError');
  }

  const substantivePosts = stage1Result.substantivePosts || [];
  const stage1FilteredSpam = stage1Result.filteredSpamPosts || [];

  // Rule / AI mode, or zero substantive posts
  if (clusterMode !== 'neural' || substantivePosts.length === 0) {
    if (spamFilterMode !== 'off' && substantivePosts.length > 0) {
      try {
        let semanticScores: SemanticSpamScore[] | undefined;
        // Leverage cached local MiniLM ONNX model for semantic spam scoring with zero extra download
        if ((spamFilterMode === 'local' || spamFilterMode === 'hybrid') && modelCacheState?.isCached) {
          reportProgress({
            step: 'spam_filtering',
            stage: 'stage2',
            percent: 72,
            message: 'Scoring posts for spam with local multilingual neural model...',
          });
          semanticScores = await scorePostsSpamInEmbedWorker(
            substantivePosts,
            executorPreference,
            requestId
          );
        }

        if (requestId !== currentRequestId) {
          throw new DOMException('Superseded', 'AbortError');
        }

        if (semanticScores?.length || spamFilterMode === 'hybrid' || spamFilterMode === 'systemone') {
          const spamRefined = await applyStage2SpamRefinement({
            posts: substantivePosts,
            stage1Filtered: stage1FilteredSpam,
            spamFilterMode,
            spamSensitivity,
            semanticScores,
            listenItems: cleanListenItems,
            signal: spamAbortCtrl.signal,
            onProgress: reportProgress,
          });

          if (requestId !== currentRequestId) {
            throw new DOMException('Superseded', 'AbortError');
          }

          if (spamRefined.newlyFilteredCount > 0) {
            reportProgress({
              step: 'clustering',
              stage: 'stage2',
              percent: 92,
              message: 'Updating topic clusters after spam filtering...',
            });
            // Re-run fast Stage-1 clustering silently (suppressing duplicate scanning/ranking progress)
            const reclustered = await runStage1Compute({
              requestId,
              cleanChannels,
              dateRange,
              geminiApiKey,
              clusterMode,
              skipTopicClustering: false,
              suppressDoneProgress: true,
              spamFilterMode,
              spamSensitivity,
              listenItems: cleanListenItems,
              channelMetadataCache: cleanMetadataCache,
            });
            const finalClean: HotsAnalysisResult = {
              ...reclustered,
              spamPostsCount: spamRefined.allFilteredSpam.length,
              filteredSpamPosts: spamRefined.allFilteredSpam,
              substantivePosts: spamRefined.cleanPosts,
              substantivePostsCount: spamRefined.cleanPosts.length,
              spamFilterModeUsed: spamFilterMode,
              computedAt: Date.now(),
            };
            reportProgress({
              step: 'done',
              percent: 100,
              message: 'Finished calculating hot intelligence.',
            });
            setCachedHotsAnalysis(finalClean, clusterMode, spamFilterMode, spamSensitivity);
            return finalClean;
          }
        }
      } catch (err: unknown) {
        if ((err as { name?: string })?.name === 'AbortError' || requestId !== currentRequestId) {
          throw new DOMException('Superseded', 'AbortError');
        }
        console.warn('Stage-2 spam refinement skipped:', err);
      }
    }

    const completedResult: HotsAnalysisResult =
      clusterMode === 'neural'
        ? {
            ...stage1Result,
            hotTopics: [],
            clusterModeUsed: 'neural',
            spamFilterModeUsed: spamFilterMode,
            computedAt: Date.now(),
            isTopicsComputing: false,
          }
        : {
            ...stage1Result,
            spamFilterModeUsed: spamFilterMode,
          };
    reportProgress({
      step: 'done',
      percent: 100,
      message: 'Finished calculating hot intelligence.',
    });
    setCachedHotsAnalysis(completedResult, clusterMode, spamFilterMode, spamSensitivity);
    return completedResult;
  }

  // Neural mode when model is NOT downloaded yet and user hasn't authorized download:
  // surface the download prompt while preserving Stage-1 preview until downloaded.
  if (!neuralReadyToRun && modelCacheState) {
    onNeedsModelDownload?.({
      approxBytes: modelCacheState.approxBytes,
      partialBytes: modelCacheState.partialBytes,
      totalBytes: modelCacheState.totalBytes,
    });
    const previewRes: HotsAnalysisResult = {
      ...stage1Result,
      clusterModeUsed: 'rule',
      spamFilterModeUsed: spamFilterMode,
    };
    setCachedHotsAnalysis(previewRes, 'rule', spamFilterMode, spamSensitivity);
    reportProgress({
      step: 'done',
      percent: 100,
      message: 'Download semantic model to enable Neural topic ranking.',
    });
    return previewRes;
  }

  // Neural Local Mode (model cached or authorized):
  // Stream progressive Neural-only clusters as embeddings compute — never flash Rule topics!
  let isProgressiveClustering = false;
  let pendingPartialSnap: {
    vectors: Array<{ postKey: string; vector: Float32Array }>;
    embedDone: number;
    embedTotal: number;
  } | null = null;
  let latestProgressiveTopics: HotTopicCluster[] = [];

  const pumpProgressiveNeuralClustering = async () => {
    if (isProgressiveClustering) return;
    isProgressiveClustering = true;
    try {
      while (pendingPartialSnap && requestId === currentRequestId) {
        const snap = pendingPartialSnap;
        pendingPartialSnap = null;

        const vecKeySet = new Set(snap.vectors.map((v) => v.postKey));
        const subsetPosts = substantivePosts.filter((p) => vecKeySet.has(p.key));
        if (subsetPosts.length === 0) continue;

        const partialTopics = await runStage2VectorClustering({
          requestId,
          substantivePosts: subsetPosts,
          vectors: snap.vectors,
          dateRange,
          skipTranslation: true,
          isProgressive: true,
        });

        if (requestId !== currentRequestId) return;

        if (partialTopics.length > 0) {
          await attachChineseTranslationsForForeignTitles(partialTopics);
          if (requestId !== currentRequestId) return;
          latestProgressiveTopics = partialTopics;
          onPartialResult?.({
            hotPosts: stage1Result.hotPosts,
            hotChannels: stage1Result.hotChannels,
            hotTopics: partialTopics,
            clusterModeUsed: 'neural',
            filteredSpamPosts: stage1FilteredSpam,
            totalPostsAnalyzed: stage1Result.totalPostsAnalyzed,
            filteredPostsCount: stage1Result.filteredPostsCount,
            meaninglessPostsCount: stage1Result.meaninglessPostsCount,
            spamPostsCount: stage1FilteredSpam.length,
            substantivePostsCount: stage1Result.substantivePostsCount,
            totalChannelsScanned: stage1Result.totalChannelsScanned,
            activeChannelsCount: stage1Result.activeChannelsCount,
          });
        }
      }
    } catch {
      // Non-fatal: final clustering pass runs once all embeddings complete
    } finally {
      isProgressiveClustering = false;
    }
  };

  try {
    const embedRes = await computePostEmbeddingsInWorker(
      substantivePosts,
      executorPreference,
      requestId,
      spamFilterMode !== 'off',
      reportProgress,
      (snap) => {
        if (requestId !== currentRequestId) return;
        pendingPartialSnap = snap;
        void pumpProgressiveNeuralClustering();
      }
    );

    pendingPartialSnap = null;
    terminateProgressiveRefineWorker();

    if (requestId !== currentRequestId) {
      throw new DOMException('Superseded', 'AbortError');
    }

    // Fuse local neural semantic spam scores (computed during the same ONNX pass) + optional SystemOne verification
    let clusteringPosts = substantivePosts;
    let clusteringVectors = embedRes.vectors;
    let allFilteredSpam = stage1FilteredSpam;

    if (spamFilterMode !== 'off') {
      const spamRefined = await applyStage2SpamRefinement({
        posts: substantivePosts,
        stage1Filtered: stage1FilteredSpam,
        spamFilterMode,
        spamSensitivity,
        semanticScores: embedRes.semanticSpamScores,
        listenItems: cleanListenItems,
        signal: spamAbortCtrl.signal,
        onProgress: reportProgress,
      });

      if (requestId !== currentRequestId) {
        throw new DOMException('Superseded', 'AbortError');
      }

      clusteringPosts = spamRefined.cleanPosts;
      allFilteredSpam = spamRefined.allFilteredSpam;
      if (spamRefined.newlyFilteredCount > 0) {
        const allowedKeys = new Set(clusteringPosts.map((p) => p.key));
        clusteringVectors = embedRes.vectors.filter((v) => allowedKeys.has(v.postKey));
      }
    }

    const neuralTopics =
      clusteringPosts.length > 0
        ? await runStage2VectorClustering({
            requestId,
            substantivePosts: clusteringPosts,
            vectors: clusteringVectors,
            dateRange,
            skipTranslation: true,
            isProgressive: false,
            onProgress: reportProgress,
          })
        : [];

    if (requestId !== currentRequestId) {
      throw new DOMException('Superseded', 'AbortError');
    }

    if (neuralTopics.length > 0) {
      reportProgress({
        step: 'clustering',
        stage: 'stage2',
        percent: 96,
        message: 'Translating non-Chinese topic titles into Chinese...',
      });
      await attachChineseTranslationsForForeignTitles(neuralTopics);
    }

    if (requestId !== currentRequestId) {
      throw new DOMException('Superseded', 'AbortError');
    }

    const finalResult: HotsAnalysisResult = {
      ...stage1Result,
      hotTopics: neuralTopics,
      substantivePosts: clusteringPosts,
      substantivePostsCount: clusteringPosts.length,
      spamPostsCount: allFilteredSpam.length,
      filteredSpamPosts: allFilteredSpam,
      spamFilterModeUsed: spamFilterMode,
      clusterModeUsed: 'neural',
      computedAt: Date.now(),
      isTopicsComputing: false,
    };

    reportProgress({
      step: 'done',
      stage: 'stage2',
      percent: 100,
      message: `Refined with multilingual embeddings (${embedRes.cachedHits} cached, ${embedRes.newlyEmbedded} embedded, ${allFilteredSpam.length} spam filtered).`,
      provider: embedRes.provider,
      cachedHits: embedRes.cachedHits,
    });

    setCachedHotsAnalysis(finalResult, 'neural', spamFilterMode, spamSensitivity);
    return finalResult;
  } catch (err: unknown) {
    pendingPartialSnap = null;
    terminateProgressiveRefineWorker();
    const isAbort =
      (err as { name?: string })?.name === 'AbortError' || requestId !== currentRequestId;
    if (isAbort) {
      throw new DOMException('Superseded', 'AbortError');
    }

    console.warn('Stage-2 neural clustering failed:', err);
    const preservedTopics =
      latestProgressiveTopics.length > 0
        ? latestProgressiveTopics
        : getCachedHotsAnalysis(dateRange, 'neural', spamFilterMode, spamSensitivity)?.hotTopics || [];
    const fallbackResult: HotsAnalysisResult = {
      ...stage1Result,
      hotTopics: preservedTopics,
      clusterModeUsed: 'neural',
      spamFilterModeUsed: spamFilterMode,
      computedAt: Date.now(),
      isTopicsComputing: false,
    };
    reportProgress({
      step: 'done',
      percent: 100,
      message: 'Neural embedding interrupted.',
    });
    return fallbackResult;
  } finally {
    if (activeSpamAbortController === spamAbortCtrl) {
      activeSpamAbortController = null;
    }
  }
}
