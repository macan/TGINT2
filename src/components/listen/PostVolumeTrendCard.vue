<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';
import {
  Activity,
  TrendingUp,
  BarChart2,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Eye,
  Layers,
  Clock
} from 'lucide-vue-next';
import { HotPostItem, HotsDateRange } from '../../utils/hotsEngine';
import {
  generatePostTrendData,
  PostTrendDataPoint,
  PostTrendStats
} from '../../utils/postTrendData';
import {
  mountTrendChart,
  TrendViewMode
} from './PostVolumeTrendChart';

const props = withDefaults(
  defineProps<{
    posts: HotPostItem[];
    dateRange: HotsDateRange;
    isDark?: boolean;
    isComputing?: boolean;
  }>(),
  {
    isDark: false,
    isComputing: false
  }
);

const chartContainer = ref<HTMLElement | null>(null);
const currentViewMode = ref<TrendViewMode>('volume');
const isCollapsed = ref<boolean>(false);

let chartInstance: {
  update: (p: any) => void;
  destroy: () => void;
} | null = null;

// Compute trend data and stats
const processedData = computed(() => {
  return generatePostTrendData(props.posts || [], props.dateRange);
});

const dataPoints = computed(() => processedData.value.dataPoints);
const stats = computed(() => processedData.value.stats);

const dateRangeLabel = computed(() => {
  switch (props.dateRange) {
    case 'today':
      return 'Today (Hourly)';
    case 'yesterday':
      return 'Yesterday (Hourly)';
    case '3days':
      return 'Last 3 Days (3-hr intervals)';
    case 'week':
      return 'Last Week (Daily)';
    default:
      return 'All Time';
  }
});

function formatNumber(num: number | undefined): string {
  if (num == null) return '0';
  return Number(num).toLocaleString();
}

function updateChart() {
  if (!chartContainer.value || isCollapsed.value) return;

  const chartProps = {
    dataPoints: dataPoints.value,
    stats: stats.value,
    viewMode: currentViewMode.value,
    isDark: Boolean(props.isDark),
    dateRange: props.dateRange
  };

  if (!chartInstance) {
    chartInstance = mountTrendChart(chartContainer.value, chartProps);
  } else {
    chartInstance.update(chartProps);
  }
}

function toggleCollapse() {
  isCollapsed.value = !isCollapsed.value;
  if (!isCollapsed.value) {
    nextTick(() => {
      updateChart();
    });
  }
}

onMounted(() => {
  nextTick(() => {
    updateChart();
  });
});

onBeforeUnmount(() => {
  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
  }
});

watch(
  [
    () => props.posts,
    () => props.dateRange,
    () => props.isDark,
    currentViewMode
  ],
  () => {
    nextTick(() => {
      updateChart();
    });
  },
  { deep: true }
);
</script>

