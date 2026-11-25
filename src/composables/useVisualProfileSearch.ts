import { computed, ref } from "vue";
import {
  VISUAL_EMBED_APPROX_BYTES,
  VISUAL_EMBED_MODEL_ID,
  buildTelegramProfileCandidatesForIdentifier,
  canonicalizeVisualEntity,
  cleanHandle,
  clearAllVisualMlCaches,
  clearVisualEmbeddingStore,
  exportVisualEmbeddingsBundle,
  findVisualProfileRecordByHandle,
  getVisualEmbeddingStats,
  importVisualEmbeddingsBundle,
  inspectVisualModelCache,
  makeVisualProfileRecordId,
  readVisualVector,
  resolveProfilePhotoCandidates,
  saveVisualProfileEmbeddings,
  searchSimilarVisualProfiles,
  type VisualEmbeddingExportBundle,
  type VisualEmbeddingImportSummary,
  type VisualEntityType,
  type VisualProfileMetadataSnapshot,
  type VisualSearchScope,
  type VisualSimilarityMatch,
} from "../utils/visualEmbedStore";
import type {
  VisualEmbedExecutorPreference,
  VisualEmbedWorkerInMessage,
  VisualEmbedWorkerOutMessage,
} from "../workers/visualEmbed.worker";

export type VisualModelStage =
  | "idle"
  | "checking"
  | "downloading"
  | "retrying"
  | "loading_cache"
  | "initializing"
  | "ready";

export interface ActiveVisualQuery {
  mode: "name" | "upload" | "profile";
  label: string;
  sublabel?: string;
  previewUrl: string;
  entityType?: VisualEntityType;
  entityKey?: string;
  recordId?: string | null;
  metadata?: VisualProfileMetadataSnapshot | null;
}

export interface VisualSearchOptions {
  threshold: number; // 0..1
  topK: number;
  scope: VisualSearchScope;
}

const PAUSE_STORAGE_KEY = "gingko_visual_index_paused_v1";

const TelegramCDNRegions: Record<string, [string, string]> = {
  "1": ["Miami, FL, USA", "Americas (North & South)"],
  "2": ["Amsterdam, NL", "Europe, Middle East, and Africa"],
  "3": ["Miami, FL, USA", "Secondary for Americas"],
  "4": ["Amsterdam, NL", "Secondary for Europe/Africa"],
  "5": ["Singapore, SG", "Asia, Australia, and Oceania"],
};

// ---------------------------------------------------------------------------
// Module-level Singleton State
// ---------------------------------------------------------------------------

let workerInstance: Worker | null = null;
let rpcCounter = 0;
let initializedOnce = false;
let currentUploadObjectUrl: string | null = null;
let statsRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let liveRerankTimer: ReturnType<typeof setTimeout> | null = null;
let lastSearchOptions: VisualSearchOptions = {
  threshold: 0.55,
  topK: 20,
  scope: "all",
};

const indexedTotal = ref(0);
const indexedChannels = ref(0);
const indexedUsers = ref(0);
const approxStoreBytes = ref(0);

const isPaused = ref(
  typeof localStorage !== "undefined" && localStorage.getItem(PAUSE_STORAGE_KEY) === "1"
);
const isIndexing = ref(false);
const pendingCount = ref(0);
const processedCount = ref(0);
const newlyEmbeddedCount = ref(0);
const skippedCount = ref(0);
const cachedHitsCount = ref(0);

const modelStage = ref<VisualModelStage>("idle");
const modelPercent = ref(0);
const modelLoadedBytes = ref(0);
const modelTotalBytes = ref(VISUAL_EMBED_APPROX_BYTES);
const modelCached = ref(false);
const provider = ref<"webgpu" | "wasm" | null>(null);
const retryAttempt = ref(0);
const maxRetries = ref(5);
const workerError = ref<string | null>(null);

const isSearching = ref(false);
const isExporting = ref(false);
const isImporting = ref(false);
const queryError = ref<string | null>(null);
const activeQuery = ref<ActiveVisualQuery | null>(null);
const lastQueryVector = ref<Float32Array | null>(null);
const results = ref<VisualSimilarityMatch[]>([]);
const scannedCount = ref(0);
const hasSearched = ref(false);

