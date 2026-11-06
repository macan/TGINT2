<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import { useI18n, t } from "../../i18n";
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
  Hash
} from "lucide-vue-next";
import {
  HotsDateRange,
  HotPostItem,
  HotTopicCluster,
  HotChannelItem,
  HotsEngineProgress,
  HotsAnalysisResult
} from "../../utils/hotsEngine";
import {
  computeListenHotsInBackground,
  getCachedHotsAnalysis,
  setCachedHotsAnalysis
} from "../../utils/hotsWorkerClient";
import { getAllCachedPostsIndexedDB } from "../../utils/indexedDbPosts";
import PostItemView from "./PostItemView.vue";
import ChannelViewCard from "./ChannelViewCard.vue";

const props = defineProps<{
  isDark?: boolean;
  lastDbUpdate?: number;
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

const selectedDateRange = ref<HotsDateRange>(
  (localStorage.getItem("listen_hots_date_range") as HotsDateRange) || "today"
);

const isComputing = ref(false);
const isTopicsComputing = ref(false);
const computeProgress = ref<HotsEngineProgress>({
  step: "done",
  percent: 100,
  message: ""
});

const analysisResult = ref<HotsAnalysisResult | null>(null);

// AI Mode & Gemini Token State
const geminiApiKey = ref<string>(localStorage.getItem("gemini_api_key") || "");
const serverHasGemini = ref(false);
const isAiModeEnabled = ref<boolean>(localStorage.getItem("listen_hots_ai_mode") === "true");
const isApiKeyModalOpen = ref(false);
const apiKeyInput = ref(geminiApiKey.value);
const apiKeyFeedback = ref("");

const checkServerGeminiStatus = async () => {
  try {
    const res = await fetch('/api/gemini/status');
    if (res.ok) {
      const data = await res.json();
      serverHasGemini.value = !!data.available;
      if (data.available && !localStorage.getItem("listen_hots_ai_mode")) {
        isAiModeEnabled.value = true;
      }
    }
  } catch {}
};

// Full List Modal / Drill-Down State
const isDrillDownOpen = ref(false);
const drillDownTab = ref<"topics" | "posts" | "channels">("topics");
const drillDownSearch = ref("");
const selectedDomainFilter = ref<string>("");
const postSortOrder = ref<"views" | "score" | "date">("views");
const inspectedTopic = ref<HotTopicCluster | null>(null);
const inspectedPost = ref<HotPostItem | null>(null);

// Incremental computing debounce timer
let debounceTimer: any = null;

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

async function runAnalysis(force: boolean = false) {
  if (isComputing.value && !force) return;

  const isAi = isAiModeEnabled.value && (serverHasGemini.value || !!geminiApiKey.value);
  const cached = getCachedHotsAnalysis(selectedDateRange.value, isAi);
  if (cached && !force) {
    analysisResult.value = cached;
  }

  isComputing.value = true;
  isTopicsComputing.value = true;
  computeProgress.value = {
    step: "scanning",
    percent: 5,
    message: "Scanning IndexedDB posts cache in background..."
  };

  try {
    const cachedChannels = await getAllCachedPostsIndexedDB();
    if (cachedChannels.length === 0) {
      analysisResult.value = {
        dateRange: selectedDateRange.value,
        timeWindow: { start: 0, end: Date.now() },
        totalPostsAnalyzed: 0,
        filteredPostsCount: 0,
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
      useAiMode: isAi,
      listenItems: props.listenItems,
      channelMetadataCache: props.channelMetadataCache,
      onProgress: p => {
        computeProgress.value = p;
        if (p.step === 'clustering' || p.step === 'ai_clustering') {
          isTopicsComputing.value = true;
        }
      },
      onPartialResult: partial => {
        // Progressive UI: Immediately show Hot Posts & Hot Channels without waiting for topic clustering
        if (!analysisResult.value) {
          analysisResult.value = {
            dateRange: selectedDateRange.value,
            timeWindow: { start: 0, end: Date.now() },
            totalPostsAnalyzed: partial.totalPostsAnalyzed,
            filteredPostsCount: partial.filteredPostsCount,
            totalChannelsScanned: partial.totalChannelsScanned,
            activeChannelsCount: partial.activeChannelsCount,
            hotTopics: [],
            hotPosts: partial.hotPosts,
            hotChannels: partial.hotChannels,
            computedAt: Date.now(),
            isTopicsComputing: true
          };
        } else {
          analysisResult.value = {
            ...analysisResult.value,
            totalPostsAnalyzed: partial.totalPostsAnalyzed,
            filteredPostsCount: partial.filteredPostsCount,
            totalChannelsScanned: partial.totalChannelsScanned,
            activeChannelsCount: partial.activeChannelsCount,
            hotPosts: partial.hotPosts,
            hotChannels: partial.hotChannels,
            isTopicsComputing: true
          };
        }
      }
    });

    analysisResult.value = res;
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
  selectedDateRange.value = range;
  localStorage.setItem("listen_hots_date_range", range);
  runAnalysis();
}

function toggleAiMode() {
  if (!serverHasGemini.value && !geminiApiKey.value) {
    apiKeyInput.value = "";
    isApiKeyModalOpen.value = true;
    return;
  }
  isAiModeEnabled.value = !isAiModeEnabled.value;
  localStorage.setItem("listen_hots_ai_mode", String(isAiModeEnabled.value));
  runAnalysis();
}

function saveApiKey() {
  const trimmed = apiKeyInput.value.trim();
  if (!trimmed) {
    geminiApiKey.value = "";
    localStorage.removeItem("gemini_api_key");
    isAiModeEnabled.value = false;
    localStorage.setItem("listen_hots_ai_mode", "false");
    apiKeyFeedback.value = "Gemini key removed. Reverting to local semantic clustering.";
    setTimeout(() => {
      isApiKeyModalOpen.value = false;
      apiKeyFeedback.value = "";
      runAnalysis();
    }, 800);
    return;
  }

  geminiApiKey.value = trimmed;
  localStorage.setItem("gemini_api_key", trimmed);
  isAiModeEnabled.value = true;
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
  isDrillDownOpen.value = true;
}

function inspectTopic(topic: HotTopicCluster) {
  inspectedTopic.value = topic;
  openDrillDown("topics");
}

function inspectPost(post: HotPostItem) {
  inspectedPost.value = post;
}

function handleChannelClick(channelId: string) {
  emit("select-channel", channelId);
  isDrillDownOpen.value = false;
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

// ---------------------------------------------------------------------------
// Lifecycle & Reactive Watchers (Incremental Computing)
// ---------------------------------------------------------------------------

// Debounce-watch for background database updates from listen sync
watch(
  () => props.lastDbUpdate,
  (newVal) => {
    if (!newVal) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      // Re-run computation progressively with batched updates
      runAnalysis();
    }, 3000);
  }
);

onMounted(() => {
  checkServerGeminiStatus();
  // Instant restore from in-memory cache if available (0ms render time)
  const isAi = isAiModeEnabled.value && (serverHasGemini.value || !!geminiApiKey.value);
  const cached = getCachedHotsAnalysis(selectedDateRange.value, isAi);
  if (cached) {
    analysisResult.value = cached;
  }

  // Defer background computing slightly so main UI paint completes without any frame drops
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => {
      setTimeout(() => {
        runAnalysis();
      }, 50);
    });
  } else {
    setTimeout(() => {
      runAnalysis();
    }, 50);
  }
});

