/**
 * Post Engagement & Viewing Time Analysis Engine
 *
 * Implements the engagement scoring model:
 *   Engagement Score = \sum_{\Delta t} (\Delta t \times \text{Visibility Factor}) \times \frac{1}{\text{Expected Read Time}}
 *
 * Factors considered:
 * 1. \Delta t: Discrete active time slice when the user is actively focused on the document
 * 2. Visibility Factor:
 *    - Bounding client rect intersection with viewport
 *    - Post item div height vs viewport height (coverage ratio)
 *    - Center gaze bias (foveal attention zone multiplier)
 * 3. Expected Read Time:
 *    - Content length (word count for Western/Latin text, character count for CJK scripts)
 *    - Post item div height (eye traversal and visual scanning time across card layout)
 *    - Media components (photos, videos, audio/voice notes, documents, link previews)
 *    - Interactive elements (quoted replies, forwarded messages, contact cards, reactions)
 *    - Minimum cognitive orientation threshold
 */

export interface ExpectedReadTimeBreakdown {
  textTime: number;
  heightTime: number;
  mediaTime: number;
  interactiveTime: number;
  baseTime: number;
  totalExpectedSeconds: number;
  contentLengthChars: number;
  wordCount: number;
  cjkCharCount: number;
  measuredHeightPx: number;
  mediaDetails: {
    photoCount: number;
    videoCount: number;
    documentCount: number;
    hasLinkPreview: boolean;
    hasReply: boolean;
    hasForward: boolean;
    hasContact: boolean;
  };
  substanceFactor?: number;
}

export interface ExpectedReadTimeResult {
  expectedTimeSeconds: number;
  breakdown: ExpectedReadTimeBreakdown;
}

export interface VisibilityFactorResult {
  visibilityFactor: number; // 0.0 to 1.0
  coverageRatio: number;   // Visible height / effective height
  centerFactor: number;    // Multiplier based on proximity to viewport center
  visibleHeightPx: number;
  elementHeightPx: number;
  rect: {
    top: number;
    bottom: number;
    height: number;
  };
}

export interface PostViewStats {
  postKey: string;
  channelName?: string;
  author?: string;
  date?: string;
  textSnippet?: string;
  postRef?: any;

  // Real-time accumulated metrics
  effectiveViewTimeSeconds: number; // \sum (\Delta t * Visibility Factor)
  totalDwellTimeSeconds: number;     // Raw time spent in viewport
  expectedReadTimeSeconds: number;  // Calculated expected read time
  engagementScore: number;          // Optimized engagement score
  substanceFactor?: number;         // Content substance density weight (0.50 - 1.10)

  // Additional detail
  measuredHeightPx: number;
  breakdown?: ExpectedReadTimeBreakdown;
  viewSessionsCount: number;
  firstViewedAt: number;
  lastViewedAt: number;
  slowStartExpiresAt?: number;
}

export interface ExpectedReadTimeOptions {
  wordsPerMinute?: number;     // Default: 220 WPM
  cjkCharsPerMinute?: number;  // Default: 360 CPM
  heightScanRatePxPerSec?: number; // Default: 250 px/s
  minReadTimeSeconds?: number; // Default: 3.5s (realistic cognitive floor)
  maxReadTimeSeconds?: number; // Default: 180s
}

export interface MostViewedQueryOptions {
  sortBy?: 'engagementScore' | 'effectiveTime' | 'dwellTime' | 'viewSessions';
  limit?: number;
  minEffectiveTime?: number;
  minScore?: number;
  channelName?: string;
}

const STORAGE_KEY = '__post_engagement_stats_v1__';
const MAX_CACHED_POSTS = 1000;

