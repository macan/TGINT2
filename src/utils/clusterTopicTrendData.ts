import { format, startOfHour, startOfDay, addHours } from 'date-fns';
import {
  type HotPostItem,
  type HotsDateRange,
  getDateRangeBounds,
} from './hotsEngine';
import { extractPostTrendTimestamp } from './postTrendData';

export type ClusterTrendScope = 'cluster' | 'range';
export type ClusterTrendDisplayMode = 'interval' | 'cumulative';

export interface ClusterTrendSamplePost {
  id: string | number;
  channelName: string;
  snippet: string;
  views: number;
  dateStr: string;
}

export interface ClusterTopicTrendPoint {
  timestamp: number;
  endTimestamp: number;
  timeLabel: string;
  fullDateLabel: string;
  posts: number;
  views: number;
  cumulativePosts: number;
  cumulativeViews: number;
  forwards: number;
  replies: number;
  channelCount: number;
  topChannels: string[];
  samplePosts: ClusterTrendSamplePost[];
}

export interface ClusterTopicTrendStats {
  totalPosts: number;
  totalViews: number;
  totalChannels: number;
  avgViewsPerPost: number;
  peakPosts: number;
  peakPostsLabel: string;
  peakViews: number;
  peakViewsLabel: string;
  activeBucketsCount: number;
  bucketUnitLabel: string;
  spanLabel: string;
}

export interface ClusterTopicTrendResult {
  dataPoints: ClusterTopicTrendPoint[];
  stats: ClusterTopicTrendStats;
  effectiveScope: ClusterTrendScope;
}

export interface BuildClusterTopicTrendOptions {
  scope?: ClusterTrendScope;
  now?: Date;
}

function floorToIntervalMs(ts: number, intervalMs: number): number {
  const d = new Date(ts);
  if (intervalMs >= 24 * 3600000) {
    return startOfDay(d).getTime();
  }
  if (intervalMs >= 3600000) {
    const hours = Math.round(intervalMs / 3600000);
    const dayStart = startOfDay(d).getTime();
    const hourIdx = Math.floor((ts - dayStart) / (hours * 3600000));
    return dayStart + hourIdx * hours * 3600000;
  }
  const mins = Math.max(1, Math.round(intervalMs / 60000));
  const hourStart = startOfHour(d).getTime();
  const minIdx = Math.floor((ts - hourStart) / (mins * 60000));
  return hourStart + minIdx * mins * 60000;
}

function formatDurationSpan(spanMs: number): string {
  if (spanMs <= 0) return 'Single moment';
  const totalMinutes = Math.round(spanMs / 60000);
  if (totalMinutes < 60) return `${Math.max(1, totalMinutes)}m span`;
  const totalHours = totalMinutes / 60;
  if (totalHours < 24) {
    const hrs = Math.floor(totalHours);
    const remMins = totalMinutes % 60;
    return remMins > 0 ? `${hrs}h ${remMins}m span` : `${hrs}h span`;
  }
  const days = Math.floor(totalHours / 24);
  const remHrs = Math.round(totalHours % 24);
  return remHrs > 0 ? `${days}d ${remHrs}h span` : `${days}d span`;
}

function buildBucketLabels(
  bStart: number,
  bEnd: number,
  bucketDurationMs: number,
  spansMultipleDays: boolean
): { timeLabel: string; fullDateLabel: string } {
  const startDate = new Date(bStart);
  const endDate = new Date(bEnd);

  if (bucketDurationMs < 3600000) {
    // Sub-hour (15m / 30m)
    const timeLabel = spansMultipleDays
      ? format(startDate, 'MMM d HH:mm')
      : format(startDate, 'HH:mm');
    const fullDateLabel = `${format(startDate, 'MMM d, yyyy')} · ${format(startDate, 'HH:mm')} – ${format(endDate, 'HH:mm')}`;
    return { timeLabel, fullDateLabel };
  }

  if (bucketDurationMs < 24 * 3600000) {
    // Hourly / 3-hr / 6-hr / 12-hr
    const timeLabel = spansMultipleDays
      ? format(startDate, 'MMM d HH:00')
      : format(startDate, 'HH:00');
    const fullDateLabel = `${format(startDate, 'EEE, MMM d')} · ${format(startDate, 'HH:00')} – ${format(endDate, 'HH:00')}`;
    return { timeLabel, fullDateLabel };
  }

  // Daily or multi-day
  const timeLabel = format(startDate, 'MMM d');
  const fullDateLabel =
    bucketDurationMs <= 24 * 3600000
      ? format(startDate, 'EEEE, MMM d, yyyy')
      : `${format(startDate, 'MMM d, yyyy')} – ${format(new Date(bEnd - 1), 'MMM d, yyyy')}`;
  return { timeLabel, fullDateLabel };
}

