/**
 * High-performance intelligence and semantic clustering engine for Listen Tab Hots Mode.
 * Analyzes local IndexedDB posts across date ranges: Hot Topics, Hot Posts, Hot Channels.
 */

import { probeApiBackend } from './apiCapabilities';
import {
  dotProductVectors,
  fnv1aHash64,
  l2Normalize,
  loadCachedNerEntitiesForPosts,
  type CachedNerPostSummary,
} from './hotsVectorStore';

import {
  analyzeClusterSentiment,
  normalizeSentimentLabel,
  type TopicSentimentBreakdown,
  type TopicSentimentLabel,
} from './hotsSentiment';

export type { TopicSentimentBreakdown, TopicSentimentLabel };
export type HotsDateRange = 'today' | 'yesterday' | '3days' | 'week' | 'all';
export type HotsClusterMode = 'rule' | 'neural' | 'ai';

export interface StructuredLinkPreview {
  url?: string;
  domain?: string;
  title?: string;
  description?: string;
  site_name?: string;
  image?: string;
  pubdate?: string;
}

export interface HotPostItem {
  id: string | number;
  key: string;
  channelId: string;
  channelUsername: string;
  channelName: string;
  channelTitle?: string;
  text: string;
  cleanSnippet: string;
  views: number;
  forwards: number;
  replies: number;
  date: number;
  dateStr: string;
  url?: string;
  linkPreview?: StructuredLinkPreview;
  hasMedia: boolean;
  mediaType?: 'photo' | 'video' | 'mixed' | 'document';
  qualityScore: number;
  data: any; // Posts metadata (post.data) from the value (json) of indexeddb table row
  raw: any;
}

export interface ClusterTag {
  type: 'person' | 'entity' | 'fact' | 'option' | 'keyword';
  label: string;
}

export interface HotTopicCluster {
  id: string;
  title: string;
  titleZh?: string; // Chinese translation of title when original title is not in Chinese (including English)
  summary: string;
  isAiGenerated?: boolean;
  clusterSource?: 'rule' | 'neural' | 'ai';
  cohesionScore?: number;
  category?: string;
  sentiment?: TopicSentimentLabel;
  sentimentScore?: number;
  sentimentBreakdown?: TopicSentimentBreakdown;
  keywords: string[];
  domains: string[];
  persons?: string[];
  entities?: string[];
  facts?: string[];
  options?: string[];
  tags?: ClusterTag[];
  posts: HotPostItem[];
  postCount: number;
  totalViews: number;
  totalForwards: number;
  totalReplies: number;
  channels: string[];
  hotScore: number;
  representativePost?: HotPostItem;
  timeSpan: {
    start: number;
    end: number;
  };
}

export interface HotChannelItem {
  channelId: string;
  channelUsername: string;
  channelName: string;
  title: string;
  avatarUrl?: string;
  postCount: number;
  totalViews: number;
  totalForwards: number;
  totalReplies: number;
  avgViews: number;
  activityScore: number;
  latestPostTime: number;
  subscribers?: number;
  online?: number;
  description?: string;
  date?: string | number;
  _type?: string;
  samplePosts: HotPostItem[];
}

import { format } from "date-fns";

export const telegramLogoUrl =
  "data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Crect width='24' height='24' fill='%232AABEE'/%3E%3Cpath fill='%23fff' d='M5.265 11.735l11.953-4.606c.553-.206 1.034.13.844.975l-2.02 9.516c-.15.676-.554.843-1.116.528l-3.085-2.274-1.488 1.433c-.165.165-.303.303-.62.303l.22-3.15 5.734-5.18c.25-.223-.054-.346-.387-.123l-7.09 4.466-3.054-.954c-.664-.208-.678-.664.14-.984z'/%3E%3C/svg%3E";

export const formatDate = (dateStr: string | number): string => {
  if (!dateStr) return "";
  try {
    if (typeof dateStr === "number" && dateStr < 10000000000) {
      return format(new Date(dateStr * 1000), "MMM d, yyyy h:mm:ss a");
    }
    return format(new Date(dateStr), "MMM d, yyyy h:mm:ss a");
  } catch {
    return String(dateStr);
  }
};

export const formatViews = (views: any): string => {
  if (views == null) return "";
  if (typeof views === "number") return views.toLocaleString();
  if (typeof views === "string") {
    const parsed = Number(views);
    if (!isNaN(parsed)) return parsed.toLocaleString();
    return views;
  }
  return String(views);
};

export const getUsername = (post: any): string => {
  if (!post) return "Telegram User";

  // Must only return the TRUE username if data.url exists, otherwise return 'Telegram User'
  const dataUrl = post.data?.url || post.url;
  if (!dataUrl) {
    return "Telegram User";
  }

  // Restore the default 'Telegram User' displaying when post.data.user is null
  const rawUser = post.data?.user;
  if (!rawUser || typeof rawUser !== "string") {
    return "Telegram User";
  }

  const trimmed = rawUser.trim();
  if (
    !trimmed ||
    trimmed.toLowerCase() === "null" ||
    trimmed.toLowerCase() === "undefined" ||
    trimmed.toLowerCase() === "none" ||
    trimmed === "{}"
  ) {
    return "Telegram User";
  }

  // Extract true username from path or handle
  const clean = trimmed.replace(/\/+$/, "");
  const parts = clean.split("/").filter(Boolean);
  const lastPart = parts[parts.length - 1] || "";
  const trueUsername = lastPart.split("?")[0].split("#")[0].replace(/^@+/, "").trim();
  if (
    !trueUsername ||
    trueUsername.toLowerCase() === "null" ||
    trueUsername.toLowerCase() === "undefined"
  ) {
    return "Telegram User";
  }
  return trueUsername;
};

export const getToolName = (post: any): string => {
  const tool = post.data?._tool;
  if (typeof tool === "string" && tool.startsWith("tgb.")) {
    return "TGB";
  }
  return "TG";
};

export const getPostAvatarUrl = (post: any): string => {
  if (post?.data?.photo && typeof post.data.photo === 'string' && post.data.photo.startsWith('data:')) {
    return post.data.photo;
  }
  if (post?.metadata?.photo && typeof post.metadata.photo === 'string' && post.metadata.photo.startsWith('data:')) {
    return post.metadata.photo;
  }
  const user = post.data?.user;
  if (user && typeof user === 'string') {
    const parts = user.split("/");
    const username = parts[parts.length - 1]?.replace(/^@+/, "");
    if (username && username !== 'null' && username !== 'undefined') {
      return `https://i.gogingko.net/api/v1/v/telegram-profile/${username}`;
    }
  }
  // Fallback to channel username if post.key has it
  const channelUser = post.key ? String(post.key).split('.')[0] : (post.channelUsername || '');
  if (channelUser && !channelUser.startsWith('-100')) {
    return `https://i.gogingko.net/api/v1/v/telegram-profile/${channelUser}`;
  }
  return telegramLogoUrl;
};

export const getParsedReactions = (reactions: any): Array<{ emoji: string; count: number }> => {
  if (!reactions) return [];
  const formatEmoji = (emojiVal: any): string => {
    if (emojiVal === null || emojiVal === undefined) return "";
    const str = String(emojiVal).trim();
    if (str !== "" && !isNaN(Number(str))) {
      return `<i class="inline-block align-middle bg-contain bg-center bg-no-repeat" style="background-image: url('https://t.me/i/emoji/${str}.webp'); width: 1.2em; height: 1.2em;"></i>`;
    }
    return String(emojiVal);
  };
  if (Array.isArray(reactions)) {
    return reactions.map(item => {
      if (!item) return null;
      const emoji = item.reaction || item.emoticon || item.emoji || item.text;
      const count = item.count != null ? item.count : (item.counter != null ? item.counter : item.value);
      if (emoji && count != null) {
        return { emoji: formatEmoji(emoji), count: Number(count) };
      }
      const keys = Object.keys(item);
      if (keys.length === 1) {
        const k = keys[0];
        const v = item[k];
        if (typeof v === 'number' || !isNaN(Number(v))) {
          return { emoji: formatEmoji(k), count: Number(v) };
        }
      }
      return null;
    }).filter((x): x is { emoji: string; count: number } => x !== null);
  } else if (typeof reactions === 'object') {
    if ('results' in reactions && Array.isArray(reactions.results)) {
      return reactions.results
        .map((item: any) => ({ emoji: formatEmoji(item.reaction || item.emoji), count: Number(item.count) }))
        .filter((x: any) => !isNaN(x.count));
    } else {
      return Object.entries(reactions)
        .map(([emoji, count]) => ({ emoji: formatEmoji(emoji), count: Number(count) }))
        .filter(x => !isNaN(x.count));
    }
  }
  return [];
};

export const getVideoUrl = (post: any): string => {
  let url = "";
  if (
    post.data?.videos &&
    post.data.videos.length > 0 &&
    post.data?.documents &&
    post.data.documents.length > 0 &&
    post.data.documents[0].mime_type?.startsWith("video/")
  ) {
    url = `https://i.gogingko.net/api/v1/v/telegram-doc/${post.key}`;
  } else {
    url = `https://i.gogingko.net/api/v1/v/telegram-video/${post.key}-0`;
  }
  return `${url}#t=0.1`;
};

export const getPostDocuments = (post: any): Array<{ title: string; url: string }> => {
  if (post.data?.documents && Array.isArray(post.data.documents)) {
    return post.data.documents.map((document: any) => {
      const file_name = document.attributes?.find((attr: any) => attr._ === "DocumentAttributeFilename")?.file_name;
      return {
        title: file_name || (document.title || '') + (document.extra ? ' ' + document.extra : '') || 'Document',
        url: file_name ? `https://i.gogingko.net/api/v1/v/telegram-doc/${post.key}` : ''
      };
    });
  }
  return [];
};

export interface HotsEngineProgress {
  step:
    | 'scanning'
    | 'clustering'
    | 'ranking'
    | 'embedding_download'
    | 'embedding'
    | 'ai_clustering'
    | 'done';
  percent: number;
  message: string;
  stage?: 'stage1' | 'stage2';
  loadedBytes?: number;
  totalBytes?: number;
  embedDone?: number;
  embedTotal?: number;
  cachedHits?: number;
  provider?: 'webgpu' | 'wasm' | null;
}

export interface HotsAnalysisResult {
  dateRange: HotsDateRange;
  timeWindow: { start: number; end: number };
  totalPostsAnalyzed: number;
  filteredPostsCount: number;
  meaninglessPostsCount: number;
  substantivePostsCount: number;
  totalChannelsScanned: number;
  activeChannelsCount: number;
  hotTopics: HotTopicCluster[];
  hotPosts: HotPostItem[];
  hotChannels: HotChannelItem[];
  substantivePosts?: HotPostItem[];
  clusterModeUsed?: HotsClusterMode;
  computedAt: number;
  isTopicsComputing?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers: Time Range
// ---------------------------------------------------------------------------

export function getLocalCalendarDayKey(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function isRelativeCalendarDateRange(range: HotsDateRange): boolean {
  return range === 'today' || range === 'yesterday' || range === '3days' || range === 'week';
}

export function getDateRangeBounds(range: HotsDateRange, now: Date = new Date()): { start: number; end: number } {
  const currentTimestamp = now.getTime();

  switch (range) {
    case 'today': {
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      return { start: todayStart, end: currentTimestamp + 60000 };
    }
    case 'yesterday': {
      const yesterdayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime();
      const yesterdayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - 1;
      return { start: yesterdayStart, end: yesterdayEnd };
    }
    case '3days': {
      const threeDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 2).getTime();
      return { start: threeDaysAgo, end: currentTimestamp + 60000 };
    }
    case 'week': {
      const weekAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6).getTime();
      return { start: weekAgo, end: currentTimestamp + 60000 };
    }
    case 'all':
    default:
      return { start: 0, end: Infinity };
  }
}

export function formatHotsDateRangeSummary(range: HotsDateRange, now: Date = new Date()): string {
  switch (range) {
    case 'today':
      return format(now, 'MMM d, yyyy');
    case 'yesterday': {
      const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      return format(y, 'MMM d, yyyy');
    }
    case '3days': {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 2);
      return `${format(start, 'MMM d')} – ${format(now, 'MMM d, yyyy')}`;
    }
    case 'week': {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
      return `${format(start, 'MMM d')} – ${format(now, 'MMM d, yyyy')}`;
    }
    case 'all':
    default:
      return '';
  }
}

// ---------------------------------------------------------------------------
// Helpers: Post Parsing & Scoring
// ---------------------------------------------------------------------------

export function extractPostTimestamp(p: any): number {
  if (!p) return 0;
  const raw = p.data?.date ?? p.date ?? p.data?.created_at ?? p.created_at ?? p.data?.timestamp ?? p.timestamp ?? p.message?.date;
  if (!raw) return 0;
  if (typeof raw === "number") {
    return raw < 10000000000 ? raw * 1000 : raw;
  }
  const parsed = new Date(raw).getTime();
  return isNaN(parsed) ? 0 : parsed;
}

export function extractPostViews(p: any): number {
  if (!p) return 0;
  const v = p.data?.views ?? p.views ?? p.data?.view_count ?? 0;
  if (typeof v === 'number') return isNaN(v) ? 0 : v;
  if (typeof v === 'string') {
    const trimmed = v.trim().toUpperCase();
    if (!trimmed) return 0;
    // Check for K or M suffix (e.g. "9.5K", "1.2M")
    let multiplier = 1;
    let cleanStr = trimmed;
    if (trimmed.endsWith('K')) {
      multiplier = 1000;
      cleanStr = trimmed.slice(0, -1);
    } else if (trimmed.endsWith('M')) {
      multiplier = 1000000;
      cleanStr = trimmed.slice(0, -1);
    }
    // Remove commas and any remaining non-numeric chars except dot
    cleanStr = cleanStr.replace(/,/g, '').replace(/[^\d.]/g, '');
    const parsed = parseFloat(cleanStr);
    if (!isNaN(parsed)) {
      return Math.round(parsed * multiplier);
    }
  }
  const num = parseInt(String(v).replace(/[^\d]/g, ''), 10);
  return isNaN(num) ? 0 : num;
}

