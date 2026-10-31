import React, { useState, useMemo, useRef, useEffect } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  Cell
} from "recharts";
import { t } from "../../i18n";

export interface PostItem {
  _index?: number;
  id?: string | number;
  key?: string;
  url?: string;
  link?: string;
  date?: string | number;
  datetime?: string | number;
  mtime?: number | string;
  data?: {
    date?: string | number;
    datetime?: string | number;
    created_at?: string | number;
    views?: number;
    forwards?: number;
    forward_from?: any;
    forward_url?: string;
    forward_title?: string;
    forward_sender_name?: string;
    forward_sender_user?: string;
    forward_date?: string;
    content?: string;
    rawcontent?: string;
    photos?: any[];
    videos?: any[];
    author?: string;
    reply?: any;
  };
}

// Canonical English weekday keys (0=Sun, 1=Mon, ..., 6=Sat)
export const WEEKDAY_KEYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
export type WeekdayKey = (typeof WEEKDAY_KEYS)[number];

// Robust helper to parse various Telegram date representations
export const parsePostDate = (rawDate: any): Date => {
  if (rawDate == null || rawDate === "") return new Date(NaN);
  if (rawDate instanceof Date) return isNaN(rawDate.getTime()) ? new Date(NaN) : rawDate;
  if (typeof rawDate === "number") {
    // If Unix timestamp in seconds (typically < 10 billion), multiply by 1000
    const ms = rawDate < 10_000_000_000 ? rawDate * 1000 : rawDate;
    return new Date(ms);
  }
  if (typeof rawDate === "string") {
    const trimmed = rawDate.trim();
    if (!trimmed) return new Date(NaN);
    // All digits: numeric timestamp in string form
    if (/^\d+$/.test(trimmed)) {
      const num = Number(trimmed);
      const ms = num < 10_000_000_000 ? num * 1000 : num;
      return new Date(ms);
    }
    // Standard ISO or date string
    const d1 = new Date(trimmed);
    if (!isNaN(d1.getTime())) return d1;
    // Format with space instead of T (e.g. "2025-05-20 14:32:00")
    const d2 = new Date(trimmed.replace(" ", "T"));
    if (!isNaN(d2.getTime())) return d2;
  }
  return new Date(NaN);
};

export interface ChannelMetadata {
  title?: string;
  subscribers?: number | string;
  members?: number | string;
  participants_count?: number | string;
  type?: string;
  photo?: string;
  description?: string;
  about?: string;
  [key: string]: any;
}

export interface ChannelEngagementDashboardProps {
  posts: PostItem[];
  channelName: string;
  metadata?: ChannelMetadata | null;
  subscribersCount?: number;
  isDark?: boolean;
  locale?: string;
  onPostClick?: (post: PostItem) => void;
  onExploreChannel?: (channel: string) => void;
}

// Robust helper to extract Forward-In details from Telegram post metadata
const extractForwardDetails = (
  pData: any
): { isForwardIn: boolean; source: string; username?: string; url?: string } => {
  if (!pData) return { isForwardIn: false, source: "" };

  // 1. Check forward_from object
  if (pData.forward_from && typeof pData.forward_from === "object") {
    const title = pData.forward_from.title || pData.forward_from.username || "Forwarded Channel";
    const username = pData.forward_from.username ? `@${pData.forward_from.username}` : "";
    return {
      isForwardIn: true,
      source: username || title,
      username: pData.forward_from.username || "",
      url: pData.forward_url
    };
  }

  // 2. Check forward_from string
  if (typeof pData.forward_from === "string" && pData.forward_from.trim().length > 0) {
    let sourceName = pData.forward_from.trim();
    let username = "";
    if (pData.forward_url) {
      const parts = pData.forward_url.split("/").filter(Boolean);
      const target = parts[parts.length - 2];
      if (target && target !== "t.me" && target !== "telegram.me") {
        sourceName = `@${target}`;
        username = target;
      }
    }
    return {
      isForwardIn: true,
      source: sourceName,
      username,
      url: pData.forward_url
    };
  }

  // 3. Check forward_title / forward_sender_name
  if (pData.forward_title || pData.forward_sender_name) {
    return {
      isForwardIn: true,
      source: pData.forward_title || pData.forward_sender_name,
      username: pData.forward_sender_user || "",
      url: pData.forward_url
    };
  }

  // 4. Check forward_url alone
  if (pData.forward_url) {
    const parts = pData.forward_url.split("/").filter(Boolean);
    const target = parts[parts.length - 2];
    if (target && target !== "t.me" && target !== "telegram.me") {
      return {
        isForwardIn: true,
        source: `@${target}`,
        username: target,
        url: pData.forward_url
      };
    }
    return {
      isForwardIn: true,
      source: "Forwarded Post",
      url: pData.forward_url
    };
  }

  // 5. Check numeric forwards > 0 if present
  if (typeof pData.forwards === "number" && pData.forwards > 0) {
    return {
      isForwardIn: true,
      source: "Forward In",
      url: undefined
    };
  }

  return { isForwardIn: false, source: "" };
};