interface PendingQueryRpc {
  resolve: (res: {
    vector: Float32Array;
    photoHash: string;
    resolvedPhotoUrl?: string;
    width: number;
    height: number;
    provider: "webgpu" | "wasm";
  }) => void;
  reject: (err: Error) => void;
}

const pendingQueryRpcs = new Map<number, PendingQueryRpc>();
const pendingClearRpcs = new Map<number, () => void>();

function scheduleLiveRerank() {
  if (!hasSearched.value || !lastQueryVector.value || isSearching.value) return;
  if (liveRerankTimer) return;
  liveRerankTimer = setTimeout(async () => {
    liveRerankTimer = null;
    if (!hasSearched.value || !lastQueryVector.value || isSearching.value) return;
    const { matches, scannedCount: scanned } = await searchSimilarVisualProfiles(
      lastQueryVector.value,
      {
        threshold: lastSearchOptions.threshold,
        topK: lastSearchOptions.topK,
        scope: lastSearchOptions.scope,
        excludeRecordId: activeQuery.value?.recordId ?? null,
        excludeEntityKey: activeQuery.value?.entityKey ?? null,
        excludeId: activeQuery.value?.metadata?.id ?? null,
      }
    );
    results.value = matches;
    scannedCount.value = scanned;
  }, 450);
}

function scheduleStatsRefresh() {
  if (statsRefreshTimer) return;
  statsRefreshTimer = setTimeout(async () => {
    statsRefreshTimer = null;
    await refreshStats();
  }, 350);
}

async function refreshStats(): Promise<void> {
  const [stats, cacheInfo] = await Promise.all([
    getVisualEmbeddingStats(),
    inspectVisualModelCache(),
  ]);
  indexedTotal.value = stats.totalCount;
  indexedChannels.value = stats.channelCount;
  indexedUsers.value = stats.userCount;
  approxStoreBytes.value = stats.approxBytes;
  modelCached.value = cacheInfo.isCached;
  if (cacheInfo.totalBytes > 0) {
    modelTotalBytes.value = cacheInfo.totalBytes;
  }
}

function handleWorkerMessage(ev: MessageEvent<VisualEmbedWorkerOutMessage>) {
  const msg = ev.data;
  if (!msg) return;

  if (msg.type === "model-progress") {
    modelStage.value = msg.stage;
    modelPercent.value = msg.percent;
    if (msg.loadedBytes > 0) modelLoadedBytes.value = msg.loadedBytes;
    if (msg.totalBytes > 0) modelTotalBytes.value = msg.totalBytes;
    if (msg.provider) provider.value = msg.provider;
    if (typeof msg.cached === "boolean") modelCached.value = msg.cached;
    if (msg.retryAttempt !== undefined) retryAttempt.value = msg.retryAttempt;
    if (msg.maxRetries !== undefined) maxRetries.value = msg.maxRetries;
    if (msg.stage === "ready") {
      modelCached.value = true;
      workerError.value = null;
    }
    return;
  }

  if (msg.type === "index-status") {
    const prevNewly = newlyEmbeddedCount.value;
    isIndexing.value = msg.isIndexing;
    isPaused.value = msg.isPaused;
    pendingCount.value = msg.pendingCount;
    processedCount.value = msg.processedCount;
    newlyEmbeddedCount.value = msg.newlyEmbeddedCount;
    skippedCount.value = msg.skippedCount;
    cachedHitsCount.value = msg.cachedHitsCount;
    if (msg.provider) provider.value = msg.provider;
    if (msg.newlyEmbeddedCount !== prevNewly || (!msg.isIndexing && msg.pendingCount === 0)) {
      scheduleStatsRefresh();
    }
    if (msg.newlyEmbeddedCount !== prevNewly) {
      scheduleLiveRerank();
    }
    return;
  }

  if (msg.type === "query-done") {
    if (msg.provider) provider.value = msg.provider;
    const rpc = pendingQueryRpcs.get(msg.id);
    if (rpc) {
      pendingQueryRpcs.delete(msg.id);
      rpc.resolve({
        vector: msg.vector,
        photoHash: msg.photoHash,
        resolvedPhotoUrl: msg.resolvedPhotoUrl,
        width: msg.width,
        height: msg.height,
        provider: msg.provider,
      });
    }
    return;
  }

  if (msg.type === "clear-done") {
    const resolve = pendingClearRpcs.get(msg.id);
    if (resolve) {
      pendingClearRpcs.delete(msg.id);
      resolve();
    }
    return;
  }

  if (msg.type === "error") {
    if (msg.scope === "query" && typeof msg.id === "number") {
      const rpc = pendingQueryRpcs.get(msg.id);
      if (rpc) {
        pendingQueryRpcs.delete(msg.id);
        rpc.reject(new Error(msg.message));
      }
      return;
    }
    if (!msg.aborted) {
      workerError.value = msg.message;
      if (msg.scope === "model") {
        modelStage.value = "idle";
      }
    }
  }
}

