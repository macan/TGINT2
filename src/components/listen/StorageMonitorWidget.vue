<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { useI18n } from "../../i18n";
import {
  Database,
  HardDrive,
  RefreshCw,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  AlertOctagon,
  ShieldCheck,
  Layers,
  Calendar,
  ChevronDown,
  ChevronUp,
  X,
  Sparkles
} from "lucide-vue-next";
import {
  POST_LIMIT_500K,
  getCacheStorageStatsIndexedDB,
  pruneOldPostsIndexedDB,
  type CacheStorageStats,
  type PruneStats
} from "../../utils/indexedDbPosts";

const props = withDefaults(
  defineProps<{
    isDark?: boolean;
    lastDbUpdate?: number;
    lastDbSyncEvent?: any;
    allowDismiss?: boolean;
  }>(),
  {
    isDark: false,
    allowDismiss: true
  }
);

const emit = defineEmits<{
  (e: "close"): void;
  (e: "pruned", stats: PruneStats): void;
}>();

const { t } = useI18n();

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const isLoading = ref(true);
const isPruning = ref(false);
const pruneMessage = ref<string | null>(null);
const pruneMessageTimer = ref<any>(null);

const isCollapsed = ref<boolean>(
  localStorage.getItem("listen_storage_monitor_collapsed") === "true"
);

const stats = ref<CacheStorageStats>({
  channelCount: 0,
  totalPostCount: 0,
  oldestPostTimestamp: 0,
  newestPostTimestamp: 0,
  multiListenItemPostCount: 0,
  postLimit: POST_LIMIT_500K,
  percentOfLimit: 0,
  storageEstimate: {
    usageBytes: 0,
    quotaBytes: 0,
    usageFormatted: "0 B",
    quotaFormatted: "Unknown",
    percentQuotaUsed: 0
  }
});

// ---------------------------------------------------------------------------
// Computed Metrics & Limit Thresholds
// ---------------------------------------------------------------------------

const postCount = computed(() => stats.value.totalPostCount);
const postLimit = computed(() => stats.value.postLimit || POST_LIMIT_500K);
const usagePercent = computed(() => {
  if (!postLimit.value) return 0;
  return Math.min(100, (postCount.value / postLimit.value) * 100);
});

const remainingHeadroom = computed(() => {
  return Math.max(0, postLimit.value - postCount.value);
});

// Three-tier health status
const healthLevel = computed<'healthy' | 'warning' | 'critical'>(() => {
  if (usagePercent.value >= 90 || postCount.value >= 450000) return 'critical';
  if (usagePercent.value >= 70 || postCount.value >= 350000) return 'warning';
  return 'healthy';
});

const healthBadgeInfo = computed(() => {
  switch (healthLevel.value) {
    case 'critical':
      return {
        label: t('listen.storage.nearLimit') || 'Near 500K Limit',
        desc: t('listen.storage.criticalDesc') || 'Database capacity exceeds 90%. Prune older posts to maintain optimal B-tree index performance.',
        bgClass: 'bg-rose-50 dark:bg-rose-950/60 border-rose-200 dark:border-rose-900/60 text-rose-700 dark:text-rose-300',
        dotClass: 'bg-rose-500 animate-pulse',
        barClass: 'bg-gradient-to-r from-rose-500 to-red-600',
        ringClass: 'ring-rose-500/20'
      };
    case 'warning':
      return {
        label: t('listen.storage.highVolume') || 'Approaching Limit',
        desc: t('listen.storage.warningDesc') || 'Storage capacity is above 70%. Consider pruning inactive channel posts.',
        bgClass: 'bg-amber-50 dark:bg-amber-950/60 border-amber-200 dark:border-amber-900/60 text-amber-700 dark:text-amber-300',
        dotClass: 'bg-amber-500',
        barClass: 'bg-gradient-to-r from-amber-500 to-orange-500',
        ringClass: 'ring-amber-500/20'
      };
    default:
      return {
        label: t('listen.storage.healthy') || 'Healthy Capacity',
        desc: t('listen.storage.healthyDesc') || 'IndexedDB storage and compound indexes operating well within optimal thresholds.',
        bgClass: 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200 dark:border-emerald-900/60 text-emerald-700 dark:text-emerald-300',
        dotClass: 'bg-emerald-500',
        barClass: 'bg-gradient-to-r from-teal-500 to-emerald-500',
        ringClass: 'ring-emerald-500/20'
      };
  }
});

