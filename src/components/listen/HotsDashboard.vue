<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from "vue";
import { useI18n, t } from "../../i18n";
import { probeApiBackend } from "../../utils/apiCapabilities";
import {
  Flame,
  TrendingUp,
  Eye,
  Radio,
  RefreshCw,
  Sparkles,
  ExternalLink,
  MessageSquare,
  Share2,
  Calendar,
  Layers,
  Search,
  X,
  Key,
  CheckCircle2,
  AlertCircle,
  Clock,
  Filter,
  ArrowRight,
  ImageIcon,
  Video,
  Globe,
  User,
  Building2,
  BarChart2,
  Scale,
  Hash,
  Cpu,
  Database,
  Download,
  Trash2,
  Zap,
  Smile,
  Meh,
  Frown
} from "lucide-vue-next";
import {
  HotsDateRange,
  HotsClusterMode,
  HotPostItem,
  HotTopicCluster,
  HotChannelItem,
  HotsEngineProgress,
  HotsAnalysisResult,
  TopicSentimentLabel,
  getDateRangeBounds,
  getLocalCalendarDayKey,
  isRelativeCalendarDateRange,
  formatHotsDateRangeSummary,
  isNonChineseTitle,
  translateTopicTitlesOnDemand
} from "../../utils/hotsEngine";
import {
  computeListenHotsInBackground,
  getCachedHotsAnalysis,
  clearHotsAnalysisCache,
  pruneStaleDayHotsCache,
  warmupHotsEmbedModel,
  abortHotsEmbedWorker,
  getHotsEmbedCacheStatus,
  clearHotsEmbedAndVectorCache,
  type HotsEmbedExecutorPreference,
  type HotsNeuralCacheStatus
} from "../../utils/hotsWorkerClient";
import { HOTS_EMBED_MODEL_ID } from "../../utils/hotsVectorStore";
import { getAllCachedPostsIndexedDB } from "../../utils/indexedDbPosts";
import PostItemView from "./PostItemView.vue";
import VirtualPostList from "./VirtualPostList.vue";
import ChannelViewCard from "./ChannelViewCard.vue";
import PostVolumeTrendCard from "./PostVolumeTrendCard.vue";

export interface ListenDbSyncPayload {
  timestamp: number;
  nodeId: string;
  count: number;
  minPostTimestamp: number;
  maxPostTimestamp: number;
}

const props = defineProps<{
  isDark?: boolean;
  lastDbUpdate?: number;
  lastDbSyncEvent?: ListenDbSyncPayload;
  listenItems?: any[];
  channelMetadataCache?: Record<string, any>;
}>();

const emit = defineEmits<{
  (e: "select-channel", channelId: string): void;
  (e: "open-post", payload: { channelId: string; postId: string | number; postUrl?: string }): void;
  (e: "add-to-workspace", post: any): void;
  (e: "share-post", post: any): void;
  (e: "open-lightbox", url: string): void;
}>();

const { t } = useI18n();

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const DATE_RANGE_STORAGE_KEY = "listen_hots_date_range";
const DATE_RANGE_DAY_STORAGE_KEY = "listen_hots_date_range_day";

const activeCalendarDayKey = ref<string>(getLocalCalendarDayKey());
const dayRolloverNotice = ref<string>("");
let dayRolloverNoticeTimer: ReturnType<typeof setTimeout> | null = null;
let midnightTimer: ReturnType<typeof setTimeout> | null = null;
let dayCheckInterval: ReturnType<typeof setInterval> | null = null;
let initialDateRolloverReset = false;

function showDayRolloverNotice(dateLabel: string) {
  if (dayRolloverNoticeTimer) {
    clearTimeout(dayRolloverNoticeTimer);
    dayRolloverNoticeTimer = null;
  }
  dayRolloverNotice.value =
    t("listen.hots.dateRolloverNotice", { date: dateLabel }) ||
    `Date updated to ${dateLabel} — filter reset to Today and hot topics recalculated.`;
  dayRolloverNoticeTimer = setTimeout(() => {
    dayRolloverNotice.value = "";
    dayRolloverNoticeTimer = null;
  }, 10000);
}

function dismissDayRolloverNotice() {
  if (dayRolloverNoticeTimer) {
    clearTimeout(dayRolloverNoticeTimer);
    dayRolloverNoticeTimer = null;
  }
  dayRolloverNotice.value = "";
}

function resolveInitialDateRange(): HotsDateRange {
  const savedRange = (localStorage.getItem(DATE_RANGE_STORAGE_KEY) as HotsDateRange) || "today";
  const savedDay = localStorage.getItem(DATE_RANGE_DAY_STORAGE_KEY);
  const todayKey = activeCalendarDayKey.value;

  if (savedDay && savedDay !== todayKey && isRelativeCalendarDateRange(savedRange)) {
    initialDateRolloverReset = true;
    localStorage.setItem(DATE_RANGE_STORAGE_KEY, "today");
    localStorage.setItem(DATE_RANGE_DAY_STORAGE_KEY, todayKey);
    pruneStaleDayHotsCache(todayKey);
    return "today";
  }

  localStorage.setItem(DATE_RANGE_DAY_STORAGE_KEY, todayKey);
  return savedRange;
}

const selectedDateRange = ref<HotsDateRange>(resolveInitialDateRange());

const activeDateRangeSummary = computed<string>(() => {
  void activeCalendarDayKey.value;
  return formatHotsDateRangeSummary(selectedDateRange.value);
});

const dateRangeTooltips = computed<Record<'today' | 'yesterday' | '3days' | 'week', string>>(() => {
  void activeCalendarDayKey.value;
  const now = new Date();
  return {
    today: `${t("listen.hots.today") || "Today"} · ${formatHotsDateRangeSummary("today", now)}`,
    yesterday: `${t("listen.hots.yesterday") || "Yesterday"} · ${formatHotsDateRangeSummary("yesterday", now)}`,
    "3days": `${t("listen.hots.last3Days") || "Last 3 Days"} · ${formatHotsDateRangeSummary("3days", now)}`,
    week: `${t("listen.hots.lastWeek") || "Last Week"} · ${formatHotsDateRangeSummary("week", now)}`
  };
});

const isComputing = ref(false);
const isTopicsComputing = ref(false);
const computeProgress = ref<HotsEngineProgress>({
  step: "done",
  percent: 100,
  message: ""
});

const analysisResult = ref<HotsAnalysisResult | null>(null);

const effectiveChartDateRange = computed<HotsDateRange>(() => {
  return analysisResult.value?.dateRange || selectedDateRange.value;
});

// Cluster Mode, Gemini Token & Local Neural Cache State
function resolveInitialClusterMode(): HotsClusterMode {
  const saved = localStorage.getItem("listen_hots_cluster_mode");
  if (saved === "rule" || saved === "neural" || saved === "ai") return saved;
  if (localStorage.getItem("listen_hots_ai_mode") === "true") return "ai";
  return "neural";
}

const geminiApiKey = ref<string>(localStorage.getItem("gemini_api_key") || "");
const serverHasGemini = ref(false);
const selectedClusterMode = ref<HotsClusterMode>(resolveInitialClusterMode());
const executorPreference = ref<HotsEmbedExecutorPreference>(
  (localStorage.getItem("listen_hots_embed_executor") as HotsEmbedExecutorPreference) || "auto"
);
const isApiKeyModalOpen = ref(false);
const apiKeyInput = ref(geminiApiKey.value);
const apiKeyFeedback = ref("");

const isEmbedCacheModalOpen = ref(false);
const neuralCacheStatus = ref<HotsNeuralCacheStatus | null>(null);
const needsNeuralModelDownload = ref<{
  approxBytes: number;
  partialBytes: number;
  totalBytes: number;
} | null>(null);
const isWarmingUpModel = ref(false);
const isClearingEmbedCache = ref(false);
const embedActionFeedback = ref("");

const effectiveClusterMode = computed<HotsClusterMode>(() => {
  if (selectedClusterMode.value === "ai" && !serverHasGemini.value && !geminiApiKey.value) {
    return "rule";
  }
  return selectedClusterMode.value;
});

const refreshNeuralCacheStatus = async () => {
  try {
    neuralCacheStatus.value = await getHotsEmbedCacheStatus();
  } catch {
    // ignore storage probe failures
  }
};

const checkServerGeminiStatus = async () => {
  const cap = await probeApiBackend();
  serverHasGemini.value = cap.serverHasGeminiKey;
  if (
    cap.serverHasGeminiKey &&
    !localStorage.getItem("listen_hots_cluster_mode") &&
    !localStorage.getItem("listen_hots_ai_mode")
  ) {
    selectedClusterMode.value = "ai";
  }
};

// Full List Modal / Drill-Down State
const isDrillDownOpen = ref(false);
const drillDownTab = ref<"topics" | "posts" | "channels">("topics");
const drillDownSearch = ref("");
const selectedDomainFilter = ref<string>("");
const selectedSentimentFilter = ref<"" | TopicSentimentLabel>("");
const postSortOrder = ref<"views" | "score" | "date">("views");
const inspectedTopic = ref<HotTopicCluster | null>(null);
const inspectedPost = ref<HotPostItem | null>(null);

// Incremental computing debounce & pending state
let debounceTimer: any = null;
let maxWaitTimer: any = null;
let countdownInterval: any = null;
const isRecalculationPending = ref(false);
const pendingCountdownSeconds = ref(0);
const pendingBatchesCount = ref(0);
const DEBOUNCE_DELAY_MS = 10000; // 10 seconds trailing debounce (triggered a little later when receiving new posts)
const MAX_WAIT_MS = 25000; // 25 seconds maximum wait boundary for continuous streams

// ---------------------------------------------------------------------------
// Computed properties
// ---------------------------------------------------------------------------

const availableDomains = computed(() => {
  if (!analysisResult.value) return [];
  const set = new Set<string>();
  for (const post of analysisResult.value.hotPosts) {
    if (post.linkPreview?.domain) {
      set.add(post.linkPreview.domain);
    }
  }
  return Array.from(set).sort();
});

const filteredDrillDownTopics = computed(() => {
  if (!analysisResult.value) return [];
  let list = analysisResult.value.hotTopics;
  const q = drillDownSearch.value.trim().toLowerCase();
  if (q) {
    list = list.filter(top =>
      top.title.toLowerCase().includes(q) ||
      top.summary.toLowerCase().includes(q) ||
      top.keywords.some(k => k.toLowerCase().includes(q)) ||
      top.channels.some(c => c.toLowerCase().includes(q))
    );
  }
  if (selectedDomainFilter.value) {
    list = list.filter(top => top.domains.includes(selectedDomainFilter.value));
  }
  if (selectedSentimentFilter.value) {
    list = list.filter(top => (top.sentiment || "neutral") === selectedSentimentFilter.value);
  }
  return list;
});

const filteredDrillDownPosts = computed(() => {
  if (!analysisResult.value) return [];
  let list = [...analysisResult.value.hotPosts];
  const q = drillDownSearch.value.trim().toLowerCase();
  if (q) {
    list = list.filter(p =>
      p.text.toLowerCase().includes(q) ||
      p.channelName.toLowerCase().includes(q) ||
      (p.linkPreview?.title && p.linkPreview.title.toLowerCase().includes(q)) ||
      (p.linkPreview?.domain && p.linkPreview.domain.toLowerCase().includes(q))
    );
  }
  if (selectedDomainFilter.value) {
    list = list.filter(p => p.linkPreview?.domain === selectedDomainFilter.value);
  }
  if (postSortOrder.value === "score") {
    list.sort((a, b) => b.qualityScore - a.qualityScore);
  } else if (postSortOrder.value === "date") {
    list.sort((a, b) => b.date - a.date);
  } else {
    list.sort((a, b) => b.views - a.views);
  }
  return list;
});

const filteredDrillDownChannels = computed(() => {
  if (!analysisResult.value) return [];
  let list = analysisResult.value.hotChannels;
  const q = drillDownSearch.value.trim().toLowerCase();
  if (q) {
    list = list.filter(ch =>
      ch.channelName.toLowerCase().includes(q) ||
      ch.title.toLowerCase().includes(q)
    );
  }
  return list;
});

// ---------------------------------------------------------------------------
// Computing Engine Execution
// ---------------------------------------------------------------------------

