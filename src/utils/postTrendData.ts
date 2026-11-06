import { format, startOfDay, addHours, addDays, startOfHour } from 'date-fns';
import { HotPostItem, HotsDateRange, getDateRangeBounds } from './hotsEngine';

export interface PostTrendDataPoint {
  timestamp: number;
  timeLabel: string;
  fullDateLabel: string;
  volume: number;
  substantiveVolume: number;
  mediaOnlyVolume: number;
  views: number;
  forwards: number;
  replies: number;
  channelCount: number;
  topChannels: string[];
}

export interface PostTrendStats {
  totalPosts: number;
  totalViews: number;
  totalForwards: number;
  substantivePosts: number;
  mediaOnlyPosts: number;
  peakVolume: number;
  peakTimeLabel: string;
  peakViews: number;
  avgVolumePerBucket: number;
  bucketUnitLabel: string;
  activeBucketsCount: number;
}

function normalizeTimestampMs(ts: any): number {
  if (typeof ts === 'number') {
    return ts < 10000000000 ? ts * 1000 : ts;
  }
  if (typeof ts === 'string') {
    const num = Number(ts);
    if (!isNaN(num)) {
      return num < 10000000000 ? num * 1000 : num;
    }
    const parsed = Date.parse(ts);
    if (!isNaN(parsed)) return parsed;
  }
  return 0;
}

