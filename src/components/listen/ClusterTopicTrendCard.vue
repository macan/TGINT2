<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';
import {
  TrendingUp,
  ChevronDown,
  ChevronUp,
  BarChart2,
} from 'lucide-vue-next';
import { useI18n } from '../../i18n';
import type { HotTopicCluster, HotsDateRange } from '../../utils/hotsEngine';
import {
  buildClusterTopicTrendData,
  type ClusterTrendScope,
  type ClusterTrendDisplayMode,
} from '../../utils/clusterTopicTrendData';
import { mountClusterTopicTrendChart } from './ClusterTopicTrendChart';

const props = withDefaults(
  defineProps<{
    topic: HotTopicCluster;
    dateRange: HotsDateRange;
    isDark?: boolean;
  }>(),
  {
    isDark: false,
  }
);

const { t } = useI18n();

const chartContainer = ref<HTMLElement | null>(null);
const scope = ref<ClusterTrendScope>('cluster');
const displayMode = ref<ClusterTrendDisplayMode>('interval');
const showPosts = ref<boolean>(true);
const showViews = ref<boolean>(true);
const isCollapsed = ref<boolean>(false);

let chartInstance: {
  update: (p: any) => void;
  destroy: () => void;
} | null = null;
let currentContainerEl: HTMLElement | null = null;
let resizeObserver: ResizeObserver | null = null;

// Reset scope to 'cluster' if active dateRange is 'all'
watch(
  () => props.dateRange,
  (next) => {
    if (next === 'all') {
      scope.value = 'cluster';
    }
  }
);

const canToggleRangeScope = computed(() => props.dateRange !== 'all');

const activeRangeLabel = computed(() => {
  switch (props.dateRange) {
    case 'today':
      return t('listen.hots.today') || 'Today';
    case 'yesterday':
      return t('listen.hots.yesterday') || 'Yesterday';
    case '3days':
      return t('listen.hots.last3Days') || 'Last 3 Days';
    case 'week':
      return t('listen.hots.lastWeek') || 'Last Week';
    default:
      return t('listen.hots.allTime') || 'All Time';
  }
});

const trendResult = computed(() =>
  buildClusterTopicTrendData(props.topic?.posts || [], props.dateRange, {
    scope: canToggleRangeScope.value ? scope.value : 'cluster',
  })
);

const dataPoints = computed(() => trendResult.value.dataPoints);
const stats = computed(() => trendResult.value.stats);

function toggleSeries(series: 'posts' | 'views') {
  if (series === 'posts') {
    if (showPosts.value && !showViews.value) return; // keep at least one series visible
    showPosts.value = !showPosts.value;
  } else {
    if (showViews.value && !showPosts.value) return;
    showViews.value = !showViews.value;
  }
}

function formatCompact(num: number): string {
  if (!num) return '0';
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return String(num);
}

function updateChart() {
  if (!chartContainer.value || isCollapsed.value || dataPoints.value.length === 0) return;

  const chartProps = {
    dataPoints: dataPoints.value,
    displayMode: displayMode.value,
    showPosts: showPosts.value,
    showViews: showViews.value,
    isDark: Boolean(props.isDark),
    labels: {
      posts: t('listen.hots.clusterTrendPostsSeries') || 'Posts',
      views: t('listen.hots.clusterTrendViewsSeries') || 'Views',
      cumulativePosts: t('listen.hots.clusterTrendCumPosts') || 'Cumulative Posts',
      cumulativeViews: t('listen.hots.clusterTrendCumViews') || 'Cumulative Views',
      channels: t('listen.hots.heatmapMetricChannels') || 'Channels',
      noData: t('listen.hots.clusterTrendEmpty') || 'No timeline data available for this cluster',
    },
  };

  if (!chartInstance || chartContainer.value !== currentContainerEl) {
    if (chartInstance) {
      try {
        chartInstance.destroy();
      } catch (e) {
        console.warn('Cluster trend chart destroy warning:', e);
      }
      chartInstance = null;
    }
    currentContainerEl = chartContainer.value;
    chartInstance = mountClusterTopicTrendChart(chartContainer.value, chartProps);
  } else {
    chartInstance.update(chartProps);
  }
}

function toggleCollapse() {
  isCollapsed.value = !isCollapsed.value;
  if (!isCollapsed.value) {
    nextTick(() => updateChart());
  }
}

onMounted(() => {
  nextTick(() => {
    updateChart();
    if (chartContainer.value && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        if (!isCollapsed.value && dataPoints.value.length > 0) {
          updateChart();
        }
      });
      resizeObserver.observe(chartContainer.value);
    }
  });
});

onBeforeUnmount(() => {
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
  }
  currentContainerEl = null;
});