const formattedOldestDate = computed(() => {
  if (!stats.value.oldestPostTimestamp) return "—";
  try {
    return new Date(stats.value.oldestPostTimestamp).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric"
    });
  } catch {
    return "—";
  }
});

const formattedNewestDate = computed(() => {
  if (!stats.value.newestPostTimestamp) return "—";
  try {
    return new Date(stats.value.newestPostTimestamp).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric"
    });
  } catch {
    return "—";
  }
});

const averagePostSizeFormatted = computed(() => {
  const bytes = stats.value.storageEstimate?.indexedDbBytes || stats.value.storageEstimate?.usageBytes;
  if (!bytes || !postCount.value) return "—";
  const bytesPerPost = bytes / postCount.value;
  if (bytesPerPost < 1024) return `${bytesPerPost.toFixed(0)} B/post`;
  return `${(bytesPerPost / 1024).toFixed(1)} KB/post`;
});

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function fetchStats(fast: boolean = false) {
  isLoading.value = true;
  try {
    const data = await getCacheStorageStatsIndexedDB({ fast });
    stats.value = data;
  } catch (err) {
    console.error("Failed to load storage monitor stats:", err);
  } finally {
    isLoading.value = false;
  }
}

async function handleRunPrune() {
  if (isPruning.value) return;
  isPruning.value = true;
  pruneMessage.value = null;

  try {
    // 60-day cutoff, guaranteed 30 newest posts per channel kept
    const res = await pruneOldPostsIndexedDB(60, 30);
    emit("pruned", res);

    if (res.postsPruned > 0) {
      pruneMessage.value = `Pruned ${res.postsPruned.toLocaleString()} posts across ${res.channelsPruned} channels (Safeguard preserved 30 newest per channel).`;
    } else {
      pruneMessage.value = `All channels are within the 60-day or minimum 30-post retention window. No pruning needed.`;
    }

    // Refresh metrics after prune
    await fetchStats(false);

    if (pruneMessageTimer.value) clearTimeout(pruneMessageTimer.value);
    pruneMessageTimer.value = setTimeout(() => {
      pruneMessage.value = null;
    }, 6000);
  } catch (err) {
    console.error("Storage prune error:", err);
    pruneMessage.value = "Storage optimization encountered an error.";
  } finally {
    isPruning.value = false;
  }
}

function toggleCollapsed() {
  isCollapsed.value = !isCollapsed.value;
  localStorage.setItem("listen_storage_monitor_collapsed", String(isCollapsed.value));
}

// ---------------------------------------------------------------------------
// Lifecycle & Sync Reactivity
// ---------------------------------------------------------------------------

onMounted(() => {
  fetchStats(false);
});

// Reactively refresh whenever posts are synced to IndexedDB
watch(
  () => props.lastDbUpdate,
  (newVal) => {
    if (newVal) {
      fetchStats(true);
    }
  }
);
</script>