export const ChannelEngagementDashboard: React.FC<ChannelEngagementDashboardProps> = ({
  posts = [],
  channelName,
  metadata = null,
  subscribersCount = 0,
  isDark = false,
  locale,
  onPostClick,
  onExploreChannel
}) => {
  const [timeRange, setTimeRange] = useState<"all" | "20" | "50">("all");
  const [activeTab, setActiveTab] = useState<"growth" | "forwards" | "hourly">("growth");
  const [selectedForwardSource, setSelectedForwardSource] = useState<string | null>(null);
  const [selectedWeekday, setSelectedWeekday] = useState<string | null>(null);

  // Custom subscriber count override / simulation
  const [customSubscribers, setCustomSubscribers] = useState<number | null>(null);
  const [isEditingSubscribers, setIsEditingSubscribers] = useState(false);
  const [subscriberInput, setSubscriberInput] = useState("");
  const [isAssessmentExpanded, setIsAssessmentExpanded] = useState(true);

  // Effective subscribers count (from profile metadata or user simulation)
  const effectiveSubscribers = useMemo(() => {
    if (customSubscribers !== null && customSubscribers > 0) return customSubscribers;
    const fromProps = Number(subscribersCount || metadata?.subscribers || metadata?.members || metadata?.participants_count || 0);
    return isNaN(fromProps) ? 0 : fromProps;
  }, [customSubscribers, subscribersCount, metadata]);

  // Format numbers compactly (e.g. 1.2k, 450k, 1.5M)
  const formatNumber = (num: number): string => {
    if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + "M";
    if (num >= 1_000) return (num / 1_000).toFixed(1) + "k";
    return num.toLocaleString();
  };

  // Helper to ensure post objects passed into Recharts chart datasets are 100% plain objects
  const sanitizeObject = (obj: any) => {
    if (obj == null) return obj;
    try {
      return JSON.parse(JSON.stringify(obj));
    } catch {
      return obj;
    }
  };

  // Process & chronologically sort post points
  const processedData = useMemo(() => {
    if (!posts || posts.length === 0) return [];

    // Filter valid posts that have dates
    const valid = posts
      .map((p) => {
        if (!p) return null;
        const pData = p.data || {};
        const rawDate = pData.date ?? (p as any).date ?? pData.datetime ?? (p as any).datetime ?? (p as any).mtime ?? pData.created_at;
        const d = parsePostDate(rawDate);
        if (isNaN(d.getTime())) return null;

        const views = typeof pData.views === "number" ? pData.views : 0;
        const rawContent = pData.content || pData.rawcontent || "";
        const cleanSnippet = rawContent.replace(/<[^>]*>/g, " ").trim().slice(0, 100);

        const fwdDetails = extractForwardDetails(pData);

        // Map d.getDay() (0=Sun, 1=Mon, ..., 6=Sat) into fixed canonical day keys
        const dayIdx = d.getDay();
        const weekdayKey = WEEKDAY_KEYS[dayIdx]; // "Sun" | "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat"

        return {
          rawPost: sanitizeObject(p),
          timestamp: d.getTime(),
          dateObj: d,
          dateStr: d.toLocaleDateString(locale || undefined, { month: "short", day: "numeric" }),
          timeStr: d.toLocaleTimeString(locale || undefined, { hour: "2-digit", minute: "2-digit" }),
          fullDate: d.toLocaleString(locale || undefined),
          hour: d.getHours(),
          dayIndex: dayIdx,
          weekday: weekdayKey,
          views,
          isForwardIn: fwdDetails.isForwardIn,
          forwardSource: fwdDetails.source,
          forwardUsername: fwdDetails.username,
          forwardUrl: fwdDetails.url,
          snippet: cleanSnippet
        };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null && !isNaN(p.timestamp));

    // Sort chronologically ascending for time-series charts
    valid.sort((a, b) => a.timestamp - b.timestamp);

    // Calculate rolling 5-post moving average
    return valid.map((item, idx, arr) => {
      const windowStart = Math.max(0, idx - 4);
      const windowSlice = arr.slice(windowStart, idx + 1);
      const avgViews = Math.round(
        windowSlice.reduce((sum, p) => sum + p.views, 0) / windowSlice.length
      );
      return {
        ...item,
        postIndex: idx + 1,
        movingAvgViews: avgViews
      };
    });
  }, [posts, locale]);

  // Zoom state: window indices in the filtered dataset
  const [zoomWindow, setZoomWindow] = useState<{ start: number; end: number } | null>(null);
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const dragStartXRef = useRef(0);
  const dragStartWindowRef = useRef<{ start: number; end: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Base filtered dataset before weekday filter
  const datasetBeforeWeekdayFilter = useMemo(() => {
    let dataset = processedData;
    if (selectedForwardSource) {
      dataset = dataset.filter((p) => p.forwardSource === selectedForwardSource);
    }
    if (timeRange === "20") return dataset.slice(-20);
    if (timeRange === "50") return dataset.slice(-50);
    return dataset;
  }, [processedData, timeRange, selectedForwardSource]);

  // Base filtered dataset before zoom (with optional weekday filter)
  const baseData = useMemo(() => {
    if (selectedWeekday) {
      return datasetBeforeWeekdayFilter.filter((p) => p.weekday === selectedWeekday);
    }
    return datasetBeforeWeekdayFilter;
  }, [datasetBeforeWeekdayFilter, selectedWeekday]);

  // Sliced data based on active zoom window
  const displayData = useMemo(() => {
    if (!zoomWindow || baseData.length <= 5) return baseData;
    const start = Math.max(0, Math.min(zoomWindow.start, baseData.length - 2));
    const end = Math.min(baseData.length - 1, Math.max(zoomWindow.end, start + 1));
    return baseData.slice(start, end + 1);
  }, [baseData, zoomWindow]);

  // Reset zoom window whenever tab, timeRange, channel, upstream, or weekday filter changes
  useEffect(() => {
    setZoomWindow(null);
  }, [activeTab, timeRange, selectedForwardSource, channelName, selectedWeekday]);

  // Reset weekday filter when changing channels
  useEffect(() => {
    setSelectedWeekday(null);
  }, [channelName]);

  // Scoped Wheel Zoom: captures wheel events ONLY inside the chart display area
  useEffect(() => {
    const el = chartContainerRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      // Only capture wheel zoom when on growth tab and there are enough posts to zoom
      if (activeTab !== "growth" || baseData.length <= 4) return;

      e.preventDefault();
      e.stopPropagation();

      const rect = el.getBoundingClientRect();
      const mouseX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
      const ratio = rect.width > 0 ? mouseX / rect.width : 0.5;

      setZoomWindow((prev) => {
        const total = baseData.length;
        const currentStart = prev ? prev.start : 0;
        const currentEnd = prev ? prev.end : total - 1;
        const currentCount = currentEnd - currentStart + 1;

        const isZoomIn = e.deltaY < 0;
        const MIN_POINTS = 5; // Zoom down to 5 posts for large, easy-to-click nodes

        let newCount: number;
        if (isZoomIn) {
          newCount = Math.max(MIN_POINTS, Math.round(currentCount * 0.75));
        } else {
          newCount = Math.min(total, Math.round(currentCount * 1.35));
        }

        if (newCount >= total) {
          return null; // Return to 100% full view
        }

        // Anchor zoom around cursor position
        const pivotIndex = currentStart + ratio * (currentCount - 1);
        let newStart = Math.round(pivotIndex - ratio * (newCount - 1));
        let newEnd = newStart + newCount - 1;

        if (newStart < 0) {
          newStart = 0;
          newEnd = Math.min(total - 1, newCount - 1);
        } else if (newEnd >= total) {
          newEnd = total - 1;
          newStart = Math.max(0, total - newCount);
        }

        return { start: newStart, end: newEnd };
      });
    };

    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", handleWheel);
    };
  }, [baseData, activeTab]);

  // Horizontal Drag to Pan when zoomed in
  const handleMouseDown = (e: React.MouseEvent) => {
    if (!zoomWindow) return;
    if ((e.target as HTMLElement)?.closest("button") || (e.target as HTMLElement)?.closest(".recharts-tooltip-wrapper")) return;
    isDraggingRef.current = true;
    dragStartXRef.current = e.clientX;
    dragStartWindowRef.current = { ...zoomWindow };
    setIsDragging(true);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDraggingRef.current || !dragStartWindowRef.current || !chartContainerRef.current) return;
    const deltaX = e.clientX - dragStartXRef.current;
    const rect = chartContainerRef.current.getBoundingClientRect();
    const count = dragStartWindowRef.current.end - dragStartWindowRef.current.start + 1;
    const deltaIndex = -Math.round((deltaX / rect.width) * count);

    if (deltaIndex !== 0) {
      const total = baseData.length;
      let newStart = dragStartWindowRef.current.start + deltaIndex;
      let newEnd = dragStartWindowRef.current.end + deltaIndex;

      if (newStart < 0) {
        newStart = 0;
        newEnd = count - 1;
      } else if (newEnd >= total) {
        newEnd = total - 1;
        newStart = Math.max(0, total - count);
      }

      setZoomWindow({ start: newStart, end: newEnd });
    }
  };

  const handleMouseUp = () => {
    isDraggingRef.current = false;
    setIsDragging(false);
  };

  // Programmatic zoom buttons (+ / -)
  const handleZoomIn = () => {
    setZoomWindow((prev) => {
      const total = baseData.length;
      const currentStart = prev ? prev.start : 0;
      const currentEnd = prev ? prev.end : total - 1;
      const currentCount = currentEnd - currentStart + 1;
      const newCount = Math.max(5, Math.round(currentCount * 0.7));
      if (newCount >= total) return null;
      const mid = Math.round((currentStart + currentEnd) / 2);
      let newStart = Math.max(0, mid - Math.floor(newCount / 2));
      let newEnd = newStart + newCount - 1;
      if (newEnd >= total) {
        newEnd = total - 1;
        newStart = Math.max(0, total - newCount);
      }
      return { start: newStart, end: newEnd };
    });
  };

  const handleZoomOut = () => {
    setZoomWindow((prev) => {
      if (!prev) return null;
      const total = baseData.length;
      const currentCount = prev.end - prev.start + 1;
      const newCount = Math.min(total, Math.round(currentCount * 1.4));
      if (newCount >= total) return null;
      const mid = Math.round((prev.start + prev.end) / 2);
      let newStart = Math.max(0, mid - Math.floor(newCount / 2));
      let newEnd = newStart + newCount - 1;
      if (newEnd >= total) {
        newEnd = total - 1;
        newStart = Math.max(0, total - newCount);
      }
      return { start: newStart, end: newEnd };
    });
  };

  // Aggregate Executive KPIs & Forward-In breakdown
  const kpis = useMemo(() => {
    if (processedData.length === 0) {
      return {
        totalPosts: 0,
        totalViews: 0,
        avgViews: 0,
        forwardInCount: 0,
        nativeCount: 0,
        forwardInRatio: "0",
        forwardInAvgViews: 0,
        nativeAvgViews: 0,
        topSource: "None",
        topSourceFull: "None",
        uniqueSourcesCount: 0,
        topSources: [],
        maxPost: null,
        peakHour: "--"
      };
    }

    const totalPosts = processedData.length;
    const totalViews = processedData.reduce((acc, cur) => acc + cur.views, 0);
    const avgViews = Math.round(totalViews / totalPosts);

    // Forward In vs Native split
    const forwardInPosts = processedData.filter((p) => p.isForwardIn);
    const nativePosts = processedData.filter((p) => !p.isForwardIn);
    const forwardInCount = forwardInPosts.length;
    const nativeCount = nativePosts.length;
    const forwardInRatio = totalPosts > 0 ? ((forwardInCount / totalPosts) * 100).toFixed(1) : "0";

    const forwardInTotalViews = forwardInPosts.reduce((acc, p) => acc + p.views, 0);
    const forwardInAvgViews = forwardInCount > 0 ? Math.round(forwardInTotalViews / forwardInCount) : 0;

    const nativeTotalViews = nativePosts.reduce((acc, p) => acc + p.views, 0);
    const nativeAvgViews = nativeCount > 0 ? Math.round(nativeTotalViews / nativeCount) : 0;

    // Upstream sources breakdown
    const sourceMap: Record<string, { count: number; totalViews: number; username?: string }> = {};
    for (const p of forwardInPosts) {
      const src = p.forwardSource || "External Source";
      if (!sourceMap[src]) {
        sourceMap[src] = { count: 0, totalViews: 0, username: p.forwardUsername };
      }
      sourceMap[src].count += 1;
      sourceMap[src].totalViews += p.views;
    }

    const topSources = Object.entries(sourceMap)
      .map(([name, item]) => ({
        name,
        count: item.count,
        avgViews: Math.round(item.totalViews / item.count),
        username: item.username
      }))
      .sort((a, b) => b.count - a.count);

    const topSource = topSources[0] ? `${topSources[0].name} (${topSources[0].count})` : t("analytics.native100");
    const topSourceFull = topSources[0]
      ? `${topSources[0].name} (${topSources[0].count} posts, avg ${formatNumber(topSources[0].avgViews)} views)`
      : t("analytics.noForwardDetected");

    let maxPost = processedData[0];
    for (const p of processedData) {
      if (p.views > (maxPost?.views || 0)) {
        maxPost = p;
      }
    }

    // Determine peak posting hour
    const hourCounts: Record<number, number> = {};
    for (const p of processedData) {
      hourCounts[p.hour] = (hourCounts[p.hour] || 0) + 1;
    }
    let peakH = 0;
    let maxCount = 0;
    for (const [h, count] of Object.entries(hourCounts)) {
      if (count > maxCount) {
        maxCount = count;
        peakH = Number(h);
      }
    }
    const peakHour = `${String(peakH).padStart(2, "0")}:00 - ${String((peakH + 1) % 24).padStart(2, "0")}:00`;

    return {
      totalPosts,
      totalViews,
      avgViews,
      forwardInCount,
      nativeCount,
      forwardInRatio,
      forwardInAvgViews,
      nativeAvgViews,
      topSource,
      topSourceFull,
      uniqueSourcesCount: topSources.length,
      topSources,
      maxPost,
      peakHour
    };
  }, [processedData, locale]);

  // Channel Impact & Audience Viability Evaluator
  // Synthesizes Average Views and Subscriber/Member count to evaluate Popularity, Importance, Utility, and Attractability
  const assessment = useMemo(() => {
    const subs = effectiveSubscribers;
    const avgV = kpis.avgViews;
    const hasSubscribers = subs > 0;

    // View-to-Subscriber Ratio (Engagement Penetration Rate per Post)
    const vsr = hasSubscribers ? (avgV / subs) * 100 : 0;
    const vsrFormatted = hasSubscribers ? vsr.toFixed(1) : "--";

    // 1. Popularity Score (0 - 100): Absolute audience size + absolute view volume
    let popularityScore = 0;
    let popularityTier = "";
    if (hasSubscribers) {
      // 0 to 1M subscribers = 0 to 50 pts; 0 to 100k avg views = 0 to 50 pts
      const subsLog = Math.min(50, (Math.log10(Math.max(10, subs)) / 6) * 50);
      const viewsLog = Math.min(50, (Math.log10(Math.max(10, avgV)) / 5) * 50);
      popularityScore = Math.round(Math.min(100, Math.max(10, subsLog + viewsLog)));
    } else {
      popularityScore = Math.round(Math.min(100, (Math.log10(Math.max(10, avgV)) / 5) * 100));
    }

    if (popularityScore >= 80) popularityTier = t("analytics.popularityTiers.tier1");
    else if (popularityScore >= 65) popularityTier = t("analytics.popularityTiers.tier2");
    else if (popularityScore >= 45) popularityTier = t("analytics.popularityTiers.tier3");
    else if (popularityScore >= 25) popularityTier = t("analytics.popularityTiers.tier4");
    else popularityTier = t("analytics.popularityTiers.tier5");

    // 2. Importance & Authority Score (0 - 100): High VSR penetration + original reporting
    const nativeRatio = Number(kpis.nativeCount) / Math.max(1, kpis.totalPosts);
    let importanceScore = 0;
    let importanceTier = "";
    if (hasSubscribers) {
      // Standard healthy Telegram VSR is 15-35%. VSR >= 35% gives top engagement score.
      const vsrPts = Math.min(60, (vsr / 35) * 60);
      const nativePts = nativeRatio * 25; // Original reporting vs forward aggregation
      const scalePts = Math.min(15, (Math.log10(Math.max(10, subs)) / 6) * 15);
      importanceScore = Math.round(Math.min(100, Math.max(10, vsrPts + nativePts + scalePts)));
    } else {
      importanceScore = Math.round(Math.min(100, Math.max(15, 45 + nativeRatio * 40)));
    }

    if (importanceScore >= 80) importanceTier = t("analytics.importanceTiers.tier1");
    else if (importanceScore >= 65) importanceTier = t("analytics.importanceTiers.tier2");
    else if (importanceScore >= 45) importanceTier = t("analytics.importanceTiers.tier3");
    else importanceTier = t("analytics.importanceTiers.tier4");

    // 3. Utility & Signal-to-Noise Score (0 - 100): Predictable attention, active retention
    let utilityScore = 0;
    let utilityTier = "";
    const peakMulti = avgV > 0 && kpis.maxPost ? kpis.maxPost.views / avgV : 1;
    // Lower volatility signals consistent reliable utility
    const consistencyScore = Math.max(10, 40 - Math.min(25, (peakMulti - 1) * 8));
    if (hasSubscribers) {
      const activeScore = Math.min(40, (vsr / 30) * 40);
      utilityScore = Math.round(Math.min(100, Math.max(10, activeScore + consistencyScore + nativeRatio * 20)));
    } else {
      utilityScore = Math.round(Math.min(100, Math.max(20, 50 + consistencyScore + nativeRatio * 20)));
    }

    if (utilityScore >= 80) utilityTier = t("analytics.utilityTiers.tier1");
    else if (utilityScore >= 60) utilityTier = t("analytics.utilityTiers.tier2");
    else if (utilityScore >= 40) utilityTier = t("analytics.utilityTiers.tier3");
    else utilityTier = t("analytics.utilityTiers.tier4");

    // 4. Attractability & Virality Score (0 - 100): Outward viral expansion, external pull
    let attractabilityScore = 0;
    let attractabilityTier = "";
    const viralPeakPts = Math.min(40, (peakMulti / 4) * 40);
    const forwardInBonus = (Number(kpis.forwardInRatio) / 100) * 15;
    if (hasSubscribers) {
      // If VSR >= 50%, content is heavily forwarded to external channels
      const externalExpansionPts = Math.min(45, (vsr / 50) * 45);
      attractabilityScore = Math.round(Math.min(100, Math.max(10, externalExpansionPts + viralPeakPts + forwardInBonus)));
    } else {
      attractabilityScore = Math.round(Math.min(100, Math.max(15, 45 + viralPeakPts + forwardInBonus)));
    }

    if (attractabilityScore >= 80) attractabilityTier = t("analytics.attractabilityTiers.tier1");
    else if (attractabilityScore >= 60) attractabilityTier = t("analytics.attractabilityTiers.tier2");
    else if (attractabilityScore >= 40) attractabilityTier = t("analytics.attractabilityTiers.tier3");
    else attractabilityTier = t("analytics.attractabilityTiers.tier4");

    // Qualitative Verdict & Health Assessment
    let verdictTitle = "";
    let verdictBadge = "";
    let verdictColor: "emerald" | "purple" | "sky" | "amber" | "rose" | "blue" = "sky";
    let audienceQuality = "";
    let explanation = "";

    if (hasSubscribers) {
      if (vsr >= 100) {
        verdictTitle = "Viral Outward Sensation";
        verdictBadge = t("analytics.badgeHyperViral");
        verdictColor = "purple";
        audienceQuality = t("analytics.qualityViralSpillover");
        explanation = t("analytics.explanationViral", {
          avg: formatNumber(avgV),
          subs: formatNumber(subs),
          vsr: vsrFormatted
        });
      } else if (vsr >= 40) {
        verdictTitle = "High-Authority Powerhouse";
        verdictBadge = t("analytics.badgeTopEngagement");
        verdictColor = "emerald";
        audienceQuality = t("analytics.qualityHyperActiveCore");
        explanation = t("analytics.explanationTop", {
          vsr: vsrFormatted
        });
      } else if (vsr >= 15) {
        verdictTitle = "Established & Popular Hub";
        verdictBadge = t("analytics.badgeHealthyBenchmark");
        verdictColor = "sky";
        audienceQuality = t("analytics.qualityAuthenticSteady");
        explanation = t("analytics.explanationHealthy", {
          vsr: vsrFormatted
        });
      } else if (vsr >= 5) {
        verdictTitle = "Broad Broadcast / Muted Audience";
        verdictBadge = t("analytics.badgeModerateReach");
        verdictColor = "amber";
        audienceQuality = t("analytics.qualityPassiveFollowing");
        explanation = t("analytics.explanationModerate", {
          vsr: vsrFormatted
        });
      } else {
        verdictTitle = "Low-Penetration / Inactive Risk";
        verdictBadge = t("analytics.badgeLowEngagement");
        verdictColor = "rose";
        audienceQuality = t("analytics.qualityGhostAudienceRisk");
        explanation = t("analytics.explanationLow", {
          vsr: vsrFormatted,
          subs: formatNumber(subs)
        });
      }
    } else {
      verdictTitle = "Active Post Stream";
      verdictBadge = t("analytics.badgeViewsActive");
      verdictColor = "blue";
      audienceQuality = t("analytics.qualityUnlistedSubscribers");
      explanation = t("analytics.explanationUnlisted", {
        avg: formatNumber(avgV),
        min: formatNumber(avgV * 3),
        max: formatNumber(avgV * 6)
      });
    }

    return {
      subs,
      hasSubscribers,
      avgViews: avgV,
      vsr,
      vsrFormatted,
      popularityScore,
      popularityTier,
      importanceScore,
      importanceTier,
      utilityScore,
      utilityTier,
      attractabilityScore,
      attractabilityTier,
      verdictTitle,
      verdictBadge,
      verdictColor,
      audienceQuality,
      explanation
    };
  }, [effectiveSubscribers, kpis, locale]);

  // Aggregate 24-hour distribution pattern
  const hourlyData = useMemo(() => {
    const hours = Array.from({ length: 24 }, (_, i) => ({
      hour: `${String(i).padStart(2, "0")}:00`,
      postsCount: 0,
      totalViews: 0,
      avgViews: 0
    }));

    const targetPosts = datasetBeforeWeekdayFilter.length > 0 ? datasetBeforeWeekdayFilter : processedData;
    for (const p of targetPosts) {
      if (p.hour >= 0 && p.hour < 24) {
        hours[p.hour].postsCount += 1;
        hours[p.hour].totalViews += p.views;
      }
    }

    return hours.map((h) => ({
      ...h,
      avgViews: h.postsCount > 0 ? Math.round(h.totalViews / h.postsCount) : 0
    }));
  }, [datasetBeforeWeekdayFilter, processedData]);

  // Aggregate Day-of-Week cadence
  const weekdayData = useMemo(() => {
    const daysOrder = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
    const counts: Record<string, { posts: number; totalViews: number }> = {
      Mon: { posts: 0, totalViews: 0 },
      Tue: { posts: 0, totalViews: 0 },
      Wed: { posts: 0, totalViews: 0 },
      Thu: { posts: 0, totalViews: 0 },
      Fri: { posts: 0, totalViews: 0 },
      Sat: { posts: 0, totalViews: 0 },
      Sun: { posts: 0, totalViews: 0 }
    };

    const targetPosts = datasetBeforeWeekdayFilter.length > 0 ? datasetBeforeWeekdayFilter : processedData;
    for (const p of targetPosts) {
      if (p.weekday && counts[p.weekday] !== undefined) {
        counts[p.weekday].posts += 1;
        counts[p.weekday].totalViews += p.views;
      }
    }

    const totalPostsCount = targetPosts.length;
    let maxPosts = 0;
    for (const d of daysOrder) {
      if (counts[d].posts > maxPosts) {
        maxPosts = counts[d].posts;
      }
    }

    return daysOrder.map((day) => {
      const postsCount = counts[day].posts;
      const totalViews = counts[day].totalViews;
      const avgViews = postsCount > 0 ? Math.round(totalViews / postsCount) : 0;
      const percentage = totalPostsCount > 0 ? Math.round((postsCount / totalPostsCount) * 100) : 0;
      const isPeak = maxPosts > 0 && postsCount === maxPosts;
      return {
        day,
        postsCount,
        avgViews,
        percentage,
        isPeak
      };
    });
  }, [datasetBeforeWeekdayFilter, processedData]);

  // Theme-aware colors
  const chartColors = {
    grid: isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.06)",
    text: isDark ? "#94A3B8" : "#64748B",
    viewsLine: "#0EA5E9", // Sky-500
    viewsFill: isDark ? "rgba(14, 165, 233, 0.2)" : "rgba(14, 165, 233, 0.12)",
    movingAvgLine: "#F59E0B", // Amber-500
    forwardInBar: "#10B981", // Emerald-500
    forwardInBarDark: "#059669",
    nativeBar: isDark ? "#475569" : "#94A3B8", // Slate-600 / Slate-400
    hourlyBar: "#6366F1", // Indigo-500
    tooltipBg: isDark ? "#0F172A" : "#FFFFFF",
    tooltipBorder: isDark ? "#334155" : "#E2E8F0"
  };

  // Custom Tooltip Renderer
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload || !payload.length) return null;
    const data = payload[0]?.payload;

    return (
      <div
        className="p-3.5 rounded-2xl shadow-xl border text-xs font-sans max-w-xs transition-all duration-200 pointer-events-auto"
        style={{
          backgroundColor: chartColors.tooltipBg,
          borderColor: chartColors.tooltipBorder,
          color: isDark ? "#F8FAFC" : "#0F172A"
        }}
        onClick={(e) => {
          e.stopPropagation();
          if (data?.rawPost && onPostClick) {
            onPostClick(data.rawPost);
          }
        }}
      >
        <div className="flex items-center justify-between gap-3 pb-2 border-b border-black/5 dark:border-white/10 mb-2">
          <div className="flex items-center gap-1.5">
            <span className="font-extrabold text-[11px] uppercase tracking-wider text-sky-600 dark:text-sky-400">
              {t("analytics.postNumber", { number: data?.postIndex || label })}
            </span>
            {data?.views > 0 && data?.views === kpis.maxPost?.views && (
              <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-500 text-[9px] font-bold">
                {t("analytics.peakBadge")}
              </span>
            )}
          </div>
          <span className="text-[10px] opacity-60 font-mono">
            {data?.fullDate || data?.dateStr || data?.hour || data?.day}
          </span>
        </div>

        {/* Post Type Banner: Forward-In vs Native */}
        {data?.isForwardIn !== undefined && (
          <div className="mb-2.5">
            {data.isForwardIn ? (
              <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200/60 dark:border-emerald-800/60">
                <span>{t("analytics.forwardFromLabel")}</span>
                <span className="font-mono">{data.forwardSource || t("analytics.externalChannel")}</span>
              </div>
            ) : (
              <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700">
                <span>{t("analytics.originalNativePost")}</span>
              </div>
            )}
          </div>
        )}

        <div className="space-y-1.5 font-mono text-[11px]">
          {data?.views !== undefined && (
            <div className="flex items-center justify-between gap-4">
              <span className="text-stone-500 dark:text-stone-400">{t("analytics.viewsLabel")}</span>
              <span className="font-bold text-sky-600 dark:text-sky-400 tabular-nums">
                {data.views.toLocaleString()}
              </span>
            </div>
          )}
          {data?.movingAvgViews !== undefined && (
            <div className="flex items-center justify-between gap-4">
              <span className="text-stone-500 dark:text-stone-400">{t("analytics.movingAvgLabel")}</span>
              <span className="font-bold text-amber-600 dark:text-amber-400 tabular-nums">
                {data.movingAvgViews.toLocaleString()}
              </span>
            </div>
          )}
          {data?.postsCount !== undefined && (
            <div className="flex items-center justify-between gap-4">
              <span className="text-stone-500 dark:text-stone-400">{t("analytics.postsPublishedLabel")}</span>
              <span className="font-bold text-indigo-600 dark:text-indigo-400 tabular-nums">
                {data.postsCount}
              </span>
            </div>
          )}
          {data?.avgViews !== undefined && (
            <div className="flex items-center justify-between gap-4">
              <span className="text-stone-500 dark:text-stone-400">{t("analytics.avgViewsPostLabel")}</span>
              <span className="font-bold text-sky-600 dark:text-sky-400 tabular-nums">
                {data.avgViews.toLocaleString()}
              </span>
            </div>
          )}
        </div>

        {data?.snippet && (
          <p className="mt-2.5 pt-2 border-t border-black/5 dark:border-white/10 text-[11px] line-clamp-2 text-stone-600 dark:text-stone-300 italic font-sans leading-relaxed">
            "{data.snippet}"
          </p>
        )}

        {data?.rawPost && onPostClick && (
          <div className="mt-2.5 pt-2 border-t border-black/5 dark:border-white/10 flex items-center justify-between">
            <span className="text-[10px] text-gray-400 dark:text-gray-500 font-sans">
              {t("analytics.postDetails")}
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onPostClick(data.rawPost);
              }}
              className="text-[10px] text-sky-600 dark:text-sky-400 font-bold hover:text-sky-700 dark:hover:text-sky-300 hover:underline cursor-pointer flex items-center gap-1 bg-sky-50 dark:bg-sky-950/50 px-2.5 py-1 rounded-lg border border-sky-200/50 dark:border-sky-800/50 transition-all active:scale-95 shadow-xs"
            >
              <span>{t("analytics.viewPost")}</span>
              <span aria-hidden="true">→</span>
            </button>
          </div>
        )}
      </div>
    );
  };

  if (processedData.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-gray-300 dark:border-gray-700 p-12 text-center bg-white/40 dark:bg-gray-800/40 backdrop-blur-md">
        <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-blue-50 dark:bg-blue-950/40 text-blue-500 flex items-center justify-center">
          <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
        </div>
        <h4 className="text-base font-bold text-gray-800 dark:text-gray-100 mb-1">
          {t("analytics.noMetricsTitle")}
        </h4>
        <p className="text-xs text-gray-500 dark:text-gray-400 max-w-sm mx-auto">
          {t("analytics.noMetricsDesc", { channel: channelName })}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 1. Executive Metric Summary Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
        {/* Metric 1: Avg Views */}
        <div className="p-4 rounded-2xl bg-white dark:bg-gray-800 border border-gray-200/80 dark:border-gray-700/80 shadow-xs flex flex-col justify-between">
          <span className="text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center justify-between">
            <span>{t("analytics.avgViews")}</span>
            <span className="text-sky-500 text-xs font-mono">👁️</span>
          </span>
          <div className="mt-2">
            <span className="text-2xl font-black text-gray-900 dark:text-white tabular-nums tracking-tight">
              {formatNumber(kpis.avgViews)}
            </span>
            <div className="text-[10px] text-gray-400 dark:text-gray-500 font-mono mt-0.5">
              {t("analytics.totalImpressions", { count: formatNumber(kpis.totalViews) })}
            </div>
          </div>
        </div>

        {/* Metric 2: Forward-In Content Ratio */}
        <div className="p-4 rounded-2xl bg-white dark:bg-gray-800 border border-gray-200/80 dark:border-gray-700/80 shadow-xs flex flex-col justify-between">
          <span className="text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center justify-between">
            <span>{t("analytics.forwardInRatio")}</span>
            <span className="text-emerald-500 text-xs font-mono">📥</span>
          </span>
          <div className="mt-2">
            <span className="text-2xl font-black text-emerald-600 dark:text-emerald-400 tabular-nums tracking-tight">
              {kpis.forwardInRatio}%
            </span>
            <div className="text-[10px] text-gray-400 dark:text-gray-500 font-mono mt-0.5">
              {t("analytics.forwardVsOriginal", { forwarded: kpis.forwardInCount, original: kpis.nativeCount })}
            </div>
          </div>
        </div>

        {/* Metric 3: Top Upstream Source */}
        <div className="p-4 rounded-2xl bg-white dark:bg-gray-800 border border-gray-200/80 dark:border-gray-700/80 shadow-xs flex flex-col justify-between">
          <span className="text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center justify-between">
            <span>{t("analytics.topForwardSource")}</span>
            <span className="text-emerald-500 text-xs font-mono">🔗</span>
          </span>
          <div className="mt-2">
            <span
              className="text-lg sm:text-xl font-black text-gray-900 dark:text-white tabular-nums tracking-tight truncate block"
              title={kpis.topSourceFull}
            >
              {kpis.topSource}
            </span>
            <div className="text-[10px] text-gray-400 dark:text-gray-500 font-mono mt-0.5 truncate">
              {kpis.uniqueSourcesCount > 1
                ? t("analytics.upstreamChannelsDetected", { count: kpis.uniqueSourcesCount })
                : kpis.uniqueSourcesCount === 1
                ? t("analytics.upstreamChannelDetected")
                : t("analytics.allNativeMessages")}
            </div>
          </div>
        </div>

        {/* Metric 4: Forwarded vs Native Views */}
        <div className="p-4 rounded-2xl bg-white dark:bg-gray-800 border border-gray-200/80 dark:border-gray-700/80 shadow-xs flex flex-col justify-between">
          <span className="text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center justify-between">
            <span>{t("analytics.fwdVsNativeViews")}</span>
            <span className="text-indigo-500 text-xs font-mono">⚖️</span>
          </span>
          <div className="mt-2">
            <div className="flex items-baseline gap-1.5">
              <span
                className="text-lg font-black text-emerald-600 dark:text-emerald-400 tabular-nums"
                title={`Avg views for forwarded-in posts: ${kpis.forwardInAvgViews.toLocaleString()}`}
              >
                {formatNumber(kpis.forwardInAvgViews)}
              </span>
              <span className="text-xs text-gray-400">/</span>
              <span
                className="text-lg font-black text-gray-600 dark:text-gray-300 tabular-nums"
                title={`Avg views for native posts: ${kpis.nativeAvgViews.toLocaleString()}`}
              >
                {formatNumber(kpis.nativeAvgViews)}
              </span>
            </div>
            <div className="text-[10px] text-gray-400 dark:text-gray-500 font-mono mt-0.5 truncate">
              {kpis.forwardInCount === 0
                ? t("analytics.noForwardedPosts")
                : kpis.forwardInAvgViews >= kpis.nativeAvgViews
                ? t("analytics.fwdPerformsHigher")
                : t("analytics.nativePerformsHigher")}
            </div>
          </div>
        </div>
      </div>

      {/* 2. Channel Viability, Popularity, Importance, Utility & Attractability Assessment */}
      <div className="bg-gradient-to-br from-white via-sky-50/20 to-indigo-50/20 dark:from-gray-800 dark:via-gray-800/90 dark:to-gray-900 rounded-3xl border border-gray-200/90 dark:border-gray-700/80 p-5 sm:p-6 shadow-xs transition-all">
        {/* Header with Title, Overall Verdict Badge, and Expand/Collapse */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-4 border-b border-gray-150 dark:border-gray-700/60">
          <div className="flex items-start sm:items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20 shrink-0">
              <span className="text-lg">🧠</span>
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm font-extrabold text-gray-900 dark:text-white uppercase tracking-tight">
                  {t("analytics.assessmentTitle")}
                </h3>
                <span
                  className={`px-2.5 py-0.5 rounded-full text-[10px] font-black tracking-wide border shadow-2xs ${
                    assessment.verdictColor === "purple"
                      ? "bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-950/80 dark:text-purple-300 dark:border-purple-700"
                      : assessment.verdictColor === "emerald"
                      ? "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/80 dark:text-emerald-300 dark:border-emerald-700"
                      : assessment.verdictColor === "amber"
                      ? "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/80 dark:text-amber-300 dark:border-amber-700"
                      : assessment.verdictColor === "rose"
                      ? "bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950/80 dark:text-rose-300 dark:border-rose-700"
                      : "bg-sky-100 text-sky-800 border-sky-300 dark:bg-sky-950/80 dark:text-sky-300 dark:border-sky-700"
                  }`}
                >
                  {assessment.verdictBadge}
                </span>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                {assessment.hasSubscribers
                  ? t("analytics.synthesizingWithSubscribers", {
                      avg: formatNumber(kpis.avgViews),
                      subs: formatNumber(assessment.subs)
                    })
                  : t("analytics.synthesizingEstimated", {
                      avg: formatNumber(kpis.avgViews)
                    })}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-end md:self-center shrink-0">
            {/* Quick Subscribers Calibrator button */}
            <button
              type="button"
              onClick={() => {
                setIsEditingSubscribers(!isEditingSubscribers);
                if (!isEditingSubscribers) {
                  setSubscriberInput(String(assessment.subs || ""));
                }
              }}
              className="px-2.5 py-1 rounded-xl text-[11px] font-bold bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700 transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs"
              title="Calibrate or simulate different subscriber counts"
            >
              <span>⚙️</span>
              <span>{isEditingSubscribers ? t("analytics.closeCalibration") : t("analytics.calibrateAudience")}</span>
            </button>

            {/* Toggle Expand / Minimize */}
            <button
              type="button"
              onClick={() => setIsAssessmentExpanded(!isAssessmentExpanded)}
              className="p-1.5 rounded-xl text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer"
              title={isAssessmentExpanded ? t("analytics.collapseEvaluation") : t("analytics.expandEvaluation")}
            >
              <svg
                className={`w-4 h-4 transition-transform duration-200 ${isAssessmentExpanded ? "rotate-180" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>
        </div>

        {/* Subscriber Calibration Drawer (Optional Simulator) */}
        {isEditingSubscribers && (
          <div className="mt-3.5 p-3.5 bg-sky-50/70 dark:bg-sky-950/40 rounded-2xl border border-sky-200/60 dark:border-sky-800/60 flex flex-wrap items-center justify-between gap-3 text-xs animate-fadeIn">
            <div className="space-y-0.5">
              <span className="font-bold text-sky-900 dark:text-sky-200">
                {t("analytics.calibrateTitle")}
              </span>
              <p className="text-[11px] text-sky-700/80 dark:text-sky-300/80">
                {t("analytics.calibrateDesc")}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1">
                {[1000, 10000, 50000, 250000].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => {
                      setCustomSubscribers(preset);
                      setSubscriberInput(String(preset));
                    }}
                    className={`px-2 py-0.5 rounded-lg text-[10px] font-mono font-bold border transition-colors cursor-pointer ${
                      assessment.subs === preset
                        ? "bg-sky-600 text-white border-sky-600"
                        : "bg-white dark:bg-gray-800 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800 hover:bg-sky-100"
                    }`}
                  >
                    {formatNumber(preset)}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min="1"
                  step="100"
                  placeholder="e.g. 25000"
                  value={subscriberInput}
                  onChange={(e) => setSubscriberInput(e.target.value)}
                  className="w-24 px-2 py-1 rounded-lg border border-sky-300 dark:border-sky-700 bg-white dark:bg-gray-900 text-xs font-mono font-bold text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-sky-500"
                />
                <button
                  type="button"
                  onClick={() => {
                    const parsed = parseInt(subscriberInput, 10);
                    if (!isNaN(parsed) && parsed > 0) {
                      setCustomSubscribers(parsed);
                    }
                  }}
                  className="px-2.5 py-1 rounded-lg bg-sky-600 text-white font-bold text-xs hover:bg-sky-500 cursor-pointer shadow-2xs"
                >
                  {t("analytics.apply")}
                </button>
                {customSubscribers !== null && (
                  <button
                    type="button"
                    onClick={() => {
                      setCustomSubscribers(null);
                      setSubscriberInput("");
                    }}
                    className="px-2 py-1 rounded-lg text-[10px] text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:underline cursor-pointer"
                  >
                    {t("analytics.resetToProfile")}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {isAssessmentExpanded && (
          <div className="mt-5 space-y-5">
            {/* 4 Core Dimensions Matrix: Popular, Important, Useful, Attractable */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
              {/* Dimension 1: Popularity */}
              <div className="p-4 rounded-2xl bg-white/80 dark:bg-gray-800/80 border border-gray-200/80 dark:border-gray-700/80 shadow-2xs flex flex-col justify-between space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-0.5">
                    <span className="text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                      <span>{t("analytics.popularityScale")}</span>
                      <span title={t("analytics.popularityScaleDesc")}>ℹ️</span>
                    </span>
                    <span className="text-xs font-extrabold text-gray-900 dark:text-white block">
                      {assessment.popularityTier}
                    </span>
                  </div>
                  <span className="text-xl font-black text-sky-600 dark:text-sky-400 tabular-nums">
                    {assessment.popularityScore}<span className="text-[11px] font-normal text-gray-400">/100</span>
                  </span>
                </div>
                <div>
                  <div className="h-1.5 w-full rounded-full bg-gray-150 dark:bg-gray-700 overflow-hidden">
                    <div
                      className="h-full bg-sky-500 rounded-full transition-all duration-700"
                      style={{ width: `${assessment.popularityScore}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-gray-400 dark:text-gray-500 font-mono mt-1.5 block">
                    {assessment.hasSubscribers
                      ? t("analytics.membersAndAvgViews", {
                          members: formatNumber(assessment.subs),
                          avg: formatNumber(kpis.avgViews)
                        })
                      : t("analytics.avgViewsPerPost", {
                          avg: formatNumber(kpis.avgViews)
                        })}
                  </span>
                </div>
              </div>

              {/* Dimension 2: Importance & Authority */}
              <div className="p-4 rounded-2xl bg-white/80 dark:bg-gray-800/80 border border-gray-200/80 dark:border-gray-700/80 shadow-2xs flex flex-col justify-between space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-0.5">
                    <span className="text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                      <span>{t("analytics.importanceAuthority")}</span>
                      <span title={t("analytics.importanceAuthorityDesc")}>ℹ️</span>
                    </span>
                    <span className="text-xs font-extrabold text-gray-900 dark:text-white block">
                      {assessment.importanceTier}
                    </span>
                  </div>
                  <span className="text-xl font-black text-emerald-600 dark:text-emerald-400 tabular-nums">
                    {assessment.importanceScore}<span className="text-[11px] font-normal text-gray-400">/100</span>
                  </span>
                </div>
                <div>
                  <div className="h-1.5 w-full rounded-full bg-gray-150 dark:bg-gray-700 overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 rounded-full transition-all duration-700"
                      style={{ width: `${assessment.importanceScore}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-gray-400 dark:text-gray-500 font-mono mt-1.5 block">
                    {assessment.hasSubscribers
                      ? t("analytics.viewPenetrationNative", {
                          vsr: assessment.vsrFormatted,
                          count: kpis.nativeCount
                        })
                      : t("analytics.nativePostsOriginalRatio", {
                          count: kpis.nativeCount,
                          ratio: (100 - Number(kpis.forwardInRatio)).toFixed(0)
                        })}
                  </span>
                </div>
              </div>

              {/* Dimension 3: Utility & Signal-to-Noise */}
              <div className="p-4 rounded-2xl bg-white/80 dark:bg-gray-800/80 border border-gray-200/80 dark:border-gray-700/80 shadow-2xs flex flex-col justify-between space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-0.5">
                    <span className="text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                      <span>{t("analytics.utilityValue")}</span>
                      <span title={t("analytics.utilityValueDesc")}>ℹ️</span>
                    </span>
                    <span className="text-xs font-extrabold text-gray-900 dark:text-white block">
                      {assessment.utilityTier}
                    </span>
                  </div>
                  <span className="text-xl font-black text-indigo-600 dark:text-indigo-400 tabular-nums">
                    {assessment.utilityScore}<span className="text-[11px] font-normal text-gray-400">/100</span>
                  </span>
                </div>
                <div>
                  <div className="h-1.5 w-full rounded-full bg-gray-150 dark:bg-gray-700 overflow-hidden">
                    <div
                      className="h-full bg-indigo-500 rounded-full transition-all duration-700"
                      style={{ width: `${assessment.utilityScore}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-gray-400 dark:text-gray-500 font-mono mt-1.5 block">
                    {t("analytics.peakViewsSteady", { peak: formatNumber(kpis.maxPost?.views || 0) })}
                  </span>
                </div>
              </div>

              {/* Dimension 4: Attractability & Virality */}
              <div className="p-4 rounded-2xl bg-white/80 dark:bg-gray-800/80 border border-gray-200/80 dark:border-gray-700/80 shadow-2xs flex flex-col justify-between space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-0.5">
                    <span className="text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                      <span>{t("analytics.attractabilityVirality")}</span>
                      <span title={t("analytics.attractabilityViralityDesc")}>ℹ️</span>
                    </span>
                    <span className="text-xs font-extrabold text-gray-900 dark:text-white block">
                      {assessment.attractabilityTier}
                    </span>
                  </div>
                  <span className="text-xl font-black text-purple-600 dark:text-purple-400 tabular-nums">
                    {assessment.attractabilityScore}<span className="text-[11px] font-normal text-gray-400">/100</span>
                  </span>
                </div>
                <div>
                  <div className="h-1.5 w-full rounded-full bg-gray-150 dark:bg-gray-700 overflow-hidden">
                    <div
                      className="h-full bg-purple-500 rounded-full transition-all duration-700"
                      style={{ width: `${assessment.attractabilityScore}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-gray-400 dark:text-gray-500 font-mono mt-1.5 block">
                    {assessment.vsr >= 50 ? t("analytics.viralReachBeyond") : t("analytics.organicCirculation")}
                  </span>
                </div>
              </div>
            </div>

            {/* View-to-Subscriber Ratio (VSR) Benchmark Spectrum & Authenticity Callout */}
            <div className="p-4 rounded-2xl bg-white dark:bg-gray-800/90 border border-gray-200/70 dark:border-gray-700/70 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1.5 max-w-xl">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-black uppercase tracking-wider text-gray-800 dark:text-gray-200">
                    {t("analytics.audienceHealthDiagnosis")}
                  </span>
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-sky-100 dark:bg-sky-950/80 text-sky-800 dark:text-sky-300 border border-sky-200 dark:border-sky-800 font-mono">
                    {assessment.audienceQuality}
                  </span>
                </div>
                <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed font-sans">
                  {assessment.explanation}
                </p>
              </div>

              {/* VSR Gauge Meter */}
              {assessment.hasSubscribers && (
                <div className="shrink-0 p-3 rounded-xl bg-gray-50 dark:bg-gray-900 border border-gray-200/80 dark:border-gray-700/80 text-center min-w-[210px]">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 block">
                    {t("analytics.vsrTitle")}
                  </span>
                  <div className="text-2xl font-black text-gray-900 dark:text-white tabular-nums tracking-tight my-0.5">
                    {assessment.vsrFormatted}%
                  </div>
                  <div className="text-[10px] font-mono text-gray-500 dark:text-gray-400 flex items-center justify-center gap-1">
                    <span>{t("analytics.healthyBenchmark")}</span>
                    <strong className="text-emerald-600 dark:text-emerald-400">{t("analytics.benchmarkRange")}</strong>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 3. Interactive Chart Canvas Card */}
      <div className="bg-white dark:bg-gray-800 rounded-3xl border border-gray-200/80 dark:border-gray-700/80 shadow-sm p-5 sm:p-6 transition-colors">
        {/* Chart Header Toolbar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-5 border-b border-gray-150 dark:border-gray-700/60 mb-6">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
            </div>
            <div>
              <h3 className="text-sm font-black text-gray-900 dark:text-white uppercase tracking-tight">
                {activeTab === "growth" && t("analytics.growthHeaderTitle")}
                {activeTab === "forwards" && t("analytics.forwardsHeaderTitle")}
                {activeTab === "hourly" && t("analytics.hourlyHeaderTitle")}
              </h3>
              <p className="text-[11px] text-gray-400 dark:text-gray-500 font-mono">
                {activeTab === "growth" && t("analytics.growthHeaderSubtitle", { channel: channelName })}
                {activeTab === "forwards" && t("analytics.forwardsHeaderSubtitle", { channel: channelName })}
                {activeTab === "hourly" && t("analytics.hourlyHeaderSubtitle")}
              </p>
            </div>
          </div>

          {/* Scope Controls & Navigation */}
          <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
            {/* View Mode Tabs */}
            <div className="flex items-center bg-gray-100 dark:bg-gray-900 p-1 rounded-xl border border-gray-200/80 dark:border-gray-700 text-xs">
              <button
                onClick={() => setActiveTab("growth")}
                className={`px-3 py-1.5 rounded-lg font-bold transition cursor-pointer ${
                  activeTab === "growth"
                    ? "bg-white dark:bg-gray-800 text-sky-600 dark:text-sky-400 shadow-xs"
                    : "text-gray-500 hover:text-gray-900 dark:hover:text-white"
                }`}
              >
                {t("analytics.tabViewsGrowth")}
              </button>
              <button
                onClick={() => setActiveTab("forwards")}
                className={`px-3 py-1.5 rounded-lg font-bold transition cursor-pointer flex items-center gap-1.5 ${
                  activeTab === "forwards"
                    ? "bg-white dark:bg-gray-800 text-emerald-600 dark:text-emerald-400 shadow-xs"
                    : "text-gray-500 hover:text-gray-900 dark:hover:text-white"
                }`}
              >
                <span>{t("analytics.tabForwardIn")}</span>
                {kpis.forwardInCount > 0 && (
                  <span className="px-1.5 py-0.2 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-mono">
                    {kpis.forwardInCount}
                  </span>
                )}
              </button>
              <button
                onClick={() => setActiveTab("hourly")}
                className={`px-3 py-1.5 rounded-lg font-bold transition cursor-pointer ${
                  activeTab === "hourly"
                    ? "bg-white dark:bg-gray-800 text-indigo-600 dark:text-indigo-400 shadow-xs"
                    : "text-gray-500 hover:text-gray-900 dark:hover:text-white"
                }`}
              >
                {t("analytics.tab24hRhythms")}
              </button>
            </div>

            {/* Timeframe Scope Selector */}
            {activeTab !== "hourly" && (
              <div className="flex items-center bg-gray-100 dark:bg-gray-900 p-1 rounded-xl border border-gray-200/80 dark:border-gray-700 text-[11px] font-mono">
                <button
                  onClick={() => setTimeRange("all")}
                  className={`px-2.5 py-1 rounded-lg font-bold transition cursor-pointer ${
                    timeRange === "all"
                      ? "bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-xs"
                      : "text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                  }`}
                >
                  {t("analytics.timeRangeAll", { count: processedData.length })}
                </button>
                <button
                  onClick={() => setTimeRange("50")}
                  className={`px-2.5 py-1 rounded-lg font-bold transition cursor-pointer ${
                    timeRange === "50"
                      ? "bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-xs"
                      : "text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                  }`}
                >
                  {t("analytics.timeRange50")}
                </button>
                <button
                  onClick={() => setTimeRange("20")}
                  className={`px-2.5 py-1 rounded-lg font-bold transition cursor-pointer ${
                    timeRange === "20"
                      ? "bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-xs"
                      : "text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                  }`}
                >
                  {t("analytics.timeRange20")}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Extra Composition & Upstream Sources Strip (When Forward In Tab is active) */}
        {activeTab === "forwards" && (
          <div className="mb-6 p-4 rounded-2xl bg-gray-50 dark:bg-gray-900/60 border border-gray-200/60 dark:border-gray-700/60 space-y-3">
            {/* Split Progress Bar */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px] font-mono font-bold">
                <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                  <span>📥 {t("analytics.forwardedInBanner")}</span>
                  <span>{t("analytics.postsCountPercent", { count: kpis.forwardInCount, percent: kpis.forwardInRatio })}</span>
                </span>
                <span className="text-gray-500 dark:text-gray-400 flex items-center gap-1">
                  <span>📝 {t("analytics.nativeBanner")}</span>
                  <span>{t("analytics.postsCountPercent", { count: kpis.nativeCount, percent: (100 - Number(kpis.forwardInRatio)).toFixed(1) })}</span>
                </span>
              </div>
              <div className="h-2 w-full rounded-full bg-gray-200 dark:bg-gray-800 overflow-hidden flex">
                <div
                  className="h-full bg-emerald-500 transition-all duration-500"
                  style={{ width: `${kpis.forwardInRatio}%` }}
                ></div>
                <div
                  className="h-full bg-slate-400 dark:bg-slate-600 transition-all duration-500"
                  style={{ width: `${100 - Number(kpis.forwardInRatio)}%` }}
                ></div>
              </div>
            </div>

            {/* Upstream Sources Chips */}
            {kpis.topSources.length > 0 && (
              <div className="pt-2 border-t border-gray-200/50 dark:border-gray-700/50 flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider mr-1">
                  {t("analytics.upstreamSourcesTitle")}
                </span>
                {selectedForwardSource && (
                  <button
                    onClick={() => setSelectedForwardSource(null)}
                    className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-300 transition-colors flex items-center gap-1 cursor-pointer"
                  >
                    <span>{t("analytics.showAllSources")}</span>
                    <span>&times;</span>
                  </button>
                )}
                {kpis.topSources.slice(0, 6).map((src: any) => {
                  const isSelected = selectedForwardSource === src.name;
                  return (
                    <button
                      key={src.name}
                      onClick={() => {
                        setSelectedForwardSource(isSelected ? null : src.name);
                        if (src.username && onExploreChannel) {
                          onExploreChannel(src.username);
                        }
                      }}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-mono font-bold transition-all flex items-center gap-1.5 cursor-pointer border ${
                        isSelected
                          ? "bg-emerald-600 text-white border-emerald-600 shadow-xs"
                          : "bg-white dark:bg-gray-800 text-emerald-700 dark:text-emerald-300 border-emerald-300/40 dark:border-emerald-700/40 hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
                      }`}
                      title={t("analytics.sourceTooltip", { name: src.name, count: src.count, avg: formatNumber(src.avgViews) })}
                    >
                      <span>{src.name}</span>
                      <span className="px-1.5 py-0.2 rounded bg-black/10 dark:bg-white/10 text-[9px]">
                        {src.count}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Zoom Controls & Status Banner (Growth Tab) */}
        {activeTab === "growth" && baseData.length > 4 && (
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 border border-sky-200/50 dark:border-sky-800/50 font-mono text-[11px]">
                <span aria-hidden="true">🔍</span>
                <span>
                  {zoomWindow ? (
                    t("analytics.zoomStatus", {
                      current: displayData.length,
                      total: baseData.length,
                      percent: Math.round((displayData.length / baseData.length) * 100)
                    })
                  ) : (
                    t("analytics.zoomShowingAll", { total: baseData.length })
                  )}
                </span>
              </span>
              {zoomWindow && (
                <span className="text-[11px] text-gray-500 dark:text-gray-400 hidden sm:inline">
                  {t("analytics.zoomDragHint")}
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleZoomIn}
                className="w-7 h-7 rounded-lg bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm font-bold flex items-center justify-center transition-all cursor-pointer border border-gray-200 dark:border-gray-700 shadow-2xs"
                title={t("analytics.zoomInBtn")}
              >
                +
              </button>
              <button
                type="button"
                onClick={handleZoomOut}
                disabled={!zoomWindow}
                className={`w-7 h-7 rounded-lg text-sm font-bold flex items-center justify-center transition-all border shadow-2xs ${
                  zoomWindow
                    ? "bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 border-gray-200 dark:border-gray-700 cursor-pointer"
                    : "opacity-40 text-gray-400 border-gray-200/40 dark:border-gray-800 cursor-not-allowed"
                }`}
                title={t("analytics.zoomOutBtn")}
              >
                −
              </button>
              {zoomWindow && (
                <button
                  type="button"
                  onClick={() => setZoomWindow(null)}
                  className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-sky-600 hover:bg-sky-500 text-white shadow-xs transition-all cursor-pointer flex items-center gap-1 ml-0.5"
                  title={t("analytics.resetZoom")}
                >
                  <span>{t("analytics.resetZoom")}</span>
                  <span className="text-[10px]">↺</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* 3. Recharts Visualizations */}
        <div
          ref={chartContainerRef}
          onMouseDown={activeTab === "growth" ? handleMouseDown : undefined}
          onMouseMove={activeTab === "growth" ? handleMouseMove : undefined}
          onMouseUp={activeTab === "growth" ? handleMouseUp : undefined}
          onMouseLeave={activeTab === "growth" ? handleMouseUp : undefined}
          className={`h-80 sm:h-96 w-full pt-2 select-none relative ${
            activeTab === "growth" && zoomWindow
              ? isDragging
                ? "cursor-grabbing"
                : "cursor-grab"
              : ""
          }`}
        >
          {activeTab === "growth" && (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={displayData}
                margin={{ top: 10, right: 10, left: -15, bottom: 0 }}
                onClick={(e: any) => {
                  if (e && e.activePayload && e.activePayload.length > 0 && onPostClick) {
                    const post = e.activePayload[0]?.payload?.rawPost || e.activePayload[1]?.payload?.rawPost;
                    if (post) {
                      onPostClick(post);
                    }
                  }
                }}
              >
                <defs>
                  <linearGradient id="viewsGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={chartColors.viewsLine} stopOpacity={0.4} />
                    <stop offset="95%" stopColor={chartColors.viewsLine} stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} />
                <XAxis
                  dataKey="postIndex"
                  stroke={chartColors.text}
                  fontSize={10}
                  tickLine={false}
                  dy={6}
                  interval="preserveStartEnd"
                  tickFormatter={(indexVal) => {
                    const item = displayData.find((d) => d.postIndex === indexVal);
                    return item ? item.dateStr : "";
                  }}
                />
                <YAxis
                  stroke={chartColors.text}
                  fontSize={10}
                  tickLine={false}
                  tickFormatter={formatNumber}
                  dx={-4}
                />
                <Tooltip
                  content={<CustomTooltip />}
                  wrapperStyle={{ pointerEvents: "auto" }}
                  isAnimationActive={false}
                  cursor={{ stroke: chartColors.viewsLine, strokeWidth: 1, strokeDasharray: "3 3" }}
                />
                <Legend
                  verticalAlign="top"
                  align="right"
                  iconType="circle"
                  wrapperStyle={{ fontSize: "11px", paddingBottom: "12px" }}
                />

                {/* 1. 5-Post Moving Average Line rendered first (underneath post dots) */}
                <Line
                  type="monotone"
                  dataKey="movingAvgViews"
                  name={t("analytics.legendFivePostAvg")}
                  stroke={chartColors.movingAvgLine}
                  strokeWidth={2}
                  strokeDasharray="4 4"
                  dot={false}
                  style={{ pointerEvents: "none" }}
                  activeDot={(activeDotProps: any) => {
                    const { cx, cy, payload } = activeDotProps;
                    if (cx == null || cy == null || !payload) return null;
                    return (
                      <circle
                        cx={cx}
                        cy={cy}
                        r={5.5}
                        fill={chartColors.movingAvgLine}
                        stroke={isDark ? "#0F172A" : "#FFFFFF"}
                        strokeWidth={1.5}
                        className="cursor-pointer transition-all hover:scale-125"
                        style={{ cursor: "pointer", pointerEvents: "all" }}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (payload && payload.rawPost && onPostClick) {
                            onPostClick(payload.rawPost);
                          }
                        }}
                      />
                    );
                  }}
                  onClick={(e: any) => {
                    const post = e?.payload?.rawPost || e?.activePayload?.[0]?.payload?.rawPost;
                    if (post && onPostClick) {
                      onPostClick(post);
                    }
                  }}
                />

                {/* 2. Post Views Area & Interactive Nodes rendered second (on top of moving average) */}
                <Area
                  type="monotone"
                  dataKey="views"
                  name={t("analytics.legendPostViews")}
                  stroke={chartColors.viewsLine}
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#viewsGradient)"
                  dot={(dotProps: any) => {
                    const { cx, cy, payload } = dotProps;
                    if (cx == null || cy == null || !payload) return null;
                    const isPeak = payload.views > 0 && payload.views === kpis.maxPost?.views;
                    const isSignificant = payload.views > kpis.avgViews * 1.5 && payload.views > 0;
                    const r = displayData.length <= 10
                      ? (isPeak ? 8 : isSignificant ? 7 : 6)
                      : displayData.length <= 25
                      ? (isPeak ? 7 : isSignificant ? 5.5 : 4.5)
                      : displayData.length <= 60
                      ? (isPeak ? 6 : isSignificant ? 4.5 : 3.5)
                      : (isPeak ? 5 : isSignificant ? 3.5 : 2.5);
                    const fill = isPeak
                      ? "#F59E0B"
                      : payload.isForwardIn
                      ? "#10B981"
                      : isSignificant
                      ? "#38BDF8"
                      : chartColors.viewsLine;

                    return (
                      <g key={`dot-g-${payload.postIndex}`} className="cursor-pointer">
                        {/* Enlarged transparent hit target for effortless clicking (always on top) */}
                        <circle
                          cx={cx}
                          cy={cy}
                          r={Math.max(16, r * 2.4)}
                          fill="transparent"
                          className="cursor-pointer"
                          style={{ cursor: "pointer", pointerEvents: "all" }}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (payload && payload.rawPost && onPostClick) {
                              onPostClick(payload.rawPost);
                            }
                          }}
                        />
                        <circle
                          cx={cx}
                          cy={cy}
                          r={r}
                          fill={fill}
                          stroke={isDark ? "#0F172A" : "#FFFFFF"}
                          strokeWidth={isPeak ? 2.5 : 1.5}
                          className="transition-all hover:scale-125 cursor-pointer"
                          style={{ cursor: "pointer", pointerEvents: "all" }}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (payload && payload.rawPost && onPostClick) {
                              onPostClick(payload.rawPost);
                            }
                          }}
                        />
                      </g>
                    );
                  }}
                  activeDot={(activeDotProps: any) => {
                    const { cx, cy, payload } = activeDotProps;
                    if (cx == null || cy == null) return null;
                    const activeR = displayData.length <= 15 ? 9 : 7.5;
                    return (
                      <g className="cursor-pointer">
                        <circle
                          cx={cx}
                          cy={cy}
                          r={22}
                          fill="transparent"
                          className="cursor-pointer"
                          style={{ cursor: "pointer", pointerEvents: "all" }}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (payload && payload.rawPost && onPostClick) {
                              onPostClick(payload.rawPost);
                            }
                          }}
                        />
                        <circle
                          cx={cx}
                          cy={cy}
                          r={activeR}
                          stroke="#38BDF8"
                          strokeWidth={3}
                          fill={isDark ? "#0F172A" : "#FFFFFF"}
                          style={{ cursor: "pointer", pointerEvents: "all" }}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (payload && payload.rawPost && onPostClick) {
                              onPostClick(payload.rawPost);
                            }
                          }}
                        />
                      </g>
                    );
                  }}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}

          {activeTab === "forwards" && (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={displayData}
                margin={{ top: 10, right: 10, left: -15, bottom: 0 }}
                onClick={(e: any) => {
                  if (e && e.activePayload && e.activePayload[0] && onPostClick) {
                    onPostClick(e.activePayload[0].payload.rawPost);
                  }
                }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} />
                <XAxis
                  dataKey="postIndex"
                  stroke={chartColors.text}
                  fontSize={10}
                  tickLine={false}
                  dy={6}
                  interval="preserveStartEnd"
                  tickFormatter={(indexVal) => {
                    const item = displayData.find((d) => d.postIndex === indexVal);
                    return item ? item.dateStr : "";
                  }}
                />
                <YAxis
                  stroke={chartColors.text}
                  fontSize={10}
                  tickLine={false}
                  tickFormatter={formatNumber}
                  dx={-4}
                />
                <Tooltip
                  content={<CustomTooltip />}
                  wrapperStyle={{ pointerEvents: "auto" }}
                  isAnimationActive={false}
                  cursor={{ fill: isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)" }}
                />
                <Legend
                  verticalAlign="top"
                  align="right"
                  iconType="circle"
                  wrapperStyle={{ fontSize: "11px", paddingBottom: "12px" }}
                />
                <Bar
                  dataKey="views"
                  name={t("analytics.legendViewsFwdVsNative")}
                  fill={chartColors.forwardInBar}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={36}
                  style={{ cursor: "pointer" }}
                  onClick={(entry: any) => {
                    if (entry && entry.rawPost && onPostClick) {
                      onPostClick(entry.rawPost);
                    }
                  }}
                >
                  {displayData.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={entry.isForwardIn ? chartColors.forwardInBar : chartColors.nativeBar}
                    />
                  ))}
                </Bar>
                <Line
                  type="monotone"
                  dataKey="movingAvgViews"
                  name={t("analytics.legendViewsMovingAvg")}
                  stroke={chartColors.movingAvgLine}
                  strokeWidth={2}
                  strokeDasharray="4 4"
                  dot={false}
                />
              </BarChart>
            </ResponsiveContainer>
          )}

          {activeTab === "hourly" && (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={hourlyData} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} />
                <XAxis dataKey="hour" stroke={chartColors.text} fontSize={10} tickLine={false} dy={6} />
                <YAxis stroke={chartColors.text} fontSize={10} tickLine={false} dx={-4} />
                <Tooltip content={<CustomTooltip />} />
                <Legend
                  verticalAlign="top"
                  align="right"
                  iconType="circle"
                  wrapperStyle={{ fontSize: "11px", paddingBottom: "12px" }}
                />
                <Bar
                  dataKey="postsCount"
                  name={t("analytics.legendPostsPublished")}
                  fill={chartColors.hourlyBar}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={28}
                >
                  {hourlyData.map((entry, index) => (
                    <Cell
                      key={`cell-hour-${index}`}
                      fill={entry.postsCount > 0 ? chartColors.hourlyBar : "rgba(99, 102, 241, 0.2)"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* 4. Weekday Cadence Footer Strip */}
        <div className="mt-6 pt-4 border-t border-gray-150 dark:border-gray-750 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 font-bold text-gray-500 dark:text-gray-400">
            <span className="flex items-center gap-1.5">
              <span>📅 {t("analytics.dayOfWeekDensity")}</span>
              <span className="text-[10px] font-normal text-gray-400 dark:text-gray-500 font-mono">
                {t("analytics.postsCountParenthesis", { count: datasetBeforeWeekdayFilter.length })}
              </span>
            </span>
            {selectedWeekday && (
              <button
                type="button"
                onClick={() => setSelectedWeekday(null)}
                className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-sky-100 hover:bg-sky-200 dark:bg-sky-950 dark:hover:bg-sky-900 text-sky-700 dark:text-sky-300 transition-colors flex items-center gap-1 cursor-pointer"
                title={t("analytics.clearDayFilter")}
              >
                <span>{t("analytics.filterDay", { day: t(`analytics.weekdays.${selectedWeekday}` as any) || selectedWeekday })}</span>
                <span>&times;</span>
              </button>
            )}
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
            {weekdayData.map((w) => {
              const isSelected = selectedWeekday === w.day;
              const localizedDay = t(`analytics.weekdays.${w.day}` as any) || w.day;
              return (
                <button
                  type="button"
                  key={w.day}
                  onClick={() => setSelectedWeekday(isSelected ? null : w.day)}
                  className={`px-2.5 py-1.5 rounded-xl border text-[11px] font-mono flex items-center gap-1.5 transition-all cursor-pointer select-none ${
                    isSelected
                      ? "bg-sky-600 border-sky-600 text-white shadow-xs scale-105"
                      : w.postsCount > 0
                      ? w.isPeak
                        ? "bg-sky-50 dark:bg-sky-950/60 border-sky-300 dark:border-sky-800 text-sky-900 dark:text-sky-200 hover:border-sky-400"
                        : "bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
                      : "bg-transparent border-dashed border-gray-200 dark:border-gray-800 text-gray-400 opacity-60 hover:opacity-100"
                  }`}
                  title={t("analytics.dayTooltip", {
                    count: w.postsCount,
                    day: localizedDay,
                    percent: w.percentage,
                    avg: formatNumber(w.avgViews)
                  })}
                >
                  <span className="font-bold flex items-center gap-0.5">
                    <span>{localizedDay}</span>
                    {w.isPeak && w.postsCount > 0 && !isSelected && (
                      <span className="text-[9px] text-amber-500" title={t("analytics.peakActivityDay")}>⭐</span>
                    )}
                  </span>
                  <span
                    className={`tabular-nums font-black ${
                      isSelected
                        ? "text-white"
                        : w.postsCount > 0
                        ? "text-sky-600 dark:text-sky-400"
                        : "text-gray-400"
                    }`}
                  >
                    {w.postsCount}
                  </span>
                  {w.postsCount > 0 && (
                    <span
                      className={`text-[9.5px] opacity-75 font-sans ${
                        isSelected ? "text-sky-100" : "text-gray-400 dark:text-gray-500"
                      }`}
                    >
                      ({w.percentage}%)
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