export function generatePostTrendData(
  posts: HotPostItem[],
  dateRange: HotsDateRange
): { dataPoints: PostTrendDataPoint[]; stats: PostTrendStats } {
  const bounds = getDateRangeBounds(dateRange);
  const now = Date.now();
  const startTime = bounds.start;
  const endTime = Math.min(bounds.end, now + 3600000);

  // Determine bucket interval and unit label based on date range
  let bucketDurationMs = 3600000; // 1 hour default
  let bucketUnitLabel = 'hr';
  let bucketCount = 24;

  if (dateRange === 'today') {
    bucketDurationMs = 3600000; // 1 hour
    bucketUnitLabel = 'hr';
    bucketCount = 24;
  } else if (dateRange === 'yesterday') {
    bucketDurationMs = 3600000; // 1 hour
    bucketUnitLabel = 'hr';
    bucketCount = 24;
  } else if (dateRange === '3days') {
    bucketDurationMs = 3 * 3600000; // 3 hours
    bucketUnitLabel = '3 hrs';
    bucketCount = Math.max(1, Math.ceil((endTime - startTime) / bucketDurationMs));
  } else if (dateRange === 'week') {
    bucketDurationMs = 24 * 3600000; // 1 day
    bucketUnitLabel = 'day';
    bucketCount = Math.max(1, Math.ceil((endTime - startTime) / bucketDurationMs));
  } else {
    // 'all' time: dynamic bucket sizing to keep 15-30 data points
    const span = Math.max(3600000, endTime - startTime);
    if (span <= 48 * 3600000) {
      bucketDurationMs = 2 * 3600000; // 2 hours
      bucketUnitLabel = '2 hrs';
    } else if (span <= 14 * 24 * 3600000) {
      bucketDurationMs = 24 * 3600000; // 1 day
      bucketUnitLabel = 'day';
    } else if (span <= 60 * 24 * 3600000) {
      bucketDurationMs = 3 * 24 * 3600000; // 3 days
      bucketUnitLabel = '3 days';
    } else {
      bucketDurationMs = 7 * 24 * 3600000; // 1 week
      bucketUnitLabel = 'week';
    }
    bucketCount = Math.max(1, Math.min(40, Math.ceil(span / bucketDurationMs)));
  }

  // Pre-initialize empty buckets with clean labels
  const buckets: PostTrendDataPoint[] = [];
  const bucketMap = new Map<number, {
    point: PostTrendDataPoint;
    channelsSet: Set<string>;
    channelVolumeMap: Map<string, number>;
  }>();

  for (let i = 0; i < bucketCount; i++) {
    const bStart = startTime + i * bucketDurationMs;
    const bDate = new Date(bStart);

    let timeLabel = '';
    let fullDateLabel = '';

    if (dateRange === 'today' || dateRange === 'yesterday') {
      timeLabel = format(bDate, 'HH:00');
      fullDateLabel = `${format(bDate, 'MMM d, yyyy')} · ${format(bDate, 'HH:00')} - ${format(addHours(bDate, 1), 'HH:00')}`;
    } else if (dateRange === '3days') {
      timeLabel = format(bDate, 'MMM d HH:00');
      fullDateLabel = `${format(bDate, 'EEE, MMM d')} · ${format(bDate, 'HH:00')} - ${format(new Date(bStart + bucketDurationMs), 'HH:00')}`;
    } else if (dateRange === 'week') {
      timeLabel = format(bDate, 'EEE (MMM d)');
      fullDateLabel = format(bDate, 'EEEE, MMMM d, yyyy');
    } else {
      timeLabel = format(bDate, 'MMM d');
      fullDateLabel = `${format(bDate, 'MMM d, yyyy')} - ${format(new Date(bStart + bucketDurationMs - 1), 'MMM d, yyyy')}`;
    }

    const point: PostTrendDataPoint = {
      timestamp: bStart,
      timeLabel,
      fullDateLabel,
      volume: 0,
      substantiveVolume: 0,
      mediaOnlyVolume: 0,
      views: 0,
      forwards: 0,
      replies: 0,
      channelCount: 0,
      topChannels: []
    };

    buckets.push(point);
    bucketMap.set(i, {
      point,
      channelsSet: new Set<string>(),
      channelVolumeMap: new Map<string, number>()
    });
  }

  // Aggregate posts into buckets
  let totalPosts = 0;
  let totalViews = 0;
  let totalForwards = 0;
  let substantivePosts = 0;
  let mediaOnlyPosts = 0;

  for (const post of posts) {
    const pTime = normalizeTimestampMs(post.date);
    if (pTime < startTime || pTime > endTime) {
      continue;
    }

    const bucketIdx = Math.floor((pTime - startTime) / bucketDurationMs);
    if (bucketIdx < 0 || bucketIdx >= buckets.length) {
      continue;
    }

    const b = bucketMap.get(bucketIdx);
    if (!b) continue;

    totalPosts++;
    b.point.volume++;

    // Check if post is substantive vs media-only
    const cleanText = (post.cleanSnippet || post.text || '').replace(/<[^>]*>?/gm, '').trim();
    const hasLongText = cleanText.length >= 25;
    const hasTitle = Boolean(post.linkPreview?.title && post.linkPreview.title.trim().length >= 8);
    const isSubstantive = hasLongText || hasTitle;

    if (isSubstantive) {
      b.point.substantiveVolume++;
      substantivePosts++;
    } else {
      b.point.mediaOnlyVolume++;
      mediaOnlyPosts++;
    }

    const views = Number(post.views) || 0;
    const forwards = Number(post.forwards) || 0;
    const replies = Number(post.replies) || 0;

    b.point.views += views;
    b.point.forwards += forwards;
    b.point.replies += replies;

    totalViews += views;
    totalForwards += forwards;

    const chName = post.channelName || post.channelUsername || 'Unknown';
    b.channelsSet.add(chName);
    b.channelVolumeMap.set(chName, (b.channelVolumeMap.get(chName) || 0) + 1);
  }

  // Finalize top channels and active channel counts per bucket
  let peakVolume = 0;
  let peakTimeLabel = buckets[0]?.timeLabel || 'N/A';
  let peakViews = 0;
  let activeBucketsCount = 0;

  for (let i = 0; i < buckets.length; i++) {
    const b = bucketMap.get(i);
    if (!b) continue;

    b.point.channelCount = b.channelsSet.size;
    b.point.topChannels = Array.from(b.channelVolumeMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([ch, count]) => `${ch} (${count})`);

    if (b.point.volume > 0) {
      activeBucketsCount++;
    }

    if (b.point.volume > peakVolume) {
      peakVolume = b.point.volume;
      peakTimeLabel = b.point.timeLabel;
    }

    if (b.point.views > peakViews) {
      peakViews = b.point.views;
    }
  }

  const effectiveBucketCount = Math.max(1, buckets.length);
  const avgVolumePerBucket = Number((totalPosts / effectiveBucketCount).toFixed(1));

  return {
    dataPoints: buckets,
    stats: {
      totalPosts,
      totalViews,
      totalForwards,
      substantivePosts,
      mediaOnlyPosts,
      peakVolume,
      peakTimeLabel,
      peakViews,
      avgVolumePerBucket,
      bucketUnitLabel,
      activeBucketsCount
    }
  };
}