function getOrCreateWorker(): Worker | null {
  if (typeof Worker === "undefined") return null;
  if (workerInstance) return workerInstance;
  try {
    const w = new Worker(new URL("../workers/visualEmbed.worker.ts", import.meta.url), {
      type: "module",
    });
    w.addEventListener("message", handleWorkerMessage);
    w.addEventListener("error", (ev) => {
      workerError.value = ev.message || "Visual embedding worker error";
      for (const [, rpc] of pendingQueryRpcs) {
        rpc.reject(new Error(workerError.value));
      }
      pendingQueryRpcs.clear();
      if (workerInstance === w) {
        workerInstance.terminate();
        workerInstance = null;
      }
    });
    workerInstance = w;
    if (isPaused.value) {
      w.postMessage({ id: ++rpcCounter, type: "pause" } satisfies VisualEmbedWorkerInMessage);
    }
    return w;
  } catch (err) {
    workerError.value = err instanceof Error ? err.message : "Failed to start visual worker";
    return null;
  }
}

function embedQueryInWorker(payload: {
  photoUrl?: string;
  photoUrls?: string[];
  imageBuffer?: ArrayBuffer;
  mimeType?: string;
  executor?: VisualEmbedExecutorPreference;
}): Promise<{
  vector: Float32Array;
  photoHash: string;
  resolvedPhotoUrl?: string;
  width: number;
  height: number;
  provider: "webgpu" | "wasm";
}> {
  const w = getOrCreateWorker();
  if (!w) {
    return Promise.reject(new Error("Web Worker is unavailable in this browser."));
  }
  const id = ++rpcCounter;
  return new Promise((resolve, reject) => {
    pendingQueryRpcs.set(id, { resolve, reject });
    const msg: VisualEmbedWorkerInMessage = {
      id,
      type: "embed-query",
      photoUrl: payload.photoUrl,
      photoUrls: payload.photoUrls,
      imageBuffer: payload.imageBuffer,
      mimeType: payload.mimeType,
      executor: payload.executor || "wasm",
    };
    if (payload.imageBuffer) {
      w.postMessage(msg, [payload.imageBuffer]);
    } else {
      w.postMessage(msg);
    }
  });
}

function attachCdnInfo(data: any) {
  if (!data || typeof data !== "object") return;
  if (data.photo) {
    const match = String(data.photo).match(/cdn(\d+)/);
    if (match) {
      data.cdnNumber = match[1];
      data.cdnRegion = TelegramCDNRegions[match[1]] || null;
    }
  }
}