function pruneStatsForStorage(allStats: PostViewStats[]): PostViewStats[] {
  if (allStats.length <= MAX_CACHED_POSTS) return allStats;

  // Hybrid retention strategy:
  // 1. Keep top recent posts (up to 700)
  const byRecency = [...allStats].sort((a, b) => (b.lastViewedAt || 0) - (a.lastViewedAt || 0));
  const recentSlice = byRecency.slice(0, 700);

  // 2. Keep top most viewed / engaged posts by effective view time (up to 300)
  const byEngagement = [...allStats].sort((a, b) => (b.effectiveViewTimeSeconds || 0) - (a.effectiveViewTimeSeconds || 0));
  const engagedSlice = byEngagement.slice(0, 300);

  // Deduplicate entries by postKey
  const map = new Map<string, PostViewStats>();
  recentSlice.forEach(s => map.set(s.postKey, s));
  engagedSlice.forEach(s => map.set(s.postKey, s));

  let results = Array.from(map.values());
  if (results.length > MAX_CACHED_POSTS) {
    const now = Date.now();
    results.sort((a, b) => {
      const ageHoursA = Math.max(0, (now - (a.lastViewedAt || 0)) / (1000 * 3600));
      const ageHoursB = Math.max(0, (now - (b.lastViewedAt || 0)) / (1000 * 3600));
      const scoreA = (a.effectiveViewTimeSeconds || 0) * 1.5 + (100 / (1 + ageHoursA * 0.1));
      const scoreB = (b.effectiveViewTimeSeconds || 0) * 1.5 + (100 / (1 + ageHoursB * 0.1));
      return scoreB - scoreA;
    });
    results = results.slice(0, MAX_CACHED_POSTS);
  }

  return results;
}

/**
 * Strips HTML tags and excessive whitespace to analyze raw textual content
 */
