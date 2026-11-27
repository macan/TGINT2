import { format, startOfHour, addHours, subHours } from 'date-fns';
import {
  type HotTopicCluster,
  type HotsDateRange,
  getDateRangeBounds,
} from './hotsEngine';
import { extractPostTrendTimestamp } from './postTrendData';

export type HeatmapMetric = 'posts' | 'views' | 'channels';
export type HeatmapWindowMode = 'range' | '24h';

export interface HeatmapTimeBucket {
  index: number;
  startTs: number;
  endTs: number;
  label: string;
  shortLabel: string;
  dayGroup: string;
  fullLabel: string;
  isCurrent: boolean;
}

export interface HeatmapDayGroup {
  label: string;
  span: number;
  startIndex: number;
}

export interface HeatmapCellSamplePost {
  id: string | number;
  channelName: string;
  snippet: string;
  views: number;
  dateStr: string;
}

export interface HeatmapCell {
  bucketIndex: number;
  postCount: number;
  views: number;
  forwards: number;
  replies: number;
  channelCount: number;
  channels: string[];
  metricValue: number;
  normalized: number; // 0..1
  level: 0 | 1 | 2 | 3 | 4;
  samplePosts: HeatmapCellSamplePost[];
}

export interface HeatmapClusterRow {
  topicId: string;
  rank: number;
  title: string;
  titleZh?: string;
  category?: string;
  topic: HotTopicCluster;
  cells: HeatmapCell[];
  totalPosts: number;
  totalViews: number;
  totalChannels: number;
  peakBucketIndex: number;
  peakValue: number;
  activeBucketsCount: number;
}

export interface HeatmapColumnSummary {
  bucketIndex: number;
  totalPosts: number;
  totalViews: number;
  activeClustersCount: number;
  normalizedHeight: number; // 0..1
}

export interface ClusterHeatmapPeakInfo {
  clusterTitle: string;
  timeLabel: string;
  value: number;
  postCount: number;
  views: number;
  channelCount: number;
}

export interface ClusterHeatmapMatrix {
  buckets: HeatmapTimeBucket[];
  dayGroups: HeatmapDayGroup[];
  rows: HeatmapClusterRow[];
  columnSummaries: HeatmapColumnSummary[];
  maxCellValue: number;
  globalMaxPosts: number;
  totalActiveCells: number;
  totalPostsPlotted: number;
  totalClustersAvailable: number;
  peakCell: ClusterHeatmapPeakInfo | null;
  windowLabel: string;
  bucketUnitLabel: string;
  metric: HeatmapMetric;
  windowMode: HeatmapWindowMode;
}

export interface BuildClusterHeatmapOptions {
  metric?: HeatmapMetric;
  windowMode?: HeatmapWindowMode;
  maxClusters?: number;
  now?: Date;
}

function buildDayGroups(buckets: HeatmapTimeBucket[]): HeatmapDayGroup[] {
  if (buckets.length === 0) return [];
  const groups: HeatmapDayGroup[] = [];
  for (const b of buckets) {
    const last = groups[groups.length - 1];
    if (last && last.label === b.dayGroup) {
      last.span++;
    } else {
      groups.push({ label: b.dayGroup, span: 1, startIndex: b.index });
    }
  }
  return groups;
}

