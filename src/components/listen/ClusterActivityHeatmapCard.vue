<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import {
  Flame,
  Eye,
  Radio,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  Clock,
  Grid2x2,
} from 'lucide-vue-next';
import { useI18n } from '../../i18n';
import type { HotTopicCluster, HotsDateRange } from '../../utils/hotsEngine';
import {
  buildClusterHeatmapData,
  type HeatmapCell,
  type HeatmapClusterRow,
  type HeatmapMetric,
  type HeatmapWindowMode,
} from '../../utils/clusterHeatmapData';

const props = withDefaults(
  defineProps<{
    topics: HotTopicCluster[];
    dateRange: HotsDateRange;
    dayKey?: string;
    isDark?: boolean;
    isComputing?: boolean;
  }>(),
  {
    dayKey: '',
    isDark: false,
    isComputing: false,
  }
);

const emit = defineEmits<{
  (e: 'inspect-topic', topic: HotTopicCluster): void;
}>();

const { t } = useI18n();

const activeMetric = ref<HeatmapMetric>('posts');
const windowMode = ref<HeatmapWindowMode>('range');
const maxClusters = ref<number>(12);
const isCollapsed = ref<boolean>(false);

// Reset to active range mode whenever user switches the top-level date range
// (keeps 'yesterday' cleanly in range mode since yesterday is strictly outside last 24h)
watch(
  () => props.dateRange,
  (nextRange) => {
    if (nextRange === 'yesterday') {
      windowMode.value = 'range';
    } else if (windowMode.value === '24h' && nextRange !== 'today') {
      windowMode.value = 'range';
    }
  }
);

const canToggle24h = computed(() => props.dateRange !== 'yesterday');

const matrix = computed(() => {
  void props.dayKey;
  return buildClusterHeatmapData(props.topics || [], props.dateRange, {
    metric: activeMetric.value,
    windowMode: canToggle24h.value ? windowMode.value : 'range',
    maxClusters: maxClusters.value,
  });
});

const showDayGroupHeader = computed(() => matrix.value.dayGroups.length > 1);