async function runAnalysis(force: boolean = false, allowModelDownload: boolean = false) {
  if (isComputing.value && !force) return;

  const currentDayKey = getLocalCalendarDayKey();
  if (currentDayKey !== activeCalendarDayKey.value) {
    activeCalendarDayKey.value = currentDayKey;
    pruneStaleDayHotsCache(currentDayKey);
  }

  const activeMode = effectiveClusterMode.value;
  const cached = getCachedHotsAnalysis(selectedDateRange.value, activeMode);
  if (cached && !force) {
    analysisResult.value = cached;
  } else if (!force) {
    // Also restore Stage-1 rule cache immediately if switching into neural for instant preview
    const ruleFallback =
      activeMode === "neural" ? getCachedHotsAnalysis(selectedDateRange.value, "rule") : undefined;
    analysisResult.value = ruleFallback || null;
  } else if (
    !analysisResult.value ||
    analysisResult.value.dateRange !== selectedDateRange.value ||
    (isRelativeCalendarDateRange(selectedDateRange.value) &&
      analysisResult.value.computedAt &&
      getLocalCalendarDayKey(new Date(analysisResult.value.computedAt)) !== currentDayKey)
  ) {
    analysisResult.value = null;
  }

  needsNeuralModelDownload.value = null;
  isComputing.value = true;
  isTopicsComputing.value = true;
  computeProgress.value = {
    step: "scanning",
    percent: 5,
    message: "Scanning IndexedDB posts cache in background..."
  };

  try {
    const bounds = getDateRangeBounds(selectedDateRange.value);
    const cachedChannels = await getAllCachedPostsIndexedDB({
      dateRangeStart: bounds.start,
      dateRangeEnd: bounds.end,
      lightweightProjection: true
    });
    if (cachedChannels.length === 0) {
      analysisResult.value = {
        dateRange: selectedDateRange.value,
        timeWindow: { start: bounds.start, end: bounds.end },
        totalPostsAnalyzed: 0,
        filteredPostsCount: 0,
        meaninglessPostsCount: 0,
        substantivePostsCount: 0,
        totalChannelsScanned: 0,
        activeChannelsCount: 0,
        hotTopics: [],
        hotPosts: [],
        hotChannels: [],
        computedAt: Date.now(),
        isTopicsComputing: false
      };
      isTopicsComputing.value = false;
      return;
    }

    const res = await computeListenHotsInBackground({
      cachedChannels,
      dateRange: selectedDateRange.value,
      geminiApiKey: geminiApiKey.value,
      useAiMode: activeMode === "ai",
      clusterMode: activeMode,
      allowModelDownload,
      executorPreference: executorPreference.value,
      listenItems: props.listenItems,
      channelMetadataCache: props.channelMetadataCache,
      onProgress: p => {
        computeProgress.value = p;
        if (
          p.step === "clustering" ||
          p.step === "ai_clustering" ||
          p.step === "embedding_download" ||
          p.step === "embedding"
        ) {
          isTopicsComputing.value = true;
        }
      },
      onNeedsModelDownload: info => {
        needsNeuralModelDownload.value = info;
      },
      onPartialResult: partial => {
        // Progressive UI: Show Hot Posts, Hot Channels, and instant Stage-1 topics cleanly
        const keepComputingTopics = activeMode === "neural" || activeMode === "ai";
        if (!analysisResult.value) {
          analysisResult.value = {
            dateRange: selectedDateRange.value,
            timeWindow: { start: 0, end: Date.now() },
            totalPostsAnalyzed: partial.totalPostsAnalyzed,
            filteredPostsCount: partial.filteredPostsCount,
            meaninglessPostsCount: partial.meaninglessPostsCount || 0,
            substantivePostsCount: partial.substantivePostsCount || 0,
            totalChannelsScanned: partial.totalChannelsScanned,
            activeChannelsCount: partial.activeChannelsCount,
            hotTopics: partial.hotTopics || [],
            hotPosts: partial.hotPosts,
            hotChannels: partial.hotChannels,
            computedAt: Date.now(),
            isTopicsComputing: keepComputingTopics
          };
        } else {
          analysisResult.value = {
            ...analysisResult.value,
            totalPostsAnalyzed: partial.totalPostsAnalyzed,
            filteredPostsCount: partial.filteredPostsCount,
            meaninglessPostsCount: partial.meaninglessPostsCount ?? analysisResult.value.meaninglessPostsCount ?? 0,
            substantivePostsCount: partial.substantivePostsCount ?? analysisResult.value.substantivePostsCount ?? 0,
            totalChannelsScanned: partial.totalChannelsScanned,
            activeChannelsCount: partial.activeChannelsCount,
            hotTopics: partial.hotTopics && partial.hotTopics.length > 0 ? partial.hotTopics : analysisResult.value.hotTopics,
            hotPosts: partial.hotPosts,
            hotChannels: partial.hotChannels,
            isTopicsComputing: keepComputingTopics
          };
        }
      }
    });

    analysisResult.value = res;

    // Keep open inspectedTopic in sync when Stage-2 refinement replaces Stage-1 clusters
    if (inspectedTopic.value && res.hotTopics.length > 0) {
      const prevRepKey = inspectedTopic.value.representativePost?.key || inspectedTopic.value.posts[0]?.key;
      const matched =
        res.hotTopics.find(tp => tp.id === inspectedTopic.value?.id) ||
        (prevRepKey ? res.hotTopics.find(tp => tp.posts.some(p => p.key === prevRepKey)) : undefined);
      if (matched) {
        inspectedTopic.value = matched;
      }
    }

    if (res.clusterModeUsed === "neural") {
      refreshNeuralCacheStatus();
    }
  } catch (err) {
    console.error("Failed to run listen hots analysis in background:", err);
  } finally {
    isComputing.value = false;
    isTopicsComputing.value = false;
  }
}

// ---------------------------------------------------------------------------
// Channel Metadata Cache Helper
// ---------------------------------------------------------------------------
const localChannelMetaMap = ref<Record<string, any>>({});
const fetchingChannelsSet = new Set<string>();

function getChannelMeta(username: string): any {
  if (!username) return undefined;
  const clean = username.replace(/^@/, "");
  if (props.channelMetadataCache?.[clean]) {
    return props.channelMetadataCache[clean];
  }
  if (localChannelMetaMap.value[clean]) {
    return localChannelMetaMap.value[clean];
  }

  fetchChannelMetadataAsync(clean);
  return undefined;
}

async function fetchChannelMetadataAsync(cleanUsername: string) {
  if (!cleanUsername || fetchingChannelsSet.has(cleanUsername)) return;
  fetchingChannelsSet.add(cleanUsername);

  try {
    let metaRes = await fetch(`https://i.gogingko.net/api/v1/v/telegram-channel/${cleanUsername}`);
    if (metaRes.status === 404 && cleanUsername.startsWith("-100")) {
      metaRes = await fetch(`https://i.gogingko.net/api/v1/v/telegram-channel/${cleanUsername.slice(4)}`);
    }
    if (metaRes.ok) {
      const data = await metaRes.json();
      localChannelMetaMap.value[cleanUsername] = data;
      if (props.channelMetadataCache) {
        props.channelMetadataCache[cleanUsername] = data;
      }
    }
  } catch (err) {
    console.warn("Channel meta fetch failed for", cleanUsername, err);
  } finally {
    fetchingChannelsSet.delete(cleanUsername);
  }
}

function handleDateRangeChange(range: HotsDateRange) {
  clearPendingRecalculation();
  dismissDayRolloverNotice();
  const currentDayKey = getLocalCalendarDayKey();
  const dayChanged = currentDayKey !== activeCalendarDayKey.value;
  if (dayChanged) {
    activeCalendarDayKey.value = currentDayKey;
    clearHotsAnalysisCache();
    scheduleNextMidnightCheck();
  }
  selectedDateRange.value = range;
  localStorage.setItem(DATE_RANGE_STORAGE_KEY, range);
  localStorage.setItem(DATE_RANGE_DAY_STORAGE_KEY, currentDayKey);
  runAnalysis(dayChanged);
}

function selectClusterMode(mode: HotsClusterMode) {
  if (mode === "ai" && !serverHasGemini.value && !geminiApiKey.value) {
    apiKeyInput.value = "";
    isApiKeyModalOpen.value = true;
    return;
  }
  if (selectedClusterMode.value === mode) return;
  selectedClusterMode.value = mode;
  localStorage.setItem("listen_hots_cluster_mode", mode);
  localStorage.setItem("listen_hots_ai_mode", mode === "ai" ? "true" : "false");
  needsNeuralModelDownload.value = null;
  runAnalysis();
}

function downloadAndRefineNeural() {
  needsNeuralModelDownload.value = null;
  runAnalysis(true, true);
}

function abortNeuralTask() {
  abortHotsEmbedWorker();
  isWarmingUpModel.value = false;
  isTopicsComputing.value = false;
  isComputing.value = false;
}

async function openEmbedCacheModal() {
  embedActionFeedback.value = "";
  isEmbedCacheModalOpen.value = true;
  await refreshNeuralCacheStatus();
}

function handleExecutorChange(pref: HotsEmbedExecutorPreference) {
  executorPreference.value = pref;
  localStorage.setItem("listen_hots_embed_executor", pref);
}

async function handleWarmupEmbedModel() {
  if (isWarmingUpModel.value) return;
  isWarmingUpModel.value = true;
  embedActionFeedback.value = "";
  try {
    const res = await warmupHotsEmbedModel(executorPreference.value, p => {
      computeProgress.value = p;
    });
    await refreshNeuralCacheStatus();
    needsNeuralModelDownload.value = null;
    embedActionFeedback.value = `Model ready via ${res.provider.toUpperCase()}.`;
    if (selectedClusterMode.value === "neural") {
      runAnalysis(true, true);
    }
  } catch (err: any) {
    embedActionFeedback.value = err?.message || "Model download failed.";
  } finally {
    isWarmingUpModel.value = false;
  }
}

async function handleClearEmbedCache() {
  if (isClearingEmbedCache.value) return;
  isClearingEmbedCache.value = true;
  embedActionFeedback.value = "";
  try {
    await clearHotsEmbedAndVectorCache();
    await refreshNeuralCacheStatus();
    needsNeuralModelDownload.value = null;
    embedActionFeedback.value = t("listen.hots.embedCacheCleared") || "Local model & vector caches cleared.";
    if (selectedClusterMode.value === "neural") {
      runAnalysis(true, false);
    }
  } catch (err: any) {
    embedActionFeedback.value = err?.message || "Failed clearing cache.";
  } finally {
    isClearingEmbedCache.value = false;
  }
}

function saveApiKey() {
  const trimmed = apiKeyInput.value.trim();
  if (!trimmed) {
    geminiApiKey.value = "";
    localStorage.removeItem("gemini_api_key");
    selectedClusterMode.value = "neural";
    localStorage.setItem("listen_hots_cluster_mode", "neural");
    localStorage.setItem("listen_hots_ai_mode", "false");
    apiKeyFeedback.value = "Gemini key removed. Reverting to local neural clustering.";
    setTimeout(() => {
      isApiKeyModalOpen.value = false;
      apiKeyFeedback.value = "";
      runAnalysis();
    }, 800);
    return;
  }

  geminiApiKey.value = trimmed;
  localStorage.setItem("gemini_api_key", trimmed);
  selectedClusterMode.value = "ai";
  localStorage.setItem("listen_hots_cluster_mode", "ai");
  localStorage.setItem("listen_hots_ai_mode", "true");
  apiKeyFeedback.value = "Key saved! AI-powered clustering enabled with Gemini 3.1 Flash Lite.";
  setTimeout(() => {
    isApiKeyModalOpen.value = false;
    apiKeyFeedback.value = "";
    runAnalysis();
  }, 900);
}

// ---------------------------------------------------------------------------
// Modal & Inspection Handlers
// ---------------------------------------------------------------------------

function openDrillDown(tab: "topics" | "posts" | "channels") {
  drillDownTab.value = tab;
  drillDownSearch.value = "";
  selectedDomainFilter.value = "";
  selectedSentimentFilter.value = "";
  isDrillDownOpen.value = true;
}

function selectInspectedTopic(topic: HotTopicCluster) {
  inspectedTopic.value = topic;
  nextTick(() => {
    if (drillDownScrollRef.value) {
      drillDownScrollRef.value.scrollTop = 0;
    }
  });
  if (isNonChineseTitle(topic.title) && (!topic.titleZh || topic.titleZh === topic.title)) {
    void translateTopicTitlesOnDemand([topic]);
  }
}

function inspectTopic(topic: HotTopicCluster) {
  selectInspectedTopic(topic);
  openDrillDown("topics");
}

function inspectPost(post: HotPostItem) {
  inspectedPost.value = post;
}

function handleChannelClick(channelId: string) {
  if (!channelId) return;
  emit("select-channel", channelId);
  isDrillDownOpen.value = false;
  inspectedPost.value = null;
}

function handlePostJump(post: HotPostItem) {
  emit("open-post", {
    channelId: post.channelId,
    postId: post.id,
    postUrl: post.url
  });
  isDrillDownOpen.value = false;
  inspectedPost.value = null;
}

// ---------------------------------------------------------------------------
// Helpers: Formatting
// ---------------------------------------------------------------------------