function resolveTimeBuckets(
  topics: HotTopicCluster[],
  dateRange: HotsDateRange,
  windowMode: HeatmapWindowMode,
  nowDate: Date
): {
  buckets: HeatmapTimeBucket[];
  startTime: number;
  endTime: number;
  bucketDurationMs: number;
  windowLabel: string;
  bucketUnitLabel: string;
} {
  const nowMs = nowDate.getTime();
  const currentHourStart = startOfHour(nowDate).getTime();

  // Rolling 24-hour density view (last 24 hourly slots ending with current hour)
  if (windowMode === '24h') {
    const startTime = subHours(startOfHour(nowDate), 23).getTime();
    const bucketDurationMs = 3600000;
    const endTime = startTime + 24 * bucketDurationMs;
    const buckets: HeatmapTimeBucket[] = [];

    for (let i = 0; i < 24; i++) {
      const bStart = startTime + i * bucketDurationMs;
      const bEnd = bStart + bucketDurationMs;
      const bDate = new Date(bStart);
      const bEndDate = new Date(bEnd);
      buckets.push({
        index: i,
        startTs: bStart,
        endTs: bEnd,
        label: format(bDate, 'HH:00'),
        shortLabel: i % 3 === 0 || i === 23 ? format(bDate, 'HH') : '',
        dayGroup: format(bDate, 'MMM d'),
        fullLabel: `${format(bDate, 'MMM d')} · ${format(bDate, 'HH:00')} – ${format(bEndDate, 'HH:00')}`,
        isCurrent: bStart === currentHourStart,
      });
    }

    return {
      buckets,
      startTime,
      endTime,
      bucketDurationMs,
      windowLabel: 'Last 24 Hours (Hourly)',
      bucketUnitLabel: 'hr',
    };
  }

  const bounds = getDateRangeBounds(dateRange, nowDate);

  // Today / Yesterday: 24 hourly buckets (00:00 – 23:00)
  if (dateRange === 'today' || dateRange === 'yesterday') {
    const startTime = bounds.start;
    const bucketDurationMs = 3600000;
    const endTime = startTime + 24 * bucketDurationMs;
    const buckets: HeatmapTimeBucket[] = [];

    for (let i = 0; i < 24; i++) {
      const bStart = startTime + i * bucketDurationMs;
      const bEnd = bStart + bucketDurationMs;
      const bDate = new Date(bStart);
      const bEndDate = addHours(bDate, 1);
      buckets.push({
        index: i,
        startTs: bStart,
        endTs: bEnd,
        label: format(bDate, 'HH:00'),
        shortLabel: i % 3 === 0 || i === 23 ? format(bDate, 'HH') : '',
        dayGroup: format(bDate, 'EEE, MMM d'),
        fullLabel: `${format(bDate, 'MMM d, yyyy')} · ${format(bDate, 'HH:00')} – ${format(bEndDate, 'HH:00')}`,
        isCurrent: dateRange === 'today' && bStart === currentHourStart,
      });
    }

    return {
      buckets,
      startTime,
      endTime,
      bucketDurationMs,
      windowLabel: dateRange === 'today' ? 'Today (Hourly)' : 'Yesterday (Hourly)',
      bucketUnitLabel: 'hr',
    };
  }

  // Last 3 Days: 24 x 3-hour buckets across the 3 calendar days
  if (dateRange === '3days') {
    const startTime = bounds.start;
    const bucketDurationMs = 3 * 3600000;
    const bucketCount = 24;
    const endTime = startTime + bucketCount * bucketDurationMs;
    const buckets: HeatmapTimeBucket[] = [];

    for (let i = 0; i < bucketCount; i++) {
      const bStart = startTime + i * bucketDurationMs;
      const bEnd = bStart + bucketDurationMs;
      const bDate = new Date(bStart);
      const bEndDate = new Date(bEnd);
      const hour = bDate.getHours();
      buckets.push({
        index: i,
        startTs: bStart,
        endTs: bEnd,
        label: format(bDate, 'MMM d HH:00'),
        shortLabel: hour === 0 || hour === 12 ? format(bDate, 'HH') : '',
        dayGroup: format(bDate, 'EEE MMM d'),
        fullLabel: `${format(bDate, 'EEE, MMM d')} · ${format(bDate, 'HH:00')} – ${format(bEndDate, 'HH:00')}`,
        isCurrent: nowMs >= bStart && nowMs < bEnd,
      });
    }

    return {
      buckets,
      startTime,
      endTime,
      bucketDurationMs,
      windowLabel: 'Last 3 Days (3-hr blocks)',
      bucketUnitLabel: '3 hrs',
    };
  }

  // Last Week: 28 x 6-hour buckets across 7 days (4 blocks/day: 00, 06, 12, 18)
  if (dateRange === 'week') {
    const startTime = bounds.start;
    const bucketDurationMs = 6 * 3600000;
    const bucketCount = 28;
    const endTime = startTime + bucketCount * bucketDurationMs;
    const buckets: HeatmapTimeBucket[] = [];

    for (let i = 0; i < bucketCount; i++) {
      const bStart = startTime + i * bucketDurationMs;
      const bEnd = bStart + bucketDurationMs;
      const bDate = new Date(bStart);
      const bEndDate = new Date(bEnd);
      const hour = bDate.getHours();
      buckets.push({
        index: i,
        startTs: bStart,
        endTs: bEnd,
        label: `${format(bDate, 'EEE')} ${format(bDate, 'HH:00')}`,
        shortLabel: hour === 0 ? '00' : hour === 12 ? '12' : '',
        dayGroup: format(bDate, 'EEE MMM d'),
        fullLabel: `${format(bDate, 'EEE, MMM d')} · ${format(bDate, 'HH:00')} – ${format(bEndDate, 'HH:00')}`,
        isCurrent: nowMs >= bStart && nowMs < bEnd,
      });
    }

    return {
      buckets,
      startTime,
      endTime,
      bucketDurationMs,
      windowLabel: 'Last 7 Days (6-hr blocks)',
      bucketUnitLabel: '6 hrs',
    };
  }

  // All Time: dynamic 24 evenly-spaced buckets fitted to actual topic post span
  let minTs = Infinity;
  let maxTs = 0;
  for (const tp of topics) {
    for (const p of tp.posts || []) {
      const ts = extractPostTrendTimestamp(p);
      if (ts > 0) {
        if (ts < minTs) minTs = ts;
        if (ts > maxTs) maxTs = ts;
      }
    }
  }

  if (!Number.isFinite(minTs) || maxTs <= 0) {
    // Fallback to rolling 24h when no timestamps exist
    return resolveTimeBuckets(topics, 'today', '24h', nowDate);
  }

  const rawSpan = Math.max(3600000, maxTs - minTs);
  const bucketCount = 24;
  const startTime = startOfHour(new Date(minTs)).getTime();
  const bucketDurationMs = Math.max(
    3600000,
    Math.ceil((Math.max(maxTs + 60000, startTime + rawSpan) - startTime) / bucketCount)
  );
  const endTime = startTime + bucketCount * bucketDurationMs;
  const isSubDaySpan = rawSpan <= 36 * 3600000;
  const isMultiMonthSpan = rawSpan > 90 * 24 * 3600000;

  const buckets: HeatmapTimeBucket[] = [];
  for (let i = 0; i < bucketCount; i++) {
    const bStart = startTime + i * bucketDurationMs;
    const bEnd = bStart + bucketDurationMs;
    const bDate = new Date(bStart);
    const bEndDate = new Date(bEnd - 1);

    const label = isSubDaySpan
      ? format(bDate, 'HH:00')
      : isMultiMonthSpan
        ? format(bDate, 'MMM yy')
        : format(bDate, 'MMM d');
    const shortLabel =
      i % 4 === 0 || i === bucketCount - 1
        ? isSubDaySpan
          ? format(bDate, 'HH:00')
          : format(bDate, 'MMM d')
        : '';

    buckets.push({
      index: i,
      startTs: bStart,
      endTs: bEnd,
      label,
      shortLabel,
      dayGroup: isSubDaySpan
        ? format(bDate, 'MMM d')
        : isMultiMonthSpan
          ? format(bDate, 'yyyy')
          : format(bDate, 'MMM yyyy'),
      fullLabel: isSubDaySpan
        ? `${format(bDate, 'MMM d')} · ${format(bDate, 'HH:00')} – ${format(new Date(bEnd), 'HH:00')}`
        : `${format(bDate, 'MMM d, yyyy')} – ${format(bEndDate, 'MMM d, yyyy')}`,
      isCurrent: nowMs >= bStart && nowMs < bEnd,
    });
  }

  const hoursPerBucket = bucketDurationMs / 3600000;
  const bucketUnitLabel =
    hoursPerBucket < 24
      ? `${Math.round(hoursPerBucket)}h`
      : `${Math.max(1, Math.round(hoursPerBucket / 24))}d`;

  return {
    buckets,
    startTime,
    endTime,
    bucketDurationMs,
    windowLabel: `All Time (${bucketUnitLabel} slots)`,
    bucketUnitLabel,
  };
}