export function buildClusterTopicTrendData(
  posts: HotPostItem[],
  dateRange: HotsDateRange,
  options: BuildClusterTopicTrendOptions = {}
): ClusterTopicTrendResult {
  const requestedScope: ClusterTrendScope = options.scope || 'cluster';
  const effectiveScope: ClusterTrendScope =
    requestedScope === 'range' && dateRange === 'all' ? 'cluster' : requestedScope;
  const nowDate = options.now || new Date();

  const safePosts = Array.isArray(posts) ? posts : [];
  const timedPosts: Array<{ post: HotPostItem; ts: number }> = [];

  let minTs = Infinity;
  let maxTs = 0;

  for (const post of safePosts) {
    const ts = extractPostTrendTimestamp(post);
    if (ts > 0) {
      timedPosts.push({ post, ts });
      if (ts < minTs) minTs = ts;
      if (ts > maxTs) maxTs = ts;
    }
  }

  if (timedPosts.length === 0) {
    return {
      dataPoints: [],
      effectiveScope,
      stats: {
        totalPosts: 0,
        totalViews: 0,
        totalChannels: 0,
        avgViewsPerPost: 0,
        peakPosts: 0,
        peakPostsLabel: '—',
        peakViews: 0,
        peakViewsLabel: '—',
        activeBucketsCount: 0,
        bucketUnitLabel: 'hr',
        spanLabel: 'No timestamps',
      },
    };
  }

  let startTime: number;
  let endTime: number;
  let bucketDurationMs: number;
  let bucketCount: number;
  let bucketUnitLabel: string;
  let spansMultipleDays = false;

  if (effectiveScope === 'range') {
    const bounds = getDateRangeBounds(dateRange, nowDate);
    startTime = bounds.start;

    if (dateRange === 'today' || dateRange === 'yesterday') {
      bucketDurationMs = 3600000; // 1 hr
      bucketCount = 24;
      bucketUnitLabel = '1 hr';
      spansMultipleDays = false;
    } else if (dateRange === '3days') {
      bucketDurationMs = 3 * 3600000; // 3 hrs
      bucketCount = 24;
      bucketUnitLabel = '3 hrs';
      spansMultipleDays = true;
    } else {
      // 'week': 28 x 6-hr slots across 7 days
      bucketDurationMs = 6 * 3600000;
      bucketCount = 28;
      bucketUnitLabel = '6 hrs';
      spansMultipleDays = true;
    }
    endTime = startTime + bucketCount * bucketDurationMs;
  } else {
    // Cluster Span: fit sharply to the cluster's actual post timestamps
    const rawSpan = Math.max(0, maxTs - minTs);

    if (rawSpan < 15 * 60000) {
      // Single post or tight <15m cluster: centered 5-slot 15-min window for a clear visual curve
      bucketDurationMs = 15 * 60000;
      bucketUnitLabel = '15 min';
      const centerSlot = floorToIntervalMs(minTs, bucketDurationMs);
      startTime = centerSlot - 2 * bucketDurationMs;
      bucketCount = 5;
      endTime = startTime + bucketCount * bucketDurationMs;
    } else {
      if (rawSpan <= 3 * 3600000) {
        bucketDurationMs = 15 * 60000;
        bucketUnitLabel = '15 min';
      } else if (rawSpan <= 8 * 3600000) {
        bucketDurationMs = 30 * 60000;
        bucketUnitLabel = '30 min';
      } else if (rawSpan <= 36 * 3600000) {
        bucketDurationMs = 3600000;
        bucketUnitLabel = '1 hr';
      } else if (rawSpan <= 5 * 24 * 3600000) {
        bucketDurationMs = 3 * 3600000;
        bucketUnitLabel = '3 hrs';
      } else if (rawSpan <= 10 * 24 * 3600000) {
        bucketDurationMs = 6 * 3600000;
        bucketUnitLabel = '6 hrs';
      } else if (rawSpan <= 35 * 24 * 3600000) {
        bucketDurationMs = 24 * 3600000;
        bucketUnitLabel = '1 day';
      } else {
        const daysPerBucket = Math.max(2, Math.ceil(rawSpan / (28 * 24 * 3600000)));
        bucketDurationMs = daysPerBucket * 24 * 3600000;
        bucketUnitLabel = `${daysPerBucket} days`;
      }

      const alignedStart = floorToIntervalMs(minTs, bucketDurationMs);
      const alignedLast = floorToIntervalMs(maxTs, bucketDurationMs);
      const rawCount = Math.floor((alignedLast - alignedStart) / bucketDurationMs) + 1;

      // Add 1 subtle padding slot on each side when the series is compact so curves breathe cleanly
      if (rawCount <= 18) {
        startTime = alignedStart - bucketDurationMs;
        bucketCount = rawCount + 2;
      } else {
        startTime = alignedStart;
        bucketCount = Math.min(36, rawCount);
      }
      endTime = startTime + bucketCount * bucketDurationMs;
    }

    spansMultipleDays =
      format(new Date(startTime), 'yyyy-MM-dd') !==
      format(new Date(endTime - 1), 'yyyy-MM-dd');
  }

  interface BucketAcc {
    point: ClusterTopicTrendPoint;
    channelsSet: Set<string>;
    channelCountMap: Map<string, number>;
  }

  const accs: BucketAcc[] = [];

  for (let i = 0; i < bucketCount; i++) {
    const bStart = startTime + i * bucketDurationMs;
    const bEnd = bStart + bucketDurationMs;
    const { timeLabel, fullDateLabel } =
      effectiveScope === 'range' && (dateRange === 'today' || dateRange === 'yesterday')
        ? {
            timeLabel: format(new Date(bStart), 'HH:00'),
            fullDateLabel: `${format(new Date(bStart), 'MMM d, yyyy')} · ${format(new Date(bStart), 'HH:00')} – ${format(addHours(new Date(bStart), 1), 'HH:00')}`,
          }
        : buildBucketLabels(bStart, bEnd, bucketDurationMs, spansMultipleDays);

    accs.push({
      point: {
        timestamp: bStart,
        endTimestamp: bEnd,
        timeLabel,
        fullDateLabel,
        posts: 0,
        views: 0,
        cumulativePosts: 0,
        cumulativeViews: 0,
        forwards: 0,
        replies: 0,
        channelCount: 0,
        topChannels: [],
        samplePosts: [],
      },
      channelsSet: new Set<string>(),
      channelCountMap: new Map<string, number>(),
    });
  }

  // Sort chronologically before aggregation so sample posts and accumulation are deterministic
  timedPosts.sort((a, b) => a.ts - b.ts);

  let totalPosts = 0;
  let totalViews = 0;
  const globalChannels = new Set<string>();

  for (const { post, ts } of timedPosts) {
    if (ts < startTime - 60000 || ts > endTime + 60000) continue;

    const rawIdx = Math.floor((ts - startTime) / bucketDurationMs);
    const idx = Math.max(0, Math.min(bucketCount - 1, rawIdx));
    const acc = accs[idx];

    const views = Number(post.views) || 0;
    const forwards = Number(post.forwards) || 0;
    const replies = Number(post.replies) || 0;
    const chName = post.channelName || post.channelUsername || 'Unknown';

    acc.point.posts += 1;
    acc.point.views += views;
    acc.point.forwards += forwards;
    acc.point.replies += replies;
    acc.channelsSet.add(chName);
    acc.channelCountMap.set(chName, (acc.channelCountMap.get(chName) || 0) + 1);

    acc.point.samplePosts.push({
      id: post.id,
      channelName: chName,
      snippet: (post.cleanSnippet || post.text || '').replace(/\s+/g, ' ').trim().slice(0, 110),
      views,
      dateStr: post.dateStr || format(new Date(ts), 'MMM d, HH:mm'),
    });

    totalPosts += 1;
    totalViews += views;
    globalChannels.add(chName);
  }

  // Finalize cumulative series, top channels, peak slots, and top 2 sample posts per bucket
  let runningPosts = 0;
  let runningViews = 0;
  let peakPosts = 0;
  let peakPostsLabel = '—';
  let peakViews = 0;
  let peakViewsLabel = '—';
  let activeBucketsCount = 0;

  const dataPoints: ClusterTopicTrendPoint[] = accs.map((acc) => {
    const p = acc.point;
    runningPosts += p.posts;
    runningViews += p.views;
    p.cumulativePosts = runningPosts;
    p.cumulativeViews = runningViews;
    p.channelCount = acc.channelsSet.size;
    p.topChannels = Array.from(acc.channelCountMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([ch, cnt]) => (cnt > 1 ? `${ch} (${cnt})` : ch));
    p.samplePosts = p.samplePosts.sort((a, b) => b.views - a.views).slice(0, 2);

    if (p.posts > 0) {
      activeBucketsCount += 1;
    }
    if (p.posts > peakPosts) {
      peakPosts = p.posts;
      peakPostsLabel = p.timeLabel;
    }
    if (p.views > peakViews) {
      peakViews = p.views;
      peakViewsLabel = p.timeLabel;
    }

    return p;
  });

  const avgViewsPerPost = totalPosts > 0 ? Math.round(totalViews / totalPosts) : 0;
  const spanLabel =
    effectiveScope === 'range'
      ? dateRange === 'today'
        ? 'Today (Hourly)'
        : dateRange === 'yesterday'
          ? 'Yesterday (Hourly)'
          : dateRange === '3days'
            ? 'Last 3 Days'
            : 'Last 7 Days'
      : formatDurationSpan(maxTs - minTs);

  return {
    dataPoints,
    effectiveScope,
    stats: {
      totalPosts,
      totalViews,
      totalChannels: globalChannels.size,
      avgViewsPerPost,
      peakPosts,
      peakPostsLabel,
      peakViews,
      peakViewsLabel,
      activeBucketsCount,
      bucketUnitLabel,
      spanLabel,
    },
  };
}