function formatNumber(num: number): string {
  if (num >= 1_000_000) {
    return (num / 1_000_000).toFixed(1) + "M";
  }
  if (num >= 10_000) {
    return (num / 1_000).toFixed(1) + "K";
  }
  return num.toLocaleString();
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return "0 MB";
  const mb = bytes / (1024 * 1024);
  if (mb < 0.1) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${mb.toFixed(1)} MB`;
}

function formatRelativeTime(timestamp: number): string {
  if (!timestamp) return "";
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function getTagBadgeClass(type: string): string {
  switch (type) {
    case 'person':
      return 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border-blue-200/60 dark:border-blue-800/60';
    case 'entity':
      return 'bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border-purple-200/60 dark:border-purple-800/60';
    case 'fact':
      return 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200/60 dark:border-emerald-800/60';
    case 'option':
      return 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border-amber-200/60 dark:border-amber-800/60';
    case 'keyword':
    default:
      return 'bg-gray-100 dark:bg-gray-700/60 text-gray-700 dark:text-gray-300 border-gray-200/60 dark:border-gray-600/60';
  }
}

function getSentimentBadgeClass(sentiment?: TopicSentimentLabel): string {
  switch (sentiment) {
    case 'positive':
      return 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200/80 dark:border-emerald-800/60';
    case 'negative':
      return 'bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border-rose-200/80 dark:border-rose-800/60';
    case 'neutral':
    default:
      return 'bg-slate-100 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 border-slate-200/80 dark:border-slate-700/70';
  }
}

function getSentimentLabel(sentiment?: TopicSentimentLabel): string {
  switch (sentiment) {
    case 'positive':
      return t('listen.hots.sentimentPositive') || 'Positive';
    case 'negative':
      return t('listen.hots.sentimentNegative') || 'Negative';
    case 'neutral':
    default:
      return t('listen.hots.sentimentNeutral') || 'Neutral';
  }
}

function getSentimentTooltip(topic: HotTopicCluster): string {
  const label = getSentimentLabel(topic.sentiment);
  const score = typeof topic.sentimentScore === 'number'
    ? ` (${topic.sentimentScore > 0 ? '+' : ''}${topic.sentimentScore.toFixed(2)})`
    : '';
  const b = topic.sentimentBreakdown;
  if (b) {
    return `${t('listen.hots.sentimentLabel') || 'Sentiment'}: ${label}${score} · ${b.positive} ${t('listen.hots.sentimentPositive') || 'Positive'}, ${b.neutral} ${t('listen.hots.sentimentNeutral') || 'Neutral'}, ${b.negative} ${t('listen.hots.sentimentNegative') || 'Negative'}`;
  }
  return `${t('listen.hots.sentimentLabel') || 'Sentiment'}: ${label}${score}`;
}

// ---------------------------------------------------------------------------
// Lifecycle & Reactive Watchers (Incremental Computing & Smart Date Filtering)
// ---------------------------------------------------------------------------

function doesSyncEventMatchDateRange(event: ListenDbSyncPayload | undefined, range: HotsDateRange): boolean {
  if (!event) return true; // Fallback to safe trigger if event details omitted
  if (range === 'all') return true;
  if (event.count === 0) return false;

  // If min and max post timestamp are both 0 (no timestamps found), allow to be safe
  if (event.minPostTimestamp === 0 && event.maxPostTimestamp === 0) return true;

  const bounds = getDateRangeBounds(range);
  // Perform check on the received posts' date to filter out unmatched posts with respect to current date range selector
  if (event.maxPostTimestamp < bounds.start || event.minPostTimestamp > bounds.end) {
    return false;
  }
  return true;
}

function clearPendingRecalculation() {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (maxWaitTimer) {
    clearTimeout(maxWaitTimer);
    maxWaitTimer = null;
  }
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
  isRecalculationPending.value = false;
  pendingCountdownSeconds.value = 0;
  pendingBatchesCount.value = 0;
}

function scheduleNextMidnightCheck() {
  if (midnightTimer) {
    clearTimeout(midnightTimer);
    midnightTimer = null;
  }
  const now = new Date();
  const nextMidnight = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
    0,
    0,
    1,
    0
  ).getTime();
  const delayMs = Math.max(1000, Math.min(nextMidnight - now.getTime(), 24 * 60 * 60 * 1000));
  midnightTimer = setTimeout(() => {
    midnightTimer = null;
    checkAndHandleCalendarDayChange();
    scheduleNextMidnightCheck();
  }, delayMs);
}

/**
 * Detects whether wall-clock local calendar date has moved forward since the page was opened
 * or since the current relative date-range analysis was computed.
 * When detected, resets relative filters (Today / Yesterday / Last 3 Days / Last Week) back to
 * Today, clears stale day caches, and forces a fresh hot-topic recalculation.
 */
function checkAndHandleCalendarDayChange(): boolean {
  const currentDayKey = getLocalCalendarDayKey();
  const resultComputedDayKey =
    analysisResult.value?.computedAt
      ? getLocalCalendarDayKey(new Date(analysisResult.value.computedAt))
      : null;

  const isStaleRelativeResult =
    isRelativeCalendarDateRange(selectedDateRange.value) &&
    resultComputedDayKey !== null &&
    resultComputedDayKey !== currentDayKey;

  if (currentDayKey === activeCalendarDayKey.value && !isStaleRelativeResult) {
    return false;
  }

  activeCalendarDayKey.value = currentDayKey;
  clearHotsAnalysisCache();
  clearPendingRecalculation();
  scheduleNextMidnightCheck();

  if (isRelativeCalendarDateRange(selectedDateRange.value)) {
    selectedDateRange.value = "today";
    localStorage.setItem(DATE_RANGE_STORAGE_KEY, "today");
    localStorage.setItem(DATE_RANGE_DAY_STORAGE_KEY, currentDayKey);
    inspectedTopic.value = null;
    inspectedPost.value = null;
    analysisResult.value = null;
    showDayRolloverNotice(formatHotsDateRangeSummary("today"));
    runAnalysis(true);
    return true;
  }

  localStorage.setItem(DATE_RANGE_DAY_STORAGE_KEY, currentDayKey);
  return false;
}

function handleWindowResumeOrFocus() {
  if (typeof document !== "undefined" && document.visibilityState === "hidden") {
    return;
  }
  checkAndHandleCalendarDayChange();
}

function triggerImmediateRecalculation() {
  clearPendingRecalculation();
  if (checkAndHandleCalendarDayChange()) {
    return;
  }
  runAnalysis(true);
}

function scheduleDeferredRecalculation() {
  isRecalculationPending.value = true;
  pendingBatchesCount.value++;
  pendingCountdownSeconds.value = Math.round(DEBOUNCE_DELAY_MS / 1000);

  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  // Trailing debounce timer (triggered a little later when receiving new posts)
  debounceTimer = setTimeout(() => {
    executePendingRecalculation();
  }, DEBOUNCE_DELAY_MS);

  // Leading max-wait boundary timer
  if (!maxWaitTimer) {
    maxWaitTimer = setTimeout(() => {
      executePendingRecalculation();
    }, MAX_WAIT_MS);
  }

  // Countdown timer interval for live UI feedback
  if (!countdownInterval) {
    countdownInterval = setInterval(() => {
      if (pendingCountdownSeconds.value > 1) {
        pendingCountdownSeconds.value--;
      }
    }, 1000);
  }
}

function executePendingRecalculation() {
  clearPendingRecalculation();
  if (checkAndHandleCalendarDayChange()) {
    return;
  }
  runAnalysis(false);
}

// Watch for background database updates from listen sync with date range filtering & extended debounce
watch(
  () => props.lastDbSyncEvent,
  (syncEvent) => {
    if (!syncEvent) return;

    // Detect day rollover before checking date bounds so incoming posts for the new day aren't discarded
    if (checkAndHandleCalendarDayChange()) {
      return;
    }

    // Perform check on the received posts' date to filter out unmatched posts with respect to current date range
    if (!doesSyncEventMatchDateRange(syncEvent, selectedDateRange.value)) {
      // Discard event: new posts do not fall within the active date range
      return;
    }

    // Trigger calculation later when receiving new fetched posts
    scheduleDeferredRecalculation();
  }
);

// Fallback watch for direct timestamp updates if lastDbSyncEvent wasn't provided
watch(
  () => props.lastDbUpdate,
  (newVal) => {
    if (!newVal || props.lastDbSyncEvent) return;
    if (checkAndHandleCalendarDayChange()) {
      return;
    }
    scheduleDeferredRecalculation();
  }
);

onMounted(() => {
  checkServerGeminiStatus();
  refreshNeuralCacheStatus();
  scheduleNextMidnightCheck();

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", handleWindowResumeOrFocus);
  }
  if (typeof window !== "undefined") {
    window.addEventListener("focus", handleWindowResumeOrFocus);
    window.addEventListener("pageshow", handleWindowResumeOrFocus);
  }
  // 60s wall-clock heartbeat catches OS sleep/wake and throttled timers across days
  dayCheckInterval = setInterval(() => {
    checkAndHandleCalendarDayChange();
  }, 60_000);

  if (initialDateRolloverReset) {
    showDayRolloverNotice(formatHotsDateRangeSummary("today"));
  }

  // Instant restore from day-validated in-memory cache if available (0ms render time)
  const cached = initialDateRolloverReset
    ? undefined
    : getCachedHotsAnalysis(selectedDateRange.value, effectiveClusterMode.value);
  if (cached) {
    analysisResult.value = cached;
  }

  const shouldForceInitial = initialDateRolloverReset;
  initialDateRolloverReset = false;

  // Defer background computing slightly so main UI paint completes without any frame drops
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => {
      setTimeout(() => {
        runAnalysis(shouldForceInitial);
      }, 50);
    });
  } else {
    setTimeout(() => {
      runAnalysis(shouldForceInitial);
    }, 50);
  }
});

// Lazy on-the-fly title translation for tail topics scrolled into view in Drill-Down Modal
const drillDownScrollRef = ref<HTMLElement | null>(null);
let topicTranslateObserver: IntersectionObserver | null = null;
let lazyTranslateTimer: ReturnType<typeof setTimeout> | null = null;
const pendingLazyTopicsMap = new Map<string, HotTopicCluster>();
let isFlushingLazyTranslations = false;

async function flushLazyTitleTranslations() {
  if (isFlushingLazyTranslations || pendingLazyTopicsMap.size === 0) return;
  isFlushingLazyTranslations = true;
  try {
    while (pendingLazyTopicsMap.size > 0) {
      const batch = Array.from(pendingLazyTopicsMap.values()).slice(0, 10);
      for (const item of batch) {
        pendingLazyTopicsMap.delete(item.id);
      }
      await translateTopicTitlesOnDemand(batch);
    }
  } finally {
    isFlushingLazyTranslations = false;
  }
}

function enqueueLazyTopicTranslation(topic: HotTopicCluster) {
  if (!isNonChineseTitle(topic.title)) return;
  if (topic.titleZh && topic.titleZh !== topic.title) return;
  if (pendingLazyTopicsMap.has(topic.id)) return;
  pendingLazyTopicsMap.set(topic.id, topic);

  if (lazyTranslateTimer) clearTimeout(lazyTranslateTimer);
  lazyTranslateTimer = setTimeout(() => {
    lazyTranslateTimer = null;
    void flushLazyTitleTranslations();
  }, 150);
}

function cleanupTopicTranslateObserver() {
  if (topicTranslateObserver) {
    topicTranslateObserver.disconnect();
    topicTranslateObserver = null;
  }
}

function setupDrillDownTopicObserver() {
  cleanupTopicTranslateObserver();
  if (
    !isDrillDownOpen.value ||
    drillDownTab.value !== "topics" ||
    inspectedTopic.value ||
    !drillDownScrollRef.value ||
    typeof IntersectionObserver === "undefined"
  ) {
    return;
  }

  const topicsById = new Map<string, HotTopicCluster>();
  for (const tp of filteredDrillDownTopics.value) {
    topicsById.set(tp.id, tp);
  }

  topicTranslateObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const el = entry.target as HTMLElement;
        const topicId = el.dataset.topicId;
        topicTranslateObserver?.unobserve(el);
        if (!topicId) continue;
        const topic = topicsById.get(topicId);
        if (topic) {
          enqueueLazyTopicTranslation(topic);
        }
      }
    },
    {
      root: drillDownScrollRef.value,
      rootMargin: "180px 0px",
      threshold: 0.01
    }
  );

  const cards = drillDownScrollRef.value.querySelectorAll<HTMLElement>("[data-topic-id]");
  cards.forEach((card) => topicTranslateObserver?.observe(card));
}

watch(
  [isDrillDownOpen, drillDownTab, () => inspectedTopic.value, () => filteredDrillDownTopics.value],
  async () => {
    if (!isDrillDownOpen.value) {
      cleanupTopicTranslateObserver();
      return;
    }
    await nextTick();
    setupDrillDownTopicObserver();
  }
);

onUnmounted(() => {
  clearPendingRecalculation();
  cleanupTopicTranslateObserver();
  dismissDayRolloverNotice();
  if (midnightTimer) {
    clearTimeout(midnightTimer);
    midnightTimer = null;
  }
  if (dayCheckInterval) {
    clearInterval(dayCheckInterval);
    dayCheckInterval = null;
  }
  if (typeof document !== "undefined") {
    document.removeEventListener("visibilitychange", handleWindowResumeOrFocus);
  }
  if (typeof window !== "undefined") {
    window.removeEventListener("focus", handleWindowResumeOrFocus);
    window.removeEventListener("pageshow", handleWindowResumeOrFocus);
  }
  if (lazyTranslateTimer) {
    clearTimeout(lazyTranslateTimer);
    lazyTranslateTimer = null;
  }
});
</script>

<template>
  <div class="space-y-6 w-full max-w-full">
    <!-- Top Executive Control Strip -->
    <div class="bg-white dark:bg-gray-800 rounded-3xl border border-gray-200/80 dark:border-gray-700/80 shadow-sm p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
      <!-- Left: Header info & Date Ranges -->
      <div class="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 flex-wrap min-w-0">
        <div class="flex items-center gap-2.5">
          <div class="h-9 w-9 rounded-2xl bg-gradient-to-tr from-amber-500/20 to-orange-500/20 border border-amber-300/60 dark:border-amber-700/60 flex items-center justify-center text-amber-600 dark:text-amber-400 shrink-0">
            <Flame class="h-5 w-5" />
          </div>
          <div>
            <h3 class="text-base sm:text-lg font-black text-gray-900 dark:text-white tracking-tight">
              {{ t('listen.hots.title') || 'Hot Intelligence & Trends' }}
            </h3>
            <div class="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 flex-wrap">
              <span v-if="analysisResult" class="flex items-center gap-1.5 font-mono tabular-nums flex-wrap">
                <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-teal-50 dark:bg-teal-950/70 text-teal-700 dark:text-teal-300 font-bold border border-teal-200/70 dark:border-teal-800/70">
                  {{ formatNumber(analysisResult.filteredPostsCount) }} in range
                </span>
                <span
                  v-if="analysisResult.meaninglessPostsCount != null"
                  class="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 font-medium border border-amber-200/60 dark:border-amber-800/60"
                  :title="'Filtered out media-only or short text posts'"
                >
                  <span class="inline-block w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                  {{ formatNumber(analysisResult.meaninglessPostsCount) }} meaningless filtered
                </span>
                <span class="text-gray-400 dark:text-gray-500">/</span>
                <span class="text-gray-600 dark:text-gray-300 font-medium">
                  {{ formatNumber(analysisResult.totalPostsAnalyzed) }} total cached
                </span>
                <span aria-hidden="true" class="text-gray-300 dark:text-gray-600">·</span>
                <span>{{ analysisResult.activeChannelsCount }} channels</span>
              </span>
              <span v-else>
                {{ t('listen.hots.subtitle') || 'Aggregating local posts from IndexedDB' }}
              </span>
            </div>
          </div>
        </div>

        <!-- 4+ Date Range Buttons Segmented Control -->
        <div class="flex items-center gap-2 flex-wrap max-w-full">
          <div class="flex items-center gap-1 bg-gray-100/90 dark:bg-gray-900/70 p-1 rounded-2xl border border-gray-200/60 dark:border-gray-700/60 overflow-x-auto max-w-full">
            <button
              type="button"
              @click="handleDateRangeChange('today')"
              :title="dateRangeTooltips.today"
              class="px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap shrink-0"
              :class="[
                selectedDateRange === 'today'
                  ? 'bg-white dark:bg-gray-800 text-teal-600 dark:text-teal-400 shadow-xs'
                  : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
              ]"
            >
              {{ t('listen.hots.today') || 'Today' }}
            </button>
            <button
              type="button"
              @click="handleDateRangeChange('yesterday')"
              :title="dateRangeTooltips.yesterday"
              class="px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap shrink-0"
              :class="[
                selectedDateRange === 'yesterday'
                  ? 'bg-white dark:bg-gray-800 text-teal-600 dark:text-teal-400 shadow-xs'
                  : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
              ]"
            >
              {{ t('listen.hots.yesterday') || 'Yesterday' }}
            </button>
            <button
              type="button"
              @click="handleDateRangeChange('3days')"
              :title="dateRangeTooltips['3days']"
              class="px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap shrink-0"
              :class="[
                selectedDateRange === '3days'
                  ? 'bg-white dark:bg-gray-800 text-teal-600 dark:text-teal-400 shadow-xs'
                  : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
              ]"
            >
              {{ t('listen.hots.last3Days') || 'Last 3 Days' }}
            </button>
            <button
              type="button"
              @click="handleDateRangeChange('week')"
              :title="dateRangeTooltips.week"
              class="px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap shrink-0"
              :class="[
                selectedDateRange === 'week'
                  ? 'bg-white dark:bg-gray-800 text-teal-600 dark:text-teal-400 shadow-xs'
                  : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
              ]"
            >
              {{ t('listen.hots.lastWeek') || 'Last Week' }}
            </button>
            <button
              type="button"
              @click="handleDateRangeChange('all')"
              class="px-2.5 py-1.5 rounded-xl text-xs font-medium transition-all cursor-pointer whitespace-nowrap shrink-0"
              :class="[
                selectedDateRange === 'all'
                  ? 'bg-white dark:bg-gray-800 text-teal-600 dark:text-teal-400 shadow-xs'
                  : 'text-gray-400 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-300'
              ]"
            >
              {{ t('listen.hots.allTime') || 'All Time' }}
            </button>
          </div>
          <span
            v-if="activeDateRangeSummary"
            class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[11px] font-mono font-semibold bg-gray-100/90 dark:bg-gray-900/70 text-gray-600 dark:text-gray-300 border border-gray-200/70 dark:border-gray-700/60 tabular-nums whitespace-nowrap"
          >
            <Calendar class="h-3 w-3 text-teal-600 dark:text-teal-400 shrink-0" />
            <span>{{ activeDateRangeSummary }}</span>
          </span>
        </div>
      </div>

      <!-- Right: 3-Mode Clustering Selector, Cache Settings & Refresh Button -->
      <div class="flex items-center gap-2 self-end sm:self-auto shrink-0 flex-wrap">
        <!-- 3-Mode Clustering Segmented Control -->
        <div
          class="flex items-center gap-0.5 bg-gray-100/90 dark:bg-gray-900/70 p-1 rounded-2xl border border-gray-200/70 dark:border-gray-700/70"
          role="group"
        >
          <button
            type="button"
            @click="selectClusterMode('rule')"
            class="flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap shrink-0"
            :class="[
              selectedClusterMode === 'rule'
                ? 'bg-white dark:bg-gray-800 text-teal-600 dark:text-teal-400 shadow-xs'
                : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
            ]"
            :title="t('listen.hots.modeRuleTooltip') || 'Instant multilingual TF-IDF + SimHash statistical clustering'"
          >
            <Zap class="h-3 w-3" />
            <span>{{ t('listen.hots.modeRule') || 'Fast Rule' }}</span>
          </button>

          <button
            type="button"
            @click="selectClusterMode('neural')"
            class="flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap shrink-0"
            :class="[
              selectedClusterMode === 'neural'
                ? 'bg-white dark:bg-gray-800 text-cyan-600 dark:text-cyan-400 shadow-xs'
                : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
            ]"
            :title="t('listen.hots.modeNeuralTooltip') || 'Instant preview refined locally with MiniLM multilingual ONNX sentence embeddings'"
          >
            <Cpu class="h-3 w-3" />
            <span>{{ t('listen.hots.modeNeural') || 'Neural Local' }}</span>
          </button>

          <button
            type="button"
            @click="selectClusterMode('ai')"
            class="flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap shrink-0"
            :class="[
              selectedClusterMode === 'ai' && (serverHasGemini || geminiApiKey)
                ? 'bg-white dark:bg-gray-800 text-indigo-600 dark:text-indigo-400 shadow-xs'
                : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
            ]"
            :title="serverHasGemini || geminiApiKey ? t('listen.hots.aiClusteringActive') : t('listen.hots.aiClusteringTooltip')"
          >
            <Sparkles class="h-3 w-3" />
            <span>{{ t('listen.hots.modeAi') || 'Gemini AI' }}</span>
          </button>

          <button
            type="button"
            @click.stop="isApiKeyModalOpen = true"
            class="ml-0.5 px-1.5 py-1 rounded-xl text-[11px] font-semibold text-gray-500 hover:text-indigo-600 dark:text-gray-400 dark:hover:text-indigo-400 cursor-pointer whitespace-nowrap shrink-0"
            :title="t('listen.hots.geminiTokenModalTitle') || 'Configure Gemini Key'"
          >
            <Key class="h-3 w-3" />
          </button>
        </div>

        <!-- Local Embedding Cache Modal Trigger -->
        <button
          type="button"
          @click="openEmbedCacheModal"
          class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-2xl text-xs font-bold bg-white hover:bg-gray-50 dark:bg-gray-800 dark:hover:bg-gray-700/70 text-gray-700 dark:text-gray-200 border border-gray-200/80 dark:border-gray-700/80 transition-all cursor-pointer select-none shadow-2xs whitespace-nowrap shrink-0"
          :title="t('listen.hots.embedCacheTitle') || 'Local Embedding Model & Vector Cache'"
        >
          <Database
            class="h-3.5 w-3.5"
            :class="neuralCacheStatus?.isCached ? 'text-cyan-600 dark:text-cyan-400' : 'text-gray-400 dark:text-gray-500'"
          />
          <span class="hidden xl:inline">{{ t('listen.hots.embedCacheBtn') || 'Model Cache' }}</span>
        </button>

        <!-- Pending Recalculation Notification Chip & Instant Update Trigger -->
        <div
          v-if="isRecalculationPending && !isComputing"
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-2xl bg-amber-50 dark:bg-amber-950/60 border border-amber-200/80 dark:border-amber-800/80 text-amber-800 dark:text-amber-200 text-xs font-semibold shadow-2xs"
        >
          <span class="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
          <span class="whitespace-nowrap">
            New posts synced · Updating in {{ pendingCountdownSeconds }}s
          </span>
          <button
            type="button"
            @click="triggerImmediateRecalculation"
            class="ml-1 px-2 py-0.5 rounded-xl bg-amber-200/80 hover:bg-amber-300 dark:bg-amber-900/80 dark:hover:bg-amber-800 text-amber-900 dark:text-amber-100 text-[11px] font-bold cursor-pointer transition-colors whitespace-nowrap active:scale-95 shrink-0"
            title="Update hot topics immediately"
          >
            Update now
          </button>
        </div>

        <!-- Refresh / Recompute Button -->
        <button
          type="button"
          @click="triggerImmediateRecalculation"
          :disabled="isComputing"
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-2xl text-xs font-bold bg-white hover:bg-teal-50 dark:bg-gray-800 dark:hover:bg-gray-700 text-teal-700 dark:text-teal-300 border border-teal-200/80 dark:border-teal-800/60 transition-all cursor-pointer select-none shadow-2xs active:scale-95 disabled:opacity-50 whitespace-nowrap shrink-0"
          :title="t('listen.hots.refresh') || 'Re-calculate'"
        >
          <RefreshCw class="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" :class="{ 'animate-spin': isComputing }" />
          <span class="hidden sm:inline">{{ t('listen.hots.refresh') || 'Re-calculate' }}</span>
        </button>
      </div>
    </div>

    <!-- Automatic Wall-Clock Date Rollover Notice -->
    <div
      v-if="dayRolloverNotice"
      role="status"
      aria-live="polite"
      class="w-full bg-teal-50/90 dark:bg-teal-950/40 border border-teal-200/80 dark:border-teal-800/60 rounded-2xl px-4 py-2.5 flex items-center justify-between gap-3 text-xs font-semibold text-teal-900 dark:text-teal-200"
    >
      <div class="flex items-center gap-2 min-w-0">
        <Calendar class="h-3.5 w-3.5 text-teal-600 dark:text-teal-400 shrink-0" />
        <span class="truncate">{{ dayRolloverNotice }}</span>
      </div>
      <button
        type="button"
        @click="dismissDayRolloverNotice"
        class="p-0.5 rounded-lg text-teal-600 dark:text-teal-300 hover:bg-teal-100 dark:hover:bg-teal-900/60 transition-colors cursor-pointer shrink-0"
        :aria-label="t('common.close') || 'Close'"
      >
        <X class="h-3.5 w-3.5" />
      </button>
    </div>

    <!-- Progressive Computing Progress Bar (Initial Cold Load Only) -->
    <div v-if="isComputing && !analysisResult" class="w-full bg-teal-50 dark:bg-teal-950/40 border border-teal-200/70 dark:border-teal-800/60 rounded-2xl p-3 flex items-center justify-between gap-3">
      <div class="flex items-center gap-2 text-xs font-bold text-teal-900 dark:text-teal-200 truncate">
        <RefreshCw class="h-3.5 w-3.5 animate-spin text-teal-600 dark:text-teal-400 shrink-0" />
        <span class="truncate">{{ computeProgress.message }}</span>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <span class="text-xs font-mono font-bold text-teal-700 dark:text-teal-300 tabular-nums">
          {{ computeProgress.percent }}%
        </span>
        <button
          v-if="computeProgress.step === 'embedding_download' || computeProgress.step === 'embedding'"
          type="button"
          @click="abortNeuralTask"
          class="px-2 py-0.5 rounded-lg text-[11px] font-bold bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 border border-teal-200 dark:border-teal-700 hover:bg-gray-50 cursor-pointer whitespace-nowrap"
        >
          {{ t('listen.hots.abortDownload') || 'Abort' }}
        </button>
      </div>
    </div>

    <!-- Empty State -->
    <div
      v-if="!isComputing && analysisResult && analysisResult.hotPosts.length === 0"
      class="bg-white dark:bg-gray-800 rounded-3xl border border-gray-200/80 dark:border-gray-700/80 p-12 text-center flex flex-col items-center justify-center max-w-xl mx-auto space-y-3"
    >
      <div class="h-12 w-12 rounded-2xl bg-gray-100 dark:bg-gray-700/50 flex items-center justify-center text-gray-400 dark:text-gray-500">
        <Clock class="h-6 w-6" />
      </div>
      <h4 class="text-base font-bold text-gray-900 dark:text-white">
        {{ t('listen.hots.noPostsFound') || 'No cached posts found in this date range.' }}
      </h4>
      <p class="text-xs text-gray-500 dark:text-gray-400 leading-relaxed max-w-md">
        {{ t('listen.hots.noPostsHint') || 'Enable background sync or click Sync All in the top bar to fetch recent posts into your local cache.' }}
      </p>
    </div>

    <!-- Trend Line Chart: Volume of Posts Over Time (Recharts) -->
    <PostVolumeTrendCard
      v-if="analysisResult && analysisResult.hotPosts.length > 0"
      :posts="analysisResult.hotPosts"
      :date-range="effectiveChartDateRange"
      :day-key="activeCalendarDayKey"
      :is-dark="isDark"
      :is-computing="isComputing"
    />

    <!-- Main 3-Column Bento Grid: Hot Topics, Hot Posts, Hot Channels -->
    <div
      v-if="analysisResult && analysisResult.hotPosts.length > 0"
      class="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start w-full"
    >
      <!-- =================================================================== -->
      <!-- COLUMN 1: HOT TOPICS                                               -->
      <!-- =================================================================== -->
      <div class="bg-white dark:bg-gray-800 rounded-3xl border border-gray-200/80 dark:border-gray-700/80 shadow-sm overflow-hidden flex flex-col">
        <!-- Section Header -->
        <div class="p-4 sm:p-5 border-b border-gray-100 dark:border-gray-700/80 bg-gray-50/50 dark:bg-gray-800/40 flex items-center justify-between gap-3">
          <div class="flex items-center gap-2.5 min-w-0">
            <div class="h-8 w-8 rounded-xl bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 border border-amber-200/60 dark:border-amber-800/60 flex items-center justify-center shrink-0">
              <Flame class="h-4 w-4" />
            </div>
            <div class="min-w-0">
              <h4 class="text-sm font-black text-gray-900 dark:text-white truncate">
                {{ t('listen.hots.hotTopics') || 'Hot Topics' }}
              </h4>
              <p class="text-[11px] text-gray-400 dark:text-gray-500 font-mono tabular-nums truncate">
                <span v-if="isTopicsComputing" class="text-amber-600 dark:text-amber-400 font-medium inline-flex items-center gap-1">
                  <RefreshCw class="h-2.5 w-2.5 animate-spin" />
                  Clustering in background...
                </span>
                <span v-else>
                  {{ analysisResult.hotTopics.length }} topics · {{ formatNumber(analysisResult.substantivePostsCount || (analysisResult.filteredPostsCount - (analysisResult.meaninglessPostsCount || 0))) }} posts
                </span>
              </p>
            </div>
          </div>
          <button
            type="button"
            @click="openDrillDown('topics')"
            class="text-xs font-bold text-teal-600 dark:text-teal-400 hover:text-teal-700 dark:hover:text-teal-300 flex items-center gap-1 cursor-pointer transition-colors"
          >
            <span>{{ t('listen.hots.viewAllTopics') || 'View All' }}</span>
            <ArrowRight class="h-3 w-3" />
          </button>
        </div>

        <!-- Topics Cards List (Top 5) -->
        <div class="p-4 space-y-3 divide-y divide-gray-100 dark:divide-gray-700/50">
          <!-- Stage-2 Neural Refinement Progress Banner (when Stage-1 preview is visible) -->
          <div
            v-if="isTopicsComputing && analysisResult.hotTopics.length > 0"
            class="mb-2 p-2.5 rounded-xl bg-cyan-50/80 dark:bg-cyan-950/40 border border-cyan-200/70 dark:border-cyan-800/60 text-[11px] text-cyan-900 dark:text-cyan-200 space-y-1.5"
          >
            <div class="flex items-center justify-between gap-2">
              <span class="inline-flex items-center gap-1.5 font-semibold truncate">
                <RefreshCw class="h-3 w-3 animate-spin text-cyan-600 dark:text-cyan-400 shrink-0" />
                <span class="truncate">{{ computeProgress.message || (t('listen.hots.neuralRefining') || 'Refining clusters with neural embeddings...') }}</span>
              </span>
              <div class="flex items-center gap-2 shrink-0">
                <span
                  v-if="computeProgress.step === 'embedding_download' && computeProgress.totalBytes"
                  class="font-mono text-[10px] text-cyan-700 dark:text-cyan-300 tabular-nums"
                >
                  {{ formatBytes(computeProgress.loadedBytes) }} / {{ formatBytes(computeProgress.totalBytes) }}
                </span>
                <span class="font-mono font-bold tabular-nums">{{ computeProgress.percent }}%</span>
                <button
                  v-if="computeProgress.step === 'embedding_download' || computeProgress.step === 'embedding'"
                  type="button"
                  @click.stop="abortNeuralTask"
                  class="px-1.5 py-0.5 rounded-md bg-white dark:bg-gray-800 border border-cyan-300/70 dark:border-cyan-700/70 text-[10px] font-bold text-gray-700 dark:text-gray-200 hover:bg-gray-50 cursor-pointer whitespace-nowrap"
                >
                  {{ t('listen.hots.abortDownload') || 'Abort' }}
                </button>
              </div>
            </div>
            <div class="h-1 w-full rounded-full bg-cyan-200/60 dark:bg-cyan-900/60 overflow-hidden">
              <div
                class="h-full bg-cyan-600 dark:bg-cyan-400 transition-all duration-200"
                :style="{ width: `${Math.min(100, Math.max(4, computeProgress.percent))}%` }"
              ></div>
            </div>
          </div>

          <!-- Non-blocking 1-click Neural Model Download Prompt (keeps Stage-1 preview interactive) -->
          <div
            v-else-if="!isTopicsComputing && selectedClusterMode === 'neural' && needsNeuralModelDownload"
            class="mb-2 p-3 rounded-2xl bg-cyan-50/80 dark:bg-cyan-950/35 border border-cyan-200/80 dark:border-cyan-800/60 flex flex-col gap-2"
          >
            <div class="flex items-start gap-2">
              <Cpu class="h-4 w-4 text-cyan-600 dark:text-cyan-400 shrink-0 mt-0.5" />
              <div class="min-w-0 flex-1">
                <p class="text-xs font-bold text-gray-900 dark:text-white">
                  {{ t('listen.hots.neuralDownloadPromptTitle') || 'Stage-1 preview ready · Refine locally with MiniLM embeddings' }}
                </p>
                <p class="text-[11px] text-gray-600 dark:text-gray-300 mt-0.5 leading-snug">
                  {{ t('listen.hots.neuralDownloadPromptDesc') || 'One-time ~113 MB multilingual ONNX download cached offline in your browser for ZH/EN/RU/JA clustering.' }}
                </p>
              </div>
            </div>
            <div class="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                @click="downloadAndRefineNeural"
                class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-cyan-600 hover:bg-cyan-700 text-white cursor-pointer transition-colors whitespace-nowrap shrink-0"
              >
                <Download class="h-3.5 w-3.5" />
                <span>
                  {{
                    needsNeuralModelDownload.partialBytes > 0
                      ? (t('listen.hots.resumeDownloadRefine') || `Resume (${formatBytes(needsNeuralModelDownload.partialBytes)} saved) & Refine`)
                      : (t('listen.hots.downloadAndRefine') || 'Download & Refine')
                  }}
                </span>
              </button>
              <button
                type="button"
                @click="selectClusterMode('rule')"
                class="px-2.5 py-1.5 rounded-xl text-xs font-semibold text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer whitespace-nowrap shrink-0"
              >
                {{ t('listen.hots.stayFastRule') || 'Use Fast Rule' }}
              </button>
            </div>
          </div>

          <!-- Non-blocking Skeleton Loader when topics are computing for the first time -->
          <div
            v-if="isTopicsComputing && analysisResult.hotTopics.length === 0"
            class="space-y-3 py-1"
          >
            <div v-for="i in 3" :key="i" class="animate-pulse space-y-2 p-2.5 -mx-1 rounded-2xl bg-gray-50/70 dark:bg-gray-750/30">
              <div class="flex items-center gap-2">
                <div class="h-3 w-6 bg-amber-200/70 dark:bg-amber-800/50 rounded-md"></div>
                <div class="h-3 w-12 bg-gray-200 dark:bg-gray-700 rounded-md"></div>
                <div class="h-3 w-16 bg-gray-200 dark:bg-gray-700 rounded-md"></div>
              </div>
              <div class="h-4 bg-gray-200 dark:bg-gray-700 rounded-md w-5/6"></div>
              <div class="h-3 bg-gray-100 dark:bg-gray-750 rounded-md w-full"></div>
              <div class="h-2.5 bg-gray-100 dark:bg-gray-750 rounded-md w-1/3"></div>
            </div>
          </div>

          <div
            v-else-if="!isTopicsComputing && analysisResult.hotTopics.length === 0"
            class="py-8 px-3 text-center"
          >
            <p class="text-xs text-gray-500 dark:text-gray-400">
              {{ t('listen.hots.noSubstantiveTopics') || 'No substantive topics found in this range. Short messages and media-only posts are filtered out.' }}
            </p>
          </div>

          <div
            v-for="(topic, idx) in analysisResult.hotTopics.slice(0, 10)"
            :key="topic.id"
            @click="inspectTopic(topic)"
            class="pt-3 first:pt-0 group cursor-pointer hover:bg-gray-50/80 dark:hover:bg-gray-700/30 p-2.5 -mx-1 rounded-2xl transition-all"
          >
            <!-- Topic Title Header with Rank, Badges & Headline -->
            <div class="flex items-start gap-2.5 mb-1.5 min-w-0">
              <span class="text-xs font-black text-amber-600 dark:text-amber-400 font-mono tabular-nums shrink-0 mt-0.5">
                #{{ idx + 1 }}
              </span>

              <div class="min-w-0 flex-1">
                <!-- Badges Row directly in Topic Title Header -->
                <div class="flex items-center flex-wrap gap-1.5 mb-1">
                  <!-- Mode Badge -->
                  <span
                    v-if="topic.isAiGenerated || topic.clusterSource === 'ai'"
                    class="inline-flex items-center gap-1 text-[10px] font-bold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/60 px-1.5 py-0.5 rounded-md border border-indigo-200/60 dark:border-indigo-800/50 shrink-0"
                  >
                    <Sparkles class="h-2.5 w-2.5" />
                    AI
                  </span>
                  <span
                    v-else-if="topic.clusterSource === 'neural'"
                    class="inline-flex items-center gap-1 text-[10px] font-bold text-cyan-700 dark:text-cyan-300 bg-cyan-50 dark:bg-cyan-950/60 px-1.5 py-0.5 rounded-md border border-cyan-200/60 dark:border-cyan-800/50 shrink-0"
                  >
                    <Cpu class="h-2.5 w-2.5" />
                    {{ t('listen.hots.badgeNeural') || 'Neural' }}
                  </span>
                  <span
                    v-else
                    class="inline-flex items-center gap-1 text-[10px] font-bold text-teal-700 dark:text-teal-300 bg-teal-50 dark:bg-teal-950/60 px-1.5 py-0.5 rounded-md border border-teal-200/60 dark:border-teal-800/50 shrink-0"
                  >
                    {{ t('listen.hots.badgeRule') || 'Rule' }}
                  </span>

                  <!-- Category Badge -->
                  <span
                    v-if="topic.category"
                    class="text-[10px] font-bold text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700/60 px-1.5 py-0.5 rounded-md border border-gray-200/60 dark:border-gray-600/60 shrink-0"
                  >
                    {{ topic.category }}
                  </span>

                  <!-- Sentiment Indicator -->
                  <span
                    class="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-md border shrink-0"
                    :class="getSentimentBadgeClass(topic.sentiment)"
                    :title="getSentimentTooltip(topic)"
                  >
                    <Smile v-if="topic.sentiment === 'positive'" class="h-2.5 w-2.5 shrink-0" />
                    <Frown v-else-if="topic.sentiment === 'negative'" class="h-2.5 w-2.5 shrink-0" />
                    <Meh v-else class="h-2.5 w-2.5 shrink-0" />
                    <span>{{ getSentimentLabel(topic.sentiment) }}</span>
                  </span>

                  <!-- Topic Tag Badges (Person, Entity, Fact, Option, Keyword) -->
                  <span
                    v-for="(tag, tIdx) in (topic.tags || []).slice(0, 3)"
                    :key="tIdx"
                    class="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md border shrink-0 transition-all"
                    :class="getTagBadgeClass(tag.type)"
                    :title="`${tag.type}: ${tag.label}`"
                  >
                    <User v-if="tag.type === 'person'" class="h-2.5 w-2.5 opacity-80 shrink-0" />
                    <Building2 v-else-if="tag.type === 'entity'" class="h-2.5 w-2.5 opacity-80 shrink-0" />
                    <BarChart2 v-else-if="tag.type === 'fact'" class="h-2.5 w-2.5 opacity-80 shrink-0" />
                    <Scale v-else-if="tag.type === 'option'" class="h-2.5 w-2.5 opacity-80 shrink-0" />
                    <Hash v-else class="h-2.5 w-2.5 opacity-80 shrink-0" />
                    <span class="truncate max-w-[120px]">{{ tag.label }}</span>
                  </span>
                </div>

                <!-- Headline Title -->
                <h5 class="text-xs sm:text-sm font-bold text-gray-900 dark:text-white leading-snug group-hover:text-teal-600 dark:group-hover:text-teal-400 transition-colors line-clamp-2">
                  {{ topic.title }}
                </h5>

                <!-- Chinese Translation Subtitle (When original is not in Chinese) -->
                <div
                  v-if="topic.titleZh && topic.titleZh !== topic.title"
                  class="flex items-start gap-1.5 text-xs font-semibold text-teal-700 dark:text-teal-300 mt-1 mb-0.5"
                >
                  <span class="text-[9px] uppercase font-bold tracking-wider px-1 py-0.5 rounded bg-teal-100/80 dark:bg-teal-900/60 text-teal-800 dark:text-teal-200 shrink-0">
                    中译
                  </span>
                  <span class="line-clamp-1 leading-snug">
                    {{ topic.titleZh }}
                  </span>
                </div>
              </div>
            </div>

            <!-- Summary snippet -->
            <p v-if="topic.summary" class="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 mb-2 leading-relaxed">
              {{ topic.summary }}
            </p>

            <!-- Zero-Pill Unboxed Metadata Line -->
            <div class="flex items-center gap-2 text-[11px] text-gray-400 dark:text-gray-500 flex-wrap font-mono tabular-nums">
              <span class="font-bold text-gray-700 dark:text-gray-300">{{ topic.postCount }} {{ topic.postCount === 1 ? 'post' : 'posts' }}</span>
              <span aria-hidden="true">·</span>
              <span>{{ formatNumber(topic.totalViews) }} views</span>
              <span aria-hidden="true">·</span>
              <span>{{ topic.channels.length }} {{ topic.channels.length === 1 ? 'channel' : 'channels' }}</span>
              <span v-if="topic.domains.length > 0" aria-hidden="true">·</span>
              <span v-if="topic.domains.length > 0" class="text-teal-600 dark:text-teal-400 truncate max-w-[120px]">
                {{ topic.domains[0] }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- =================================================================== -->
      <!-- COLUMN 2: HOT POSTS (Sorted by Views DSC)                          -->
      <!-- =================================================================== -->
      <div class="bg-white dark:bg-gray-800 rounded-3xl border border-gray-200/80 dark:border-gray-700/80 shadow-sm overflow-hidden flex flex-col">
        <!-- Section Header -->
        <div class="p-4 sm:p-5 border-b border-gray-100 dark:border-gray-700/80 bg-gray-50/50 dark:bg-gray-800/40 flex items-center justify-between gap-3">
          <div class="flex items-center gap-2.5 min-w-0">
            <div class="h-8 w-8 rounded-xl bg-teal-50 dark:bg-teal-950/50 text-teal-600 dark:text-teal-400 border border-teal-200/60 dark:border-teal-800/60 flex items-center justify-center shrink-0">
              <Eye class="h-4 w-4" />
            </div>
            <div class="min-w-0">
              <h4 class="text-sm font-black text-gray-900 dark:text-white truncate">
                {{ t('listen.hots.hotPosts') || 'Hot Posts' }}
              </h4>
              <p class="text-[11px] text-gray-400 dark:text-gray-500 font-mono tabular-nums truncate">
                {{ formatNumber(analysisResult.filteredPostsCount) }} filtered posts · Views (DSC)
              </p>
            </div>
          </div>
          <button
            type="button"
            @click="openDrillDown('posts')"
            class="text-xs font-bold text-teal-600 dark:text-teal-400 hover:text-teal-700 dark:hover:text-teal-300 flex items-center gap-1 cursor-pointer transition-colors"
          >
            <span>{{ t('listen.hots.viewAllPosts') || 'View All' }}</span>
            <ArrowRight class="h-3 w-3" />
          </button>
        </div>

        <!-- Posts Cards List (Top 5) -->
        <div class="p-4 space-y-3">
          <PostItemView
            v-for="(post, idx) in analysisResult.hotPosts.slice(0, 5)"
            :key="post.key || post.id"
            :post="post"
            :compact="true"
            :rank="idx + 1"
            :is-dark="isDark"
            @open-lightbox="url => emit('open-lightbox', url)"
            @add-to-workspace="p => emit('add-to-workspace', p)"
            @share-post="p => emit('share-post', p)"
            @jump-to-channel="(u, k) => handleChannelClick(u || post.channelUsername || post.channelId || post.channelName)"
            @click-post="p => inspectPost(p)"
          />
        </div>
      </div>

      <!-- =================================================================== -->
      <!-- COLUMN 3: HOT CHANNELS (Ranked by Activity Score DSC)              -->
      <!-- =================================================================== -->
      <div class="bg-white dark:bg-gray-800 rounded-3xl border border-gray-200/80 dark:border-gray-700/80 shadow-sm overflow-hidden flex flex-col">
        <!-- Section Header -->
        <div class="p-4 sm:p-5 border-b border-gray-100 dark:border-gray-700/80 bg-gray-50/50 dark:bg-gray-800/40 flex items-center justify-between gap-3">
          <div class="flex items-center gap-2.5 min-w-0">
            <div class="h-8 w-8 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 border border-emerald-200/60 dark:border-emerald-800/60 flex items-center justify-center shrink-0">
              <Radio class="h-4 w-4" />
            </div>
            <div class="min-w-0">
              <h4 class="text-sm font-black text-gray-900 dark:text-white truncate">
                {{ t('listen.hots.hotChannels') || 'Hot Channels' }}
              </h4>
              <p class="text-[11px] text-gray-400 dark:text-gray-500 font-mono tabular-nums truncate">
                Ranked by activity & reach
              </p>
            </div>
          </div>
          <button
            type="button"
            @click="openDrillDown('channels')"
            class="text-xs font-bold text-teal-600 dark:text-teal-400 hover:text-teal-700 dark:hover:text-teal-300 flex items-center gap-1 cursor-pointer transition-colors"
          >
            <span>{{ t('listen.hots.viewAllChannels') || 'View All' }}</span>
            <ArrowRight class="h-3 w-3" />
          </button>
        </div>

        <!-- Channels Cards List (Top 10) -->
        <div class="p-4 space-y-3">
          <ChannelViewCard
            v-for="(channel, idx) in analysisResult.hotChannels.slice(0, 10)"
            :key="channel.channelId"
            :channel="channel"
            :metadata="getChannelMeta(channel.channelUsername || channel.channelName)"
            :compact="true"
            :rank="idx + 1"
            :is-dark="isDark"
            @select-channel="handleChannelClick"
          />
        </div>
      </div>
    </div>

    <!-- ===================================================================== -->
    <!-- DRILL-DOWN FULL LIST MODAL / DRAWER                                   -->
    <!-- ===================================================================== -->
    <div
      v-if="isDrillDownOpen"
      class="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200"
      @click.self="isDrillDownOpen = false"
    >
      <div
        class="bg-white dark:bg-gray-800 rounded-3xl border border-gray-200 dark:border-gray-700 shadow-2xl w-full max-w-6xl xl:max-w-7xl max-h-[95vh] flex flex-col overflow-hidden"
      >
        <!-- Modal Top Bar -->
        <div class="p-4 sm:p-5 border-b border-gray-100 dark:border-gray-700/80 flex items-center justify-between gap-3 shrink-0">
          <div class="flex items-center gap-3">
            <!-- Tabs -->
            <div class="flex items-center gap-1 bg-gray-100/90 dark:bg-gray-900/70 p-1 rounded-2xl border border-gray-200/60 dark:border-gray-700/60">
              <button
                type="button"
                @click="drillDownTab = 'topics'"
                class="px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer"
                :class="drillDownTab === 'topics' ? 'bg-white dark:bg-gray-800 text-teal-600 dark:text-teal-400 shadow-xs' : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'"
              >
                Hot Topics ({{ analysisResult?.hotTopics.length || 0 }})
              </button>
              <button
                type="button"
                @click="drillDownTab = 'posts'"
                class="px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer"
                :class="drillDownTab === 'posts' ? 'bg-white dark:bg-gray-800 text-teal-600 dark:text-teal-400 shadow-xs' : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'"
              >
                Hot Posts ({{ analysisResult?.filteredPostsCount || 0 }})
              </button>
              <button
                type="button"
                @click="drillDownTab = 'channels'"
                class="px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer"
                :class="drillDownTab === 'channels' ? 'bg-white dark:bg-gray-800 text-teal-600 dark:text-teal-400 shadow-xs' : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'"
              >
                Hot Channels ({{ analysisResult?.hotChannels.length || 0 }})
              </button>
            </div>
          </div>

          <button
            type="button"
            @click="isDrillDownOpen = false; inspectedTopic = null;"
            class="h-8 w-8 rounded-full bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-500 dark:text-gray-300 flex items-center justify-center cursor-pointer transition-colors"
          >
            <X class="h-4 w-4" />
          </button>
        </div>

        <!-- Filter Bar inside Modal -->
        <div class="px-4 sm:px-5 py-3 border-b border-gray-100 dark:border-gray-700/60 bg-gray-50/50 dark:bg-gray-800/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
          <div class="relative flex-1 max-w-md">
            <Search class="h-4 w-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              v-model="drillDownSearch"
              type="text"
              :placeholder="t('listen.hots.searchPlaceholder') || 'Search topics, posts, or channels...'"
              class="w-full pl-9 pr-8 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl text-xs text-gray-900 dark:text-white placeholder-gray-400 focus:outline-hidden focus:ring-2 focus:ring-teal-500/50"
            />
            <button
              v-if="drillDownSearch"
              @click="drillDownSearch = ''"
              class="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-0.5 cursor-pointer"
            >
              <X class="h-3.5 w-3.5" />
            </button>
          </div>

          <div class="flex items-center gap-2 flex-wrap">
            <!-- Sentiment filter (topics tab) -->
            <select
              v-if="drillDownTab === 'topics' && !inspectedTopic"
              v-model="selectedSentimentFilter"
              class="px-2.5 py-1.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl text-xs text-gray-700 dark:text-gray-300 focus:outline-hidden"
            >
              <option value="">{{ t('listen.hots.allSentiments') || 'All Sentiments' }}</option>
              <option value="positive">{{ t('listen.hots.sentimentPositive') || 'Positive' }}</option>
              <option value="neutral">{{ t('listen.hots.sentimentNeutral') || 'Neutral' }}</option>
              <option value="negative">{{ t('listen.hots.sentimentNegative') || 'Negative' }}</option>
            </select>

            <!-- Domain filter (if any) -->
            <select
              v-if="availableDomains.length > 0"
              v-model="selectedDomainFilter"
              class="px-2.5 py-1.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl text-xs text-gray-700 dark:text-gray-300 focus:outline-hidden"
            >
              <option value="">{{ t('listen.hots.allDomains') || 'All Domains' }}</option>
              <option v-for="d in availableDomains" :key="d" :value="d">{{ d }}</option>
            </select>

            <!-- Sort order for posts -->
            <select
              v-if="drillDownTab === 'posts'"
              v-model="postSortOrder"
              class="px-2.5 py-1.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl text-xs text-gray-700 dark:text-gray-300 focus:outline-hidden"
            >
              <option value="views">{{ t('listen.hots.sortByViews') || 'Sort: Views (DSC)' }}</option>
              <option value="score">{{ t('listen.hots.sortByScore') || 'Sort: Quality Score' }}</option>
              <option value="date">{{ t('listen.hots.sortByDate') || 'Sort: Newest First' }}</option>
            </select>
          </div>
        </div>

        <!-- Modal Content Scroll Area -->
        <div ref="drillDownScrollRef" class="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
          <!-- TOPICS TAB -->
          <template v-if="drillDownTab === 'topics'">
            <!-- If inspecting single topic cluster posts -->
            <div v-if="inspectedTopic" class="space-y-4">
              <div class="p-4 rounded-2xl bg-teal-50/60 dark:bg-teal-950/30 border border-teal-200/70 dark:border-teal-800/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div class="min-w-0 flex-1">
                  <button
                    @click="inspectedTopic = null"
                    class="text-xs font-bold text-teal-600 dark:text-teal-400 hover:underline flex items-center gap-1 cursor-pointer mb-2"
                  >
                    ← Back to All Topics
                  </button>

                  <!-- Badges in Inspected Topic Title Header -->
                  <div class="flex items-center flex-wrap gap-1.5 mb-2">
                    <span
                      v-if="inspectedTopic.isAiGenerated || inspectedTopic.clusterSource === 'ai'"
                      class="inline-flex items-center gap-1 text-[10px] font-bold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/60 px-2 py-0.5 rounded-md border border-indigo-200/60 dark:border-indigo-800/50 shrink-0"
                    >
                      <Sparkles class="h-2.5 w-2.5" />
                      AI
                    </span>
                    <span
                      v-else-if="inspectedTopic.clusterSource === 'neural'"
                      class="inline-flex items-center gap-1 text-[10px] font-bold text-cyan-700 dark:text-cyan-300 bg-cyan-50 dark:bg-cyan-950/60 px-2 py-0.5 rounded-md border border-cyan-200/60 dark:border-cyan-800/50 shrink-0"
                    >
                      <Cpu class="h-2.5 w-2.5" />
                      {{ t('listen.hots.badgeNeural') || 'Neural' }}
                    </span>
                    <span
                      v-else
                      class="inline-flex items-center gap-1 text-[10px] font-bold text-teal-700 dark:text-teal-300 bg-teal-50 dark:bg-teal-950/60 px-2 py-0.5 rounded-md border border-teal-200/60 dark:border-teal-800/50 shrink-0"
                    >
                      {{ t('listen.hots.badgeRule') || 'Rule' }}
                    </span>

                    <span
                      v-if="inspectedTopic.category"
                      class="text-[10px] font-bold text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700/60 px-2 py-0.5 rounded-md border border-gray-200/60 dark:border-gray-600/60 shrink-0"
                    >
                      {{ inspectedTopic.category }}
                    </span>

                    <span
                      class="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md border shrink-0"
                      :class="getSentimentBadgeClass(inspectedTopic.sentiment)"
                      :title="getSentimentTooltip(inspectedTopic)"
                    >
                      <Smile v-if="inspectedTopic.sentiment === 'positive'" class="h-3 w-3 shrink-0" />
                      <Frown v-else-if="inspectedTopic.sentiment === 'negative'" class="h-3 w-3 shrink-0" />
                      <Meh v-else class="h-3 w-3 shrink-0" />
                      <span>{{ getSentimentLabel(inspectedTopic.sentiment) }}</span>
                      <span
                        v-if="inspectedTopic.sentimentBreakdown && inspectedTopic.postCount > 1"
                        class="ml-1 pl-1 border-l border-current/25 font-mono text-[9px] opacity-80 tabular-nums"
                      >
                        +{{ inspectedTopic.sentimentBreakdown.positive }} / ={{ inspectedTopic.sentimentBreakdown.neutral }} / -{{ inspectedTopic.sentimentBreakdown.negative }}
                      </span>
                    </span>

                    <span
                      v-for="(tag, tIdx) in (inspectedTopic.tags || [])"
                      :key="tIdx"
                      class="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-lg border transition-all shrink-0"
                      :class="getTagBadgeClass(tag.type)"
                    >
                      <User v-if="tag.type === 'person'" class="h-2.5 w-2.5 opacity-80 shrink-0" />
                      <Building2 v-else-if="tag.type === 'entity'" class="h-2.5 w-2.5 opacity-80 shrink-0" />
                      <BarChart2 v-else-if="tag.type === 'fact'" class="h-2.5 w-2.5 opacity-80 shrink-0" />
                      <Scale v-else-if="tag.type === 'option'" class="h-2.5 w-2.5 opacity-80 shrink-0" />
                      <Hash v-else class="h-2.5 w-2.5 opacity-80 shrink-0" />
                      <span>{{ tag.label }}</span>
                    </span>
                  </div>

                  <h4 class="text-base sm:text-lg font-black text-gray-900 dark:text-white leading-tight">
                    {{ inspectedTopic.title }}
                  </h4>
                  <div
                    v-if="inspectedTopic.titleZh && inspectedTopic.titleZh !== inspectedTopic.title"
                    class="flex items-start gap-1.5 text-xs sm:text-sm font-semibold text-teal-700 dark:text-teal-300 mt-1 mb-1"
                  >
                    <span class="text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-teal-100/80 dark:bg-teal-900/60 text-teal-800 dark:text-teal-200 shrink-0">
                      中译
                    </span>
                    <span class="leading-snug">
                      {{ inspectedTopic.titleZh }}
                    </span>
                  </div>
                  <p class="text-xs text-gray-600 dark:text-gray-300 mt-1 leading-relaxed">
                    {{ inspectedTopic.summary }}
                  </p>
                </div>
                <div class="text-right shrink-0 font-mono text-xs text-gray-500 dark:text-gray-400 tabular-nums">
                  <span class="font-bold text-gray-900 dark:text-white">{{ inspectedTopic.postCount }} {{ inspectedTopic.postCount === 1 ? 'post' : 'posts' }}</span> ·
                  <span>{{ formatNumber(inspectedTopic.totalViews) }} views</span>
                </div>
              </div>

              <!-- Cluster Member Posts (Uses Virtualized List for performance) -->
              <div>
                <VirtualPostList
                  v-if="inspectedTopic.posts.length > 5"
                  :key="inspectedTopic.id"
                  :posts="inspectedTopic.posts"
                  :is-dark="isDark"
                  :scroll-container="drillDownScrollRef"
                  @open-lightbox="url => emit('open-lightbox', url)"
                  @add-to-workspace="p => emit('add-to-workspace', p)"
                  @share-post="p => emit('share-post', p)"
                  @jump-to-channel="(u, k) => handleChannelClick(u || '')"
                  @click-post="p => inspectPost(p)"
                />
                <div v-else class="space-y-4">
                  <PostItemView
                    v-for="post in inspectedTopic.posts"
                    :key="post.key || post.id"
                    :post="post"
                    :compact="false"
                    :is-dark="isDark"
                    @open-lightbox="url => emit('open-lightbox', url)"
                    @add-to-workspace="p => emit('add-to-workspace', p)"
                    @share-post="p => emit('share-post', p)"
                    @jump-to-channel="(u, k) => handleChannelClick(u || post.channelUsername || post.channelId || post.channelName)"
                    @click-post="p => inspectPost(p)"
                  />
                </div>
              </div>
            </div>

            <!-- List of All Topics -->
            <div v-else class="space-y-3">
              <div
                v-if="filteredDrillDownTopics.length === 0"
                class="py-12 px-4 text-center"
              >
                <p class="text-xs text-gray-500 dark:text-gray-400">
                  {{ t('listen.hots.noSubstantiveTopics') || 'No substantive topics found in this range. Short messages and media-only posts are filtered out.' }}
                </p>
              </div>

              <div
                v-for="(topic, idx) in filteredDrillDownTopics"
                :key="topic.id"
                :data-topic-id="topic.id"
                @click="selectInspectedTopic(topic)"
                class="p-4 rounded-2xl border border-gray-200/80 dark:border-gray-700/80 bg-white dark:bg-gray-800 hover:border-teal-500/50 hover:bg-gray-50/50 dark:hover:bg-gray-750/50 transition-all cursor-pointer group"
              >
                <div class="flex items-start justify-between gap-3 mb-2">
                  <div class="flex items-start gap-2.5 min-w-0 flex-1">
                    <span class="text-xs font-black text-amber-600 dark:text-amber-400 font-mono tabular-nums shrink-0 mt-0.5">
                      #{{ idx + 1 }}
                    </span>
                    <div class="min-w-0 flex-1">
                      <!-- Badges in Modal Topic Title Header -->
                      <div class="flex items-center flex-wrap gap-1.5 mb-1.5">
                        <span
                          v-if="topic.isAiGenerated || topic.clusterSource === 'ai'"
                          class="inline-flex items-center gap-1 text-[10px] font-bold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/60 px-1.5 py-0.5 rounded-md border border-indigo-200/60 dark:border-indigo-800/50 shrink-0"
                        >
                          <Sparkles class="h-2.5 w-2.5" />
                          AI
                        </span>
                        <span
                          v-else-if="topic.clusterSource === 'neural'"
                          class="inline-flex items-center gap-1 text-[10px] font-bold text-cyan-700 dark:text-cyan-300 bg-cyan-50 dark:bg-cyan-950/60 px-1.5 py-0.5 rounded-md border border-cyan-200/60 dark:border-cyan-800/50 shrink-0"
                        >
                          <Cpu class="h-2.5 w-2.5" />
                          {{ t('listen.hots.badgeNeural') || 'Neural' }}
                        </span>
                        <span
                          v-else
                          class="inline-flex items-center gap-1 text-[10px] font-bold text-teal-700 dark:text-teal-300 bg-teal-50 dark:bg-teal-950/60 px-1.5 py-0.5 rounded-md border border-teal-200/60 dark:border-teal-800/50 shrink-0"
                        >
                          {{ t('listen.hots.badgeRule') || 'Rule' }}
                        </span>

                        <span
                          v-if="topic.category"
                          class="text-[10px] font-bold text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700/60 px-1.5 py-0.5 rounded-md border border-gray-200/60 dark:border-gray-600/60 shrink-0"
                        >
                          {{ topic.category }}
                        </span>

                        <span
                          class="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-md border shrink-0"
                          :class="getSentimentBadgeClass(topic.sentiment)"
                          :title="getSentimentTooltip(topic)"
                        >
                          <Smile v-if="topic.sentiment === 'positive'" class="h-2.5 w-2.5 shrink-0" />
                          <Frown v-else-if="topic.sentiment === 'negative'" class="h-2.5 w-2.5 shrink-0" />
                          <Meh v-else class="h-2.5 w-2.5 shrink-0" />
                          <span>{{ getSentimentLabel(topic.sentiment) }}</span>
                        </span>

                        <span
                          v-for="(tag, tIdx) in (topic.tags || []).slice(0, 4)"
                          :key="tIdx"
                          class="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md border shrink-0"
                          :class="getTagBadgeClass(tag.type)"
                          :title="`${tag.type}: ${tag.label}`"
                        >
                          <User v-if="tag.type === 'person'" class="h-2.5 w-2.5 opacity-80 shrink-0" />
                          <Building2 v-else-if="tag.type === 'entity'" class="h-2.5 w-2.5 opacity-80 shrink-0" />
                          <BarChart2 v-else-if="tag.type === 'fact'" class="h-2.5 w-2.5 opacity-80 shrink-0" />
                          <Scale v-else-if="tag.type === 'option'" class="h-2.5 w-2.5 opacity-80 shrink-0" />
                          <Hash v-else class="h-2.5 w-2.5 opacity-80 shrink-0" />
                          <span class="truncate max-w-[120px]">{{ tag.label }}</span>
                        </span>
                      </div>

                      <h4 class="text-sm font-bold text-gray-900 dark:text-white group-hover:text-teal-600 dark:group-hover:text-teal-400 transition-colors">
                        {{ topic.title }}
                      </h4>
                      <div
                        v-if="topic.titleZh && topic.titleZh !== topic.title"
                        class="flex items-start gap-1.5 text-xs font-semibold text-teal-700 dark:text-teal-300 mt-1 mb-0.5"
                      >
                        <span class="text-[9px] uppercase font-bold tracking-wider px-1 py-0.5 rounded bg-teal-100/80 dark:bg-teal-900/60 text-teal-800 dark:text-teal-200 shrink-0">
                          中译
                        </span>
                        <span class="line-clamp-1 leading-snug">
                          {{ topic.titleZh }}
                        </span>
                      </div>
                      <p class="text-xs text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">
                        {{ topic.summary }}
                      </p>
                    </div>
                  </div>
                  <span class="text-xs font-mono font-bold text-teal-700 dark:text-teal-300 tabular-nums shrink-0">
                    Score {{ topic.hotScore }}
                  </span>
                </div>

                <div class="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500 font-mono tabular-nums flex-wrap pt-2 border-t border-gray-100 dark:border-gray-700/40">
                  <span class="font-bold text-gray-700 dark:text-gray-300">{{ topic.postCount }} {{ topic.postCount === 1 ? 'post' : 'posts' }}</span>
                  <span aria-hidden="true">·</span>
                  <span>{{ formatNumber(topic.totalViews) }} views</span>
                  <span aria-hidden="true">·</span>
                  <span>{{ topic.channels.length }} {{ topic.channels.length === 1 ? 'channel' : 'channels' }}: {{ topic.channels.slice(0, 3).join(', ') }}</span>
                  <span v-if="topic.domains.length > 0" aria-hidden="true">·</span>
                  <span v-if="topic.domains.length > 0" class="text-teal-600 dark:text-teal-400">{{ topic.domains.join(', ') }}</span>
                </div>
              </div>
            </div>
          </template>

          <!-- POSTS TAB (Uses Virtualized List for performance) -->
          <template v-else-if="drillDownTab === 'posts'">
            <div>
              <VirtualPostList
                v-if="filteredDrillDownPosts.length > 5"
                :posts="filteredDrillDownPosts"
                :is-dark="isDark"
                :show-rank="true"
                :scroll-container="drillDownScrollRef"
                @open-lightbox="url => emit('open-lightbox', url)"
                @add-to-workspace="p => emit('add-to-workspace', p)"
                @share-post="p => emit('share-post', p)"
                @jump-to-channel="(u, k) => handleChannelClick(u || '')"
              />
              <div v-else class="space-y-4">
                <PostItemView
                  v-for="(post, idx) in filteredDrillDownPosts"
                  :key="post.key || post.id"
                  :post="post"
                  :compact="false"
                  :rank="idx + 1"
                  :is-dark="isDark"
                  @open-lightbox="url => emit('open-lightbox', url)"
                  @add-to-workspace="p => emit('add-to-workspace', p)"
                  @share-post="p => emit('share-post', p)"
                  @jump-to-channel="(u, k) => handleChannelClick(u || post.channelUsername || post.channelId || post.channelName)"
                />
              </div>
            </div>
          </template>

          <!-- CHANNELS TAB (Uses full ChannelViewCard matching View Mode Channel Metadata Widget) -->
          <template v-else-if="drillDownTab === 'channels'">
            <div class="space-y-4">
              <ChannelViewCard
                v-for="(channel, idx) in filteredDrillDownChannels"
                :key="channel.channelId"
                :channel="channel"
                :metadata="getChannelMeta(channel.channelUsername || channel.channelName)"
                :compact="false"
                :rank="idx + 1"
                :is-dark="isDark"
                @select-channel="handleChannelClick"
              />
            </div>
          </template>
        </div>
      </div>
    </div>

    <!-- ===================================================================== -->
    <!-- POST DETAIL MODAL                                                     -->
    <!-- ===================================================================== -->
    <div
      v-if="inspectedPost"
      class="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200"
    >
      <div class="bg-white dark:bg-gray-800 rounded-3xl border border-gray-200 dark:border-gray-700 shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        <div class="p-4 sm:p-5 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between gap-3">
          <div class="flex items-center gap-2">
            <span class="text-sm font-bold text-gray-900 dark:text-white">Post Detail</span>
            <span class="text-xs text-gray-400 font-mono">@{{ inspectedPost.channelUsername || inspectedPost.channelName }}</span>
          </div>
          <button
            @click="inspectedPost = null"
            class="h-8 w-8 rounded-full bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 flex items-center justify-center cursor-pointer"
          >
            <X class="h-4 w-4 text-gray-500 dark:text-gray-300" />
          </button>
        </div>

        <div class="p-4 sm:p-6 overflow-y-auto space-y-4">
          <PostItemView
            :post="inspectedPost"
            :compact="false"
            :is-dark="isDark"
            @open-lightbox="url => emit('open-lightbox', url)"
            @add-to-workspace="p => emit('add-to-workspace', p)"
            @share-post="p => emit('share-post', p)"
            @jump-to-channel="(u, k) => handleChannelClick(u || inspectedPost?.channelUsername || inspectedPost?.channelId || inspectedPost?.channelName || '')"
          />
        </div>

        <div class="p-4 border-t border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/40 flex items-center justify-end gap-2">
          <button
            type="button"
            @click="inspectedPost = null"
            class="px-4 py-2 rounded-xl text-xs font-bold text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer"
          >
            {{ t('listen.hots.close') || 'Close' }}
          </button>
          <button
            type="button"
            @click="handleChannelClick(inspectedPost?.channelUsername || inspectedPost?.channelId || inspectedPost?.channelName || '')"
            class="px-4 py-2 rounded-xl text-xs font-bold bg-teal-600 hover:bg-teal-700 text-white shadow-xs flex items-center gap-1.5 cursor-pointer"
          >
            <span>{{ t('listen.hots.jumpToChannel') || 'Jump to Channel' }}</span>
            <ExternalLink class="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>

    <!-- ===================================================================== -->
    <!-- GEMINI API CONFIGURATION MODAL                                        -->
    <!-- ===================================================================== -->
    <div
      v-if="isApiKeyModalOpen"
      class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200"
    >
      <div class="bg-white dark:bg-gray-800 rounded-3xl border border-gray-200 dark:border-gray-700 shadow-2xl w-full max-w-md overflow-hidden p-6 space-y-4">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <div class="h-8 w-8 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
              <Key class="h-4 w-4" />
            </div>
            <h4 class="text-base font-black text-gray-900 dark:text-white">
              {{ t('listen.hots.geminiTokenModalTitle') || 'Gemini API Configuration' }}
            </h4>
          </div>
          <button
            @click="isApiKeyModalOpen = false"
            class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 cursor-pointer"
          >
            <X class="h-4 w-4" />
          </button>
        </div>

        <p class="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
          {{ t('listen.hots.geminiTokenPrompt') || 'Enter your Gemini API key to enable AI-powered topic clustering and editorial titles using gemini-3.1-flash-lite:' }}
        </p>

        <div class="space-y-1">
          <input
            v-model="apiKeyInput"
            type="password"
            :placeholder="t('listen.hots.geminiTokenPlaceholder') || 'AIzaSy...'"
            class="w-full px-3.5 py-2.5 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl text-xs font-mono text-gray-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500/50"
          />
          <p v-if="apiKeyFeedback" class="text-xs text-indigo-600 dark:text-indigo-400 font-medium">
            {{ apiKeyFeedback }}
          </p>
        </div>

        <div class="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            @click="apiKeyInput = ''; saveApiKey();"
            class="px-3 py-2 rounded-xl text-xs font-bold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
          >
            {{ t('listen.hots.clearToken') || 'Clear Key' }}
          </button>
          <button
            type="button"
            @click="saveApiKey"
            class="px-4 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs cursor-pointer"
          >
            {{ t('listen.hots.saveToken') || 'Save & Enable AI' }}
          </button>
        </div>
      </div>
    </div>

    <!-- ===================================================================== -->
    <!-- LOCAL SEMANTIC EMBEDDING CACHE MODAL                                  -->
    <!-- ===================================================================== -->
    <div
      v-if="isEmbedCacheModalOpen"
      class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200"
      @click.self="isEmbedCacheModalOpen = false"
    >
      <div class="bg-white dark:bg-gray-800 rounded-3xl border border-gray-200 dark:border-gray-700 shadow-2xl w-full max-w-lg overflow-hidden p-6 space-y-4">
        <div class="flex items-center justify-between gap-3">
          <div class="flex items-center gap-2.5 min-w-0">
            <div class="h-9 w-9 rounded-xl bg-cyan-50 dark:bg-cyan-950/60 text-cyan-600 dark:text-cyan-400 border border-cyan-200/70 dark:border-cyan-800/60 flex items-center justify-center shrink-0">
              <Database class="h-4 w-4" />
            </div>
            <div class="min-w-0">
              <h4 class="text-sm sm:text-base font-black text-gray-900 dark:text-white truncate">
                {{ t('listen.hots.embedCacheTitle') || 'Local Semantic Embedding Cache' }}
              </h4>
              <p class="text-[11px] font-mono text-gray-500 dark:text-gray-400 truncate">
                {{ HOTS_EMBED_MODEL_ID }}
              </p>
            </div>
          </div>
          <button
            type="button"
            @click="isEmbedCacheModalOpen = false"
            class="h-8 w-8 rounded-full bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-500 dark:text-gray-300 flex items-center justify-center cursor-pointer shrink-0"
          >
            <X class="h-4 w-4" />
          </button>
        </div>

        <p class="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
          {{ t('listen.hots.embedCacheDesc') || 'Multilingual sentence embeddings run 100% locally via ONNX Runtime & Web Workers. Both model weights and computed post vectors are cached in your browser.' }}
        </p>

        <!-- Stats Summary Grid -->
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div class="p-3 rounded-2xl bg-gray-50 dark:bg-gray-900/60 border border-gray-200/70 dark:border-gray-700/70 space-y-1">
            <div class="text-[11px] font-semibold text-gray-500 dark:text-gray-400">
              {{ t('listen.hots.modelWeightsLabel') || 'ONNX Model Weights (INT8)' }}
            </div>
            <div class="flex items-center justify-between gap-2">
              <span
                class="text-xs font-bold"
                :class="neuralCacheStatus?.isCached ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'"
              >
                {{
                  neuralCacheStatus?.isCached
                    ? (t('listen.hots.modelCached') || 'Cached offline')
                    : (t('listen.hots.modelNotCached') || 'Not downloaded')
                }}
              </span>
              <span class="text-xs font-mono tabular-nums text-gray-700 dark:text-gray-200 font-bold">
                {{
                  neuralCacheStatus?.isCached
                    ? formatBytes(neuralCacheStatus.totalBytes || neuralCacheStatus.approxBytes)
                    : neuralCacheStatus?.partialBytes
                      ? `${formatBytes(neuralCacheStatus.partialBytes)} / ${formatBytes(neuralCacheStatus.totalBytes || neuralCacheStatus.approxBytes)}`
                      : `~${formatBytes(neuralCacheStatus?.approxBytes || 118400000)}`
                }}
              </span>
            </div>
          </div>

          <div class="p-3 rounded-2xl bg-gray-50 dark:bg-gray-900/60 border border-gray-200/70 dark:border-gray-700/70 space-y-1">
            <div class="text-[11px] font-semibold text-gray-500 dark:text-gray-400">
              {{ t('listen.hots.vectorStoreLabel') || 'IndexedDB Post Vectors (384-d)' }}
            </div>
            <div class="flex items-center justify-between gap-2">
              <span class="text-xs font-mono font-bold tabular-nums text-gray-900 dark:text-white">
                {{ (neuralCacheStatus?.count ?? 0).toLocaleString() }} {{ t('listen.hots.vectorsUnit') || 'vectors' }}
              </span>
              <span class="text-xs font-mono tabular-nums text-gray-500 dark:text-gray-400">
                {{ formatBytes(neuralCacheStatus?.vectorBytes) }}
              </span>
            </div>
          </div>
        </div>

        <!-- Execution Backend Preference -->
        <div class="space-y-1.5">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-gray-700 dark:text-gray-200">
              {{ t('listen.hots.executorLabel') || 'Execution Backend' }}
            </span>
            <span v-if="neuralCacheStatus?.provider" class="text-[11px] font-mono text-cyan-600 dark:text-cyan-400 font-semibold uppercase">
              Active: {{ neuralCacheStatus.provider }}
            </span>
          </div>
          <div class="grid grid-cols-3 gap-1.5 bg-gray-100/90 dark:bg-gray-900/70 p-1 rounded-xl border border-gray-200/70 dark:border-gray-700/70">
            <button
              type="button"
              @click="handleExecutorChange('auto')"
              class="px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap"
              :class="executorPreference === 'auto' ? 'bg-white dark:bg-gray-800 text-cyan-600 dark:text-cyan-400 shadow-xs' : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'"
            >
              Auto (WebGPU/WASM)
            </button>
            <button
              type="button"
              @click="handleExecutorChange('webgpu')"
              class="px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap"
              :class="executorPreference === 'webgpu' ? 'bg-white dark:bg-gray-800 text-cyan-600 dark:text-cyan-400 shadow-xs' : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'"
            >
              WebGPU
            </button>
            <button
              type="button"
              @click="handleExecutorChange('wasm')"
              class="px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap"
              :class="executorPreference === 'wasm' ? 'bg-white dark:bg-gray-800 text-cyan-600 dark:text-cyan-400 shadow-xs' : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'"
            >
              WASM CPU
            </button>
          </div>
        </div>

        <!-- Live Warmup Progress -->
        <div
          v-if="isWarmingUpModel"
          class="p-3 rounded-2xl bg-cyan-50 dark:bg-cyan-950/40 border border-cyan-200/70 dark:border-cyan-800/60 space-y-1.5"
        >
          <div class="flex items-center justify-between gap-2 text-xs font-semibold text-cyan-900 dark:text-cyan-200">
            <span class="truncate">{{ computeProgress.message || 'Downloading embedding model...' }}</span>
            <span class="font-mono font-bold tabular-nums shrink-0">{{ computeProgress.percent }}%</span>
          </div>
          <div class="h-1.5 w-full rounded-full bg-cyan-200/60 dark:bg-cyan-900/60 overflow-hidden">
            <div
              class="h-full bg-cyan-600 dark:bg-cyan-400 transition-all duration-200"
              :style="{ width: `${Math.min(100, Math.max(4, computeProgress.percent))}%` }"
            ></div>
          </div>
        </div>

        <p v-if="embedActionFeedback" class="text-xs font-semibold text-cyan-700 dark:text-cyan-300">
          {{ embedActionFeedback }}
        </p>

        <!-- Actions Footer -->
        <div class="flex items-center justify-between gap-2 pt-2 flex-wrap">
          <button
            type="button"
            @click="handleClearEmbedCache"
            :disabled="isClearingEmbedCache || isWarmingUpModel"
            class="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer disabled:opacity-50 whitespace-nowrap"
          >
            <Trash2 class="h-3.5 w-3.5" />
            <span>{{ t('listen.hots.clearEmbedCache') || 'Clear Cache' }}</span>
          </button>

          <div class="flex items-center gap-2">
            <button
              v-if="isWarmingUpModel"
              type="button"
              @click="abortNeuralTask"
              class="px-3 py-2 rounded-xl text-xs font-bold text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 cursor-pointer whitespace-nowrap"
            >
              {{ t('listen.hots.abortDownload') || 'Abort' }}
            </button>
            <button
              v-else
              type="button"
              @click="handleWarmupEmbedModel"
              :disabled="isClearingEmbedCache"
              class="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-cyan-600 hover:bg-cyan-700 text-white shadow-xs cursor-pointer disabled:opacity-50 whitespace-nowrap"
            >
              <CheckCircle2 v-if="neuralCacheStatus?.isCached" class="h-3.5 w-3.5" />
              <Download v-else class="h-3.5 w-3.5" />
              <span>
                {{
                  neuralCacheStatus?.isCached
                    ? (t('listen.hots.verifyWarmupModel') || 'Warmup Runtime')
                    : (t('listen.hots.downloadWarmupModel') || 'Download Model (~113 MB)')
                }}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