async function resolveRemoteEntityByName(
  rawHandle: string
): Promise<{
  metadata: VisualProfileMetadataSnapshot | null;
  fallbackPhotoUrl: string;
  photoCandidates: string[];
  cleanName: string;
}> {
  const cleanName = cleanHandle(rawHandle);
  const baseCandidates = cleanName
    ? buildTelegramProfileCandidatesForIdentifier(cleanName)
    : [];
  const fallbackPhotoUrl = baseCandidates[0] || "";

  if (!cleanName) {
    return { metadata: null, fallbackPhotoUrl: "", photoCandidates: [], cleanName: "" };
  }

  let rawData: any = null;
  let resolvedType: VisualEntityType = "channel";

  const tryChannel = async (): Promise<boolean> => {
    try {
      const chanRes = await fetch(
        `https://i.gogingko.net/api/v1/v/telegram-channel/${encodeURIComponent(cleanName)}`
      );
      if (chanRes.ok) {
        const data = await chanRes.json();
        if (data && !(data.state === 1 && !data.username && !data.title && !data.name)) {
          rawData = data;
          resolvedType = "channel";
          return true;
        }
      }
    } catch {
      // ignore
    }
    return false;
  };

  const tryUser = async (): Promise<boolean> => {
    try {
      const userRes = await fetch(
        `https://i.gogingko.net/api/v1/v/telegram-user/${encodeURIComponent(cleanName)}`
      );
      if (userRes.ok) {
        const data = await userRes.json();
        if (data && !(data.state === 1 && !data.username && !data.first_name)) {
          rawData = data;
          resolvedType = "user";
          return true;
        }
      }
    } catch {
      // ignore
    }
    return false;
  };

  // Numeric channel IDs and '+' private invite links are channels/groups: probe channel first
  const preferChannelFirst = cleanName.startsWith("+") || /^-?\d+$/.test(cleanName);
  if (preferChannelFirst) {
    const foundChan = await tryChannel();
    if (!foundChan) await tryUser();
  } else {
    const foundUser = await tryUser();
    if (!foundUser) await tryChannel();
  }

  if (rawData) {
    if (resolvedType === "channel") {
      rawData.isChannel = true;
      rawData.key = rawData.key || cleanName;
      rawData.username = rawData.username || cleanName;
      rawData.title = rawData.title || rawData.name || cleanName;
    } else {
      rawData.isChannel = false;
      rawData.key = rawData.key || cleanName;
      rawData.username = rawData.username || cleanName;
    }
    attachCdnInfo(rawData);
    const snapshot = canonicalizeVisualEntity(rawData, resolvedType);
    const mergedCandidates = [
      ...(snapshot?.photoCandidates || []),
      ...baseCandidates,
    ].filter((u, idx, arr) => Boolean(u) && arr.indexOf(u) === idx);
    return {
      metadata: snapshot ? { ...snapshot, photoCandidates: mergedCandidates } : null,
      fallbackPhotoUrl: mergedCandidates[0] || fallbackPhotoUrl,
      photoCandidates: mergedCandidates,
      cleanName,
    };
  }

  return {
    metadata: null,
    fallbackPhotoUrl,
    photoCandidates: baseCandidates,
    cleanName,
  };
}

function revokeUploadObjectUrl() {
  if (currentUploadObjectUrl) {
    try {
      URL.revokeObjectURL(currentUploadObjectUrl);
    } catch {
      // ignore
    }
    currentUploadObjectUrl = null;
  }
}

// ---------------------------------------------------------------------------
// Public Composable API
// ---------------------------------------------------------------------------