watch(
  [
    () => props.topic?.id,
    () => props.topic?.posts?.length,
    () => props.topic?.totalViews,
    () => props.dateRange,
    () => props.isDark,
    scope,
    displayMode,
    showPosts,
    showViews,
  ],
  () => {
    nextTick(() => updateChart());
  }
);
</script>

<template>
  <div class="border-t border-gray-200/75 dark:border-gray-700/70 bg-white/85 dark:bg-gray-800/70">
    <!-- Trend Section Header & Interactive Controls -->
    <div
      class="px-4 sm:px-5 py-3 flex flex-col lg:flex-row lg:items-center justify-between gap-2.5 border-b border-gray-100 dark:border-gray-700/60"
    >
      <!-- Left: Title + Unboxed Tabular Context -->
      <div class="flex items-center gap-2.5 min-w-0">
        <TrendingUp class="h-4 w-4 text-teal-600 dark:text-teal-400 shrink-0" />
        <div class="min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <h5 class="text-xs sm:text-sm font-bold text-gray-900 dark:text-white tracking-tight">
              {{ t('listen.hots.clusterTrendTitle') || 'Cluster Activity & Views Timeline' }}
            </h5>
            <span class="text-[11px] font-mono tabular-nums text-gray-500 dark:text-gray-400">
              {{ stats.spanLabel }}
              <span aria-hidden="true" class="mx-1 text-gray-300 dark:text-gray-600">·</span>
              {{ stats.bucketUnitLabel }}
            </span>
          </div>
        </div>
      </div>

      <!-- Right: Series Toggles, Mode Toggle, Scope Toggle, Collapse -->
      <div class="flex items-center gap-2 flex-wrap justify-between sm:justify-end">
        <!-- Interactive Dual-Series Legend Toggles -->
        <div
          class="flex items-center gap-1 bg-gray-100/85 dark:bg-gray-900/70 p-0.5 rounded-xl border border-gray-200/60 dark:border-gray-700/60 text-[11px]"
          role="group"
          aria-label="Toggle chart series"
        >
          <button
            type="button"
            @click="toggleSeries('posts')"
            class="flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-semibold cursor-pointer transition-colors whitespace-nowrap shrink-0"
            :class="[
              showPosts
                ? 'bg-white dark:bg-gray-800 text-teal-700 dark:text-teal-300 shadow-2xs'
                : 'text-gray-400 dark:text-gray-500 line-through opacity-75 hover:opacity-100'
            ]"
            :aria-pressed="showPosts"
          >
            <span class="w-2.5 h-2.5 rounded-[3px] bg-teal-500 dark:bg-teal-400 shrink-0" />
            <span>{{ t('listen.hots.clusterTrendPostsSeries') || 'Posts' }}</span>
          </button>
          <button
            type="button"
            @click="toggleSeries('views')"
            class="flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-semibold cursor-pointer transition-colors whitespace-nowrap shrink-0"
            :class="[
              showViews
                ? 'bg-white dark:bg-gray-800 text-amber-700 dark:text-amber-300 shadow-2xs'
                : 'text-gray-400 dark:text-gray-500 line-through opacity-75 hover:opacity-100'
            ]"
            :aria-pressed="showViews"
          >
            <span class="w-3 h-0.5 rounded-full bg-amber-500 dark:bg-amber-400 shrink-0" />
            <span>{{ t('listen.hots.clusterTrendViewsSeries') || 'Views' }}</span>
          </button>
        </div>

        <!-- Interval vs Cumulative Segmented Toggle -->
        <div
          class="flex items-center gap-0.5 bg-gray-100/85 dark:bg-gray-900/70 p-0.5 rounded-xl border border-gray-200/60 dark:border-gray-700/60 text-[11px]"
          role="group"
          aria-label="Trend calculation mode"
        >
          <button
            type="button"
            @click="displayMode = 'interval'"
            class="px-2.5 py-1 rounded-lg font-semibold cursor-pointer transition-colors whitespace-nowrap shrink-0"
            :class="[
              displayMode === 'interval'
                ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-2xs'
                : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
            ]"
          >
            {{ t('listen.hots.clusterTrendInterval') || 'Interval' }}
          </button>
          <button
            type="button"
            @click="displayMode = 'cumulative'"
            class="px-2.5 py-1 rounded-lg font-semibold cursor-pointer transition-colors whitespace-nowrap shrink-0"
            :class="[
              displayMode === 'cumulative'
                ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-2xs'
                : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
            ]"
          >
            {{ t('listen.hots.clusterTrendCumulative') || 'Cumulative' }}
          </button>
        </div>

        <!-- Scope Toggle: Cluster Span vs Full Active Date Range -->
        <div
          v-if="canToggleRangeScope"
          class="flex items-center gap-0.5 bg-gray-100/85 dark:bg-gray-900/70 p-0.5 rounded-xl border border-gray-200/60 dark:border-gray-700/60 text-[11px]"
          role="group"
          aria-label="Timeline window scope"
        >
          <button
            type="button"
            @click="scope = 'cluster'"
            class="px-2.5 py-1 rounded-lg font-semibold cursor-pointer transition-colors whitespace-nowrap shrink-0"
            :class="[
              scope === 'cluster'
                ? 'bg-white dark:bg-gray-800 text-teal-700 dark:text-teal-300 shadow-2xs'
                : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
            ]"
          >
            {{ t('listen.hots.clusterTrendScopeFit') || 'Cluster Span' }}
          </button>
          <button
            type="button"
            @click="scope = 'range'"
            class="px-2.5 py-1 rounded-lg font-semibold cursor-pointer transition-colors whitespace-nowrap shrink-0"
            :class="[
              scope === 'range'
                ? 'bg-white dark:bg-gray-800 text-teal-700 dark:text-teal-300 shadow-2xs'
                : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
            ]"
          >
            {{ activeRangeLabel }}
          </button>
        </div>

        <!-- Collapse/Expand Button -->
        <button
          type="button"
          @click="toggleCollapse"
          class="h-7 w-7 rounded-lg bg-white hover:bg-gray-100 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 border border-gray-200/80 dark:border-gray-700/70 flex items-center justify-center cursor-pointer transition-colors shrink-0"
          :title="isCollapsed ? (t('listen.hots.clusterTrendExpand') || 'Show Timeline Chart') : (t('listen.hots.clusterTrendCollapse') || 'Hide Timeline Chart')"
          :aria-expanded="!isCollapsed"
        >
          <ChevronDown v-if="isCollapsed" class="h-3.5 w-3.5" />
          <ChevronUp v-else class="h-3.5 w-3.5" />
        </button>
      </div>
    </div>

    <!-- Unboxed Tabular Key Metrics Strip -->
    <div
      v-if="!isCollapsed && dataPoints.length > 0"
      class="px-4 sm:px-5 py-2 bg-gray-50/60 dark:bg-gray-900/30 border-b border-gray-100 dark:border-gray-700/50 flex items-center gap-x-4 gap-y-1 flex-wrap text-[11px] font-mono tabular-nums"
    >
      <div class="flex items-center gap-1.5">
        <span class="text-gray-400 dark:text-gray-500">{{ t('listen.hots.clusterTrendPeakPosts') || 'Peak Posts:' }}</span>
        <span class="font-bold text-teal-700 dark:text-teal-300">{{ stats.peakPosts }}</span>
        <span class="text-gray-500 dark:text-gray-400">@ {{ stats.peakPostsLabel }}</span>
      </div>

      <span aria-hidden="true" class="text-gray-300 dark:text-gray-700 hidden sm:inline">·</span>

      <div class="flex items-center gap-1.5">
        <span class="text-gray-400 dark:text-gray-500">{{ t('listen.hots.clusterTrendPeakViews') || 'Peak Views:' }}</span>
        <span class="font-bold text-amber-700 dark:text-amber-300">{{ formatCompact(stats.peakViews) }}</span>
        <span class="text-gray-500 dark:text-gray-400">@ {{ stats.peakViewsLabel }}</span>
      </div>

      <span aria-hidden="true" class="text-gray-300 dark:text-gray-700 hidden sm:inline">·</span>

      <div class="flex items-center gap-1.5">
        <span class="text-gray-400 dark:text-gray-500">{{ t('listen.hots.clusterTrendAvgViews') || 'Avg Views/Post:' }}</span>
        <span class="font-bold text-gray-800 dark:text-gray-200">{{ formatCompact(stats.avgViewsPerPost) }}</span>
      </div>

      <span aria-hidden="true" class="text-gray-300 dark:text-gray-700 hidden sm:inline">·</span>

      <div class="flex items-center gap-1.5">
        <span class="text-gray-400 dark:text-gray-500">{{ t('listen.hots.clusterTrendActiveSlots') || 'Active Slots:' }}</span>
        <span class="font-bold text-gray-800 dark:text-gray-200">{{ stats.activeBucketsCount }}</span>
      </div>
    </div>

    <!-- Dual-Axis Chart Area -->
    <div v-show="!isCollapsed" class="px-3 sm:px-5 pt-3 pb-3.5">
      <div
        v-if="dataPoints.length === 0"
        class="h-32 flex flex-col items-center justify-center gap-1.5 text-xs text-gray-400 dark:text-gray-500"
      >
        <BarChart2 class="h-6 w-6 opacity-50" />
        <span>{{ t('listen.hots.clusterTrendEmpty') || 'No timeline data available for this cluster.' }}</span>
      </div>

      <div
        ref="chartContainer"
        v-show="dataPoints.length > 0"
        class="w-full min-h-[230px]"
      ></div>
    </div>
  </div>
</template>