<template>
  <div
    class="w-full bg-white dark:bg-gray-800 rounded-3xl border border-gray-200/90 dark:border-gray-700/80 shadow-xs transition-all duration-300 overflow-hidden"
    :class="[healthBadgeInfo.ringClass]"
  >
    <!-- Widget Top Header Bar -->
    <div
      class="px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 dark:border-gray-700/70 bg-gradient-to-r from-gray-50/70 via-white to-gray-50/40 dark:from-gray-800/80 dark:via-gray-800 dark:to-gray-800/60"
    >
      <!-- Title & Health Badge -->
      <div class="flex items-center gap-2.5 min-w-0">
        <div
          class="h-8 w-8 rounded-xl bg-teal-50 dark:bg-teal-950/70 text-teal-600 dark:text-teal-400 border border-teal-200/60 dark:border-teal-800/60 flex items-center justify-center shrink-0 shadow-2xs"
        >
          <Database class="h-4 w-4" />
        </div>
        <div>
          <div class="flex items-center gap-2">
            <h3 class="text-xs sm:text-sm font-black text-gray-900 dark:text-white flex items-center gap-1.5 tracking-tight">
              <span>{{ t('listen.storage.title') || 'IndexedDB Storage Monitor' }}</span>
              <span class="text-[10px] font-mono px-1.5 py-0.2 rounded-md bg-teal-100/70 dark:bg-teal-900/50 text-teal-800 dark:text-teal-300 font-bold">
                v2 Indexed
              </span>
            </h3>
            <!-- Health Badge -->
            <span
              class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold border shadow-2xs select-none"
              :class="healthBadgeInfo.bgClass"
            >
              <span class="w-1.5 h-1.5 rounded-full shrink-0" :class="healthBadgeInfo.dotClass"></span>
              <span>{{ healthBadgeInfo.label }}</span>
            </span>
          </div>
          <p class="text-[11px] text-gray-500 dark:text-gray-400 font-medium line-clamp-1">
            {{ healthBadgeInfo.desc }}
          </p>
        </div>
      </div>

      <!-- Controls & Actions -->
      <div class="flex items-center gap-1.5 shrink-0 ml-auto">
        <!-- Optimize & Prune Button -->
        <button
          type="button"
          @click="handleRunPrune"
          :disabled="isPruning || isLoading"
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer shadow-2xs border active:scale-95 disabled:opacity-50"
          :class="[
            healthLevel === 'critical'
              ? 'bg-rose-600 hover:bg-rose-700 text-white border-rose-700 shadow-rose-500/20'
              : 'bg-white hover:bg-teal-50 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 border-gray-200 dark:border-gray-700'
          ]"
          :title="'Cleans up posts older than 60 days while preserving at least 30 newest posts per channel'"
        >
          <Trash2 class="h-3.5 w-3.5" :class="{ 'animate-spin': isPruning }" />
          <span class="hidden sm:inline">{{ isPruning ? 'Optimizing...' : (t('listen.storage.pruneSafeguard') || 'Optimize & Prune') }}</span>
          <span class="sm:hidden">{{ isPruning ? 'Pruning...' : 'Prune' }}</span>
        </button>

        <!-- Refresh Button -->
        <button
          type="button"
          @click="() => fetchStats(false)"
          :disabled="isLoading || isPruning"
          class="h-8 w-8 rounded-xl bg-white hover:bg-gray-100 dark:bg-gray-800 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 flex items-center justify-center cursor-pointer transition-all active:scale-95 shadow-2xs disabled:opacity-50"
          title="Refresh storage statistics"
        >
          <RefreshCw class="h-3.5 w-3.5" :class="{ 'animate-spin': isLoading }" />
        </button>

        <!-- Expand / Collapse Toggle -->
        <button
          type="button"
          @click="toggleCollapsed"
          class="h-8 w-8 rounded-xl bg-white hover:bg-gray-100 dark:bg-gray-800 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 flex items-center justify-center cursor-pointer transition-all active:scale-95 shadow-2xs"
          :title="isCollapsed ? 'Expand storage details' : 'Collapse storage details'"
        >
          <ChevronUp v-if="!isCollapsed" class="h-4 w-4" />
          <ChevronDown v-else class="h-4 w-4" />
        </button>

        <!-- Dismiss / Close button -->
        <button
          v-if="allowDismiss"
          type="button"
          @click="emit('close')"
          class="h-8 w-8 rounded-xl bg-white hover:bg-gray-100 dark:bg-gray-800 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 flex items-center justify-center cursor-pointer transition-all active:scale-95 shadow-2xs"
          title="Hide storage monitor"
        >
          <X class="h-4 w-4" />
        </button>
      </div>
    </div>

    <!-- Prune Result Toast Banner -->
    <div
      v-if="pruneMessage"
      class="px-4 sm:px-6 py-2.5 bg-teal-50 dark:bg-teal-950/70 border-b border-teal-200/80 dark:border-teal-800/80 flex items-center justify-between gap-3 text-xs text-teal-800 dark:text-teal-200 font-semibold"
    >
      <div class="flex items-center gap-2">
        <ShieldCheck class="h-4 w-4 text-teal-600 dark:text-teal-400 shrink-0" />
        <span>{{ pruneMessage }}</span>
      </div>
      <button
        type="button"
        @click="pruneMessage = null"
        class="text-teal-600 hover:text-teal-800 dark:text-teal-300 cursor-pointer"
      >
        <X class="h-3.5 w-3.5" />
      </button>
    </div>

    <!-- Main Capacity Progress Bar (Always Visible) -->
    <div class="px-4 sm:px-6 py-4 bg-gray-50/40 dark:bg-gray-800/40">
      <div class="flex flex-col gap-2">
        <!-- Top Numbers Row -->
        <div class="flex items-baseline justify-between gap-3 flex-wrap">
          <div class="flex items-baseline gap-2">
            <span class="text-2xl sm:text-3xl font-black font-mono tracking-tight text-gray-900 dark:text-white tabular-nums">
              {{ postCount.toLocaleString() }}
            </span>
            <span class="text-xs sm:text-sm text-gray-400 dark:text-gray-500 font-mono font-medium">
              / {{ postLimit.toLocaleString() }} {{ t('listen.storage.postsLimit') || 'posts max' }}
            </span>
          </div>

          <div class="flex items-center gap-2">
            <span class="text-xs sm:text-sm font-black font-mono tabular-nums" :class="[
              healthLevel === 'critical' ? 'text-rose-600 dark:text-rose-400' :
              healthLevel === 'warning' ? 'text-amber-600 dark:text-amber-400' : 'text-teal-600 dark:text-teal-400'
            ]">
              {{ usagePercent.toFixed(1) }}%
            </span>
            <span class="text-xs text-gray-400 dark:text-gray-500">used</span>
            <span aria-hidden="true" class="text-gray-300 dark:text-gray-600">·</span>
            <span class="text-xs text-gray-600 dark:text-gray-300 font-semibold font-mono tabular-nums">
              {{ remainingHeadroom.toLocaleString() }} remaining
            </span>
          </div>
        </div>

        <!-- Progress Meter -->
        <div class="w-full h-3 rounded-full bg-gray-200/80 dark:bg-gray-700/80 overflow-hidden p-0.5 relative">
          <div
            class="h-full rounded-full transition-all duration-700 ease-out shadow-xs relative"
            :class="healthBadgeInfo.barClass"
            :style="{ width: `${Math.max(1, Math.min(100, usagePercent))}%` }"
          >
            <div class="absolute inset-0 bg-white/20 rounded-full animate-pulse"></div>
          </div>
        </div>

        <!-- Progress Milestones / Threshold Legend -->
        <div class="flex items-center justify-between text-[10px] text-gray-400 font-mono pt-0.5">
          <span>0 posts</span>
          <span class="hidden sm:inline">350K (70% warning)</span>
          <span class="hidden sm:inline">450K (90% critical)</span>
          <span>500K ceiling</span>
        </div>
      </div>
    </div>

    <!-- Detailed Diagnostic Metrics Grid (Collapsible) -->
    <div
      v-if="!isCollapsed"
      class="px-4 sm:px-6 py-4 border-t border-gray-100 dark:border-gray-700/70 grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 bg-white dark:bg-gray-800"
    >
      <!-- Metric 1: Disk Space Allocated -->
      <div class="p-3.5 rounded-2xl bg-gray-50/80 dark:bg-gray-900/50 border border-gray-200/60 dark:border-gray-700/60 flex flex-col justify-between">
        <div class="flex items-center justify-between text-gray-500 dark:text-gray-400 mb-1">
          <span class="text-[11px] font-bold">{{ t('listen.storage.diskUsage') || 'Disk Storage' }}</span>
          <HardDrive class="h-3.5 w-3.5 text-gray-400" />
        </div>
        <div class="text-lg font-black font-mono text-gray-900 dark:text-white tabular-nums">
          {{ stats.storageEstimate?.usageFormatted || '0 B' }}
        </div>
        <div class="text-[10px] text-gray-400 font-medium truncate pt-1">
          Quota: {{ stats.storageEstimate?.quotaFormatted || 'Available' }}
          <span v-if="stats.storageEstimate?.percentQuotaUsed" class="ml-1">
            ({{ stats.storageEstimate.percentQuotaUsed.toFixed(2) }}%)
          </span>
        </div>
      </div>

      <!-- Metric 2: Average Post Footprint -->
      <div class="p-3.5 rounded-2xl bg-gray-50/80 dark:bg-gray-900/50 border border-gray-200/60 dark:border-gray-700/60 flex flex-col justify-between">
        <div class="flex items-center justify-between text-gray-500 dark:text-gray-400 mb-1">
          <span class="text-[11px] font-bold">{{ t('listen.storage.postDensity') || 'Average Size' }}</span>
          <Sparkles class="h-3.5 w-3.5 text-gray-400" />
        </div>
        <div class="text-lg font-black font-mono text-gray-900 dark:text-white tabular-nums">
          {{ averagePostSizeFormatted }}
        </div>
        <div class="text-[10px] text-teal-600 dark:text-teal-400 font-semibold truncate pt-1">
          Normalized B-tree records
        </div>
      </div>

      <!-- Metric 3: Channels & Deduplicated Shared Posts -->
      <div class="p-3.5 rounded-2xl bg-gray-50/80 dark:bg-gray-900/50 border border-gray-200/60 dark:border-gray-700/60 flex flex-col justify-between">
        <div class="flex items-center justify-between text-gray-500 dark:text-gray-400 mb-1">
          <span class="text-[11px] font-bold">{{ t('listen.storage.channelsShared') || 'Channels & Shared' }}</span>
          <Layers class="h-3.5 w-3.5 text-gray-400" />
        </div>
        <div class="text-lg font-black font-mono text-gray-900 dark:text-white tabular-nums">
          {{ stats.channelCount }} <span class="text-xs font-normal text-gray-400">ch</span>
        </div>
        <div class="text-[10px] text-indigo-600 dark:text-indigo-400 font-semibold truncate pt-1" :title="`${stats.multiListenItemPostCount} posts shared across folders without duplicate disk storage`">
          {{ stats.multiListenItemPostCount.toLocaleString() }} deduplicated
        </div>
      </div>

      <!-- Metric 4: Timestamp Span -->
      <div class="p-3.5 rounded-2xl bg-gray-50/80 dark:bg-gray-900/50 border border-gray-200/60 dark:border-gray-700/60 flex flex-col justify-between">
        <div class="flex items-center justify-between text-gray-500 dark:text-gray-400 mb-1">
          <span class="text-[11px] font-bold">{{ t('listen.storage.dateSpan') || 'Cache Date Window' }}</span>
          <Calendar class="h-3.5 w-3.5 text-gray-400" />
        </div>
        <div class="text-xs font-black font-mono text-gray-900 dark:text-white truncate">
          {{ formattedOldestDate }}
        </div>
        <div class="text-[10px] text-gray-400 font-mono truncate pt-1">
          to {{ formattedNewestDate }}
        </div>
      </div>
    </div>
  </div>
</template>