const activeRangeButtonLabel = computed(() => {
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

// Interactive hover & focus tooltip state
const hoveredRowId = ref<string | null>(null);
const hoveredColIdx = ref<number | null>(null);
const activeTooltip = ref<{
  row: HeatmapClusterRow;
  cell: HeatmapCell;
  x: number;
  y: number;
} | null>(null);

function positionTooltipFromRect(rect: DOMRect) {
  const tooltipWidth = 300;
  const tooltipHeight = 200;
  const pad = 12;
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;

  let x = rect.left + rect.width / 2 - tooltipWidth / 2;
  x = Math.max(pad, Math.min(vw - tooltipWidth - pad, x));

  let y = rect.top - tooltipHeight - 10;
  if (y < pad) {
    y = Math.min(vh - tooltipHeight - pad, rect.bottom + 10);
  }
  return { x, y };
}

function handleCellEnter(
  row: HeatmapClusterRow,
  cell: HeatmapCell,
  event: MouseEvent | FocusEvent
) {
  hoveredRowId.value = row.topicId;
  hoveredColIdx.value = cell.bucketIndex;
  const target = event.currentTarget as HTMLElement | null;
  if (!target) return;
  const { x, y } = positionTooltipFromRect(target.getBoundingClientRect());
  activeTooltip.value = { row, cell, x, y };
}

function handleCellLeave() {
  hoveredRowId.value = null;
  hoveredColIdx.value = null;
  activeTooltip.value = null;
}

function handleCellClick(row: HeatmapClusterRow) {
  activeTooltip.value = null;
  emit('inspect-topic', row.topic);
}

function formatCompact(num: number): string {
  if (!num) return '0';
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return String(num);
}

function formatFull(num: number): string {
  return Number(num || 0).toLocaleString();
}

function getCellColorClass(level: 0 | 1 | 2 | 3 | 4): string {
  switch (level) {
    case 0:
      return 'bg-gray-100/85 dark:bg-gray-900/65 text-transparent hover:bg-gray-200/80 dark:hover:bg-gray-800';
    case 1:
      return 'bg-teal-100 dark:bg-teal-950/90 text-teal-800 dark:text-teal-300';
    case 2:
      return 'bg-teal-400/85 dark:bg-teal-600/85 text-teal-950 dark:text-white';
    case 3:
      return 'bg-amber-400 dark:bg-amber-500/90 text-amber-950 dark:text-gray-950';
    case 4:
      return 'bg-orange-600 dark:bg-orange-500 text-white dark:text-white';
  }
}

function getCellDisplayText(cell: HeatmapCell): string {
  if (cell.metricValue <= 0) return '';
  if (activeMetric.value === 'views') {
    return cell.views >= 1000 ? formatCompact(cell.views) : '';
  }
  return cell.metricValue > 99 ? '99+' : String(cell.metricValue);
}

function formatPeakMetricLabel(): string {
  const peak = matrix.value.peakCell;
  if (!peak) return '—';
  if (activeMetric.value === 'views') {
    return `${formatCompact(peak.views)} ${t('listen.hots.viewsCount') || 'views'}`;
  }
  if (activeMetric.value === 'channels') {
    return `${peak.channelCount} ${t('listen.hots.channelsInvolved') || 'channels'}`;
  }
  return `${peak.postCount} ${t('listen.hots.postsCount') || 'posts'}`;
}
</script>

<template>
  <section
    class="bg-white dark:bg-gray-800 rounded-3xl border border-gray-200/80 dark:border-gray-700/80 shadow-sm overflow-hidden transition-colors"
    aria-label="Cluster Activity Density Heat Map"
  >
    <!-- Header Strip -->
    <div
      class="p-4 sm:p-5 border-b border-gray-100 dark:border-gray-700/80 bg-gray-50/50 dark:bg-gray-800/40 flex flex-col xl:flex-row xl:items-center justify-between gap-3"
    >
      <!-- Left: Title & Clean Unboxed Subtitle -->
      <div class="flex items-center gap-3 min-w-0">
        <div
          class="h-9 w-9 rounded-2xl bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 border border-amber-200/70 dark:border-amber-800/60 flex items-center justify-center shrink-0"
        >
          <Grid2x2 class="h-5 w-5" />
        </div>
        <div class="min-w-0">
          <h4 class="text-sm sm:text-base font-black text-gray-900 dark:text-white tracking-tight truncate">
            {{ t('listen.hots.heatmapTitle') || 'Cluster Activity Heat Map' }}
          </h4>
          <p class="text-xs text-gray-500 dark:text-gray-400 font-mono tabular-nums mt-0.5 truncate">
            <span>{{ matrix.windowLabel }}</span>
            <span aria-hidden="true" class="mx-1.5 text-gray-300 dark:text-gray-600">·</span>
            <span>{{ matrix.rows.length }} / {{ matrix.totalClustersAvailable }} {{ t('listen.hots.heatmapClustersUnit') || 'clusters' }}</span>
            <span aria-hidden="true" class="mx-1.5 text-gray-300 dark:text-gray-600">·</span>
            <span>{{ formatFull(matrix.totalPostsPlotted) }} {{ t('listen.hots.postsCount') || 'posts' }}</span>
          </p>
        </div>
      </div>

      <!-- Right: Interactive Controls (Time Window, Metric, Row Count, Collapse) -->
      <div class="flex items-center gap-2 flex-wrap justify-between sm:justify-end">
        <!-- Time Window Toggle: Active Range vs Rolling Last 24h -->
        <div
          v-if="canToggle24h"
          class="flex items-center gap-0.5 bg-gray-100/90 dark:bg-gray-900/70 p-1 rounded-2xl border border-gray-200/60 dark:border-gray-700/60 text-xs"
          role="group"
          aria-label="Heat map time window"
        >
          <button
            type="button"
            @click="windowMode = 'range'"
            class="flex items-center gap-1 px-2.5 py-1 rounded-xl font-bold cursor-pointer transition-colors whitespace-nowrap shrink-0"
            :class="[
              windowMode === 'range'
                ? 'bg-white dark:bg-gray-800 text-teal-600 dark:text-teal-400 shadow-2xs'
                : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
            ]"
          >
            <span>{{ activeRangeButtonLabel }}</span>
          </button>
          <button
            type="button"
            @click="windowMode = '24h'"
            class="flex items-center gap-1 px-2.5 py-1 rounded-xl font-bold cursor-pointer transition-colors whitespace-nowrap shrink-0"
            :class="[
              windowMode === '24h'
                ? 'bg-white dark:bg-gray-800 text-amber-600 dark:text-amber-400 shadow-2xs'
                : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
            ]"
            :title="t('listen.hots.heatmapLast24hHint') || 'Rolling 24-hour density ending at the current hour'"
          >
            <Clock class="h-3 w-3 shrink-0" />
            <span>{{ t('listen.hots.heatmapLast24h') || 'Last 24h' }}</span>
          </button>
        </div>

        <!-- Metric Selector: Posts | Views | Channels -->
        <div
          class="flex items-center gap-0.5 bg-gray-100/90 dark:bg-gray-900/70 p-1 rounded-2xl border border-gray-200/60 dark:border-gray-700/60 text-xs"
          role="group"
          aria-label="Heat map intensity metric"
        >
          <button
            type="button"
            @click="activeMetric = 'posts'"
            class="flex items-center gap-1 px-2.5 py-1 rounded-xl font-bold cursor-pointer transition-colors whitespace-nowrap shrink-0"
            :class="[
              activeMetric === 'posts'
                ? 'bg-white dark:bg-gray-800 text-teal-600 dark:text-teal-400 shadow-2xs'
                : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
            ]"
          >
            <MessageSquare class="h-3 w-3 shrink-0" />
            <span>{{ t('listen.hots.heatmapMetricPosts') || 'Posts' }}</span>
          </button>
          <button
            type="button"
            @click="activeMetric = 'views'"
            class="flex items-center gap-1 px-2.5 py-1 rounded-xl font-bold cursor-pointer transition-colors whitespace-nowrap shrink-0"
            :class="[
              activeMetric === 'views'
                ? 'bg-white dark:bg-gray-800 text-amber-600 dark:text-amber-400 shadow-2xs'
                : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
            ]"
          >
            <Eye class="h-3 w-3 shrink-0" />
            <span>{{ t('listen.hots.heatmapMetricViews') || 'Views' }}</span>
          </button>
          <button
            type="button"
            @click="activeMetric = 'channels'"
            class="flex items-center gap-1 px-2.5 py-1 rounded-xl font-bold cursor-pointer transition-colors whitespace-nowrap shrink-0"
            :class="[
              activeMetric === 'channels'
                ? 'bg-white dark:bg-gray-800 text-indigo-600 dark:text-indigo-400 shadow-2xs'
                : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
            ]"
          >
            <Radio class="h-3 w-3 shrink-0" />
            <span>{{ t('listen.hots.heatmapMetricChannels') || 'Channels' }}</span>
          </button>
        </div>

        <!-- Row Count Segmented Selector -->
        <div
          class="flex items-center gap-0.5 bg-gray-100/90 dark:bg-gray-900/70 p-1 rounded-2xl border border-gray-200/60 dark:border-gray-700/60 text-xs font-mono tabular-nums"
          role="group"
          aria-label="Clusters shown"
        >
          <button
            v-for="limit in [8, 12, 20]"
            :key="limit"
            type="button"
            @click="maxClusters = limit"
            class="px-2 py-1 rounded-xl font-bold cursor-pointer transition-colors whitespace-nowrap shrink-0"
            :class="[
              maxClusters === limit
                ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-2xs'
                : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
            ]"
            :title="`Show top ${limit} clusters`"
          >
            {{ limit }}
          </button>
        </div>

        <!-- Collapse/Expand Toggle -->
        <button
          type="button"
          @click="isCollapsed = !isCollapsed"
          class="h-8 w-8 rounded-xl bg-white hover:bg-gray-100 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 border border-gray-200/80 dark:border-gray-700/70 flex items-center justify-center cursor-pointer transition-colors shrink-0"
          :title="isCollapsed ? (t('listen.hots.heatmapExpand') || 'Expand Heat Map') : (t('listen.hots.heatmapCollapse') || 'Collapse Heat Map')"
          :aria-expanded="!isCollapsed"
        >
          <ChevronDown v-if="isCollapsed" class="h-4 w-4" />
          <ChevronUp v-else class="h-4 w-4" />
        </button>
      </div>
    </div>

    <!-- Summary Telemetry & Thermal Scale Strip (Unboxed Tabular Typography) -->
    <div
      v-if="!isCollapsed"
      class="px-4 sm:px-5 py-2.5 bg-gray-50/70 dark:bg-gray-900/30 border-b border-gray-100 dark:border-gray-700/60 flex items-center justify-between gap-4 text-xs font-mono tabular-nums flex-wrap"
    >
      <div class="flex items-center gap-3 sm:gap-5 flex-wrap min-w-0">
        <div class="flex items-center gap-1.5 min-w-0">
          <span class="text-gray-400 dark:text-gray-500">{{ t('listen.hots.heatmapPeakBurst') || 'Peak Burst:' }}</span>
          <span v-if="matrix.peakCell" class="font-bold text-gray-900 dark:text-white truncate">
            {{ formatPeakMetricLabel() }}
            <span class="text-amber-600 dark:text-amber-400 font-semibold">@ {{ matrix.peakCell.timeLabel }}</span>
          </span>
          <span v-else class="text-gray-500">—</span>
        </div>

        <span aria-hidden="true" class="text-gray-300 dark:text-gray-700 hidden sm:inline">·</span>

        <div class="flex items-center gap-1.5">
          <span class="text-gray-400 dark:text-gray-500">{{ t('listen.hots.heatmapActiveCells') || 'Active Slots:' }}</span>
          <span class="font-bold text-gray-800 dark:text-gray-200">{{ matrix.totalActiveCells }}</span>
        </div>

        <span aria-hidden="true" class="text-gray-300 dark:text-gray-700 hidden md:inline">·</span>

        <span class="text-gray-500 dark:text-gray-400 hidden md:inline">
          {{ t('listen.hots.heatmapClickHint') || 'Click any cluster or hot cell to inspect posts' }}
        </span>
      </div>

      <!-- 5-Step Thermal Scale Legend -->
      <div class="flex items-center gap-1.5 shrink-0 text-[11px] text-gray-500 dark:text-gray-400">
        <span>{{ t('listen.hots.heatmapLess') || 'Less' }}</span>
        <span class="h-3 w-3 rounded-[3px] bg-gray-100 dark:bg-gray-900/70 border border-gray-200/80 dark:border-gray-700/80" title="0"></span>
        <span class="h-3 w-3 rounded-[3px] bg-teal-100 dark:bg-teal-950/90 border border-teal-200/70 dark:border-teal-800/70" title="Low"></span>
        <span class="h-3 w-3 rounded-[3px] bg-teal-400/85 dark:bg-teal-600/85" title="Moderate"></span>
        <span class="h-3 w-3 rounded-[3px] bg-amber-400 dark:bg-amber-500/90" title="High"></span>
        <span class="h-3 w-3 rounded-[3px] bg-orange-600 dark:bg-orange-500" title="Peak"></span>
        <span>{{ t('listen.hots.heatmapMore') || 'More' }}</span>
      </div>
    </div>

    <!-- Main Heat Map Canvas -->
    <div v-show="!isCollapsed" class="p-4 sm:p-5">
      <!-- Loading Skeleton when topics are still clustering -->
      <div v-if="isComputing && topics.length === 0" class="space-y-2.5 animate-pulse py-1">
        <div class="flex items-center gap-3">
          <div class="w-44 sm:w-56 h-3.5 bg-gray-100 dark:bg-gray-700/60 rounded"></div>
          <div class="flex-1 grid grid-cols-12 gap-1">
            <div v-for="c in 12" :key="c" class="h-3 bg-gray-100 dark:bg-gray-700/50 rounded"></div>
          </div>
        </div>
        <div v-for="r in 6" :key="r" class="flex items-center gap-3">
          <div class="w-44 sm:w-56 h-6 bg-gray-100 dark:bg-gray-700/50 rounded-md"></div>
          <div
            class="flex-1 grid gap-1"
            :style="{ gridTemplateColumns: 'repeat(24, minmax(0, 1fr))' }"
          >
            <div
              v-for="c in 24"
              :key="c"
              class="h-6 rounded-[4px] bg-gray-100/90 dark:bg-gray-800/80"
            ></div>
          </div>
        </div>
      </div>

      <!-- Empty State -->
      <div
        v-else-if="matrix.rows.length === 0"
        class="py-10 px-4 text-center flex flex-col items-center justify-center gap-2 text-xs text-gray-500 dark:text-gray-400"
      >
        <Flame class="h-7 w-7 text-gray-300 dark:text-gray-600 stroke-1.5" />
        <p class="font-semibold text-gray-700 dark:text-gray-300">
          {{
            windowMode === '24h' && topics.length > 0
              ? (t('listen.hots.heatmapEmpty24h') || 'No cluster activity recorded in the last 24 hours.')
              : (t('listen.hots.heatmapEmpty') || 'No topic clusters available to plot in this date range.')
          }}
        </p>
        <button
          v-if="windowMode === '24h' && topics.length > 0"
          type="button"
          @click="windowMode = 'range'"
          class="mt-1 px-3 py-1.5 rounded-xl text-xs font-bold bg-teal-600 hover:bg-teal-700 text-white cursor-pointer transition-colors whitespace-nowrap"
        >
          {{ t('listen.hots.heatmapSwitchToRange') || `Switch to ${activeRangeButtonLabel}` }}
        </button>
      </div>

      <!-- Populated 2D Cluster × Time Heat Map Matrix -->
      <div v-else class="overflow-x-auto pb-1">
        <div
          class="min-w-[760px]"
          @mouseleave="handleCellLeave"
        >
          <!-- Optional Multi-Day Group Header Row -->
          <div v-if="showDayGroupHeader" class="flex items-end mb-1">
            <div class="w-[215px] sm:w-[255px] shrink-0 sticky left-0 bg-white dark:bg-gray-800 z-10 pr-3"></div>
            <div
              class="flex-1 grid gap-1"
              :style="{ gridTemplateColumns: `repeat(${matrix.buckets.length}, minmax(0, 1fr))` }"
            >
              <div
                v-for="grp in matrix.dayGroups"
                :key="`${grp.label}-${grp.startIndex}`"
                :style="{ gridColumn: `span ${grp.span} / span ${grp.span}` }"
                class="text-[10px] font-mono font-bold text-gray-500 dark:text-gray-400 border-b border-gray-200/70 dark:border-gray-700/70 pb-1 truncate"
                :class="grp.startIndex > 0 ? 'pl-1.5 border-l border-gray-200/70 dark:border-gray-700/70' : ''"
              >
                {{ grp.label }}
              </div>
            </div>
            <div class="w-14 shrink-0"></div>
          </div>

          <!-- Time Axis Column Labels -->
          <div class="flex items-center mb-1.5">
            <div
              class="w-[215px] sm:w-[255px] shrink-0 sticky left-0 bg-white dark:bg-gray-800 z-10 pr-3 text-[11px] font-bold text-gray-400 dark:text-gray-500"
            >
              {{ t('listen.hots.heatmapClusterColumn') || 'Topic Cluster' }}
            </div>
            <div
              class="flex-1 grid gap-1"
              :style="{ gridTemplateColumns: `repeat(${matrix.buckets.length}, minmax(0, 1fr))` }"
            >
              <div
                v-for="bucket in matrix.buckets"
                :key="bucket.index"
                class="text-center font-mono text-[10px] tabular-nums select-none transition-colors leading-tight"
                :class="[
                  hoveredColIdx === bucket.index
                    ? 'text-teal-700 dark:text-teal-300 font-black'
                    : bucket.isCurrent
                      ? 'text-amber-600 dark:text-amber-400 font-bold'
                      : 'text-gray-400 dark:text-gray-500'
                ]"
                :title="bucket.fullLabel"
              >
                {{ bucket.shortLabel || '·' }}
              </div>
            </div>
            <div
              class="w-14 shrink-0 text-right pl-2 text-[10px] font-mono font-bold text-gray-400 dark:text-gray-500 tabular-nums"
            >
              {{ t('listen.hots.heatmapTotalColumn') || 'Total' }}
            </div>
          </div>

          <!-- Cluster Rows -->
          <div class="space-y-1">
            <div
              v-for="row in matrix.rows"
              :key="row.topicId"
              class="flex items-center group/row rounded-lg transition-colors"
              :class="hoveredRowId === row.topicId ? 'bg-gray-50/90 dark:bg-gray-700/40' : ''"
            >
              <!-- Sticky Left Cluster Label -->
              <button
                type="button"
                @click="handleCellClick(row)"
                @mouseenter="hoveredRowId = row.topicId"
                class="w-[215px] sm:w-[255px] shrink-0 sticky left-0 z-10 pr-3 py-1 text-left flex items-center gap-2 cursor-pointer transition-colors rounded-l-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
                :class="
                  hoveredRowId === row.topicId
                    ? 'bg-gray-50 dark:bg-gray-800 text-teal-700 dark:text-teal-300'
                    : 'bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 hover:text-teal-700 dark:hover:text-teal-300'
                "
                :title="row.titleZh ? `${row.title}\n${row.titleZh}` : row.title"
              >
                <span class="text-[10px] font-mono font-black text-amber-600 dark:text-amber-400 tabular-nums w-5 shrink-0">
                  #{{ row.rank }}
                </span>
                <span class="text-xs font-semibold truncate flex-1 leading-snug">
                  {{ row.title }}
                </span>
              </button>

              <!-- 24–28 Heat Map Cells -->
              <div
                class="flex-1 grid gap-1"
                :style="{ gridTemplateColumns: `repeat(${matrix.buckets.length}, minmax(0, 1fr))` }"
              >
                <button
                  v-for="cell in row.cells"
                  :key="cell.bucketIndex"
                  type="button"
                  @mouseenter="handleCellEnter(row, cell, $event)"
                  @focus="handleCellEnter(row, cell, $event)"
                  @blur="handleCellLeave"
                  @click="handleCellClick(row)"
                  class="h-7 rounded-[4px] flex items-center justify-center font-mono text-[9px] font-bold tabular-nums cursor-pointer transition-transform duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
                  :class="[
                    getCellColorClass(cell.level),
                    hoveredColIdx === cell.bucketIndex && hoveredRowId === row.topicId
                      ? 'ring-2 ring-gray-900/75 dark:ring-white/85 scale-[1.08] z-10'
                      : hoveredColIdx === cell.bucketIndex
                        ? 'ring-1 ring-teal-500/40'
                        : matrix.buckets[cell.bucketIndex]?.isCurrent && cell.level === 0
                          ? 'ring-1 ring-inset ring-amber-400/50 dark:ring-amber-500/40'
                          : ''
                  ]"
                  :aria-label="`${row.title}, ${matrix.buckets[cell.bucketIndex]?.fullLabel}, ${cell.postCount} posts`"
                >
                  <span class="truncate px-0.5 leading-none select-none">
                    {{ getCellDisplayText(cell) }}
                  </span>
                </button>
              </div>

              <!-- Row Aggregate Total -->
              <div class="w-14 shrink-0 text-right pl-2 font-mono text-[11px] font-bold tabular-nums text-gray-600 dark:text-gray-300">
                <template v-if="activeMetric === 'views'">
                  {{ formatCompact(row.totalViews) }}
                </template>
                <template v-else-if="activeMetric === 'channels'">
                  {{ row.totalChannels }}
                </template>
                <template v-else>
                  {{ row.totalPosts }}
                </template>
              </div>
            </div>
          </div>

          <!-- Bottom Aggregate Density Silhouette Strip -->
          <div class="flex items-end mt-2.5 pt-2.5 border-t border-gray-100 dark:border-gray-700/70">
            <div
              class="w-[215px] sm:w-[255px] shrink-0 sticky left-0 bg-white dark:bg-gray-800 z-10 pr-3 text-[10px] font-mono text-gray-400 dark:text-gray-500"
            >
              {{ t('listen.hots.heatmapAllClustersPulse') || 'Combined Pulse' }}
            </div>
            <div
              class="flex-1 grid gap-1 items-end h-7"
              :style="{ gridTemplateColumns: `repeat(${matrix.buckets.length}, minmax(0, 1fr))` }"
            >
              <div
                v-for="col in matrix.columnSummaries"
                :key="col.bucketIndex"
                class="h-full flex items-end"
                :title="`${matrix.buckets[col.bucketIndex]?.fullLabel}: ${col.totalPosts} posts across ${col.activeClustersCount} clusters`"
              >
                <div
                  class="w-full rounded-t-[3px] transition-opacity duration-150"
                  :class="[
                    col.totalPosts > 0
                      ? hoveredColIdx === col.bucketIndex
                        ? 'bg-orange-500 dark:bg-orange-400 opacity-100'
                        : 'bg-teal-500/70 dark:bg-teal-400/65 opacity-85'
                      : 'bg-gray-100 dark:bg-gray-900/60'
                  ]"
                  :style="{
                    height: col.totalPosts > 0 ? `${Math.round(col.normalizedHeight * 100)}%` : '3px'
                  }"
                ></div>
              </div>
            </div>
            <div class="w-14 shrink-0 text-right pl-2 font-mono text-[10px] font-bold tabular-nums text-teal-700 dark:text-teal-300">
              {{ formatFull(matrix.totalPostsPlotted) }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Floating Viewport-Clamped Cell Tooltip -->
    <Teleport to="body">
      <div
        v-if="activeTooltip"
        class="fixed z-[120] w-[300px] pointer-events-none rounded-2xl bg-gray-950/95 dark:bg-gray-900/98 text-white border border-gray-800 shadow-xl p-3.5 text-xs space-y-2"
        :style="{ left: `${activeTooltip.x}px`, top: `${activeTooltip.y}px` }"
        role="tooltip"
      >
        <div class="space-y-0.5">
          <div class="font-mono text-[10px] text-teal-400 tabular-nums">
            {{ matrix.buckets[activeTooltip.cell.bucketIndex]?.fullLabel }}
          </div>
          <div class="font-bold text-white leading-snug line-clamp-2">
            #{{ activeTooltip.row.rank }} {{ activeTooltip.row.title }}
          </div>
          <div
            v-if="activeTooltip.row.titleZh"
            class="text-[11px] text-gray-300 leading-snug line-clamp-1"
          >
            {{ activeTooltip.row.titleZh }}
          </div>
        </div>

        <div class="grid grid-cols-3 gap-2 pt-2 border-t border-gray-800 font-mono tabular-nums">
          <div>
            <div class="text-[10px] text-gray-400">{{ t('listen.hots.heatmapMetricPosts') || 'Posts' }}</div>
            <div class="text-sm font-black text-white">{{ activeTooltip.cell.postCount }}</div>
          </div>
          <div>
            <div class="text-[10px] text-gray-400">{{ t('listen.hots.heatmapMetricViews') || 'Views' }}</div>
            <div class="text-sm font-black text-amber-400">{{ formatCompact(activeTooltip.cell.views) }}</div>
          </div>
          <div>
            <div class="text-[10px] text-gray-400">{{ t('listen.hots.heatmapMetricChannels') || 'Channels' }}</div>
            <div class="text-sm font-black text-teal-400">{{ activeTooltip.cell.channelCount }}</div>
          </div>
        </div>

        <div
          v-if="activeTooltip.cell.samplePosts.length > 0"
          class="pt-2 border-t border-gray-800 space-y-1.5"
        >
          <div
            v-for="sp in activeTooltip.cell.samplePosts.slice(0, 2)"
            :key="sp.id"
            class="text-[11px] leading-snug text-gray-300"
          >
            <span class="font-semibold text-teal-300">{{ sp.channelName }}:</span>
            <span class="ml-1 line-clamp-2">{{ sp.snippet }}</span>
          </div>
        </div>
        <div v-else class="pt-1.5 border-t border-gray-800 text-[11px] text-gray-400">
          {{ t('listen.hots.heatmapNoSlotActivity') || 'No posts in this time slot · Click to inspect cluster' }}
        </div>
      </div>
    </Teleport>
  </section>
</template>