export function extractPostForwards(p: any): number {
  if (!p) return 0;
  const f = p.data?.forwards ?? p.forwards ?? p.data?.fwd_count ?? p.data?.forwards_count ?? 0;
  if (typeof f === 'number') return f;
  const num = parseInt(String(f).replace(/[^\d]/g, ''), 10);
  return isNaN(num) ? 0 : num;
}

export function extractPostReplies(p: any): number {
  if (!p) return 0;
  const r = p.data?.reply ?? p.reply ?? p.data?.replies_count ?? 0;
  if (typeof r === 'number') return r;
  if (typeof r === 'object' && r !== null) return 1;
  const num = parseInt(String(r).replace(/[^\d]/g, ''), 10);
  return isNaN(num) ? 0 : num;
}

export function extractPostText(p: any): string {
  if (!p) return '';
  const text = p.content ?? p.rawcontent ?? p.data?.content ?? p.data?.rawcontent ?? p.data?.message ?? p.data?.text ?? p.message ?? p.text ?? '';
  if (typeof text === 'string') return text;
  if (typeof text === 'object' && text !== null) {
    return String(text.text || text.caption || text.content || JSON.stringify(text));
  }
  return '';
}

export function extractPostLinkPreview(p: any): StructuredLinkPreview | undefined {
  const lp = p.data?.linkPreview ?? p.linkPreview ?? p.data?.link_preview;
  if (!lp || typeof lp !== 'object') return undefined;

  let domain: string | undefined;
  const url = lp.url || '';
  if (url) {
    try {
      const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
      domain = parsed.hostname.replace(/^www\./, '').toLowerCase();
    } catch {}
  }
  if (!domain && lp.site_name) {
    domain = String(lp.site_name).trim().toLowerCase();
  }

  return {
    url: lp.url,
    domain,
    title: lp.title ? String(lp.title).trim() : undefined,
    description: lp.description ? String(lp.description).trim() : undefined,
    site_name: lp.site_name ? String(lp.site_name).trim() : undefined,
    image: lp.image,
    pubdate: lp.pubdate,
  };
}

export function computePostQualityScore(p: any): number {
  const views = extractPostViews(p);
  const forwards = extractPostForwards(p);
  const replies = extractPostReplies(p);
  const text = extractPostText(p).trim();
  const linkPreview = extractPostLinkPreview(p);

  // Content quality factor
  let qualityBonus = 0;
  if (text.length > 25) qualityBonus += 25;
  if (text.length > 80) qualityBonus += 40;
  if (text.length > 250) qualityBonus += 40;

  if (linkPreview) {
    qualityBonus += 50;
    if (linkPreview.title) qualityBonus += 40;
    if (linkPreview.description) qualityBonus += 25;
    if (linkPreview.image) qualityBonus += 20;
  }

  const photos = p.data?.photos ?? p.photos;
  const videos = p.data?.videos ?? p.videos;
  if (Array.isArray(photos) && photos.length > 0) qualityBonus += 35;
  if (Array.isArray(videos) && videos.length > 0) qualityBonus += 45;

  // Calibrated score: sublinear views prevent runaway view counts from drowning viral discussions
  return Math.round(
    (Math.sqrt(views) * 18) +
    (views * 0.05) +
    (forwards * 25) +
    (replies * 15) +
    qualityBonus
  );
}

export function computeTopicHotScore(
  totalViews: number,
  totalForwards: number,
  totalReplies: number,
  postCount: number,
  channelCount: number,
  latestPostTime: number
): number {
  // 1. Audience Reach: sublinear curve prevents a single mega-view outlier from dominating active discussion topics
  const reachScore = (Math.sqrt(totalViews) * 20) + (totalViews * 0.05);

  // 2. Virality: Outward forwarding is the primary indicator of viral interest in Telegram
  const viralScore = totalForwards * 25;

  // 3. Discussion Depth: replies and active audience engagement
  const discussionScore = totalReplies * 15;

  // 4. Multi-Channel Consensus: when multiple separate channels talk about the same topic, it is a proven trending development
  const consensusBonus = (Math.max(1, channelCount) - 1) * 350 * Math.log2(1 + postCount);

  // 5. Topic Density: number of posts clustered
  const densityScore = Math.log2(1 + postCount) * 180;

  const rawScore = reachScore + viralScore + discussionScore + consensusBonus + densityScore;

  // 6. Recency Freshness: fresh topics from the last 24h maintain momentum
  if (latestPostTime > 0) {
    const hoursAgo = Math.max(0, (Date.now() - latestPostTime) / (1000 * 3600));
    const recencyMultiplier = Math.max(0.65, 1.35 - (hoursAgo / 48));
    return Math.round(rawScore * recencyMultiplier);
  }

  return Math.round(rawScore);
}

export function computeChannelActivityScore(stat: {
  postCount: number;
  totalViews: number;
  avgViews: number;
  totalForwards: number;
  totalReplies: number;
  latestPostTime: number;
}): number {
  // 1. Publishing Volume with square root scaling to reward consistent posting without allowing automated bot spam to run away
  const volumeScore = Math.sqrt(stat.postCount) * 180;

  // 2. Audience penetration & read-through volume
  const viewsScore = (Math.sqrt(stat.totalViews) * 15) + (stat.avgViews * 0.15);

  // 3. Outward virality & forwards
  const forwardsScore = stat.totalForwards * 20;

  // 4. Community dialogue & replies
  const repliesScore = stat.totalReplies * 12;

  const rawActivity = volumeScore + viewsScore + forwardsScore + repliesScore;

  // 5. Recency factor
  if (stat.latestPostTime > 0) {
    const hoursAgo = Math.max(0, (Date.now() - stat.latestPostTime) / (1000 * 3600));
    const recencyFactor = hoursAgo < 12 ? 1.25 : (hoursAgo < 24 ? 1.1 : (hoursAgo < 72 ? 0.95 : 0.8));
    return Math.round(rawActivity * recencyFactor);
  }

  return Math.round(rawActivity);
}

// ---------------------------------------------------------------------------
// Tokenization & Stopwords for Multilingual Semantic Clustering
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i', 'it', 'for', 'not', 'on', 'with',
  'he', 'as', 'you', 'do', 'at', 'this', 'but', 'his', 'by', 'from', 'they', 'we', 'say', 'her', 'she',
  'or', 'an', 'will', 'my', 'one', 'all', 'would', 'there', 'their', 'what', 'so', 'up', 'out', 'if',
  'about', 'who', 'get', 'which', 'go', 'me', 'when', 'make', 'can', 'like', 'time', 'no', 'just', 'him',
  'know', 'take', 'people', 'into', 'year', 'your', 'good', 'some', 'could', 'them', 'see', 'other',
  'than', 'then', 'now', 'look', 'only', 'come', 'its', 'over', 'think', 'also', 'back', 'after', 'use',
  'two', 'how', 'our', 'work', 'first', 'well', 'way', 'even', 'new', 'want', 'because', 'any', 'these',
  'give', 'day', 'most', 'us', 'is', 'are', 'was', 'were', 'been', 'has', 'had', 'does', 'did', 'such',
  'more', 'very', 'much', 'many', 'should', 'could', 'being', 'before', 'since', 'while', 'where',
  'http', 'https', 't.me', 'com', 'org', 'net', 'telegram', 'channel', 'post', 'join', 'view', 'click',
  'here', 'read', 'via', 'source', 'subscribe', 'follow', 'photo', 'video', 'update', 'breaking',
  // Common Chinese stopwords, particles & Telegram boilerplate
  '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一', '一个', '上', '也', '很', '到', '说',
  '要', '去', '你', '会', '着', '没有', '看', '好', '自己', '这', '那', '与', '及', '等', '之', '为', '以', '对',
  '我们', '他们', '她们', '它们', '这个', '那个', '可以', '已经', '因为', '所以', '如果', '但是', '而且', '或者',
  '关注', '订阅', '频道', '来源', '转发', '点击', '更多', '消息', '表示', '进行', '目前', '已经', '通过',
  // Common Russian stopwords & particles
  'и', 'в', 'во', 'не', 'что', 'он', 'на', 'я', 'с', 'со', 'как', 'а', 'то', 'все', 'она', 'так', 'его',
  'но', 'да', 'ты', 'к', 'у', 'же', 'вы', 'за', 'бы', 'по', 'только', 'ее', 'мне', 'было', 'вот', 'от',
  'меня', 'еще', 'нет', 'о', 'из', 'ему', 'теперь', 'когда', 'даже', 'ну', 'вдруг', 'ли', 'если', 'уже',
  'или', 'ни', 'быть', 'был', 'него', 'до', 'вас', 'нибудь', 'опять', 'уж', 'вам', 'ведь', 'там', 'потом',
  'себя', 'ничего', 'ей', 'может', 'они', 'тут', 'где', 'есть', 'надо', 'ней', 'для', 'мы', 'тебя', 'их',
  'чем', 'была', 'сам', 'чтоб', 'без', 'будто', 'чего', 'раз', 'тоже', 'себе', 'под', 'будет', 'ж', 'тогда',
  'кто', 'этот', 'того', 'потому', 'этого', 'какой', 'совсем', 'ним', 'здесь', 'этом', 'один', 'почти', 'мой',
  'тем', 'чтобы', 'нее', 'сейчас', 'были', 'куда', 'зачем', 'всех', 'никогда', 'можно', 'при', 'наконец',
  'два', 'об', 'другой', 'хоть', 'после', 'над', 'больше', 'тот', 'через', 'эти', 'нас', 'про', 'всего',
  'них', 'какая', 'много', 'разве', 'три', 'эту', 'моя', 'впрочем', 'хорошо', 'свою', 'этой', 'перед',
  'иногда', 'лучше', 'чуть', 'том', 'нельзя', 'такой', 'им', 'более', 'всегда', 'конечно', 'всю', 'между',
  'это', 'также', 'канал', 'подпишись', 'подписаться', 'источник', 'читать', 'далее', 'фото', 'видео'
]);

const HAS_INTL_SEGMENTER =
  typeof Intl !== 'undefined' && typeof (Intl as any).Segmenter === 'function';
const segmenterZh = HAS_INTL_SEGMENTER
  ? new (Intl as any).Segmenter('zh', { granularity: 'word' })
  : null;
const segmenterJa = HAS_INTL_SEGMENTER
  ? new (Intl as any).Segmenter('ja', { granularity: 'word' })
  : null;

const CJK_CHAR_RE = /[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff]/;