export function extractCleanPostText(post: any): string {
  if (!post) return '';
  const raw = post.data?.content ?? post.data?.rawcontent ?? post.content ?? post.text ?? '';
  if (typeof raw !== 'string') return String(raw || '');
  return raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Calculates Expected Read Time based on:
 * - Content length (words + CJK characters)
 * - Rendered post item div height
 * - Embedded media (photos, videos, documents, link previews)
 * - Metadata and conversational structures (replies, forwards, contacts)
 */
export function calculateExpectedReadTime(
  post: any,
  elementOrHeight?: HTMLElement | number | null,
  options: ExpectedReadTimeOptions = {}
): ExpectedReadTimeResult {
  const {
    wordsPerMinute = 220,
    cjkCharsPerMinute = 360,
    heightScanRatePxPerSec = 280,
    minReadTimeSeconds = 3.5,
    maxReadTimeSeconds = 180,
  } = options;

  const text = extractCleanPostText(post);
  const cjkChars = (text.match(/[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
  const nonCjkText = text.replace(/[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/g, ' ');
  const words = nonCjkText.trim().split(/\s+/).filter(Boolean).length;
  const totalChars = text.length;

  // Text reading time
  const wordsPerSecond = wordsPerMinute / 60;
  const cjkCharsPerSecond = cjkCharsPerMinute / 60;
  const textTime = (words / wordsPerSecond) + (cjkChars / cjkCharsPerSecond);

  // Post Item Div Height Impact
  let measuredHeight = 0;
  if (typeof elementOrHeight === 'number') {
    measuredHeight = Math.max(0, elementOrHeight);
  } else if (elementOrHeight && typeof elementOrHeight.getBoundingClientRect === 'function') {
    measuredHeight = Math.max(0, elementOrHeight.offsetHeight || elementOrHeight.getBoundingClientRect().height);
  } else {
    // Height estimation if DOM element is not mounted yet
    measuredHeight = 120 + Math.min(600, totalChars * 0.45);
    if (post?.data?.photos?.length) measuredHeight += 320;
    if (post?.data?.videos?.length) measuredHeight += 320;
    if (post?.data?.linkPreview) measuredHeight += 120;
  }

  // Visual layout traversal time based on card height
  // Baseline card wrapper height is ~80px. Extra vertical span takes eye movement time to scan.
  const heightTime = Math.max(0, (measuredHeight - 80) / heightScanRatePxPerSec);

  // Media Inspection Times
  const photoCount = Array.isArray(post?.data?.photos) ? post.data.photos.length : 0;
  const videoCount = Array.isArray(post?.data?.videos) ? post.data.videos.length : 0;
  const documentCount = Array.isArray(post?.data?.documents) ? post.data.documents.length : 0;
  const hasLinkPreview = !!post?.data?.linkPreview;
  const hasReply = !!(post?.data?.reply && post.data.reply.length >= 2);
  const hasForward = !!(post?.data?.forward_url || post?.data?.fwd_from);
  const hasContact = !!(post?.data?.contact && Object.keys(post.data.contact).length > 0);

  let mediaTime = 0;
  if (photoCount > 0) {
    // Primary photo takes ~3.5s, subsequent photos take ~1.5s each
    mediaTime += 3.5 + Math.min(3, photoCount - 1) * 1.5;
  }
  if (videoCount > 0) {
    // Video preview / engagement baseline
    mediaTime += 6.0 + Math.min(2, videoCount - 1) * 2.0;
  }
  if (documentCount > 0) {
    mediaTime += 2.5 * Math.min(3, documentCount);
  }
  if (hasLinkPreview) {
    mediaTime += 3.0;
  }

  // Interactive & Contextual structures
  let interactiveTime = 0;
  if (hasReply) interactiveTime += 2.0;
  if (hasForward) interactiveTime += 1.5;
  if (hasContact) interactiveTime += 2.0;

  // Base cognitive orientation time (identifying sender, avatar, timestamp, reading card boundaries)
  const baseTime = 2.0;

  const rawExpectedTotal = baseTime + textTime + heightTime + mediaTime + interactiveTime;
  const totalExpectedSeconds = Math.max(
    minReadTimeSeconds,
    Math.min(maxReadTimeSeconds, Number(rawExpectedTotal.toFixed(2)))
  );

  // Informational units for substance factor
  const mediaAssetUnits = photoCount + videoCount + documentCount + (hasLinkPreview ? 1 : 0);
  const substanceFactor = Number(
    Math.min(1.10, Math.max(0.50, 0.50 + 0.55 * Math.tanh((words + cjkChars * 0.6 + mediaAssetUnits * 25) / 35))).toFixed(3)
  );

  const breakdown: ExpectedReadTimeBreakdown = {
    textTime: Number(textTime.toFixed(2)),
    heightTime: Number(heightTime.toFixed(2)),
    mediaTime: Number(mediaTime.toFixed(2)),
    interactiveTime: Number(interactiveTime.toFixed(2)),
    baseTime,
    totalExpectedSeconds,
    contentLengthChars: totalChars,
    wordCount: words,
    cjkCharCount: cjkChars,
    measuredHeightPx: Math.round(measuredHeight),
    mediaDetails: {
      photoCount,
      videoCount,
      documentCount,
      hasLinkPreview,
      hasReply,
      hasForward,
      hasContact,
    },
    substanceFactor,
  };

  return {
    expectedTimeSeconds: totalExpectedSeconds,
    breakdown,
  };
}

/**
 * Calculates the real-time Visibility Factor of a post DOM element.
 * Accounts for:
 * 1. Vertical intersection with the window viewport
 * 2. Element height relative to viewport (full coverage for large cards)
 * 3. Proximity to the screen's vertical center (center reading focus bias)
 */
export function calculateVisibilityFactor(
  element: HTMLElement,
  viewportHeight: number = typeof window !== 'undefined' ? window.innerHeight : 800
): VisibilityFactorResult {
  const defaultResult: VisibilityFactorResult = {
    visibilityFactor: 0,
    coverageRatio: 0,
    centerFactor: 0,
    visibleHeightPx: 0,
    elementHeightPx: 0,
    rect: { top: 0, bottom: 0, height: 0 },
  };

  if (!element || typeof element.getBoundingClientRect !== 'function') {
    return defaultResult;
  }

  const rect = element.getBoundingClientRect();
  const elementHeight = rect.height;

  // Completely offscreen or collapsed
  if (elementHeight <= 0 || rect.bottom <= 0 || rect.top >= viewportHeight) {
    return {
      ...defaultResult,
      elementHeightPx: Math.round(elementHeight),
      rect: { top: Math.round(rect.top), bottom: Math.round(rect.bottom), height: Math.round(elementHeight) },
    };
  }

  // Calculate visible vertical strip
  const visTop = Math.max(0, rect.top);
  const visBottom = Math.min(viewportHeight, rect.bottom);
  const visibleHeight = Math.max(0, visBottom - visTop);

  if (visibleHeight <= 0) {
    return defaultResult;
  }

  // For posts taller than the viewport, when they fill the entire screen,
  // the user is viewing 100% of available screen real estate.
  const effectiveMaxHeight = Math.min(elementHeight, viewportHeight);
  const coverageRatio = Math.min(1.0, visibleHeight / effectiveMaxHeight);

  // Center gaze bias:
  // Visual attention is focused near the center of the screen (50% mark).
  // Elements near the screen center get weight 1.0, while elements truncated at the edges get ~0.75.
  const visCenter = (visTop + visBottom) / 2;
  const viewportCenter = viewportHeight / 2;
  const distFromCenter = Math.abs(visCenter - viewportCenter) / (viewportHeight / 2);
  const centerFactor = Math.max(0.75, 1.0 - 0.25 * Math.min(1.0, distFromCenter));

  const visibilityFactor = Math.min(1.0, Math.max(0, coverageRatio * centerFactor));

  return {
    visibilityFactor: Number(visibilityFactor.toFixed(3)),
    coverageRatio: Number(coverageRatio.toFixed(3)),
    centerFactor: Number(centerFactor.toFixed(3)),
    visibleHeightPx: Math.round(visibleHeight),
    elementHeightPx: Math.round(elementHeight),
    rect: {
      top: Math.round(rect.top),
      bottom: Math.round(rect.bottom),
      height: Math.round(elementHeight),
    },
  };
}

/**
 * Calculates Content Substance Factor (0.50 to 1.10).
 * Scales lower information density (e.g. empty or few-word posts) down appropriately
 * so that they cannot easily gain high engagement scores over substantive articles.
 */
export function calculateContentSubstanceFactor(
  breakdown?: ExpectedReadTimeBreakdown | null,
  textSnippet?: string
): number {
  if (breakdown && typeof breakdown.substanceFactor === 'number') {
    return breakdown.substanceFactor;
  }

  const words = breakdown?.wordCount ?? (textSnippet ? textSnippet.trim().split(/\s+/).filter(Boolean).length : 0);
  const cjk = breakdown?.cjkCharCount ?? (textSnippet ? (textSnippet.match(/[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/g) || []).length : 0);
  const mediaCount = (breakdown?.mediaDetails?.photoCount || 0) +
    (breakdown?.mediaDetails?.videoCount || 0) +
    (breakdown?.mediaDetails?.documentCount || 0) +
    (breakdown?.mediaDetails?.hasLinkPreview ? 1 : 0);

  const infoUnits = words + (cjk * 0.6) + (mediaCount * 25);
  const substance = 0.50 + 0.55 * Math.tanh(infoUnits / 35);
  return Number(Math.min(1.10, Math.max(0.50, substance)).toFixed(3));
}

/**
 * Calculates Optimized Engagement Score.
 *
 * Solves the Short-Content / Small-Denominator Anomaly by:
 * 1. Safe Expected Denominator Floor: Ensures baseline denominator is at least 3.5s.
 * 2. Substance Weighting (W_substance): Low information density (0.50 to 1.10) prevents trivial posts from over-indexing.
 * 3. Dwell Maturity Gating (M_dwell): Requires >= 2.5s of focused effective dwell to count as mature engagement.
 * 4. Sublinear Logarithmic Saturation: Above 1.0x ratio, uses 1 + ln(ratio) diminishing returns.
 */
export function calculatePostEngagementScore(
  effectiveViewTimeSeconds: number,
  expectedReadTimeSeconds: number,
  breakdown?: ExpectedReadTimeBreakdown | null,
  textSnippet?: string
): number {
  if (!expectedReadTimeSeconds || expectedReadTimeSeconds <= 0 || effectiveViewTimeSeconds <= 0) {
    return 0;
  }

  // Denominator floor of 3.5s to eliminate mathematical small-denominator explosion
  const safeExpectedTime = Math.max(3.5, expectedReadTimeSeconds);

  // Raw relative ratio
  const rawRatio = effectiveViewTimeSeconds / safeExpectedTime;

  // Logarithmic damping curve for ratio > 1.0 (sublinear immersion return)
  const dampedRatio = rawRatio <= 1.0
    ? rawRatio
    : 1.0 + Math.log(rawRatio);

  // Content Substance Factor (0.50 for empty/trivial posts up to ~1.10 for rich posts)
  const substanceWeight = calculateContentSubstanceFactor(breakdown, textSnippet);

  // Dwell Maturity Factor: requires at least 2.5s of focused effective viewing to reach 1.0 multiplier
  const dwellMaturity = Math.min(1.0, Math.max(0.2, effectiveViewTimeSeconds / 2.5));

  const finalScore = substanceWeight * dwellMaturity * dampedRatio;
  return Number(Math.max(0, finalScore).toFixed(3));
}

/**
 * Class representing the background task that observes, tracks, and persists
 * user viewing time across all rendered posts.
 */
export class PostEngagementTracker {
  private statsMap: Map<string, PostViewStats> = new Map();
  private elementMap: Map<string, HTMLElement> = new Map();
  private postMetadataMap: Map<string, any> = new Map();

  private isRunning: boolean = false;
  private intervalTimer: any = null;
  private lastTickTimestamp: number = 0;
  private lastUserActivityTimestamp: number = Date.now();
  private idleThresholdMs: number = 45000; // 45s idle threshold
  private sampleIntervalMs: number = 250;   // 250ms sampling loop

  private listeners: Set<(stats: PostViewStats[]) => void> = new Set();
  private saveDebounceTimer: any = null;

  constructor() {
    this.loadFromStorage();
    this.setupUserActivityListeners();
  }

  private getPrunedExportObject(): Record<string, any> {
    const allStats = Array.from(this.statsMap.values());
    const pruned = pruneStatsForStorage(allStats);
    const exportObj: Record<string, any> = {};
    pruned.forEach((val) => {
      const { postRef, ...rest } = val;
      exportObj[val.postKey] = rest;
    });
    return exportObj;
  }

  /**
   * Loads saved engagement statistics from localStorage
   */
  private loadFromStorage() {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed: Record<string, PostViewStats> = JSON.parse(raw);
        const entries = Object.values(parsed);
        const pruned = pruneStatsForStorage(entries);
        pruned.forEach((val) => {
          if (val && val.postKey) {
            val.substanceFactor = calculateContentSubstanceFactor(val.breakdown, val.textSnippet);
            if (val.effectiveViewTimeSeconds > 0 && val.expectedReadTimeSeconds > 0) {
              val.engagementScore = calculatePostEngagementScore(
                val.effectiveViewTimeSeconds,
                val.expectedReadTimeSeconds,
                val.breakdown,
                val.textSnippet
              );
            }
            this.statsMap.set(val.postKey, val);
          }
        });
      }
    } catch (e) {
      console.warn('[PostEngagementTracker] Failed to load cached stats:', e);
    }
  }

  /**
   * Persists engagement stats to localStorage with debouncing
   */
  private scheduleSave() {
    if (typeof window === 'undefined') return;
    if (this.saveDebounceTimer) return;

    this.saveDebounceTimer = setTimeout(() => {
      this.saveDebounceTimer = null;
      try {
        const exportObj = this.getPrunedExportObject();
        localStorage.setItem(STORAGE_KEY, JSON.stringify(exportObj));
      } catch (e) {
        console.warn('[PostEngagementTracker] Storage save error:', e);
      }
    }, 2500);
  }

  /**
   * Sets up listeners for user interaction to detect idle state
   */
  private setupUserActivityListeners() {
    if (typeof window === 'undefined') return;

    const onUserActive = () => {
      this.lastUserActivityTimestamp = Date.now();
    };

    window.addEventListener('mousemove', onUserActive, { passive: true });
    window.addEventListener('pointermove', onUserActive, { passive: true });
    window.addEventListener('wheel', onUserActive, { passive: true });
    window.addEventListener('scroll', onUserActive, { passive: true });
    window.addEventListener('keydown', onUserActive, { passive: true });
    window.addEventListener('touchstart', onUserActive, { passive: true });
    window.addEventListener('touchmove', onUserActive, { passive: true });
    window.addEventListener('click', onUserActive, { passive: true });

    // Handle page unload / visibility change
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.flushImmediateSave();
      } else {
        this.lastUserActivityTimestamp = Date.now();
        this.lastTickTimestamp = performance.now();
      }
    });
  }

  private flushImmediateSave() {
    if (typeof window === 'undefined') return;
    try {
      const exportObj = this.getPrunedExportObject();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(exportObj));
    } catch {
      // Ignore
    }
  }

  /**
   * Starts the background tracking loop
   */
  public start(intervalMs: number = 250) {
    if (this.isRunning) return;
    this.isRunning = true;
    this.sampleIntervalMs = intervalMs;
    this.lastTickTimestamp = performance.now();
    this.lastUserActivityTimestamp = Date.now();

    this.intervalTimer = setInterval(() => {
      this.tick();
    }, this.sampleIntervalMs);
  }

  /**
   * Stops the background tracking loop
   */
  public stop() {
    if (!this.isRunning) return;
    this.isRunning = false;
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
    this.flushImmediateSave();
  }

  /**
   * Registers or updates a post metadata and optional DOM element
   */
  public registerPost(post: any, element?: HTMLElement | null) {
    if (!post || !post.key) return;
    const key = String(post.key);
    this.postMetadataMap.set(key, post);

    if (element) {
      this.elementMap.set(key, element);
    }

    // Ensure initial stat record exists
    if (!this.statsMap.has(key)) {
      const expected = calculateExpectedReadTime(post, element);
      const text = extractCleanPostText(post);
      const stats: PostViewStats = {
        postKey: key,
        channelName: post.data?.author || post.data?.user || post.data?.owner || (key.includes('.') ? key.split('.')[0] : ''),
        author: post.data?.author || post.data?.user || post.data?.owner || (key.includes('.') ? key.split('.')[0] : ''),
        date: post.data?.date,
        textSnippet: text.slice(0, 140),
        postRef: post,
        effectiveViewTimeSeconds: 0,
        totalDwellTimeSeconds: 0,
        expectedReadTimeSeconds: expected.expectedTimeSeconds,
        engagementScore: 0,
        substanceFactor: calculateContentSubstanceFactor(expected.breakdown, text),
        measuredHeightPx: expected.breakdown.measuredHeightPx,
        breakdown: expected.breakdown,
        viewSessionsCount: 0,
        firstViewedAt: Date.now(),
        lastViewedAt: Date.now(),
        slowStartExpiresAt: Date.now() + 2500, // 2.5s slow start grace period
      };
      this.statsMap.set(key, stats);
    } else {
      // Update element reference and re-verify expected read time if element height became available
      const stats = this.statsMap.get(key)!;
      stats.postRef = post;
      if (element && (!stats.measuredHeightPx || Math.abs(stats.measuredHeightPx - element.offsetHeight) > 50)) {
        const expected = calculateExpectedReadTime(post, element);
        stats.measuredHeightPx = expected.breakdown.measuredHeightPx;
        stats.expectedReadTimeSeconds = expected.expectedTimeSeconds;
        stats.breakdown = expected.breakdown;
        stats.substanceFactor = calculateContentSubstanceFactor(expected.breakdown, stats.textSnippet);
        stats.engagementScore = calculatePostEngagementScore(
          stats.effectiveViewTimeSeconds,
          stats.expectedReadTimeSeconds,
          stats.breakdown,
          stats.textSnippet
        );
      }
    }
  }

  /**
   * Registers multiple posts
   */
  public registerPosts(postsList: any[]) {
    if (!Array.isArray(postsList)) return;
    postsList.forEach((p) => this.registerPost(p));
  }

  /**
   * Automatically discovers and binds post elements currently mounted in the DOM
   */
  public sweepAndBindElements() {
    if (typeof document === 'undefined') return;

    // Search for post cards with standard IDs or attributes:
    // 1) id="post-{key}"
    // 2) id="search-post-{key}"
    // 3) id="listen-post-{key}"
    // 4) [data-post-key]
    const elements = document.querySelectorAll<HTMLElement>(
      "[id^='post-'], [id^='search-post-'], [id^='listen-post-'], [data-post-key]"
    );

    const isElementVisible = (target: HTMLElement): boolean => {
      if (!target || !document.body.contains(target)) return false;
      if (target.offsetParent !== null) return true;
      const rect = target.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };

    elements.forEach((el) => {
      let key = el.getAttribute('data-post-key');
      if (!key && el.id) {
        if (el.id.startsWith('post-')) {
          key = el.id.replace('post-', '');
        } else if (el.id.startsWith('search-post-')) {
          key = el.id.replace('search-post-', '');
        } else if (el.id.startsWith('listen-post-')) {
          key = el.id.replace('listen-post-', '');
        }
      }
      if (key) {
        const existing = this.elementMap.get(key);
        if (!existing || !document.body.contains(existing)) {
          this.elementMap.set(key, el);
        } else {
          // If existing is hidden (e.g. from an inactive tab) and candidate is visible, rebind to active card
          const existingVis = isElementVisible(existing);
          const candidateVis = isElementVisible(el);
          if (!existingVis && candidateVis) {
            this.elementMap.set(key, el);
          }
        }
        // If we already know the post metadata, update measured height
        const stat = this.statsMap.get(key);
        if (stat) {
          const actualH = el.offsetHeight;
          if (actualH > 0 && Math.abs(stat.measuredHeightPx - actualH) > 40) {
            stat.measuredHeightPx = actualH;
            const postObj = this.postMetadataMap.get(key);
            if (postObj) {
              const recalculation = calculateExpectedReadTime(postObj, el);
              stat.expectedReadTimeSeconds = recalculation.expectedTimeSeconds;
              stat.breakdown = recalculation.breakdown;
              stat.substanceFactor = calculateContentSubstanceFactor(recalculation.breakdown, stat.textSnippet);
              stat.engagementScore = calculatePostEngagementScore(
                stat.effectiveViewTimeSeconds,
                stat.expectedReadTimeSeconds,
                stat.breakdown,
                stat.textSnippet
              );
            }
          }
        }
      }
    });
  }

  /**
   * The core sampling tick: calculates \Delta t, checks active status,
   * inspects all visible post elements, and accumulates:
   *   Effective View Time += \Delta t * Visibility Factor
   *   Engagement Score = Effective View Time / Expected Read Time
   */
  private tick() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const now = performance.now();
    let deltaSec = (now - this.lastTickTimestamp) / 1000;
    this.lastTickTimestamp = now;

    // Guard against background sleep or huge step leaps
    if (deltaSec <= 0 || deltaSec > 2.0) {
      deltaSec = Math.min(0.5, this.sampleIntervalMs / 1000);
    }

    // Skip if document is hidden or window is not focused or user is idle
    const isDocumentVisible = !document.hidden;
    const isWindowFocused = document.hasFocus ? document.hasFocus() : true;
    const isUserActive = (Date.now() - this.lastUserActivityTimestamp) < this.idleThresholdMs;

    // Check if any modal or higher-layer overlay is currently open in the DOM
    const modalOverlays = document.querySelectorAll<HTMLElement>(
      ".fixed.inset-0, [class*='fixed'][class*='inset-0']"
    );
    let isModalOpen = false;
    for (let i = 0; i < modalOverlays.length; i++) {
      const el = modalOverlays[i];
      if (el && el.offsetParent !== null && window.getComputedStyle(el).display !== 'none' && window.getComputedStyle(el).visibility !== 'hidden') {
        const rect = el.getBoundingClientRect();
        if (rect.width >= window.innerWidth * 0.4 && rect.height >= window.innerHeight * 0.4) {
          isModalOpen = true;
          break;
        }
      }
    }

    if (!isDocumentVisible || !isWindowFocused || !isUserActive || isModalOpen) {
      return;
    }

    const viewportH = window.innerHeight;
    let hasChanges = false;

    // Sweep occasionally to catch new cards
    this.sweepAndBindElements();

    this.elementMap.forEach((element, key) => {
      // If element is detached from DOM, remove from elementMap
      if (!document.body.contains(element)) {
        this.elementMap.delete(key);
        return;
      }

      const vis = calculateVisibilityFactor(element, viewportH);

      // Only accrue if element is visibly on-screen
      if (vis.visibilityFactor > 0.04) {
        let stats = this.statsMap.get(key);
        const nowMs = Date.now();
        if (!stats) {
          const postMeta = this.postMetadataMap.get(key) || { key };
          const expected = calculateExpectedReadTime(postMeta, element);
          stats = {
            postKey: key,
            channelName: postMeta.data?.author || postMeta.data?.user || postMeta.data?.owner || (key.includes('.') ? key.split('.')[0] : ''),
            author: postMeta.data?.author || postMeta.data?.user || postMeta.data?.owner || (key.includes('.') ? key.split('.')[0] : ''),
            date: postMeta.data?.date,
            textSnippet: extractCleanPostText(postMeta).slice(0, 140),
            postRef: postMeta,
            effectiveViewTimeSeconds: 0,
            totalDwellTimeSeconds: 0,
            expectedReadTimeSeconds: expected.expectedTimeSeconds,
            engagementScore: 0,
            measuredHeightPx: vis.elementHeightPx,
            breakdown: expected.breakdown,
            viewSessionsCount: 0,
            firstViewedAt: nowMs,
            lastViewedAt: nowMs,
            slowStartExpiresAt: nowMs + 2500, // 2.5s slow start grace period
          };
          this.statsMap.set(key, stats);
        }

        // Detect new view session (if last viewed was more than 15s ago)
        if (nowMs - stats.lastViewedAt > 15000) {
          stats.viewSessionsCount += 1;
          stats.slowStartExpiresAt = nowMs + 2500;
        } else if (!stats.slowStartExpiresAt) {
          stats.slowStartExpiresAt = nowMs + 2500;
        }

        // Slow start approach: pause calculation for 2.5s when newly in viewport
        if (stats.slowStartExpiresAt && nowMs < stats.slowStartExpiresAt) {
          stats.lastViewedAt = nowMs;
          stats.measuredHeightPx = vis.elementHeightPx;
          return;
        }

        // Apply formula step: \Delta t \times Visibility Factor
        const deltaEffective = deltaSec * vis.visibilityFactor;
        stats.effectiveViewTimeSeconds += deltaEffective;
        stats.totalDwellTimeSeconds += deltaSec;
        stats.lastViewedAt = nowMs;
        stats.measuredHeightPx = vis.elementHeightPx;

        // Recalculate engagement score
        stats.substanceFactor = calculateContentSubstanceFactor(stats.breakdown, stats.textSnippet);
        stats.engagementScore = calculatePostEngagementScore(
          stats.effectiveViewTimeSeconds,
          stats.expectedReadTimeSeconds,
          stats.breakdown,
          stats.textSnippet
        );

        hasChanges = true;
      }
    });

    if (hasChanges) {
      this.scheduleSave();
      this.notifyListeners();
    }
  }

  private notifyListeners() {
    if (this.listeners.size === 0) return;
    const allStats = Array.from(this.statsMap.values());
    this.listeners.forEach((fn) => {
      try {
        fn(allStats);
      } catch (err) {
        console.error('[PostEngagementTracker] Listener error:', err);
      }
    });
  }

  /**
   * Subscribe to real-time engagement updates
   */
  public subscribe(listener: (stats: PostViewStats[]) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Returns stats for a specific post key
   */
  public getPostStats(postKey: string): PostViewStats | undefined {
    return this.statsMap.get(String(postKey));
  }

  /**
   * Returns all tracked post statistics
   */
  public getAllStats(): PostViewStats[] {
    return Array.from(this.statsMap.values());
  }

  /**
   * Returns the most viewed / most engaged posts sorted by engagement score or viewing time
   */
  public getMostEngagedPosts(options: MostViewedQueryOptions = {}): PostViewStats[] {
    const {
      sortBy = 'engagementScore',
      limit = 20,
      minEffectiveTime = 0.5,
      minScore = 0.05,
      channelName,
    } = options;

    let items = Array.from(this.statsMap.values()).filter((item) => {
      if (item.effectiveViewTimeSeconds < minEffectiveTime) return false;
      if (item.engagementScore < minScore) return false;
      if (channelName && item.channelName && !item.channelName.toLowerCase().includes(channelName.toLowerCase())) {
        return false;
      }
      return true;
    });

    items.sort((a, b) => {
      if (sortBy === 'engagementScore') {
        return b.engagementScore - a.engagementScore;
      } else if (sortBy === 'effectiveTime') {
        return b.effectiveViewTimeSeconds - a.effectiveViewTimeSeconds;
      } else if (sortBy === 'dwellTime') {
        return b.totalDwellTimeSeconds - a.totalDwellTimeSeconds;
      } else if (sortBy === 'viewSessions') {
        return b.viewSessionsCount - a.viewSessionsCount;
      }
      return b.engagementScore - a.engagementScore;
    });

    return items.slice(0, limit);
  }

  /**
   * Clears all recorded engagement data
   */
  public reset() {
    this.statsMap.clear();
    this.elementMap.clear();
    if (typeof window !== 'undefined') {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        // Ignore
      }
    }
    this.notifyListeners();
  }

  /**
   * Exports full analytics summary as JSON
   */
  public exportSummary(): {
    totalTrackedPosts: number;
    totalEffectiveTimeSeconds: number;
    totalDwellTimeSeconds: number;
    averageEngagementScore: number;
    posts: PostViewStats[];
  } {
    const all = this.getAllStats();
    const totalEffective = all.reduce((sum, item) => sum + item.effectiveViewTimeSeconds, 0);
    const totalDwell = all.reduce((sum, item) => sum + item.totalDwellTimeSeconds, 0);
    const avgScore = all.length > 0 ? (all.reduce((sum, item) => sum + item.engagementScore, 0) / all.length) : 0;

    return {
      totalTrackedPosts: all.length,
      totalEffectiveTimeSeconds: Number(totalEffective.toFixed(1)),
      totalDwellTimeSeconds: Number(totalDwell.toFixed(1)),
      averageEngagementScore: Number(avgScore.toFixed(3)),
      posts: all.sort((a, b) => b.engagementScore - a.engagementScore),
    };
  }
}

// Global singleton instance
export const postEngagementTracker = new PostEngagementTracker();

/**
 * Helper function to find out which posts a user views more.
 * Can be called with any array of posts, returning them ranked
 * by engagement score or viewing duration.
 */
export function findMostViewedPosts(
  postsList: any[] = [],
  options: MostViewedQueryOptions = {}
): PostViewStats[] {
  // Register provided posts into tracker
  if (Array.isArray(postsList) && postsList.length > 0) {
    postEngagementTracker.registerPosts(postsList);
  }

  return postEngagementTracker.getMostEngagedPosts(options);
}

// Attach to window for convenient console and background script access
if (typeof window !== 'undefined') {
  (window as any).postEngagementTracker = postEngagementTracker;
  (window as any).findMostViewedPosts = findMostViewedPosts;
  (window as any).calculateExpectedReadTime = calculateExpectedReadTime;
  (window as any).calculateVisibilityFactor = calculateVisibilityFactor;
}