<template>
  <div class="bg-white dark:bg-gray-800 rounded-3xl border border-gray-200/80 dark:border-gray-700/80 shadow-sm overflow-hidden transition-all">
    <!-- Header Strip -->
    <div class="p-4 sm:p-5 border-b border-gray-100 dark:border-gray-700/80 bg-gray-50/50 dark:bg-gray-800/40 flex flex-col md:flex-row md:items-center justify-between gap-3">
      <!-- Title & Context -->
      <div class="flex items-center gap-3 min-w-0">
        <div class="h-9 w-9 rounded-2xl bg-teal-50 dark:bg-teal-950/60 text-teal-600 dark:text-teal-400 border border-teal-200/70 dark:border-teal-800/60 flex items-center justify-center shrink-0">
          <Activity class="h-5 w-5" />
        </div>
        <div class="min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <h4 class="text-sm sm:text-base font-black text-gray-900 dark:text-white tracking-tight">
              Post Volume Trend
            </h4>
            <span class="inline-flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded-lg bg-teal-50 dark:bg-teal-950/70 text-teal-700 dark:text-teal-300 font-semibold border border-teal-200/60 dark:border-teal-800/60">
              <Clock class="h-3 w-3" />
              {{ dateRangeLabel }}
            </span>
          </div>
          <p class="text-xs text-gray-500 dark:text-gray-400 font-mono mt-0.5">
            Temporal distribution of {{ formatNumber(stats.totalPosts) }} posts across active channels
          </p>
        </div>
      </div>

      <!-- Right Controls: View Mode Switcher & Stats Summary -->
      <div class="flex items-center gap-2 flex-wrap justify-between sm:justify-end">
        <!-- Segmented View Mode Toggle -->
        <div class="flex items-center gap-1 bg-gray-100/90 dark:bg-gray-900/70 p-1 rounded-2xl border border-gray-200/60 dark:border-gray-700/60 text-xs">
          <button
            type="button"
            @click="currentViewMode = 'volume'"
            class="flex items-center gap-1 px-2.5 py-1 rounded-xl font-bold cursor-pointer transition-all"
            :class="[
              currentViewMode === 'volume'
                ? 'bg-white dark:bg-gray-800 text-teal-600 dark:text-teal-400 shadow-2xs'
                : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
            ]"
          >
            <TrendingUp class="h-3 w-3" />
            <span>Volume</span>
          </button>
          <button
            type="button"
            @click="currentViewMode = 'views'"
            class="flex items-center gap-1 px-2.5 py-1 rounded-xl font-bold cursor-pointer transition-all"
            :class="[
              currentViewMode === 'views'
                ? 'bg-white dark:bg-gray-800 text-amber-600 dark:text-amber-400 shadow-2xs'
                : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
            ]"
          >
            <Eye class="h-3 w-3" />
            <span>Views</span>
          </button>
          <button
            type="button"
            @click="currentViewMode = 'breakdown'"
            class="flex items-center gap-1 px-2.5 py-1 rounded-xl font-bold cursor-pointer transition-all"
            :class="[
              currentViewMode === 'breakdown'
                ? 'bg-white dark:bg-gray-800 text-indigo-600 dark:text-indigo-400 shadow-2xs'
                : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
            ]"
          >
            <Layers class="h-3 w-3" />
            <span>Breakdown</span>
          </button>
        </div>

        <!-- Collapse/Expand Toggle -->
        <button
          type="button"
          @click="toggleCollapse"
          class="h-8 w-8 rounded-xl bg-white hover:bg-gray-100 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 border border-gray-200/80 dark:border-gray-700/70 flex items-center justify-center cursor-pointer transition-colors"
          :title="isCollapsed ? 'Expand Trend Chart' : 'Collapse Trend Chart'"
        >
          <ChevronDown v-if="isCollapsed" class="h-4 w-4" />
          <ChevronUp v-else class="h-4 w-4" />
        </button>
      </div>
    </div>

    <!-- Executive Metrics Ribbon -->
    <div
      v-if="!isCollapsed"
      class="px-4 sm:px-5 py-2.5 bg-gray-50/70 dark:bg-gray-850/40 border-b border-gray-100 dark:border-gray-700/60 flex items-center gap-4 sm:gap-6 text-xs font-mono tabular-nums flex-wrap"
    >
      <div class="flex items-center gap-1.5">
        <span class="text-gray-400 dark:text-gray-500">Peak Velocity:</span>
        <span class="font-bold text-gray-900 dark:text-white">
          {{ stats.peakVolume }} posts
        </span>
        <span class="text-teal-600 dark:text-teal-400 font-semibold">
          @ {{ stats.peakTimeLabel }}
        </span>
      </div>

      <div class="flex items-center gap-1.5">
        <span class="text-gray-400 dark:text-gray-500">Average:</span>
        <span class="font-bold text-gray-800 dark:text-gray-200">
          {{ stats.avgVolumePerBucket }}
        </span>
        <span class="text-gray-500">posts / {{ stats.bucketUnitLabel }}</span>
      </div>

      <div class="flex items-center gap-1.5">
        <span class="text-gray-400 dark:text-gray-500">Substantive vs Noise:</span>
        <span class="font-bold text-indigo-600 dark:text-indigo-400">
          {{ formatNumber(stats.substantivePosts) }} meaningful
        </span>
        <span class="text-gray-400">/</span>
        <span class="text-amber-600 dark:text-amber-400">
          {{ formatNumber(stats.mediaOnlyPosts) }} short
        </span>
      </div>

      <div class="flex items-center gap-1.5 sm:ml-auto">
        <span class="text-gray-400 dark:text-gray-500">Total Views:</span>
        <span class="font-bold text-amber-600 dark:text-amber-400">
          {{ formatNumber(stats.totalViews) }}
        </span>
      </div>
    </div>

    <!-- Chart Container Body -->
    <div v-show="!isCollapsed" class="p-4 sm:p-5">
      <!-- Loading Skeleton if computing and 0 posts yet -->
      <div v-if="isComputing && stats.totalPosts === 0" class="h-44 flex items-center justify-center animate-pulse">
        <div class="space-y-3 w-full">
          <div class="h-3 bg-gray-100 dark:bg-gray-700/50 rounded-md w-1/4"></div>
          <div class="h-28 bg-gray-50 dark:bg-gray-800/50 rounded-2xl w-full border border-gray-100 dark:border-gray-700/40"></div>
        </div>
      </div>

      <!-- Zero Posts Empty State -->
      <div
        v-else-if="stats.totalPosts === 0"
        class="h-40 flex flex-col items-center justify-center text-center p-4 text-xs text-gray-400 dark:text-gray-500 space-y-1"
      >
        <BarChart2 class="h-8 w-8 text-gray-300 dark:text-gray-600 stroke-1" />
        <p class="font-medium text-gray-600 dark:text-gray-400">
          No posts found within {{ dateRangeLabel }}.
        </p>
        <p class="text-[11px]">
          Posts synced into local IndexedDB will plot dynamically here.
        </p>
      </div>

      <!-- Recharts Canvas Mounted Target -->
      <div v-else ref="chartContainer" class="w-full min-h-[230px] pt-1"></div>
    </div>
  </div>
</template>