onUnmounted(() => {
  if (debounceTimer) clearTimeout(debounceTimer);
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
                <span class="text-gray-400 dark:text-gray-500">/</span>
                <span class="text-gray-600 dark:text-gray-300 font-medium">
                  {{ formatNumber(analysisResult.totalPostsAnalyzed) }} total cached posts
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
        <div class="flex items-center gap-1 bg-gray-100/90 dark:bg-gray-900/70 p-1 rounded-2xl border border-gray-200/60 dark:border-gray-700/60 overflow-x-auto max-w-full">
          <button
            type="button"
            @click="handleDateRangeChange('today')"
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
      </div>

      <!-- Right: AI Mode Toggle & Refresh Button -->
      <div class="flex items-center gap-2 self-end sm:self-auto shrink-0 flex-wrap">
        <!-- AI Clustering Toggle -->
        <button
          type="button"
          @click="toggleAiMode"
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-2xl text-xs font-bold transition-all cursor-pointer select-none border shadow-2xs"
          :class="[
            isAiModeEnabled && (serverHasGemini || geminiApiKey)
              ? 'bg-gradient-to-r from-violet-50 to-indigo-50 dark:from-violet-950/60 dark:to-indigo-950/60 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800/80 ring-1 ring-indigo-500/20'
              : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/60'
          ]"
          :title="serverHasGemini || geminiApiKey ? t('listen.hots.aiClusteringActive') : t('listen.hots.aiClusteringTooltip')"
        >
          <Sparkles class="h-3.5 w-3.5" :class="isAiModeEnabled && (serverHasGemini || geminiApiKey) ? 'text-indigo-600 dark:text-indigo-400' : 'text-gray-400'" />
          <span>{{ isAiModeEnabled && (serverHasGemini || geminiApiKey) ? 'Gemini 3.1 Flash Lite' : (t('listen.hots.aiClustering') || 'AI Mode') }}</span>
          <span
            @click.stop="isApiKeyModalOpen = true"
            class="ml-1 text-[10px] text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 underline cursor-pointer"
            title="Configure Gemini Token"
          >
            {{ geminiApiKey ? 'Key' : 'Key' }}
          </span>
        </button>

        <!-- Refresh / Recompute Button -->
        <button
          type="button"
          @click="runAnalysis(true)"
          :disabled="isComputing"
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-2xl text-xs font-bold bg-white hover:bg-teal-50 dark:bg-gray-800 dark:hover:bg-gray-700 text-teal-700 dark:text-teal-300 border border-teal-200/80 dark:border-teal-800/60 transition-all cursor-pointer select-none shadow-2xs active:scale-95 disabled:opacity-50"
          :title="t('listen.hots.refresh') || 'Re-calculate'"
        >
          <RefreshCw class="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" :class="{ 'animate-spin': isComputing }" />
          <span class="hidden sm:inline">{{ t('listen.hots.refresh') || 'Re-calculate' }}</span>
        </button>
      </div>
    </div>

    <!-- Progressive Computing Progress Bar (Initial Cold Load Only) -->
    <div v-if="isComputing && !analysisResult" class="w-full bg-teal-50 dark:bg-teal-950/40 border border-teal-200/70 dark:border-teal-800/60 rounded-2xl p-3 flex items-center justify-between gap-3 animate-pulse">
      <div class="flex items-center gap-2 text-xs font-bold text-teal-900 dark:text-teal-200 truncate">
        <RefreshCw class="h-3.5 w-3.5 animate-spin text-teal-600 dark:text-teal-400 shrink-0" />
        <span class="truncate">{{ computeProgress.message }}</span>
      </div>
      <span class="text-xs font-mono font-bold text-teal-700 dark:text-teal-300 tabular-nums shrink-0">
        {{ computeProgress.percent }}%
      </span>
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

    <!-- Main 3-Column Bento Grid: Hot Topics, Hot Posts, Hot Channels -->
    <div
      v-else-if="analysisResult"
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
                  {{ analysisResult.hotTopics.length }} topics clustered
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
          <!-- Background Updating Banner when previous topics exist -->
          <div
            v-if="isTopicsComputing && analysisResult.hotTopics.length > 0"
            class="mb-2 p-2 rounded-xl bg-amber-50/70 dark:bg-amber-950/40 border border-amber-200/60 dark:border-amber-800/50 text-[11px] text-amber-800 dark:text-amber-300 flex items-center justify-between gap-2"
          >
            <span class="inline-flex items-center gap-1.5 font-medium truncate">
              <RefreshCw class="h-3 w-3 animate-spin text-amber-600 dark:text-amber-400 shrink-0" />
              <span class="truncate">{{ computeProgress.message || 'Updating topics in background...' }}</span>
            </span>
            <span class="font-mono font-bold tabular-nums shrink-0">{{ computeProgress.percent }}%</span>
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
            v-for="(topic, idx) in analysisResult.hotTopics.slice(0, 5)"
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
                    v-if="topic.isAiGenerated"
                    class="inline-flex items-center gap-1 text-[10px] font-bold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/60 px-1.5 py-0.5 rounded-md border border-indigo-200/60 dark:border-indigo-800/50 shrink-0"
                  >
                    <Sparkles class="h-2.5 w-2.5" />
                    AI
                  </span>
                  <span
                    v-else
                    class="inline-flex items-center gap-1 text-[10px] font-bold text-teal-700 dark:text-teal-300 bg-teal-50 dark:bg-teal-950/60 px-1.5 py-0.5 rounded-md border border-teal-200/60 dark:border-teal-800/50 shrink-0"
                  >
                    Rule
                  </span>

                  <!-- Category Badge -->
                  <span
                    v-if="topic.category"
                    class="text-[10px] font-bold text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700/60 px-1.5 py-0.5 rounded-md border border-gray-200/60 dark:border-gray-600/60 shrink-0"
                  >
                    {{ topic.category }}
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
            @jump-to-channel="(u, k) => handlePostJump({ ...post, channelUsername: u, key: k })"
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

        <!-- Channels Cards List (Top 5) -->
        <div class="p-4 space-y-3">
          <ChannelViewCard
            v-for="(channel, idx) in analysisResult.hotChannels.slice(0, 5)"
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
    >
      <div
        class="bg-white dark:bg-gray-800 rounded-3xl border border-gray-200 dark:border-gray-700 shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden"
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
        <div class="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
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
                      v-if="inspectedTopic.isAiGenerated"
                      class="inline-flex items-center gap-1 text-[10px] font-bold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/60 px-2 py-0.5 rounded-md border border-indigo-200/60 dark:border-indigo-800/50 shrink-0"
                    >
                      <Sparkles class="h-2.5 w-2.5" />
                      AI
                    </span>
                    <span
                      v-else
                      class="inline-flex items-center gap-1 text-[10px] font-bold text-teal-700 dark:text-teal-300 bg-teal-50 dark:bg-teal-950/60 px-2 py-0.5 rounded-md border border-teal-200/60 dark:border-teal-800/50 shrink-0"
                    >
                      Rule
                    </span>

                    <span
                      v-if="inspectedTopic.category"
                      class="text-[10px] font-bold text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700/60 px-2 py-0.5 rounded-md border border-gray-200/60 dark:border-gray-600/60 shrink-0"
                    >
                      {{ inspectedTopic.category }}
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
                  <p class="text-xs text-gray-600 dark:text-gray-300 mt-1 leading-relaxed">
                    {{ inspectedTopic.summary }}
                  </p>
                </div>
                <div class="text-right shrink-0 font-mono text-xs text-gray-500 dark:text-gray-400 tabular-nums">
                  <span class="font-bold text-gray-900 dark:text-white">{{ inspectedTopic.postCount }} {{ inspectedTopic.postCount === 1 ? 'post' : 'posts' }}</span> ·
                  <span>{{ formatNumber(inspectedTopic.totalViews) }} views</span>
                </div>
              </div>

              <!-- Cluster Member Posts (Uses full PostItemView matching View Mode) -->
              <div class="space-y-4">
                <PostItemView
                  v-for="post in inspectedTopic.posts"
                  :key="post.key || post.id"
                  :post="post"
                  :compact="false"
                  :is-dark="isDark"
                  @open-lightbox="url => emit('open-lightbox', url)"
                  @add-to-workspace="p => emit('add-to-workspace', p)"
                  @share-post="p => emit('share-post', p)"
                  @jump-to-channel="(u, k) => handlePostJump({ ...post, channelUsername: u, key: k })"
                  @click-post="p => inspectPost(p)"
                />
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
                @click="inspectedTopic = topic"
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
                          v-if="topic.isAiGenerated"
                          class="inline-flex items-center gap-1 text-[10px] font-bold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/60 px-1.5 py-0.5 rounded-md border border-indigo-200/60 dark:border-indigo-800/50 shrink-0"
                        >
                          <Sparkles class="h-2.5 w-2.5" />
                          AI
                        </span>
                        <span
                          v-else
                          class="inline-flex items-center gap-1 text-[10px] font-bold text-teal-700 dark:text-teal-300 bg-teal-50 dark:bg-teal-950/60 px-1.5 py-0.5 rounded-md border border-teal-200/60 dark:border-teal-800/50 shrink-0"
                        >
                          Rule
                        </span>

                        <span
                          v-if="topic.category"
                          class="text-[10px] font-bold text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700/60 px-1.5 py-0.5 rounded-md border border-gray-200/60 dark:border-gray-600/60 shrink-0"
                        >
                          {{ topic.category }}
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

          <!-- POSTS TAB (Uses full PostItemView matching View Mode) -->
          <template v-else-if="drillDownTab === 'posts'">
            <div class="space-y-4">
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
                @jump-to-channel="(u, k) => handlePostJump({ ...post, channelUsername: u, key: k })"
                @click-post="p => inspectPost(p)"
              />
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
            @jump-to-channel="(u, k) => handlePostJump({ ...inspectedPost!, channelUsername: u, key: k })"
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
            @click="handlePostJump(inspectedPost)"
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
  </div>
</template>