function quantizeThermalLevel(value: number, maxValue: number): {
  normalized: number;
  level: 0 | 1 | 2 | 3 | 4;
} {
  if (value <= 0 || maxValue <= 0) {
    return { normalized: 0, level: 0 };
  }
  // Perceptual square-root scaling prevents a single extreme spike from washing out moderate bursts
  const normalized = Math.min(1, Math.sqrt(value / maxValue));
  if (normalized <= 0.28) return { normalized, level: 1 };
  if (normalized <= 0.54) return { normalized, level: 2 };
  if (normalized <= 0.78) return { normalized, level: 3 };
  return { normalized, level: 4 };
}

export function buildClusterHeatmapData(
  topics: HotTopicCluster[],
  dateRange: HotsDateRange,
  options: BuildClusterHeatmapOptions = {}
): ClusterHeatmapMatrix {
  const metric: HeatmapMetric = options.metric || 'posts';
  const windowMode: HeatmapWindowMode = options.windowMode || 'range';
  const maxClusters = Math.max(1, Math.min(30, options.maxClusters ?? 12));
  const nowDate = options.now || new Date();

  const safeTopics = Array.isArray(topics) ? topics : [];
  const {
    buckets,
    startTime,
    endTime,
    bucketDurationMs,
    windowLabel,
    bucketUnitLabel,
  } = resolveTimeBuckets(safeTopics, dateRange, windowMode, nowDate);

  const dayGroups = buildDayGroups(buckets);
  const bucketCount = buckets.length;

  // Build raw per-cluster matrix over top N clusters (pre-ranked by hotScore).
  // In rolling 24h mode over wider datasets (3days/week/all), scan past inactive clusters so up to maxClusters active rows are shown.
  interface RawCellAcc {
    postCount: number;
    views: number;
    forwards: number;
    replies: number;
    channelsSet: Set<string>;
    samplePosts: HeatmapCellSamplePost[];
  }

  const rawRows: Array<{
    topic: HotTopicCluster;
    rank: number;
    cellAccs: RawCellAcc[];
    totalPosts: number;
    totalViews: number;
    channelsSet: Set<string>;
  }> = [];

  let maxCellValue = 0;
  let globalMaxPosts = 0;

  for (let rIdx = 0; rIdx < safeTopics.length; rIdx++) {
    if (rawRows.length >= maxClusters) break;
    const topic = safeTopics[rIdx];
    const cellAccs: RawCellAcc[] = Array.from({ length: bucketCount }, () => ({
      postCount: 0,
      views: 0,
      forwards: 0,
      replies: 0,
      channelsSet: new Set<string>(),
      samplePosts: [],
    }));

    let rowTotalPosts = 0;
    let rowTotalViews = 0;
    const rowChannelsSet = new Set<string>();

    for (const post of topic.posts || []) {
      const ts = extractPostTrendTimestamp(post);
      if (!ts) continue;
      if (ts < startTime - 60000 || ts > endTime + 60000) continue;

      const rawIdx = Math.floor((ts - startTime) / bucketDurationMs);
      const bIdx = Math.max(0, Math.min(bucketCount - 1, rawIdx));
      const acc = cellAccs[bIdx];

      const views = Number(post.views) || 0;
      const forwards = Number(post.forwards) || 0;
      const replies = Number(post.replies) || 0;
      const chName = post.channelName || post.channelUsername || 'Unknown';

      acc.postCount++;
      acc.views += views;
      acc.forwards += forwards;
      acc.replies += replies;
      acc.channelsSet.add(chName);

      if (acc.samplePosts.length < 3) {
        acc.samplePosts.push({
          id: post.id,
          channelName: chName,
          snippet: (post.cleanSnippet || post.text || '').slice(0, 120),
          views,
          dateStr: post.dateStr || format(new Date(ts), 'MMM d, HH:mm'),
        });
      }

      rowTotalPosts++;
      rowTotalViews += views;
      rowChannelsSet.add(chName);
    }

    // In rolling 24h mode over a wider dataset (e.g. week/all), skip clusters with 0 posts in the 24h window
    if (windowMode === '24h' && rowTotalPosts === 0) {
      continue;
    }

    for (let b = 0; b < bucketCount; b++) {
      const acc = cellAccs[b];
      if (acc.postCount > globalMaxPosts) {
        globalMaxPosts = acc.postCount;
      }
      const val =
        metric === 'views'
          ? acc.views
          : metric === 'channels'
            ? acc.channelsSet.size
            : acc.postCount;
      if (val > maxCellValue) {
        maxCellValue = val;
      }
    }

    rawRows.push({
      topic,
      rank: rIdx + 1,
      cellAccs,
      totalPosts: rowTotalPosts,
      totalViews: rowTotalViews,
      channelsSet: rowChannelsSet,
    });
  }

  // Finalize normalized cells, column summaries, and peak burst telemetry
  const colAcc = Array.from({ length: bucketCount }, () => ({
    totalPosts: 0,
    totalViews: 0,
    activeClustersCount: 0,
  }));

  let totalActiveCells = 0;
  let totalPostsPlotted = 0;
  let peakCell: ClusterHeatmapPeakInfo | null = null;
  let peakVal = 0;

  const rows: HeatmapClusterRow[] = rawRows.map((rr) => {
    let peakBucketIndex = 0;
    let rowPeakVal = 0;
    let activeBucketsCount = 0;

    const cells: HeatmapCell[] = rr.cellAccs.map((acc, bIdx) => {
      const channelCount = acc.channelsSet.size;
      const metricValue =
        metric === 'views'
          ? acc.views
          : metric === 'channels'
            ? channelCount
            : acc.postCount;

      const { normalized, level } = quantizeThermalLevel(metricValue, maxCellValue);

      if (acc.postCount > 0) {
        activeBucketsCount++;
        totalActiveCells++;
        totalPostsPlotted += acc.postCount;
        colAcc[bIdx].totalPosts += acc.postCount;
        colAcc[bIdx].totalViews += acc.views;
        colAcc[bIdx].activeClustersCount++;
      }

      if (metricValue > rowPeakVal) {
        rowPeakVal = metricValue;
        peakBucketIndex = bIdx;
      }

      if (metricValue > peakVal) {
        peakVal = metricValue;
        peakCell = {
          clusterTitle: rr.topic.title,
          timeLabel: buckets[bIdx]?.label || '',
          value: metricValue,
          postCount: acc.postCount,
          views: acc.views,
          channelCount,
        };
      }

      const sortedSamples = [...acc.samplePosts].sort((a, b) => b.views - a.views);

      return {
        bucketIndex: bIdx,
        postCount: acc.postCount,
        views: acc.views,
        forwards: acc.forwards,
        replies: acc.replies,
        channelCount,
        channels: Array.from(acc.channelsSet),
        metricValue,
        normalized,
        level,
        samplePosts: sortedSamples,
      };
    });

    return {
      topicId: rr.topic.id,
      rank: rr.rank,
      title: rr.topic.title,
      titleZh: rr.topic.titleZh,
      category: rr.topic.category,
      topic: rr.topic,
      cells,
      totalPosts: rr.totalPosts,
      totalViews: rr.totalViews,
      totalChannels: rr.channelsSet.size,
      peakBucketIndex,
      peakValue: rowPeakVal,
      activeBucketsCount,
    };
  });

  const maxColValue = Math.max(
    1,
    ...colAcc.map((c) => (metric === 'views' ? c.totalViews : c.totalPosts))
  );

  const columnSummaries: HeatmapColumnSummary[] = colAcc.map((c, idx) => {
    const val = metric === 'views' ? c.totalViews : c.totalPosts;
    return {
      bucketIndex: idx,
      totalPosts: c.totalPosts,
      totalViews: c.totalViews,
      activeClustersCount: c.activeClustersCount,
      normalizedHeight: val > 0 ? Math.max(0.14, Math.sqrt(val / maxColValue)) : 0,
    };
  });

  return {
    buckets,
    dayGroups,
    rows,
    columnSummaries,
    maxCellValue,
    globalMaxPosts,
    totalActiveCells,
    totalPostsPlotted,
    totalClustersAvailable: safeTopics.length,
    peakCell,
    windowLabel,
    bucketUnitLabel,
    metric,
    windowMode,
  };
}