export function useVisualProfileSearch() {
  if (!initializedOnce) {
    initializedOnce = true;
    void refreshStats();
  }

  function enqueueProfilesForVisualIndexing(
    rawItems: any[],
    fallbackType: VisualEntityType = "channel"
  ): number {
    if (!Array.isArray(rawItems) || rawItems.length === 0) return 0;
    const snapshots: VisualProfileMetadataSnapshot[] = [];
    const seen = new Set<string>();
    for (const raw of rawItems) {
      const snap = canonicalizeVisualEntity(raw, fallbackType);
      if (!snap) continue;
      const key = `${snap.entityType}::${snap.entityKey}`;
      if (seen.has(key)) continue;
      seen.add(key);
      snapshots.push(snap);
    }
    if (snapshots.length === 0) return 0;

    const w = getOrCreateWorker();
    if (!w) return 0;

    w.postMessage({
      id: ++rpcCounter,
      type: "enqueue-index",
      items: snapshots,
      executor: "auto",
    } satisfies VisualEmbedWorkerInMessage);

    return snapshots.length;
  }

  function pauseIndexing() {
    isPaused.value = true;
    try {
      localStorage.setItem(PAUSE_STORAGE_KEY, "1");
    } catch {
      // ignore
    }
    if (workerInstance) {
      workerInstance.postMessage({ id: ++rpcCounter, type: "pause" } satisfies VisualEmbedWorkerInMessage);
    }
  }

  function resumeIndexing() {
    isPaused.value = false;
    try {
      localStorage.setItem(PAUSE_STORAGE_KEY, "0");
    } catch {
      // ignore
    }
    const w = getOrCreateWorker();
    if (w) {
      w.postMessage({
        id: ++rpcCounter,
        type: "resume",
        executor: "auto",
      } satisfies VisualEmbedWorkerInMessage);
    }
  }

  function togglePauseIndexing() {
    if (isPaused.value) {
      resumeIndexing();
    } else {
      pauseIndexing();
    }
  }

  async function runSimilarityMatch(
    vector: Float32Array,
    options: VisualSearchOptions,
    exclude?: { recordId?: string | null; entityKey?: string | null; id?: string | number | null }
  ) {
    lastSearchOptions = { ...options };
    lastQueryVector.value = vector;
    const { matches, scannedCount: scanned } = await searchSimilarVisualProfiles(vector, {
      threshold: options.threshold,
      topK: options.topK,
      scope: options.scope,
      excludeRecordId: exclude?.recordId ?? null,
      excludeEntityKey: exclude?.entityKey ?? null,
      excludeId: exclude?.id ?? null,
    });
    results.value = matches;
    scannedCount.value = scanned;
    hasSearched.value = true;
  }

  async function searchByName(rawName: string, options: VisualSearchOptions): Promise<void> {
    const cleanName = cleanHandle(rawName);
    if (!cleanName) return;

    revokeUploadObjectUrl();
    isSearching.value = true;
    queryError.value = null;

    try {
      // 1. Check local IndexedDB first for instant zero-latency match!
      const cachedRec = await findVisualProfileRecordByHandle(cleanName, VISUAL_EMBED_MODEL_ID);
      const cachedVec = cachedRec ? readVisualVector(cachedRec.vectorBuffer) : null;
      if (cachedRec && cachedVec) {
        activeQuery.value = {
          mode: "name",
          label: cachedRec.metadata?.title || `@${cleanName}`,
          sublabel: cachedRec.metadata?.username
            ? `@${cachedRec.metadata.username}`
            : `@${cleanName}`,
          previewUrl: cachedRec.photoUrl || cachedRec.metadata?.photoUrl || "",
          entityType: cachedRec.entityType,
          entityKey: cachedRec.entityKey,
          recordId: cachedRec.id,
          metadata: cachedRec.metadata,
        };
        await runSimilarityMatch(cachedVec, options, {
          recordId: cachedRec.id,
          entityKey: cachedRec.entityKey,
          id: cachedRec.metadata?.id ?? null,
        });
        return;
      }

      // 2. Resolve profile metadata & avatar candidates remotely
      const resolved = await resolveRemoteEntityByName(cleanName);
      const photoUrl = resolved.fallbackPhotoUrl;
      const photoUrls = resolved.photoCandidates;

      activeQuery.value = {
        mode: "name",
        label: resolved.metadata?.title || `@${cleanName}`,
        sublabel: `@${resolved.metadata?.username || cleanName}`,
        previewUrl: photoUrl,
        entityType: resolved.metadata?.entityType,
        entityKey: resolved.metadata?.entityKey || cleanName.toLowerCase(),
        recordId: resolved.metadata
          ? makeVisualProfileRecordId(resolved.metadata.entityType, resolved.metadata.entityKey)
          : null,
        metadata: resolved.metadata,
      };

      if (!photoUrl && photoUrls.length === 0) {
        throw new Error("NO_VALID_PROFILE_PHOTO");
      }

      const embedded = await embedQueryInWorker({ photoUrl, photoUrls });
      const finalPhotoUrl = embedded.resolvedPhotoUrl || photoUrl;
      if (finalPhotoUrl && activeQuery.value) {
        activeQuery.value = { ...activeQuery.value, previewUrl: finalPhotoUrl };
      }

      // Save resolved profile into IndexedDB so future queries benefit too
      if (resolved.metadata) {
        const metaToSave: VisualProfileMetadataSnapshot = {
          ...resolved.metadata,
          photoUrl: finalPhotoUrl || resolved.metadata.photoUrl,
        };
        await saveVisualProfileEmbeddings([
          {
            metadata: metaToSave,
            photoHash: embedded.photoHash,
            vector: embedded.vector,
          },
        ]);
        await refreshStats();
      }

      await runSimilarityMatch(embedded.vector, options, {
        recordId: activeQuery.value.recordId,
        entityKey: activeQuery.value.entityKey,
        id: resolved.metadata?.id ?? null,
      });
    } catch (err: unknown) {
      const rawMsg = err instanceof Error ? err.message : String(err);
      queryError.value = rawMsg;
      results.value = [];
      hasSearched.value = true;
    } finally {
      isSearching.value = false;
    }
  }

  async function searchByProfile(
    rawProfile: any,
    fallbackType: VisualEntityType,
    options: VisualSearchOptions
  ): Promise<void> {
    const snap = canonicalizeVisualEntity(rawProfile, fallbackType);
    if (!snap) return;

    revokeUploadObjectUrl();
    isSearching.value = true;
    queryError.value = null;

    const recordId = makeVisualProfileRecordId(snap.entityType, snap.entityKey);

    activeQuery.value = {
      mode: "profile",
      label: snap.title || snap.username || snap.entityKey,
      sublabel: snap.username ? `@${snap.username}` : snap.id ? `ID: ${snap.id}` : snap.entityKey,
      previewUrl: snap.photoUrl,
      entityType: snap.entityType,
      entityKey: snap.entityKey,
      recordId,
      metadata: snap,
    };

    try {
      // Prefer local cached vector if already indexed and valid
      const cachedRec = await findVisualProfileRecordByHandle(snap.entityKey, VISUAL_EMBED_MODEL_ID);
      const cachedVec = cachedRec ? readVisualVector(cachedRec.vectorBuffer) : null;
      if (cachedRec && cachedVec) {
        if (cachedRec.photoUrl && activeQuery.value) {
          activeQuery.value = { ...activeQuery.value, previewUrl: cachedRec.photoUrl };
        }
        await runSimilarityMatch(cachedVec, options, {
          recordId: cachedRec.id,
          entityKey: cachedRec.entityKey,
          id: cachedRec.metadata?.id ?? snap.id ?? null,
        });
        return;
      }

      const photoUrls =
        Array.isArray(snap.photoCandidates) && snap.photoCandidates.length > 0
          ? snap.photoCandidates
          : resolveProfilePhotoCandidates(rawProfile);

      const embedded = await embedQueryInWorker({
        photoUrl: snap.photoUrl,
        photoUrls,
      });
      const finalPhotoUrl = embedded.resolvedPhotoUrl || snap.photoUrl;
      const metaToSave: VisualProfileMetadataSnapshot = {
        ...snap,
        photoUrl: finalPhotoUrl,
      };
      if (finalPhotoUrl && activeQuery.value) {
        activeQuery.value = { ...activeQuery.value, previewUrl: finalPhotoUrl, metadata: metaToSave };
      }

      await saveVisualProfileEmbeddings([
        {
          metadata: metaToSave,
          photoHash: embedded.photoHash,
          vector: embedded.vector,
        },
      ]);
      await refreshStats();

      await runSimilarityMatch(embedded.vector, options, {
        recordId,
        entityKey: snap.entityKey,
        id: snap.id ?? null,
      });
    } catch (err: unknown) {
      const rawMsg = err instanceof Error ? err.message : String(err);
      queryError.value = rawMsg;
      results.value = [];
      hasSearched.value = true;
    } finally {
      isSearching.value = false;
    }
  }

  async function searchByUploadedFile(
    file: File,
    options: VisualSearchOptions
  ): Promise<void> {
    if (!file) return;

    revokeUploadObjectUrl();
    const previewUrl = URL.createObjectURL(file);
    currentUploadObjectUrl = previewUrl;

    isSearching.value = true;
    queryError.value = null;

    activeQuery.value = {
      mode: "upload",
      label: file.name || "Uploaded image",
      sublabel: `${Math.max(1, Math.round(file.size / 1024))} KB`,
      previewUrl,
      recordId: null,
      entityKey: undefined,
      metadata: null,
    };

    try {
      const buf = await file.arrayBuffer();
      const embedded = await embedQueryInWorker({
        imageBuffer: buf,
        mimeType: file.type || "image/jpeg",
      });
      await runSimilarityMatch(embedded.vector, options);
    } catch (err: unknown) {
      const rawMsg = err instanceof Error ? err.message : String(err);
      queryError.value = rawMsg;
      results.value = [];
      hasSearched.value = true;
    } finally {
      isSearching.value = false;
    }
  }

  async function rerankLastQuery(options: VisualSearchOptions): Promise<void> {
    lastSearchOptions = { ...options };
    if (!lastQueryVector.value) return;
    await runSimilarityMatch(lastQueryVector.value, options, {
      recordId: activeQuery.value?.recordId,
      entityKey: activeQuery.value?.entityKey,
      id: activeQuery.value?.metadata?.id ?? null,
    });
  }

  function clearQuery() {
    revokeUploadObjectUrl();
    activeQuery.value = null;
    lastQueryVector.value = null;
    results.value = [];
    queryError.value = null;
    scannedCount.value = 0;
    hasSearched.value = false;
  }

  async function exportIndexedEmbeddings(): Promise<VisualEmbeddingExportBundle> {
    isExporting.value = true;
    try {
      return await exportVisualEmbeddingsBundle();
    } finally {
      isExporting.value = false;
    }
  }

  async function importIndexedEmbeddings(raw: unknown): Promise<VisualEmbeddingImportSummary> {
    isImporting.value = true;
    try {
      const summary = await importVisualEmbeddingsBundle(raw);
      await refreshStats();
      if (summary.totalImported > 0) {
        scheduleLiveRerank();
      }
      return summary;
    } finally {
      isImporting.value = false;
    }
  }

  async function clearIndexedVectors(includeModel: boolean = false): Promise<void> {
    if (workerInstance) {
      const w = workerInstance;
      const id = ++rpcCounter;
      await new Promise<void>((resolve) => {
        pendingClearRpcs.set(id, resolve);
        w.postMessage({
          id,
          type: "clear-cache",
          includeModel,
        } satisfies VisualEmbedWorkerInMessage);
        setTimeout(() => {
          pendingClearRpcs.delete(id);
          resolve();
        }, 2500);
      });
    }
    if (includeModel) {
      await clearAllVisualMlCaches();
      modelStage.value = "idle";
      modelCached.value = false;
      modelPercent.value = 0;
      modelLoadedBytes.value = 0;
    } else {
      await clearVisualEmbeddingStore();
    }
    processedCount.value = 0;
    newlyEmbeddedCount.value = 0;
    skippedCount.value = 0;
    cachedHitsCount.value = 0;
    pendingCount.value = 0;
    clearQuery();
    await refreshStats();
  }

  const isModelBusy = computed(
    () =>
      modelStage.value === "checking" ||
      modelStage.value === "downloading" ||
      modelStage.value === "retrying" ||
      modelStage.value === "loading_cache" ||
      modelStage.value === "initializing"
  );

  return {
    // Store stats
    indexedTotal,
    indexedChannels,
    indexedUsers,
    approxStoreBytes,
    // Background worker status
    isPaused,
    isIndexing,
    pendingCount,
    processedCount,
    newlyEmbeddedCount,
    skippedCount,
    cachedHitsCount,
    // Model progress
    modelStage,
    modelPercent,
    modelLoadedBytes,
    modelTotalBytes,
    modelCached,
    provider,
    retryAttempt,
    maxRetries,
    workerError,
    isModelBusy,
    // Query state
    isSearching,
    isExporting,
    isImporting,
    queryError,
    activeQuery,
    results,
    scannedCount,
    hasSearched,
    // Actions
    refreshStats,
    enqueueProfilesForVisualIndexing,
    pauseIndexing,
    resumeIndexing,
    togglePauseIndexing,
    searchByName,
    searchByProfile,
    searchByUploadedFile,
    rerankLastQuery,
    clearQuery,
    exportIndexedEmbeddings,
    importIndexedEmbeddings,
    clearIndexedVectors,
  };
}