export function tokenizeMultilingual(text: string): string[] {
  if (!text) return [];
  const cleaned = text
    .toLowerCase()
    .replace(/<[^>]*>?/gm, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/t\.me\/\S+/gi, ' ')
    .replace(/@[a-z0-9_]+/gi, ' ')
    .trim();
  if (!cleaned) return [];

  const tokens: string[] = [];

  if (segmenterZh || segmenterJa) {
    const seg = /[\u3040-\u30ff]/.test(cleaned) && segmenterJa ? segmenterJa : segmenterZh!;
    for (const part of seg.segment(cleaned) as Iterable<{ segment: string; isWordLike?: boolean }>) {
      const w = part.segment.trim();
      if (!w) continue;
      const isCjk = CJK_CHAR_RE.test(w);
      if (isCjk) {
        const cleanCjk = w.replace(/[^\p{L}\p{N}]/gu, '');
        if (cleanCjk.length >= 2 && !STOPWORDS.has(cleanCjk)) {
          tokens.push(cleanCjk);
        } else if (cleanCjk.length === 1 && !STOPWORDS.has(cleanCjk)) {
          // Skip isolated 1-char CJK particles cleanly
        }
        // Add 2-char shingles for longer CJK compounds so sub-phrase overlaps match
        if (cleanCjk.length >= 4 && cleanCjk.length <= 12) {
          for (let i = 0; i <= cleanCjk.length - 2; i++) {
            const bi = cleanCjk.slice(i, i + 2);
            if (!STOPWORDS.has(bi)) tokens.push(bi);
          }
        }
      } else if (part.isWordLike) {
        const word = w.replace(/[^\p{L}\p{N}#_]/gu, '');
        if (word.length >= 2 && !/^\d+$/.test(word) && !STOPWORDS.has(word)) {
          tokens.push(word);
        }
      }
    }
    return tokens;
  }

  // Regex + CJK bigram fallback when Intl.Segmenter is unavailable
  const rawParts = cleaned
    .replace(/[^\p{L}\p{N}#_\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);

  for (const w of rawParts) {
    if (CJK_CHAR_RE.test(w)) {
      for (let i = 0; i < w.length - 1; i++) {
        const bg = w.slice(i, i + 2);
        if (bg.length === 2 && !STOPWORDS.has(bg)) tokens.push(bg);
      }
    } else if (w.length >= 2 && !/^\d+$/.test(w) && !STOPWORDS.has(w)) {
      tokens.push(w);
    }
  }
  return tokens;
}

function extractHashtags(text: string): string[] {
  if (!text) return [];
  const matches = text.match(/#[\p{L}\p{N}_]{2,32}/gu);
  return matches ? matches.map((h) => h.toLowerCase()) : [];
}

/**
 * Checks if a string starts with generic greeting, filler, or reaction words.
 */
export function isGenericLead(text: string): boolean {
  if (!text) return true;
  return /^(hello|hi\b|good morning|good evening|good night|gm\b|gn\b|welcome|привет|здравствуйте|доброе утро|добрый вечер|спокойной ночи|大家好|各位|关注|subscribe|join|read more|click here|check out|photo|video|image|update|breaking|alert|attention|broadcast|daily|weekly|important|notice|announcement|админ|новости|реклама|подпишись|внимание|转发|通知|公告|欢迎|👍|🔥|🚀|😂|🙏)/i.test(text.trim());
}

/**
 * Evaluates whether a post possesses sufficient semantic substance for topic clustering.
 * Filters out:
 * 1. Posts that only contain media (photos, videos, documents, stickers) with no caption
 *    or with trivial/negligible captions (e.g. "photo", "watch", single emoji, filenames).
 * 2. Posts with very short text content (e.g., greetings, brief reactions, single emoji,
 *    raw un-previewed URLs, < 35 characters or < 5 meaningful words, or < 12 CJK characters)
 *    unless they are backed by an informative structured link preview (article headline).
 * 3. Boilerplate promotional fragments, bare channel links, or reaction-only chatter.
 */
export function isSubstantivePostForTopicClustering(post: HotPostItem): boolean {
  if (!post) return false;

  const rawText = (post.text || '').trim();
  const lp = post.linkPreview;

  // 1. Structured link preview with substantive headline or summary:
  // If a post shares an informative article link with a title (>= 12 chars) or description,
  // it carries real external topic information even if the post caption was terse.
  const hasSubstantiveLinkPreview = Boolean(
    lp && (
      (lp.title && lp.title.trim().length >= 12 && !isGenericLead(lp.title)) ||
      (lp.description && lp.description.trim().length >= 30)
    )
  );

  // Strip HTML tags, raw URLs, Telegram handles, and markdown characters
  let cleanText = rawText
    .replace(/<[^>]*>?/gm, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/@[a-zA-Z0-9_]+/g, ' ')
    .replace(/[#*`_~]/g, ' ')
    .trim();

  // Extract CJK characters (Chinese, Japanese, Korean)
  const cjkChars = cleanText.match(/[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/g) || [];
  const cjkCount = cjkChars.length;

  // Strip emojis, symbols, and extra whitespace to evaluate substantive linguistic content
  const substantiveChars = cleanText
    .replace(/[^\p{L}\p{N}]/gu, '')
    .trim();

  // Extract meaningful non-stopword words (length >= 3, not pure numbers)
  const meaningfulWords = cleanText
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !STOPWORDS.has(w) && !/^\d+$/.test(w));

  const meaningfulWordCount = meaningfulWords.length;

  // If text is purely generic greeting, reaction, or announcement header without body:
  if (isGenericLead(cleanText) && cleanText.length < 40 && !hasSubstantiveLinkPreview) {
    return false;
  }

  // CASE 1: Media-only or Media-dominant posts
  if (post.hasMedia) {
    // If it has a rich structured link preview, keep it
    if (hasSubstantiveLinkPreview) {
      return true;
    }

    // If it has media and NO rich link preview:
    // It MUST have a substantial descriptive text caption to carry topic meaning.
    // Pure photo/video posts with empty text, single words ("📸", "Watch", "Photo"),
    // or short comments are considered meaningless for topic clustering.
    if (cjkCount >= 14) {
      return true;
    }
    if (meaningfulWordCount >= 6 && substantiveChars.length >= 35) {
      return true;
    }
    if (substantiveChars.length >= 50) {
      return true;
    }

    // Otherwise, it's a media-only or short-caption media post -> FILTER OUT
    return false;
  }

  // CASE 2: Text posts without media
  // If it shares an informative structured article preview, keep it
  if (hasSubstantiveLinkPreview) {
    return true;
  }

  // Text-only posts must meet minimum semantic length thresholds:
  // - CJK: at least 12 Chinese/Japanese/Korean characters (e.g. a complete headline)
  // - Alphabetical: at least 6 meaningful words AND 30+ substantive characters
  //   OR 45+ substantive characters
  if (cjkCount >= 12) {
    return true;
  }
  if (meaningfulWordCount >= 6 && substantiveChars.length >= 30) {
    return true;
  }
  if (substantiveChars.length >= 45) {
    return true;
  }

  // Short, conversational, or meaningless text -> FILTER OUT
  return false;
}

// ---------------------------------------------------------------------------
// Client-Side Semantic Clustering Pipeline (Stage 1 TF-IDF/SimHash + Stage 2 Vector)
// ---------------------------------------------------------------------------

interface PostFeatureBag {
  post: HotPostItem;
  tokens: string[];
  tokenSet: Set<string>;
  tfidf: Map<string, number>;
  topTokens: string[];
  simHashHi: number;
  simHashLo: number;
  hashtags: Set<string>;
  domain?: string;
  linkUrlClean?: string;
}

function computeSimHash64(weights: Map<string, number>): { hi: number; lo: number } {
  const acc = new Float64Array(64);
  for (const [tok, w] of weights.entries()) {
    const h = fnv1aHash64(tok);
    let a = 0x811c9dc5;
    let b = 0x9e3779b9;
    for (let i = 0; i < h.length; i++) {
      const c = h.charCodeAt(i);
      a = Math.imul(a ^ c, 0x01000193);
      b = Math.imul(b ^ (c + i), 0x85ebca6b);
    }
    for (let bit = 0; bit < 32; bit++) {
      acc[bit] += ((a >>> bit) & 1) === 1 ? w : -w;
      acc[bit + 32] += ((b >>> bit) & 1) === 1 ? w : -w;
    }
  }
  let hi = 0;
  let lo = 0;
  for (let bit = 0; bit < 32; bit++) {
    if (acc[bit] >= 0) lo |= 1 << bit;
    if (acc[bit + 32] >= 0) hi |= 1 << bit;
  }
  return { hi: hi >>> 0, lo: lo >>> 0 };
}

function hammingDistance64(aHi: number, aLo: number, bHi: number, bLo: number): number {
  let x1 = (aHi ^ bHi) >>> 0;
  let x2 = (aLo ^ bLo) >>> 0;
  let count = 0;
  while (x1) {
    x1 &= x1 - 1;
    count++;
  }
  while (x2) {
    x2 &= x2 - 1;
    count++;
  }
  return count;
}

function extractCleanLinkUrl(lp?: StructuredLinkPreview): string | undefined {
  if (!lp?.url) return undefined;
  try {
    const parsed = new URL(lp.url.startsWith('http') ? lp.url : `https://${lp.url}`);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    if (host === 't.me' || host === 'telegram.me') return undefined;
    return `${host}${parsed.pathname.replace(/\/$/, '')}`.toLowerCase();
  } catch {
    return undefined;
  }
}

function buildCorpusFeatureBags(posts: HotPostItem[]): PostFeatureBag[] {
  const N = posts.length;
  const rawDocs: Array<{
    post: HotPostItem;
    tokens: string[];
    tf: Map<string, number>;
    hashtags: Set<string>;
    domain?: string;
    linkUrlClean?: string;
  }> = [];

  const df = new Map<string, number>();

  for (const post of posts) {
    const lp = post.linkPreview;
    const titleWeightText = lp?.title ? `${lp.title} ${lp.title}` : '';
    const combinedText = `${titleWeightText} ${post.text || ''} ${lp?.description || ''}`;
    const tokens = tokenizeMultilingual(combinedText);
    const hashtags = new Set(extractHashtags(post.text || ''));
    const tf = new Map<string, number>();

    for (const t of tokens) {
      tf.set(t, (tf.get(t) || 0) + 1);
    }
    for (const h of hashtags) {
      tf.set(h, (tf.get(h) || 0) + 2.2);
    }

    for (const t of tf.keys()) {
      df.set(t, (df.get(t) || 0) + 1);
    }

    rawDocs.push({
      post,
      tokens,
      tf,
      hashtags,
      domain: lp?.domain,
      linkUrlClean: extractCleanLinkUrl(lp),
    });
  }

  return rawDocs.map((doc) => {
    const tfidf = new Map<string, number>();
    let normSq = 0;

    for (const [term, count] of doc.tf.entries()) {
      const docFreq = df.get(term) || 1;
      const idf = Math.log(1 + (N + 1) / (docFreq + 0.5));
      const w = (1 + Math.log(count)) * idf;
      tfidf.set(term, w);
      normSq += w * w;
    }

    const norm = Math.sqrt(normSq) || 1;
    for (const [term, w] of tfidf.entries()) {
      tfidf.set(term, w / norm);
    }

    const topTokens = Array.from(tfidf.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 7)
      .map((e) => e[0]);

    const { hi, lo } = computeSimHash64(tfidf);

    return {
      post: doc.post,
      tokens: doc.tokens,
      tokenSet: new Set(doc.tokens),
      tfidf,
      topTokens,
      simHashHi: hi,
      simHashLo: lo,
      hashtags: doc.hashtags,
      domain: doc.domain,
      linkUrlClean: doc.linkUrlClean,
    };
  });
}

function computeSparseCosine(a: Map<string, number>, b: Map<string, number>): number {
  const smaller = a.size <= b.size ? a : b;
  const larger = a.size <= b.size ? b : a;
  let sum = 0;
  for (const [k, v] of smaller.entries()) {
    const bv = larger.get(k);
    if (bv !== undefined) {
      sum += v * bv;
    }
  }
  return sum;
}

function computeStage1BagToCentroidSim(
  bag: PostFeatureBag,
  centroidTfidf: Map<string, number>,
  centroidHashtags: Set<string>,
  centroidUrls: Set<string>,
  centroidDomains: Set<string>
): number {
  if (bag.linkUrlClean && centroidUrls.has(bag.linkUrlClean)) {
    return 0.96;
  }

  const tfidfCos = computeSparseCosine(bag.tfidf, centroidTfidf);

  let hashtagBonus = 0;
  if (bag.hashtags.size > 0 && centroidHashtags.size > 0) {
    for (const h of bag.hashtags) {
      if (centroidHashtags.has(h)) {
        hashtagBonus = 0.22;
        break;
      }
    }
  }

  let domainBonus = 0;
  if (
    bag.domain &&
    centroidDomains.has(bag.domain) &&
    bag.domain !== 't.me' &&
    bag.domain !== 'telegram.org' &&
    tfidfCos >= 0.12
  ) {
    domainBonus = 0.1;
  }

  return Math.min(1, tfidfCos + hashtagBonus + domainBonus);
}

function computeCtfIdfKeywords(
  clustersTokens: string[][],
  topN: number = 5
): string[][] {
  const numClusters = clustersTokens.length;
  if (numClusters === 0) return [];

  const clusterFreq = new Map<string, number>(); // number of clusters containing token
  const clusterTfs: Map<string, number>[] = [];
  let totalTokens = 0;

  for (const toks of clustersTokens) {
    const tf = new Map<string, number>();
    const seen = new Set<string>();
    for (const raw of toks) {
      const t = raw.trim();
      if (!t || t.length < 2 || STOPWORDS.has(t)) continue;
      tf.set(t, (tf.get(t) || 0) + 1);
      totalTokens++;
      if (!seen.has(t)) {
        seen.add(t);
        clusterFreq.set(t, (clusterFreq.get(t) || 0) + 1);
      }
    }
    clusterTfs.push(tf);
  }

  const avgClusterLen = Math.max(1, totalTokens / numClusters);

  return clusterTfs.map((tf) => {
    const scored: Array<[string, number]> = [];
    for (const [tok, freq] of tf.entries()) {
      const cf = clusterFreq.get(tok) || 1;
      // Reward cluster-distinctive keywords while still reflecting frequency within cluster
      const idf = Math.log(1 + (avgClusterLen + numClusters) / (cf + 0.5));
      const boost = tok.startsWith('#') ? 1.5 : 1.0;
      scored.push([tok, freq * idf * boost]);
    }
    return scored
      .sort((a, b) => b[1] - a[1])
      .slice(0, topN)
      .map((e) => e[0]);
  });
}

export interface ExtractedClusterInfo {
  persons: string[];
  entities: string[];
  facts: string[];
  options: string[];
  tags: ClusterTag[];
}

export function extractClusterMetadata(clusterPosts: HotPostItem[]): ExtractedClusterInfo {
  const personsSet = new Set<string>();
  const entitiesSet = new Set<string>();
  const factsSet = new Set<string>();
  const optionsSet = new Set<string>();

  // Known entity and person patterns
  const PERSON_KNOWN_RE = /\b(Pavel Durov|Durov|Elon Musk|Musk|Sam Altman|Vitalik Buterin|Vitalik|Donald Trump|Trump|Joe Biden|Biden|Kamala Harris|Jerome Powell|Satoshi Nakamoto|Satoshi|Changpeng Zhao|CZ|Jensen Huang|Mark Zuckerberg|Tim Cook|Satya Nadella|Sundar Pichai|Edward Snowden|Julian Assange)\b/gi;
  const PERSON_SPEECH_RE = /\b(?:according to|statement from|quote from|said|says|warns|announced by|interview with)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/g;

  const ENTITY_KNOWN_RE = /\b(Telegram|TON|TON Blockchain|Fragment|Notcoin|Dogs|Catizen|Hamster Kombat|Bitcoin|BTC|Ethereum|ETH|Solana|SOL|Tether|USDT|USDC|OpenAI|ChatGPT|GPT-4[o]?|Gemini|Claude|Anthropic|DeepSeek|Google|Apple|Microsoft|NVIDIA|Meta|Twitter|X Corp|TikTok|Binance|Coinbase|Kraken|SEC|Federal Reserve|Fed|European Union|EU|NASA|SpaceX|Tesla)\b/gi;

  const FACT_CURRENCY_RE = /(?:\$|€|£|¥)\s*\d+(?:\.\d+)?\s*(?:billion|million|trillion|[BMKbmk])?\b/gi;
  const FACT_PERCENT_RE = /[+-]?\d+(?:\.\d+)?%/g;
  const FACT_MILESTONE_RE = /\b\d+(?:\.\d+)?\s*(?:million|billion|M|K)\s*(?:users|active users|members|subscribers|transactions|TPS|holders|downloads)\b/gi;
  const FACT_VERSION_RE = /\b(?:v|Version\s+)\d+\.\d+(?:\.\d+)?\b/gi;
  const FACT_EVENT_RE = /\b(All-Time High|ATH|Record High|Mainnet Launch|Testnet|Airdrop|Hard Fork|Halving|IPO|Acquisition|Banned|Approved|Sanctions)\b/gi;

  const OPTION_PATTERN_RE = /\b(?:Option [A-D1-4]|Choice [A-D1-4]|Plan [A-D1-4]|Scenario [1-4]|Bullish vs Bearish|Pros & Cons|For vs Against|Vote:?)\s*[:—\-]?\s*([^\n,;.]{3,35})/gi;
  const OPTION_DEBATE_RE = /\b(Yes\s*[/vs]\s*No|Bullish\s*[/vs]\s*Bearish|Approve\s*[/vs]\s*Reject|Support\s*[/vs]\s*Oppose)\b/gi;

  for (const p of clusterPosts) {
    // 1. Author metadata
    const author = p.data?.author || p.raw?.author;
    if (author && typeof author === 'string') {
      const cleanAuthor = author.replace(/^@/, '').trim();
      if (cleanAuthor.length >= 2 && cleanAuthor.length <= 25 && !/^(admin|bot|channel|group|telegram)$/i.test(cleanAuthor)) {
        personsSet.add(cleanAuthor);
      }
    }

    // 2. Poll metadata
    const poll = p.data?.poll || p.raw?.poll;
    if (poll) {
      if (poll.question && typeof poll.question === 'string') {
        const q = poll.question.trim();
        if (q.length > 5 && q.length < 50) {
          optionsSet.add(q);
        }
      }
      if (Array.isArray(poll.answers)) {
        for (const ans of poll.answers) {
          const text = ans.text || ans.option;
          if (text && typeof text === 'string' && text.trim().length <= 25) {
            optionsSet.add(text.trim());
          }
        }
      }
    }

    // 3. LinkPreview domains / site_name
    if (p.linkPreview) {
      if (p.linkPreview.site_name) {
        const sn = p.linkPreview.site_name.trim();
        if (sn.length >= 2 && sn.length <= 25 && !/^t\.me$/i.test(sn)) {
          entitiesSet.add(sn);
        }
      }
      if (p.linkPreview.domain) {
        const dom = p.linkPreview.domain.replace(/^www\./, '').replace(/\.(com|org|net|io|me|app|ai)$/, '');
        if (dom.length >= 3 && dom.length <= 20 && !/^(t|telegram)$/i.test(dom)) {
          entitiesSet.add(dom.charAt(0).toUpperCase() + dom.slice(1));
        }
      }
    }

    const textToScan = `${p.text} ${p.linkPreview?.title || ''} ${p.linkPreview?.description || ''}`;

    // Scan for persons
    let match: RegExpExecArray | null;
    PERSON_KNOWN_RE.lastIndex = 0;
    while ((match = PERSON_KNOWN_RE.exec(textToScan)) !== null) {
      let name = match[0].trim();
      if (name.toLowerCase() === 'durov') name = 'Pavel Durov';
      if (name.toLowerCase() === 'musk') name = 'Elon Musk';
      if (name.toLowerCase() === 'altman') name = 'Sam Altman';
      if (name.toLowerCase() === 'trump') name = 'Donald Trump';
      personsSet.add(name);
    }

    PERSON_SPEECH_RE.lastIndex = 0;
    while ((match = PERSON_SPEECH_RE.exec(textToScan)) !== null) {
      const candidate = match[1].trim();
      if (candidate.length >= 3 && candidate.length <= 25 && !/^(The|A|An|This|That|Some|New|Telegram|Channel|Users|Message)$/i.test(candidate)) {
        personsSet.add(candidate);
      }
    }

    // Scan for entities
    ENTITY_KNOWN_RE.lastIndex = 0;
    while ((match = ENTITY_KNOWN_RE.exec(textToScan)) !== null) {
      entitiesSet.add(match[0].trim());
    }

    // Scan for facts & metrics
    FACT_CURRENCY_RE.lastIndex = 0;
    while ((match = FACT_CURRENCY_RE.exec(textToScan)) !== null) {
      factsSet.add(match[0].trim());
    }
    FACT_PERCENT_RE.lastIndex = 0;
    while ((match = FACT_PERCENT_RE.exec(textToScan)) !== null) {
      factsSet.add(match[0].trim());
    }
    FACT_MILESTONE_RE.lastIndex = 0;
    while ((match = FACT_MILESTONE_RE.exec(textToScan)) !== null) {
      factsSet.add(match[0].trim());
    }
    FACT_VERSION_RE.lastIndex = 0;
    while ((match = FACT_VERSION_RE.exec(textToScan)) !== null) {
      factsSet.add(match[0].trim());
    }
    FACT_EVENT_RE.lastIndex = 0;
    while ((match = FACT_EVENT_RE.exec(textToScan)) !== null) {
      factsSet.add(match[0].trim());
    }

    // Scan for options & debates
    OPTION_PATTERN_RE.lastIndex = 0;
    while ((match = OPTION_PATTERN_RE.exec(textToScan)) !== null) {
      optionsSet.add(match[1].trim());
    }
    OPTION_DEBATE_RE.lastIndex = 0;
    while ((match = OPTION_DEBATE_RE.exec(textToScan)) !== null) {
      optionsSet.add(match[0].trim());
    }
  }

  const persons = Array.from(personsSet).slice(0, 3);
  const entities = Array.from(entitiesSet).slice(0, 4);
  const facts = Array.from(factsSet).slice(0, 4);
  const options = Array.from(optionsSet).slice(0, 3);

  // Assemble unified tags
  const tags: ClusterTag[] = [];
  for (const p of persons.slice(0, 2)) {
    tags.push({ type: 'person', label: p });
  }
  for (const e of entities.slice(0, 2)) {
    tags.push({ type: 'entity', label: e });
  }
  for (const f of facts.slice(0, 2)) {
    tags.push({ type: 'fact', label: f });
  }
  for (const o of options.slice(0, 1)) {
    tags.push({ type: 'option', label: o });
  }

  return { persons, entities, facts, options, tags };
}

/**
 * Sanitizes titles and text fragments by removing un-displayed UTF-8 replacement characters (),
 * corrupted emoji codes, stray unicode symbols, and normalizing spacing.
 */
export function sanitizeTitle(text: string): string {
  if (!text) return '';
  return String(text)
    .replace(/\uFFFD+/g, '') // remove all  replacement characters
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '') // control chars
    // Remove isolated single-character artifacts left behind by broken emoji encodings
    .replace(/(?:^|\s)[?\ufffd](?:\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanArticleHeadline(raw: string): string {
  if (!raw) return '';
  const sanitized = sanitizeTitle(raw);
  return sanitized
    .replace(/\s*([|–—\-])\s*(Reuters|Bloomberg|TechCrunch|The Verge|CoinDesk|Cointelegraph|Decrypt|Forbes|CNBC|BBC|CNN|WSJ|Wall Street Journal|Telegram|Medium|Substack|YouTube|GitHub|X|Twitter|Reddit|News).*$/i, '')
    .replace(/^([A-Z\s]+:)\s*/, '')
    .trim();
}

function truncateAtWordBoundary(text: string, maxLen: number): string {
  if (!text || text.length <= maxLen) return text;
  const cut = text.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(' ');
  const lastPunct = Math.max(cut.lastIndexOf(','), cut.lastIndexOf(';'), cut.lastIndexOf('—'));
  const cutIndex = Math.max(lastSpace, lastPunct);
  if (cutIndex > maxLen * 0.55) {
    return cut.slice(0, cutIndex).trim() + '...';
  }
  return cut.trim() + '...';
}

function splitIntoSentences(text: string): string[] {
  if (!text) return [];
  return text
    .replace(/[\r\n]+/g, ' ')
    .split(/(?<=[.!?。！？])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 5);
}


export function detectTopicCategory(text: string, domains: string[] = []): string {
  const lower = (text + ' ' + domains.join(' ')).toLowerCase();

  if (/\b(bitcoin|btc|ethereum|eth|ton|solana|sol|crypto|token|airdrop|binance|coinbase|tether|usdt|usdc|wallet|defi|nft|blockchain|dex|cex|mining|staking|notcoin|dogs|catizen)\b/i.test(lower)) {
    return 'Crypto';
  }
  if (/\b(ai|artificial intelligence|openai|chatgpt|gpt-4|gemini|claude|deepseek|llm|neural|robot|hardware|apple|google|microsoft|nvidia|software|app|ios|android|github|tech)\b/i.test(lower)) {
    return 'Tech';
  }
  if (/\b(market|stock|shares|nasdaq|dow|fed|federal reserve|interest rate|inflation|ipo|earnings|revenue|profit|acquisition|merger|economy|billion|trillion|dollar)\b/i.test(lower)) {
    return 'Business';
  }
  if (/\b(hack|hacked|breach|vulnerability|malware|ransomware|security|leak|patch|exploit|scam|phishing|cve|ddos|attack)\b/i.test(lower)) {
    return 'Security';
  }
  if (/\b(government|president|minister|election|court|law|police|arrest|sanction|war|military|strike|treaty|congress|senate|parliament|putin|trump|biden|china|russia|ukraine|israel)\b/i.test(lower)) {
    return 'World';
  }
  if (/\b(science|space|nasa|spacex|physics|biology|climate|energy|medical|vaccine|disease|planet|telescope|research)\b/i.test(lower)) {
    return 'Science';
  }
  if (/\b(game|gaming|steam|playstation|xbox|movie|cinema|film|music|spotify|art|entertainment|anime|manga)\b/i.test(lower)) {
    return 'Culture';
  }
  return 'General';
}

function generateCleanSummary(text: string, fallback: string): string {
  const source = (text || fallback || '').trim();
  if (!source) return '';

  // Clean out URLs, formatting symbols
  const clean = source
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/t\.me\/\S+/gi, '')
    .replace(/[#*`_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (clean.length <= 160) {
    return clean;
  }

  // If long content: intelligently extract salient sentences
  const sentences = splitIntoSentences(clean).filter(s => !isGenericLead(s));
  if (sentences.length === 0) return truncateAtWordBoundary(clean, 175);

  let summary = '';
  for (const s of sentences) {
    if ((summary + ' ' + s).length > 210) {
      if (!summary) {
        summary = truncateAtWordBoundary(s, 185);
      }
      break;
    }
    summary += (summary ? ' ' : '') + s;
  }

  return summary || truncateAtWordBoundary(clean, 180);
}

function summarizeSinglePost(
  post: HotPostItem,
  extracted?: ExtractedClusterInfo
): { title: string; summary: string } {
  const persons = extracted?.persons || [];
  const entities = extracted?.entities || [];
  const facts = extracted?.facts || [];
  const fullText = (post.text || '').trim();
  const cleanSnippet = post.cleanSnippet || '';

  // 1. Structured link preview headline (editorially created)
  if (post.linkPreview?.title) {
    const cleanedLp = cleanArticleHeadline(post.linkPreview.title);
    if (cleanedLp.length >= 10 && cleanedLp.length <= 110) {
      const summary = generateCleanSummary(fullText, post.linkPreview.description || cleanSnippet);
      return { title: cleanedLp, summary };
    }
  }

  // 2. Distinct first line headline (Telegram bold / markdown / announcement header)
  const lines = fullText.split(/[\r\n]+/).map(l => l.trim()).filter(Boolean);
  if (lines.length > 1) {
    const firstLine = lines[0];
    const headerMatch = firstLine.match(/^(?:#+\s+|\*\*(.+?)\*\*|[^\s\w]\s*)(.+)$/);
    const rawCandidate = (headerMatch ? (headerMatch[1] || headerMatch[2]) : firstLine)
      .replace(/[#*`_]/g, '')
      .trim();
    const candidate = sanitizeTitle(rawCandidate);

    if (candidate.length >= 10 && candidate.length <= 95 && !isGenericLead(candidate)) {
      const remaining = lines.slice(1).join(' ');
      const summary = generateCleanSummary(remaining.length > 40 ? remaining : fullText, cleanSnippet);
      return { title: candidate, summary };
    }
  }

  // 3. For long content: summarize into a crisp title and informative summary
  const sentences = splitIntoSentences(fullText);
  let bestTitle = '';
  for (const s of sentences) {
    const clean = s.replace(/^[#\s*•\->⚡🔥🚀📢🚨]+/, '').trim();
    if (clean.length >= 15 && !isGenericLead(clean)) {
      bestTitle = clean;
      break;
    }
  }

  if (bestTitle.length > 85) {
    bestTitle = truncateAtWordBoundary(bestTitle, 80);
  }

  // If no single sentence was adequate, synthesize from person / entity / fact
  if (!bestTitle || bestTitle.length < 12) {
    const subject = persons[0] || entities[0] || post.channelName;
    const fact = facts[0];
    if (fact) {
      bestTitle = `${subject}: ${fact}`;
    } else {
      bestTitle = `${subject}: ${truncateAtWordBoundary(cleanSnippet, 65)}`;
    }
  }

  const summary = generateCleanSummary(fullText, cleanSnippet);
  return { title: bestTitle, summary };
}

function synthesizeClusterTitle(
  clusterPosts: HotPostItem[],
  extracted?: ExtractedClusterInfo
): { title: string; summary: string } {
  if (clusterPosts.length === 0) {
    return { title: 'Broadcasts', summary: '' };
  }

  // If only one post in the cluster: summarize its content if long!
  if (clusterPosts.length === 1) {
    return summarizeSinglePost(clusterPosts[0], extracted);
  }

  const persons = extracted?.persons || [];
  const entities = extracted?.entities || [];
  const facts = extracted?.facts || [];
  const options = extracted?.options || [];

  // 1. If cluster has a clear debate or poll question
  if (options.length > 0 && options[0].includes('?')) {
    const topPost = clusterPosts[0];
    return {
      title: `Poll & Debate: ${options[0]}`,
      summary: generateCleanSummary(topPost.text, topPost.cleanSnippet)
    };
  }

  // 2. Check for a clean, informative linkPreview title
  for (const p of clusterPosts) {
    if (p.linkPreview?.title) {
      const cleaned = cleanArticleHeadline(p.linkPreview.title);
      if (cleaned.length >= 10 && cleaned.length <= 110) {
        let enriched = cleaned;
        if (entities.length > 0 && !cleaned.toLowerCase().includes(entities[0].toLowerCase()) && cleaned.length < 55) {
          enriched = `${entities[0]}: ${cleaned}`;
        } else if (persons.length > 0 && !cleaned.toLowerCase().includes(persons[0].toLowerCase()) && cleaned.length < 50) {
          enriched = `${persons[0]}: ${cleaned}`;
        }
        const summary = generateCleanSummary(p.text, p.linkPreview.description || p.cleanSnippet);
        return { title: enriched, summary };
      }
    }
  }

  // 3. Best post headline or lead sentence
  const bestPost = [...clusterPosts].sort((a, b) => b.qualityScore - a.qualityScore)[0];
  if (bestPost && bestPost.text) {
    const rawLines = bestPost.text.split(/[\n\r]+/);
    for (const line of rawLines) {
      const trimmed = line.trim();
      const headerMatch = trimmed.match(/^(?:#+\s+|\*\*(.+?)\*\*|[^\s\w]\s*)(.+)$/);
      if (headerMatch) {
        const rawCand = (headerMatch[1] || headerMatch[2] || '').replace(/[#*`_]/g, '').trim();
        const cand = sanitizeTitle(rawCand);
        if (cand.length >= 10 && cand.length <= 95 && !isGenericLead(cand)) {
          return {
            title: cand,
            summary: generateCleanSummary(bestPost.text, bestPost.cleanSnippet)
          };
        }
      }
    }

    // 4. Try lead sentence from best post
    const sentences = splitIntoSentences(bestPost.text);
    for (const s of sentences) {
      const rawCleanS = s.replace(/^[#\s*•\->\p{Emoji}\p{So}]+/gu, '').trim();
      const cleanS = sanitizeTitle(rawCleanS);
      if (cleanS.length >= 12 && cleanS.length <= 85 && !isGenericLead(cleanS)) {
        return {
          title: cleanS,
          summary: generateCleanSummary(bestPost.text, bestPost.cleanSnippet)
        };
      }
      if (cleanS.length > 85 && cleanS.length <= 150) {
        return {
          title: truncateAtWordBoundary(cleanS, 80),
          summary: generateCleanSummary(bestPost.text, bestPost.cleanSnippet)
        };
      }
    }
  }

  // 5. Clean synthesized subject headline (never output "(N posts)")
  const subject = persons[0] || entities[0] || clusterPosts[0]?.channelName || 'Broadcasts';
  const fact = facts[0];
  const title = fact ? `${subject}: ${fact}` : `${subject} Developing Story`;
  return {
    title,
    summary: generateCleanSummary(clusterPosts[0]?.text || '', clusterPosts[0]?.cleanSnippet || '')
  };
}

// ---------------------------------------------------------------------------
// AI-Powered Clustering via Gemini 3.1 Flash Lite (with Cluster Medoid Pre-Grouping)
// ---------------------------------------------------------------------------

export async function clusterWithGeminiAI(
  apiKey: string,
  posts: HotPostItem[],
  dateRange: HotsDateRange,
  preGroupedClusters?: HotTopicCluster[]
): Promise<HotTopicCluster[]> {
  if (posts.length === 0) {
    return [];
  }

  // Prefer diverse medoid representatives from Stage 1 / Stage 2 clusters so Gemini
  // sees distinct stories instead of 40 duplicates of the same breaking post
  let selectedForPrompt: HotPostItem[] = [];
  if (Array.isArray(preGroupedClusters) && preGroupedClusters.length > 0) {
    const seenKeys = new Set<string>();
    for (const cl of preGroupedClusters) {
      const rep = cl.representativePost || cl.posts[0];
      if (rep && !seenKeys.has(rep.key)) {
        seenKeys.add(rep.key);
        selectedForPrompt.push(rep);
        if (selectedForPrompt.length >= 42) break;
      }
    }
    if (selectedForPrompt.length < 32) {
      for (const p of posts) {
        if (!seenKeys.has(p.key)) {
          seenKeys.add(p.key);
          selectedForPrompt.push(p);
          if (selectedForPrompt.length >= 42) break;
        }
      }
    }
  } else {
    selectedForPrompt = posts.slice(0, 40);
  }

  const samplePosts = selectedForPrompt.map((p) => ({
    id: String(p.id),
    channel: p.channelName,
    text: p.cleanSnippet.slice(0, 180),
    linkTitle: p.linkPreview?.title,
    linkDesc: p.linkPreview?.description?.slice(0, 120),
    domain: p.linkPreview?.domain,
    views: p.views,
    forwards: p.forwards,
  }));

  try {
    const backendCap = await probeApiBackend();
    if (!backendCap.hasApiBackend || (!backendCap.serverHasGeminiKey && !apiKey)) {
      return [];
    }

    const res = await fetch('/api/gemini/cluster', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        samplePosts,
        dateRange,
        apiKey: apiKey || undefined,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.warn("Server Gemini cluster returned status:", res.status, err);
      return [];
    }

    const data = await res.json();
    const parsed = Array.isArray(data.clusters) ? data.clusters : [];

    if (parsed.length === 0) {
      return [];
    }

    const postMap = new Map<string, HotPostItem>();
    for (const p of posts) {
      postMap.set(String(p.id), p);
    }

    const clusters: HotTopicCluster[] = [];

    for (let i = 0; i < parsed.length; i++) {
      const item = parsed[i];
      if (!item || !Array.isArray(item.postIds)) continue;

      const clusterPosts: HotPostItem[] = [];
      for (const pid of item.postIds) {
        const found = postMap.get(String(pid));
        if (found) clusterPosts.push(found);
      }

      if (clusterPosts.length === 0) continue;

      let totalViews = 0;
      let totalForwards = 0;
      let totalReplies = 0;
      const channelsSet = new Set<string>();
      const domainsSet = new Set<string>();
      let minTime = Infinity;
      let maxTime = 0;

      for (const cp of clusterPosts) {
        totalViews += cp.views;
        totalForwards += cp.forwards;
        totalReplies += cp.replies;
        channelsSet.add(cp.channelName);
        if (cp.linkPreview?.domain) domainsSet.add(cp.linkPreview.domain);
        if (cp.date < minTime) minTime = cp.date;
        if (cp.date > maxTime) maxTime = cp.date;
      }

      const channelCount = channelsSet.size;
      const hotScore = computeTopicHotScore(
        totalViews,
        totalForwards,
        totalReplies,
        clusterPosts.length,
        channelCount,
        maxTime
      );

      const sortedPosts = [...clusterPosts].sort((a, b) => b.views - a.views);

      // Extract metadata or parse AI tags
      const extracted = extractClusterMetadata(clusterPosts);
      const persons = Array.isArray(item.persons) && item.persons.length > 0 ? item.persons : extracted.persons;
      const entities = Array.isArray(item.entities) && item.entities.length > 0 ? item.entities : extracted.entities;
      const facts = Array.isArray(item.facts) && item.facts.length > 0 ? item.facts : extracted.facts;
      const options = Array.isArray(item.options) && item.options.length > 0 ? item.options : extracted.options;

      const tags: ClusterTag[] = [];
      for (const p of persons.slice(0, 2)) tags.push({ type: 'person', label: String(p) });
      for (const e of entities.slice(0, 2)) tags.push({ type: 'entity', label: String(e) });
      for (const f of facts.slice(0, 2)) tags.push({ type: 'fact', label: String(f) });
      for (const o of options.slice(0, 1)) tags.push({ type: 'option', label: String(o) });

      // If keywords exist, include top ones as keyword tags
      const kws = Array.isArray(item.keywords) ? item.keywords : [];
      for (const kw of kws.slice(0, 2)) {
        if (!tags.some(t => t.label.toLowerCase() === kw.toLowerCase())) {
          tags.push({ type: 'keyword', label: kw });
        }
      }

        const clusterCategory = item.category || detectTopicCategory(sortedPosts.map(p => p.text).join(' '), Array.from(domainsSet));
        const titleZh = (item.titleZh && typeof item.titleZh === 'string' && item.titleZh.trim() !== '' && item.titleZh.trim() !== item.title?.trim()) ? item.titleZh.trim() : undefined;
        const localSentiment = analyzeClusterSentiment(sortedPosts);
        const aiSentiment = normalizeSentimentLabel(item.sentiment);
        const resolvedSentiment: TopicSentimentLabel = aiSentiment || localSentiment.label;
        const rawAiScore = typeof item.sentimentScore === 'number' && Number.isFinite(item.sentimentScore)
          ? Math.max(-1, Math.min(1, Number(item.sentimentScore.toFixed(2))))
          : undefined;
        const resolvedSentimentScore = rawAiScore ?? localSentiment.score;

        clusters.push({
          id: `ai-cluster-${i}-${Date.now()}`,
          title: item.title || `Trending Topic ${i + 1}`,
          titleZh,
          summary: item.summary || sortedPosts[0]?.cleanSnippet || '',
          isAiGenerated: true,
          clusterSource: 'ai',
          category: clusterCategory,
          sentiment: resolvedSentiment,
          sentimentScore: resolvedSentimentScore,
          sentimentBreakdown: localSentiment.counts,
          keywords: kws,
          domains: Array.from(domainsSet),
          persons,
          entities,
          facts,
          options,
          tags,
          posts: sortedPosts,
          postCount: clusterPosts.length,
          totalViews,
          totalForwards,
          totalReplies,
          channels: Array.from(channelsSet),
          hotScore,
          representativePost: sortedPosts[0],
          timeSpan: {
            start: minTime === Infinity ? Date.now() : minTime,
            end: maxTime === 0 ? Date.now() : maxTime
          }
        });
      }

      clusters.sort((a, b) => b.hotScore - a.hotScore);
      return clusters;
    } catch (err) {
      console.warn("AI clustering with Gemini failed, falling back to local clustering:", err);
      return [];
    }
  }

  // ---------------------------------------------------------------------------
  // Topic Title Language Detection & Translation Helper
  // ---------------------------------------------------------------------------

  export function isNonChineseTitle(text: string): boolean {
    if (!text || typeof text !== 'string') return false;
    const clean = text.trim();
    if (clean.length < 2) return false;

    // Strip URLs so embedded web links do not distort script detection
    const textWithoutUrls = clean
      .replace(/https?:\/\/\S+/gi, ' ')
      .replace(/\bwww\.\S+/gi, ' ')
      .trim();
    if (textWithoutUrls.length < 2) return false;

    // 1. Japanese (Hiragana / Katakana) or Korean (Hangul) always need translation to Chinese,
    //    even when Kanji / Hanja characters are also present.
    if (/[\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/.test(textWithoutUrls)) {
      return true;
    }

    const hanCount = (textWithoutUrls.match(/[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/g) || []).length;

    // 2. Non-Latin, non-CJK scripts (Cyrillic, Arabic/Persian, Thai, Hebrew, Greek, Devanagari, etc.)
    const otherNonLatinCount = (
      textWithoutUrls.match(/[\u0400-\u04FF\u0600-\u06FF\u0E00-\u0E7F\u0590-\u05FF\u0370-\u03FF\u0900-\u097F\u0980-\u09FF\u1000-\u109F]/g) || []
    ).length;
    if (otherNonLatinCount >= 2 && hanCount < otherNonLatinCount) {
      return true;
    }

    // 3. If the title already contains 2 or more Chinese characters (and is not Japanese/Korean/other script),
    //    treat it as Chinese (e.g. "OpenAI 发布 GPT-5 新模型").
    if (hanCount >= 2) {
      return false;
    }

    // 4. All remaining non-Chinese languages (including English, European, Vietnamese, etc.) with >= 2 letters
    const nonHanLetters = textWithoutUrls
      .replace(/[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/g, '')
      .match(/\p{L}/gu);
    return (nonHanLetters?.length || 0) >= 2;
  }

  /** Backward-compatible alias: returns true for any non-Chinese title (including English). */
  export const isNonEnglishNonChinese = isNonChineseTitle;

  export const INITIAL_TITLE_TRANSLATE_LIMIT = 15;
  const MAX_TITLE_CACHE_SIZE = 2000;
  const titleZhTranslationCache = new Map<string, string>();
  const inflightTitleTranslations = new Set<string>();

  function rememberTitleTranslation(source: string, translated: string) {
    if (!source || !translated || source === translated) return;
    if (titleZhTranslationCache.size >= MAX_TITLE_CACHE_SIZE) {
      const oldestKey = titleZhTranslationCache.keys().next().value;
      if (oldestKey !== undefined) {
        titleZhTranslationCache.delete(oldestKey);
      }
    }
    titleZhTranslationCache.set(source, translated);
  }

  async function runWithConcurrency<T>(
    items: T[],
    concurrency: number,
    workerFn: (item: T) => Promise<void>,
    delayBetweenMs: number = 0
  ): Promise<void> {
    if (items.length === 0) return;
    const workerCount = Math.max(1, Math.min(concurrency, items.length));
    let cursor = 0;

    const workers = Array.from({ length: workerCount }, async () => {
      while (cursor < items.length) {
        const idx = cursor++;
        if (idx >= items.length) break;
        await workerFn(items[idx]);
        if (delayBetweenMs > 0 && cursor < items.length) {
          await new Promise((r) => setTimeout(r, delayBetweenMs));
        }
      }
    });

    await Promise.all(workers);
  }

  export async function attachChineseTranslationsForForeignTitles(
    topics: HotTopicCluster[],
    options?: {
      limit?: number;
      batchSize?: number;
      concurrency?: number;
    }
  ): Promise<boolean> {
    if (!Array.isArray(topics) || topics.length === 0) return false;

    const limit = Math.max(1, options?.limit ?? INITIAL_TITLE_TRANSLATE_LIMIT);
    const batchSize = Math.max(1, Math.min(25, options?.batchSize ?? 15));
    const concurrency = Math.max(1, Math.min(4, options?.concurrency ?? 3));

    let updatedAny = false;

    // 1. Hydrate all cached translations synchronously (zero HTTP requests)
    const remaining: HotTopicCluster[] = [];
    for (const topic of topics) {
      const cleanTitle = (topic.title || '').trim();
      if (!cleanTitle || (topic.titleZh && topic.titleZh !== cleanTitle)) continue;
      if (!isNonChineseTitle(cleanTitle)) continue;

      const cached = titleZhTranslationCache.get(cleanTitle);
      if (cached) {
        topic.titleZh = cached;
        updatedAny = true;
      } else if (!inflightTitleTranslations.has(cleanTitle)) {
        remaining.push(topic);
      }
    }

    if (remaining.length === 0) return updatedAny;

    // 2. Cap upfront HTTP translations to first N topics; tail topics translate lazily on scroll/view
    const targetTopics = remaining.slice(0, limit);
    const titles = Array.from(new Set(targetTopics.map((t) => t.title.trim())));
    if (titles.length === 0) return updatedAny;

    for (const title of titles) {
      inflightTitleTranslations.add(title);
    }

    const translations: Record<string, string> = {};

    try {
      // Tier 1: Batch server endpoint requests sequentially in safe chunks
      const backendCap = await probeApiBackend();
      if (backendCap.hasApiBackend) {
        for (let i = 0; i < titles.length; i += batchSize) {
          const chunk = titles.slice(i, i + batchSize);
          try {
            const res = await fetch('/api/translate-titles', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ titles: chunk })
            });

            if (res.ok) {
              const data = await res.json();
              Object.assign(translations, data.translations || {});
            } else if (res.status === 405) {
              // Cloudflare Workers or static asset handler rejected POST -> Tier 2: Bounded GET chunks
              for (let g = 0; g < chunk.length; g += 6) {
                const subChunk = chunk.slice(g, g + 6);
                try {
                  const getRes = await fetch(
                    `/api/translate-titles?titles=${encodeURIComponent(JSON.stringify(subChunk))}`,
                    { method: 'GET' }
                  );
                  if (getRes.ok) {
                    const data = await getRes.json();
                    Object.assign(translations, data.translations || {});
                  }
                } catch {}
              }
            }
          } catch {
            // Network/abort failure on POST -> Tier 2: Bounded GET chunks
            for (let g = 0; g < chunk.length; g += 6) {
              const subChunk = chunk.slice(g, g + 6);
              try {
                const getRes = await fetch(
                  `/api/translate-titles?titles=${encodeURIComponent(JSON.stringify(subChunk))}`,
                  { method: 'GET' }
                );
                if (getRes.ok) {
                  const data = await getRes.json();
                  Object.assign(translations, data.translations || {});
                }
              } catch {}
            }
          }
        }
      }

      // Tier 3: Client-side direct fallback with strict bounded concurrency (max 3 concurrent)
      const unhandled = titles.filter((t) => !translations[t]);
      if (unhandled.length > 0) {
        await runWithConcurrency(
          unhandled,
          concurrency,
          async (title) => {
            try {
              const gUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-CN&dt=t&q=${encodeURIComponent(title)}`;
              const gRes = await fetch(gUrl);
              if (gRes.ok) {
                const data = await gRes.json();
                if (Array.isArray(data) && Array.isArray(data[0])) {
                  const translated = data[0].map((item: any) => item?.[0] || '').join('').trim();
                  if (translated && translated.toLowerCase() !== title.toLowerCase()) {
                    translations[title] = translated;
                    return;
                  }
                }
              }
            } catch {}

            // Secondary client fallback: MyMemory Neural MT
            try {
              const langPair = /^[A-Za-z0-9\s.,:;!?'"()\[\]{}\-_/&%$#@+=*]+$/.test(title)
                ? 'en|zh-CN'
                : 'autodetect|zh-CN';
              const mUrl = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(title)}&langpair=${encodeURIComponent(langPair)}`;
              const mRes = await fetch(mUrl);
              if (mRes.ok) {
                const data = await mRes.json();
                const tr = data?.responseData?.translatedText;
                if (tr && typeof tr === 'string' && tr.trim() && !tr.includes('MYMEMORY WARNING') && tr.trim().toLowerCase() !== title.toLowerCase()) {
                  translations[title] = tr.trim();
                }
              }
            } catch {}
          },
          75
        );
      }

      // Persist resolved translations in cache & apply to targetTopics (plus any duplicate title in `topics`)
      for (const [orig, tr] of Object.entries(translations)) {
        if (typeof tr === 'string' && tr.trim() && tr.trim() !== orig.trim()) {
          rememberTitleTranslation(orig.trim(), tr.trim());
        }
      }

      for (const topic of topics) {
        const clean = (topic.title || '').trim();
        if (!clean || (topic.titleZh && topic.titleZh !== clean)) continue;
        const trans =
          titleZhTranslationCache.get(clean) ||
          translations[clean] ||
          translations[topic.title];
        if (trans && typeof trans === 'string' && trans.trim() && trans.trim() !== clean) {
          topic.titleZh = trans.trim();
          updatedAny = true;
        }
      }
    } finally {
      for (const title of titles) {
        inflightTitleTranslations.delete(title);
      }
    }

    return updatedAny;
  }

  /**
   * Translates a small batch of visible/inspected topics on the fly when viewed by the user.
   */
  export async function translateTopicTitlesOnDemand(topics: HotTopicCluster[]): Promise<boolean> {
    if (!Array.isArray(topics) || topics.length === 0) return false;
    return attachChineseTranslationsForForeignTitles(topics, {
      limit: topics.length,
      batchSize: 12,
      concurrency: 3,
    });
  }

// ---------------------------------------------------------------------------
// Main Pipeline Execution: Progressive & Responsive
// ---------------------------------------------------------------------------

function yieldToMain(): Promise<void> {
  return new Promise(resolve => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 0);
    }
  });
}

export async function processListenHotsData(options: {
  cachedChannels: { nodeId: string; posts: any[] }[];
  dateRange: HotsDateRange;
  geminiApiKey?: string;
  useAiMode?: boolean;
  clusterMode?: HotsClusterMode;
  listenItems?: any[];
  channelMetadataCache?: Record<string, any>;
  onProgress?: (p: HotsEngineProgress) => void;
  onPartialResult?: (partial: {
    hotPosts: HotPostItem[];
    hotChannels: HotChannelItem[];
    hotTopics?: HotTopicCluster[];
    substantivePosts?: HotPostItem[];
    totalPostsAnalyzed: number;
    filteredPostsCount: number;
    meaninglessPostsCount?: number;
    substantivePostsCount?: number;
    totalChannelsScanned: number;
    activeChannelsCount: number;
  }) => void;
}): Promise<HotsAnalysisResult> {
  const { cachedChannels, dateRange, geminiApiKey, useAiMode, listenItems, channelMetadataCache, onProgress, onPartialResult } = options;
  const bounds = getDateRangeBounds(dateRange);

  onProgress?.({
    step: 'scanning',
    percent: 10,
    message: `Filtering posts across ${cachedChannels.length} channels...`
  });

  // 1. Scan and filter posts within the requested date bounds
  const inRangePosts: HotPostItem[] = [];
  const channelStatsMap = new Map<string, {
    channelId: string;
    channelUsername: string;
    channelName: string;
    title: string;
    avatarUrl?: string;
    subscribers?: number;
    online?: number;
    description?: string;
    date?: string | number;
    _type?: string;
    postCount: number;
    totalViews: number;
    totalForwards: number;
    totalReplies: number;
    latestPostTime: number;
    samplePosts: HotPostItem[];
  }>();

  let totalPostsAnalyzed = 0;
  const CHUNK_SIZE = 40;
  const seenPostKeys = new Set<string>();

  for (let cIdx = 0; cIdx < cachedChannels.length; cIdx++) {
    const channel = cachedChannels[cIdx];
    const channelId = channel.nodeId;
    const rawPosts = Array.isArray(channel.posts) ? channel.posts : [];
    totalPostsAnalyzed += rawPosts.length;

    // Resolve true channel username & title from posts, leaf items, or channel metadata
    let channelUsername = '';
    let channelTitle = '';

    // Check listenItems
    let matchedListenItem: any = null;
    if (Array.isArray(listenItems)) {
      matchedListenItem = listenItems.find(
        (it: any) => it.id === channelId || it.argument === channelId
      );
      if (matchedListenItem) {
        channelUsername = (matchedListenItem.argument || '').replace(/^@/, '').trim();
        channelTitle = matchedListenItem.name || channelUsername;
      }
    }

    // Check posts keys if not resolved
    if (!channelUsername) {
      for (const p of rawPosts) {
        if (p.key && typeof p.key === 'string' && p.key.includes('.')) {
          const u = p.key.split('.')[0].trim();
          if (u) {
            channelUsername = u;
            break;
          }
        }
        const url = p.data?.url || p.url;
        if (url && typeof url === 'string') {
          const match = url.match(/t\.me\/([a-zA-Z0-9_+]+)/);
          if (match && match[1]) {
            channelUsername = match[1];
            break;
          }
        }
      }
    }

    if (!channelUsername) {
      channelUsername = channelId.startsWith('@') ? channelId.slice(1) : channelId;
    }

    // Secondary match by resolved channelUsername if not matched by ID
    if (!matchedListenItem && Array.isArray(listenItems) && channelUsername) {
      matchedListenItem = listenItems.find((it: any) => {
        const arg = (it?.argument || '').replace(/^@/, '').trim().toLowerCase();
        return arg && arg === channelUsername.toLowerCase();
      });
    }

    // Exclude channel from hot topics computation if disabled in configuration
    if (matchedListenItem && matchedListenItem.enableHotTopics === false) {
      continue;
    }

    // Check channelMetadataCache
    const meta = channelMetadataCache?.[channelUsername] || channelMetadataCache?.[channelId];
    if (meta?.title || meta?.name) {
      channelTitle = meta.title || meta.name;
    } else if (!channelTitle) {
      channelTitle = channelUsername;
    }

    for (const rp of rawPosts) {
      const timestamp = extractPostTimestamp(rp);
      if (timestamp < bounds.start || timestamp > bounds.end) {
        continue;
      }

      const postKey = String(rp.key || rp.id || `${channelUsername}_${timestamp}`).trim();
      if (!postKey || seenPostKeys.has(postKey)) {
        continue; // Deduplicate by post.key
      }
      seenPostKeys.add(postKey);

      const views = extractPostViews(rp);
      const forwards = extractPostForwards(rp);
      const replies = extractPostReplies(rp);
      const text = sanitizeTitle(extractPostText(rp));
      const linkPreview = extractPostLinkPreview(rp);
      if (linkPreview?.title) {
        linkPreview.title = sanitizeTitle(linkPreview.title);
      }
      if (linkPreview?.description) {
        linkPreview.description = sanitizeTitle(linkPreview.description);
      }

      // Media check
      const photos = rp.data?.photos ?? rp.photos;
      const videos = rp.data?.videos ?? rp.videos;
      const hasPhotos = Array.isArray(photos) && photos.length > 0;
      const hasVideos = Array.isArray(videos) && videos.length > 0;
      const hasMedia = hasPhotos || hasVideos;
      const mediaType = hasPhotos && hasVideos ? 'mixed' : (hasVideos ? 'video' : (hasPhotos ? 'photo' : undefined));

      const cleanSnippet = text.replace(/<[^>]*>?/gm, '').trim();

      const postData = rp.data || {};
      const author = postData.author || '';
      const uName = getUsername(rp);
      const postAuthorTitle = author || (uName !== 'Telegram User' ? uName : (channelTitle || channelUsername));

      const postItem: HotPostItem = {
        id: rp.id || postKey,
        key: postKey,
        channelId,
        channelUsername,
        channelName: channelUsername,
        channelTitle: postAuthorTitle,
        text,
        cleanSnippet: cleanSnippet || text || (linkPreview?.title ? `[Link] ${linkPreview.title}` : '[Media Post]'),
        views,
        forwards,
        replies,
        date: timestamp,
        dateStr: formatDate(timestamp),
        url: postData.url || (channelUsername ? `https://t.me/${channelUsername}/${rp.id}` : undefined),
        linkPreview,
        hasMedia,
        mediaType,
        qualityScore: computePostQualityScore(rp),
        data: postData,
        raw: rp
      };

      inRangePosts.push(postItem);

      // Track channel aggregations by true channelUsername
      let cStat = channelStatsMap.get(channelUsername);
      if (!cStat) {
        cStat = {
          channelId,
          channelUsername,
          channelName: channelUsername,
          title: channelTitle || channelUsername,
          avatarUrl: meta?.photo && typeof meta.photo === 'string' && meta.photo.startsWith('data:') ? meta.photo : (channelUsername && !channelUsername.startsWith('-100') ? `https://i.gogingko.net/api/v1/v/telegram-profile/${channelUsername}` : undefined),
          subscribers: meta?.subscribers ?? meta?.members ?? meta?.participants_count,
          online: meta?.online ?? meta?.online_count,
          description: meta?.description || meta?.about,
          date: meta?.date || meta?.createdAt,
          _type: meta?._type,
          postCount: 0,
          totalViews: 0,
          totalForwards: 0,
          totalReplies: 0,
          latestPostTime: 0,
          samplePosts: []
        };
        channelStatsMap.set(channelUsername, cStat);
      }

      cStat.postCount++;
      cStat.totalViews += views;
      cStat.totalForwards += forwards;
      cStat.totalReplies += replies;
      if (timestamp > cStat.latestPostTime) {
        cStat.latestPostTime = timestamp;
      }
      if (cStat.samplePosts.length < 5) {
        cStat.samplePosts.push(postItem);
      }
    }

    // Yield execution periodically to preserve UI responsiveness
    if (cIdx % CHUNK_SIZE === 0 && cIdx > 0) {
      const pct = 10 + Math.floor((cIdx / cachedChannels.length) * 35);
      onProgress?.({
        step: 'scanning',
        percent: pct,
        message: `Processed ${cIdx}/${cachedChannels.length} channels...`
      });
      await yieldToMain();
    }
  }

  // 2. Sort Hot Posts (Primary sort: Views DSC)
  onProgress?.({
    step: 'ranking',
    percent: 50,
    message: 'Ranking hot posts and channels...'
  });

  const hotPosts = [...inRangePosts].sort((a, b) => b.views - a.views);

  // 3. Sort Hot Channels by activity score DSC
  const hotChannels: HotChannelItem[] = [];
  for (const stat of channelStatsMap.values()) {
    const avgViews = Math.round(stat.totalViews / Math.max(1, stat.postCount));
    const activityScore = computeChannelActivityScore({
      postCount: stat.postCount,
      totalViews: stat.totalViews,
      avgViews,
      totalForwards: stat.totalForwards,
      totalReplies: stat.totalReplies,
      latestPostTime: stat.latestPostTime
    });

    hotChannels.push({
      channelId: stat.channelId,
      channelUsername: stat.channelUsername,
      channelName: stat.channelUsername,
      title: stat.title,
      avatarUrl: stat.avatarUrl,
      postCount: stat.postCount,
      totalViews: stat.totalViews,
      totalForwards: stat.totalForwards,
      totalReplies: stat.totalReplies,
      avgViews,
      activityScore,
      latestPostTime: stat.latestPostTime,
      subscribers: stat.subscribers,
      online: stat.online,
      description: stat.description,
      date: stat.date,
      _type: stat._type,
      samplePosts: stat.samplePosts
    });
  }

  hotChannels.sort((a, b) => b.activityScore - a.activityScore);

  // Filter out posts that only contain media or have shorter/meaningless text content
  const substantivePosts = inRangePosts.filter(isSubstantivePostForTopicClustering);
  const meaninglessPostsCount = Math.max(0, inRangePosts.length - substantivePosts.length);
  const substantivePostsCount = substantivePosts.length;

  const clusterMode: HotsClusterMode =
    options.clusterMode || (useAiMode ? 'ai' : 'rule');

  // 4. Instant Stage-1 Clustering (Intl.Segmenter + TF-IDF + SimHash + Pass-2 Merge)
  onProgress?.({
    step: 'clustering',
    stage: 'stage1',
    percent: 62,
    message: 'Running multilingual Stage-1 topic preview...',
  });

  const nerMap = await loadCachedNerEntitiesForPosts(substantivePosts);
  const stage1Topics =
    substantivePosts.length > 0
      ? await clusterPostsStage1(substantivePosts, nerMap)
      : [];

  // Early partial result notification: shows Hot Posts, Hot Channels, and instant Stage-1 topics immediately
  onPartialResult?.({
    hotPosts,
    hotChannels,
    hotTopics: stage1Topics,
    substantivePosts,
    totalPostsAnalyzed,
    filteredPostsCount: inRangePosts.length,
    meaninglessPostsCount,
    substantivePostsCount,
    totalChannelsScanned: cachedChannels.length,
    activeChannelsCount: channelStatsMap.size,
  });

  let hotTopics: HotTopicCluster[] = stage1Topics;

  // Optional Gemini AI mode using Stage-1 medoid representatives for maximum story breadth
  if ((clusterMode === 'ai' || useAiMode) && substantivePosts.length > 0) {
    onProgress?.({
      step: 'ai_clustering',
      stage: 'stage2',
      percent: 78,
      message: 'Running Gemini 3.1 Flash Lite topic clustering...',
    });

    const aiTopics = await clusterWithGeminiAI(
      geminiApiKey || '',
      substantivePosts,
      dateRange,
      stage1Topics
    );
    if (aiTopics.length > 0) {
      hotTopics = aiTopics;
    }
  }

  // 5. Translate all non-Chinese topic titles (including English) into Chinese
  if (hotTopics.length > 0) {
    onProgress?.({
      step: 'clustering',
      stage: clusterMode === 'ai' ? 'stage2' : 'stage1',
      percent: 94,
      message: 'Translating non-Chinese topic titles into Chinese...',
    });
    await attachChineseTranslationsForForeignTitles(hotTopics);
  }

  onProgress?.({
    step: 'done',
    percent: 100,
    message: 'Finished calculating hot intelligence.',
  });

  return {
    dateRange,
    timeWindow: bounds,
    totalPostsAnalyzed,
    filteredPostsCount: inRangePosts.length,
    meaninglessPostsCount,
    substantivePostsCount,
    totalChannelsScanned: cachedChannels.length,
    activeChannelsCount: channelStatsMap.size,
    hotTopics,
    hotPosts,
    hotChannels,
    substantivePosts,
    clusterModeUsed: hotTopics.some((t) => t.clusterSource === 'ai') ? 'ai' : 'rule',
    computedAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Stage 1: Fast Multilingual Statistical Clustering (TF-IDF + SimHash + 2-Pass Merge)
// ---------------------------------------------------------------------------

interface Stage1ClusterBucket {
  items: PostFeatureBag[];
  centroidTfidf: Map<string, number>;
  hashtags: Set<string>;
  urls: Set<string>;
  domains: Set<string>;
  simHashHi: number;
  simHashLo: number;
}

function mergeTfidfIntoCentroid(
  centroid: Map<string, number>,
  existingCount: number,
  nextVec: Map<string, number>
): Map<string, number> {
  const blended = new Map<string, number>();
  const oldWeight = existingCount / (existingCount + 1);
  const newWeight = 1 / (existingCount + 1);

  for (const [k, v] of centroid.entries()) {
    blended.set(k, v * oldWeight);
  }
  for (const [k, v] of nextVec.entries()) {
    blended.set(k, (blended.get(k) || 0) + v * newWeight);
  }

  let normSq = 0;
  for (const v of blended.values()) {
    normSq += v * v;
  }
  const norm = Math.sqrt(normSq) || 1;

  // Cap sparse centroid size at top 48 dimensions for O(1) dot products
  if (blended.size > 48) {
    const top = Array.from(blended.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 48);
    const trimmed = new Map<string, number>();
    let subNormSq = 0;
    for (const [k, v] of top) {
      subNormSq += v * v;
    }
    const subNorm = Math.sqrt(subNormSq) || 1;
    for (const [k, v] of top) {
      trimmed.set(k, v / subNorm);
    }
    return trimmed;
  }

  for (const [k, v] of blended.entries()) {
    blended.set(k, v / norm);
  }
  return blended;
}

export async function clusterPostsStage1(
  substantivePosts: HotPostItem[],
  nerMap?: Map<string, CachedNerPostSummary>
): Promise<HotTopicCluster[]> {
  if (!Array.isArray(substantivePosts) || substantivePosts.length === 0) return [];

  // Process highest-quality posts first so strong headlines anchor centroids cleanly
  const orderedPosts = [...substantivePosts].sort(
    (a, b) => b.qualityScore - a.qualityScore || b.date - a.date
  );
  const bags = buildCorpusFeatureBags(orderedPosts);

  const clusters: Stage1ClusterBucket[] = [];
  const tokenToClusters = new Map<string, number[]>();
  const urlToCluster = new Map<string, number>();

  const STAGE1_THRESHOLD = 0.26;

  for (let i = 0; i < bags.length; i++) {
    const bag = bags[i];
    let bestClusterIdx = -1;
    let highestSim = 0;

    // 1. Exact URL instant match
    if (bag.linkUrlClean && urlToCluster.has(bag.linkUrlClean)) {
      bestClusterIdx = urlToCluster.get(bag.linkUrlClean)!;
      highestSim = 0.96;
    } else {
      // 2. Inverted top-token + hashtag candidate lookup avoids O(N * K) scan
      const candidateSet = new Set<number>();
      for (const tok of bag.topTokens) {
        const list = tokenToClusters.get(tok);
        if (list) {
          for (let k = 0; k < list.length; k++) candidateSet.add(list[k]);
        }
      }
      for (const h of bag.hashtags) {
        const list = tokenToClusters.get(h);
        if (list) {
          for (let k = 0; k < list.length; k++) candidateSet.add(list[k]);
        }
      }

      // SimHash fallback for near-duplicate CJK/mixed headlines
      if (candidateSet.size < 12) {
        for (let c = 0; c < clusters.length; c++) {
          if (hammingDistance64(bag.simHashHi, bag.simHashLo, clusters[c].simHashHi, clusters[c].simHashLo) <= 12) {
            candidateSet.add(c);
          }
        }
      }

      for (const cIdx of candidateSet) {
        const cl = clusters[cIdx];
        const sim = computeStage1BagToCentroidSim(
          bag,
          cl.centroidTfidf,
          cl.hashtags,
          cl.urls,
          cl.domains
        );
        if (sim > highestSim && sim >= STAGE1_THRESHOLD) {
          highestSim = sim;
          bestClusterIdx = cIdx;
        }
      }
    }

    if (bestClusterIdx >= 0) {
      const target = clusters[bestClusterIdx];
      target.centroidTfidf = mergeTfidfIntoCentroid(
        target.centroidTfidf,
        target.items.length,
        bag.tfidf
      );
      target.items.push(bag);
      bag.hashtags.forEach((h) => target.hashtags.add(h));
      if (bag.linkUrlClean) {
        target.urls.add(bag.linkUrlClean);
        urlToCluster.set(bag.linkUrlClean, bestClusterIdx);
      }
      if (bag.domain) target.domains.add(bag.domain);
    } else {
      const newIdx = clusters.length;
      const urls = new Set<string>();
      if (bag.linkUrlClean) {
        urls.add(bag.linkUrlClean);
        urlToCluster.set(bag.linkUrlClean, newIdx);
      }
      const domains = new Set<string>();
      if (bag.domain) domains.add(bag.domain);

      clusters.push({
        items: [bag],
        centroidTfidf: new Map(bag.tfidf),
        hashtags: new Set(bag.hashtags),
        urls,
        domains,
        simHashHi: bag.simHashHi,
        simHashLo: bag.simHashLo,
      });

      for (const tok of bag.topTokens) {
        let arr = tokenToClusters.get(tok);
        if (!arr) {
          arr = [];
          tokenToClusters.set(tok, arr);
        }
        arr.push(newIdx);
      }
      for (const h of bag.hashtags) {
        let arr = tokenToClusters.get(h);
        if (!arr) {
          arr = [];
          tokenToClusters.set(h, arr);
        }
        arr.push(newIdx);
      }
    }

    if (i % 80 === 0 && i > 0) {
      await yieldToMain();
    }
  }

  // Pass 2: Consolidate split Stage-1 clusters with strong centroid overlap
  const STAGE1_MERGE_THRESHOLD = 0.54;
  const active = new Array<boolean>(clusters.length).fill(true);
  for (let a = 0; a < clusters.length; a++) {
    if (!active[a]) continue;
    for (let b = a + 1; b < clusters.length; b++) {
      if (!active[b]) continue;
      const cos = computeSparseCosine(clusters[a].centroidTfidf, clusters[b].centroidTfidf);
      if (cos >= STAGE1_MERGE_THRESHOLD) {
        clusters[a].items.push(...clusters[b].items);
        clusters[a].centroidTfidf = mergeTfidfIntoCentroid(
          clusters[a].centroidTfidf,
          clusters[a].items.length,
          clusters[b].centroidTfidf
        );
        clusters[b].hashtags.forEach((h) => clusters[a].hashtags.add(h));
        clusters[b].urls.forEach((u) => clusters[a].urls.add(u));
        clusters[b].domains.forEach((d) => clusters[a].domains.add(d));
        active[b] = false;
      }
    }
  }

  const consolidated = clusters.filter((_, idx) => active[idx]);
  return finalizeHotTopicClusters(
    consolidated.map((cl) => ({
      items: cl.items,
      medoidPost: pickStage1Medoid(cl.items, cl.centroidTfidf),
      cohesionScore: cl.items.length > 1 ? 0.65 : 0.4,
    })),
    'rule',
    nerMap
  );
}

function pickStage1Medoid(
  items: PostFeatureBag[],
  centroidTfidf: Map<string, number>
): HotPostItem {
  if (items.length <= 1) return items[0].post;
  let best = items[0].post;
  let bestScore = -Infinity;
  const maxQ = Math.max(1, ...items.map((it) => it.post.qualityScore));

  for (const it of items) {
    const sim = computeSparseCosine(it.tfidf, centroidTfidf);
    const normQ = it.post.qualityScore / maxQ;
    const combined = 0.65 * sim + 0.35 * normQ;
    if (combined > bestScore) {
      bestScore = combined;
      best = it.post;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Stage 2: Hybrid Multilingual ONNX Embedding Clustering (Cosine + Lexical + 2-Pass Merge)
// ---------------------------------------------------------------------------

interface Stage2VectorCluster {
  items: Array<{
    bag: PostFeatureBag;
    vec?: Float32Array;
  }>;
  sumVec: Float32Array;
  centroidVec: Float32Array;
  vectorCount: number;
  centroidTfidf: Map<string, number>;
  hashtags: Set<string>;
  urls: Set<string>;
  domains: Set<string>;
  medianTime: number;
}

function computeTemporalPenalty(
  tA: number,
  tB: number,
  dateRange: HotsDateRange
): number {
  if (dateRange === 'today' || dateRange === 'yesterday') return 0;
  if (!tA || !tB) return 0;
  const diffDays = Math.abs(tA - tB) / (1000 * 3600 * 24);
  if (diffDays <= 4) return 0;
  return Math.min(0.1, (diffDays - 4) * 0.015);
}

export async function clusterPostsWithEmbeddings(
  substantivePosts: HotPostItem[],
  vectorsMap: Map<string, Float32Array>,
  dateRange: HotsDateRange,
  externalNerMap?: Map<string, CachedNerPostSummary>
): Promise<HotTopicCluster[]> {
  if (!Array.isArray(substantivePosts) || substantivePosts.length === 0) return [];

  const nerMap = externalNerMap || (await loadCachedNerEntitiesForPosts(substantivePosts));
  const orderedPosts = [...substantivePosts].sort(
    (a, b) => b.qualityScore - a.qualityScore || b.date - a.date
  );
  const bags = buildCorpusFeatureBags(orderedPosts);

  const clusters: Stage2VectorCluster[] = [];
  const urlToCluster = new Map<string, number>();

  const TAU_PASS1 = 0.58;

  for (let i = 0; i < bags.length; i++) {
    const bag = bags[i];
    const vec = vectorsMap.get(bag.post.key);

    let bestClusterIdx = -1;
    let highestSim = 0;

    if (bag.linkUrlClean && urlToCluster.has(bag.linkUrlClean)) {
      bestClusterIdx = urlToCluster.get(bag.linkUrlClean)!;
      highestSim = 0.97;
    } else {
      for (let c = 0; c < clusters.length; c++) {
        const cl = clusters[c];

        let sim = 0;
        if (vec && cl.vectorCount > 0) {
          const cos = dotProductVectors(vec, cl.centroidVec);
          const lex = computeSparseCosine(bag.tfidf, cl.centroidTfidf);
          let hashBonus = 0;
          if (bag.hashtags.size > 0 && cl.hashtags.size > 0) {
            for (const h of bag.hashtags) {
              if (cl.hashtags.has(h)) {
                hashBonus = 0.09;
                break;
              }
            }
          }
          const domBonus =
            bag.domain &&
            cl.domains.has(bag.domain) &&
            bag.domain !== 't.me' &&
            bag.domain !== 'telegram.org' &&
            cos >= 0.42
              ? 0.05
              : 0;
          const timePenalty = computeTemporalPenalty(bag.post.date, cl.medianTime, dateRange);
          sim = 0.80 * cos + 0.14 * lex + hashBonus + domBonus - timePenalty;
        } else {
          // Graceful sparse fallback for unembedded items
          sim = computeStage1BagToCentroidSim(
            bag,
            cl.centroidTfidf,
            cl.hashtags,
            cl.urls,
            cl.domains
          ) * 1.45;
        }

        if (sim > highestSim && sim >= TAU_PASS1) {
          highestSim = sim;
          bestClusterIdx = c;
        }
      }
    }

    if (bestClusterIdx >= 0) {
      const target = clusters[bestClusterIdx];
      if (vec) {
        for (let d = 0; d < vec.length; d++) {
          target.sumVec[d] += vec[d];
        }
        target.vectorCount++;
        target.centroidVec = l2Normalize(target.sumVec);
      }
      target.centroidTfidf = mergeTfidfIntoCentroid(
        target.centroidTfidf,
        target.items.length,
        bag.tfidf
      );
      target.items.push({ bag, vec });
      bag.hashtags.forEach((h) => target.hashtags.add(h));
      if (bag.linkUrlClean) {
        target.urls.add(bag.linkUrlClean);
        urlToCluster.set(bag.linkUrlClean, bestClusterIdx);
      }
      if (bag.domain) target.domains.add(bag.domain);
    } else {
      const dim = vec ? vec.length : 384;
      const sumVec = vec ? new Float32Array(vec) : new Float32Array(dim);
      const centroidVec = vec ? new Float32Array(vec) : new Float32Array(dim);
      const newIdx = clusters.length;
      const urls = new Set<string>();
      if (bag.linkUrlClean) {
        urls.add(bag.linkUrlClean);
        urlToCluster.set(bag.linkUrlClean, newIdx);
      }
      const domains = new Set<string>();
      if (bag.domain) domains.add(bag.domain);

      clusters.push({
        items: [{ bag, vec }],
        sumVec,
        centroidVec,
        vectorCount: vec ? 1 : 0,
        centroidTfidf: new Map(bag.tfidf),
        hashtags: new Set(bag.hashtags),
        urls,
        domains,
        medianTime: bag.post.date,
      });
    }

    if (i % 80 === 0 && i > 0) {
      await yieldToMain();
    }
  }

  // Pass 2: Agglomerative consolidation of split neural clusters
  const TAU_PASS2 = 0.72;
  const active = new Array<boolean>(clusters.length).fill(true);

  for (let pass = 0; pass < 2; pass++) {
    let mergedAny = false;
    for (let a = 0; a < clusters.length; a++) {
      if (!active[a] || clusters[a].vectorCount === 0) continue;
      for (let b = a + 1; b < clusters.length; b++) {
        if (!active[b] || clusters[b].vectorCount === 0) continue;
        // Avoid merging massive catch-all clusters recklessly
        if (clusters[a].items.length + clusters[b].items.length > 60) continue;

        const cos = dotProductVectors(clusters[a].centroidVec, clusters[b].centroidVec);
        const timePenalty = computeTemporalPenalty(
          clusters[a].medianTime,
          clusters[b].medianTime,
          dateRange
        );
        if (cos - timePenalty >= TAU_PASS2) {
          for (let d = 0; d < clusters[a].sumVec.length; d++) {
            clusters[a].sumVec[d] += clusters[b].sumVec[d];
          }
          clusters[a].vectorCount += clusters[b].vectorCount;
          clusters[a].centroidVec = l2Normalize(clusters[a].sumVec);
          clusters[a].items.push(...clusters[b].items);
          clusters[a].centroidTfidf = mergeTfidfIntoCentroid(
            clusters[a].centroidTfidf,
            clusters[a].items.length,
            clusters[b].centroidTfidf
          );
          clusters[b].hashtags.forEach((h) => clusters[a].hashtags.add(h));
          clusters[b].urls.forEach((u) => clusters[a].urls.add(u));
          clusters[b].domains.forEach((d) => clusters[a].domains.add(d));
          active[b] = false;
          mergedAny = true;
        }
      }
    }
    if (!mergedAny) break;
  }

  const consolidated = clusters.filter((_, idx) => active[idx]);

  return finalizeHotTopicClusters(
    consolidated.map((cl) => {
      let medoid = cl.items[0].bag.post;
      let cohesionSum = 0;
      let cohesionCount = 0;

      if (cl.items.length > 1 && cl.vectorCount > 0) {
        const maxQ = Math.max(1, ...cl.items.map((it) => it.bag.post.qualityScore));
        let bestScore = -Infinity;
        for (const it of cl.items) {
          const sim = it.vec ? dotProductVectors(it.vec, cl.centroidVec) : 0.4;
          if (it.vec) {
            cohesionSum += sim;
            cohesionCount++;
          }
          const score = 0.72 * sim + 0.28 * (it.bag.post.qualityScore / maxQ);
          if (score > bestScore) {
            bestScore = score;
            medoid = it.bag.post;
          }
        }
      } else {
        medoid = pickStage1Medoid(
          cl.items.map((it) => it.bag),
          cl.centroidTfidf
        );
      }

      return {
        items: cl.items.map((it) => it.bag),
        medoidPost: medoid,
        cohesionScore: cohesionCount > 0 ? cohesionSum / cohesionCount : 0.65,
      };
    }),
    'neural',
    nerMap
  );
}

function finalizeHotTopicClusters(
  rawClusters: Array<{
    items: PostFeatureBag[];
    medoidPost: HotPostItem;
    cohesionScore: number;
  }>,
  source: 'rule' | 'neural',
  nerMap?: Map<string, CachedNerPostSummary>
): HotTopicCluster[] {
  // Quality gate for singleton clusters before computing global c-TF-IDF
  const gated = rawClusters.filter((cl) => {
    if (cl.items.length === 0) return false;
    if (cl.items.length === 1) {
      const single = cl.items[0].post;
      const cleanBody = (single.text || '')
        .replace(/<[^>]*>?/gm, '')
        .replace(/https?:\/\/\S+/gi, '')
        .replace(/@[a-zA-Z0-9_]+/g, '')
        .trim();
      const cjkCount = (cleanBody.match(/[\u4e00-\u9fff\u3040-\u30ff]/g) || []).length;
      const hasRichLp = Boolean(
        single.linkPreview?.title &&
          single.linkPreview.title.trim().length >= 16 &&
          !isGenericLead(single.linkPreview.title)
      );
      if (cleanBody.length < 48 && cjkCount < 16 && !hasRichLp) {
        return false;
      }
    }
    return true;
  });

  const cTfIdfKeywords = computeCtfIdfKeywords(
    gated.map((cl) => cl.items.flatMap((it) => [...it.tokens, ...it.hashtags])),
    5
  );

  const hotTopics: HotTopicCluster[] = [];

  for (let cIdx = 0; cIdx < gated.length; cIdx++) {
    const cl = gated[cIdx];
    const clusterPosts = cl.items.map((it) => it.post);
    const topKeywords = cTfIdfKeywords[cIdx] || [];

    let totalViews = 0;
    let totalForwards = 0;
    let totalReplies = 0;
    const channelsSet = new Set<string>();
    const domainsSet = new Set<string>();
    let minTime = Infinity;
    let maxTime = 0;

    for (const item of cl.items) {
      const p = item.post;
      totalViews += p.views;
      totalForwards += p.forwards;
      totalReplies += p.replies;
      channelsSet.add(p.channelName);
      if (item.domain) domainsSet.add(item.domain);
      if (p.date < minTime) minTime = p.date;
      if (p.date > maxTime) maxTime = p.date;
    }

    // Order posts with medoid anchored for cleanest title synthesis, views descending for list display
    const medoidKey = cl.medoidPost?.key;
    const postsForSynthesis = [
      cl.medoidPost,
      ...clusterPosts.filter((p) => p.key !== medoidKey).sort((a, b) => b.qualityScore - a.qualityScore),
    ];

    const extracted = extractClusterMetadata(postsForSynthesis);

    // Enrich with cached Explorer NER entities when available (zero extra inference cost)
    if (nerMap && nerMap.size > 0) {
      const nerPersons = new Map<string, number>();
      const nerEntities = new Map<string, number>();
      for (const p of clusterPosts) {
        const hit = nerMap.get(p.key);
        if (!hit) continue;
        for (const per of hit.persons) nerPersons.set(per, (nerPersons.get(per) || 0) + 1);
        for (const ent of hit.entities) nerEntities.set(ent, (nerEntities.get(ent) || 0) + 1);
      }
      for (const [per] of Array.from(nerPersons.entries()).sort((a, b) => b[1] - a[1])) {
        if (extracted.persons.length >= 3) break;
        if (!extracted.persons.some((x) => x.toLowerCase() === per.toLowerCase())) {
          extracted.persons.push(per);
        }
      }
      for (const [ent] of Array.from(nerEntities.entries()).sort((a, b) => b[1] - a[1])) {
        if (extracted.entities.length >= 4) break;
        if (!extracted.entities.some((x) => x.toLowerCase() === ent.toLowerCase())) {
          extracted.entities.push(ent);
        }
      }
      // Rebuild unified tags with enriched entities
      extracted.tags = [];
      for (const p of extracted.persons.slice(0, 2)) {
        extracted.tags.push({ type: 'person', label: p });
      }
      for (const e of extracted.entities.slice(0, 2)) {
        extracted.tags.push({ type: 'entity', label: e });
      }
      for (const f of extracted.facts.slice(0, 2)) {
        extracted.tags.push({ type: 'fact', label: f });
      }
      for (const o of extracted.options.slice(0, 1)) {
        extracted.tags.push({ type: 'option', label: o });
      }
    }

    for (const kw of topKeywords.slice(0, 2)) {
      if (
        !extracted.tags.some((t) => t.label.toLowerCase() === kw.toLowerCase()) &&
        !extracted.persons.some((p) => p.toLowerCase() === kw.toLowerCase()) &&
        !extracted.entities.some((e) => e.toLowerCase() === kw.toLowerCase())
      ) {
        extracted.tags.push({ type: 'keyword', label: kw });
      }
    }

    const { title, summary } = synthesizeClusterTitle(postsForSynthesis, extracted);

    if (clusterPosts.length === 1) {
      if (!title || title === 'Broadcasts' || isGenericLead(title)) {
        continue;
      }
    }

    const sortedClusterPosts = [...clusterPosts].sort((a, b) => b.views - a.views);
    const channelDiversity = channelsSet.size;
    const hotScore = computeTopicHotScore(
      totalViews,
      totalForwards,
      totalReplies,
      clusterPosts.length,
      channelDiversity,
      maxTime
    );

    const category = detectTopicCategory(
      postsForSynthesis.slice(0, 5).map((p) => p.text).join(' '),
      Array.from(domainsSet)
    );
    const sentimentSummary = analyzeClusterSentiment(sortedClusterPosts);

    hotTopics.push({
      id: `${source}-topic-${cIdx}`,
      title,
      summary,
      isAiGenerated: false,
      clusterSource: source,
      cohesionScore: cl.cohesionScore,
      category,
      sentiment: sentimentSummary.label,
      sentimentScore: sentimentSummary.score,
      sentimentBreakdown: sentimentSummary.counts,
      keywords: topKeywords,
      domains: Array.from(domainsSet),
      persons: extracted.persons,
      entities: extracted.entities,
      facts: extracted.facts,
      options: extracted.options,
      tags: extracted.tags,
      posts: sortedClusterPosts,
      postCount: clusterPosts.length,
      totalViews,
      totalForwards,
      totalReplies,
      channels: Array.from(channelsSet),
      hotScore,
      representativePost: cl.medoidPost || sortedClusterPosts[0],
      timeSpan: {
        start: minTime === Infinity ? Date.now() : minTime,
        end: maxTime === 0 ? Date.now() : maxTime,
      },
    });
  }

  hotTopics.sort((a, b) => b.hotScore - a.hotScore);
  return hotTopics;
}
