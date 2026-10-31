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

export interface PostItem {
  _index?: number;
  id?: string | number;
  key?: string;
  url?: string;
  link?: string;
  data?: {
    date?: string;
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

export interface ChannelEngagementDashboardProps {
  posts: PostItem[];
  channelName: string;
  isDark?: boolean;
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
  isDark = false,
  onPostClick,
  onExploreChannel
}) => {
  const [timeRange, setTimeRange] = useState<"all" | "20" | "50">("all");
  const [activeTab, setActiveTab] = useState<"growth" | "forwards" | "hourly">("growth");
  const [selectedForwardSource, setSelectedForwardSource] = useState<string | null>(null);

  // Format numbers compactly (e.g. 1.2k, 450k, 1.5M)
  const formatNumber = (num: number): string => {
    if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + "M";
    if (num >= 1_000) return (num / 1_000).toFixed(1) + "k";
    return num.toLocaleString();
  };

  // Process & chronologically sort post points
  const processedData = useMemo(() => {
    if (!posts || posts.length === 0) return [];

    // Filter valid posts that have dates
    const valid = posts
      .filter((p) => p && p.data && p.data.date)
      .map((p) => {
        const d = new Date(p.data?.date || 0);
        const views = typeof p.data?.views === "number" ? p.data.views : 0;
        const rawContent = p.data?.content || p.data?.rawcontent || "";
        const cleanSnippet = rawContent.replace(/<[^>]*>/g, " ").trim().slice(0, 100);

        const fwdDetails = extractForwardDetails(p.data);

        return {
          rawPost: p,
          timestamp: d.getTime(),
          dateObj: d,
          dateStr: !isNaN(d.getTime())
            ? d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
            : "Unknown",
          timeStr: !isNaN(d.getTime())
            ? d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
            : "",
          fullDate: !isNaN(d.getTime()) ? d.toLocaleString() : "",
          hour: !isNaN(d.getTime()) ? d.getHours() : 0,
          weekday: !isNaN(d.getTime()) ? d.toLocaleDateString(undefined, { weekday: "short" }) : "",
          views,
          isForwardIn: fwdDetails.isForwardIn,
          forwardSource: fwdDetails.source,
          forwardUsername: fwdDetails.username,
          forwardUrl: fwdDetails.url,
          snippet: cleanSnippet
        };
      })
      .filter((p) => !isNaN(p.timestamp));

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
  }, [posts]);

  // Zoom state: window indices in the filtered dataset
  const [zoomWindow, setZoomWindow] = useState<{ start: number; end: number } | null>(null);
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const dragStartXRef = useRef(0);
  const dragStartWindowRef = useRef<{ start: number; end: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Base filtered dataset before zoom
  const baseData = useMemo(() => {
    let dataset = processedData;
    if (selectedForwardSource) {
      dataset = dataset.filter((p) => p.forwardSource === selectedForwardSource);
    }
    if (timeRange === "20") return dataset.slice(-20);
    if (timeRange === "50") return dataset.slice(-50);
    return dataset;
  }, [processedData, timeRange, selectedForwardSource]);

  // Sliced data based on active zoom window
  const displayData = useMemo(() => {
    if (!zoomWindow || baseData.length <= 5) return baseData;
    const start = Math.max(0, Math.min(zoomWindow.start, baseData.length - 2));
    const end = Math.min(baseData.length - 1, Math.max(zoomWindow.end, start + 1));
    return baseData.slice(start, end + 1);
  }, [baseData, zoomWindow]);

  // Reset zoom window whenever tab, timeRange, channel, or upstream filter changes
  useEffect(() => {
    setZoomWindow(null);
  }, [activeTab, timeRange, selectedForwardSource, channelName]);

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

    const topSource = topSources[0] ? `${topSources[0].name} (${topSources[0].count})` : "100% Native";
    const topSourceFull = topSources[0]
      ? `${topSources[0].name} (${topSources[0].count} posts, avg ${formatNumber(topSources[0].avgViews)} views)`
      : "No forwarded-in messages detected";

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
  }, [processedData]);

  // Aggregate 24-hour distribution pattern
  const hourlyData = useMemo(() => {
    const hours = Array.from({ length: 24 }, (_, i) => ({
      hour: `${String(i).padStart(2, "0")}:00`,
      postsCount: 0,
      totalViews: 0,
      avgViews: 0
    }));

    for (const p of processedData) {
      if (p.hour >= 0 && p.hour < 24) {
        hours[p.hour].postsCount += 1;
        hours[p.hour].totalViews += p.views;
      }
    }

    return hours.map((h) => ({
      ...h,
      avgViews: h.postsCount > 0 ? Math.round(h.totalViews / h.postsCount) : 0
    }));
  }, [processedData]);

  // Aggregate Day-of-Week cadence
  const weekdayData = useMemo(() => {
    const daysOrder = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const counts: Record<string, { posts: number; totalViews: number }> = {
      Mon: { posts: 0, totalViews: 0 },
      Tue: { posts: 0, totalViews: 0 },
      Wed: { posts: 0, totalViews: 0 },
      Thu: { posts: 0, totalViews: 0 },
      Fri: { posts: 0, totalViews: 0 },
      Sat: { posts: 0, totalViews: 0 },
      Sun: { posts: 0, totalViews: 0 }
    };

    for (const p of processedData) {
      if (p.weekday && counts[p.weekday]) {
        counts[p.weekday].posts += 1;
        counts[p.weekday].totalViews += p.views;
      }
    }

    return daysOrder.map((day) => ({
      day,
      postsCount: counts[day].posts,
      avgViews: counts[day].posts > 0 ? Math.round(counts[day].totalViews / counts[day].posts) : 0
    }));
  }, [processedData]);

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
              Post #{data?.postIndex || label}
            </span>
            {data?.views > 0 && data?.views === kpis.maxPost?.views && (
              <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-500 text-[9px] font-bold">
                Peak 🏆
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
                <span>📥 Forward from:</span>
                <span className="font-mono">{data.forwardSource || "External Channel"}</span>
              </div>
            ) : (
              <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700">
                <span>📝 Original Native Post</span>
              </div>
            )}
          </div>
        )}

        <div className="space-y-1.5 font-mono text-[11px]">
          {data?.views !== undefined && (
            <div className="flex items-center justify-between gap-4">
              <span className="text-stone-500 dark:text-stone-400">Views:</span>
              <span className="font-bold text-sky-600 dark:text-sky-400 tabular-nums">
                {data.views.toLocaleString()}
              </span>
            </div>
          )}
          {data?.movingAvgViews !== undefined && (
            <div className="flex items-center justify-between gap-4">
              <span className="text-stone-500 dark:text-stone-400">5-Post Avg:</span>
              <span className="font-bold text-amber-600 dark:text-amber-400 tabular-nums">
                {data.movingAvgViews.toLocaleString()}
              </span>
            </div>
          )}
          {data?.postsCount !== undefined && (
            <div className="flex items-center justify-between gap-4">
              <span className="text-stone-500 dark:text-stone-400">Posts Published:</span>
              <span className="font-bold text-indigo-600 dark:text-indigo-400 tabular-nums">
                {data.postsCount}
              </span>
            </div>
          )}
          {data?.avgViews !== undefined && (
            <div className="flex items-center justify-between gap-4">
              <span className="text-stone-500 dark:text-stone-400">Avg Views / Post:</span>
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
              Post details
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
              <span>View post</span>
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
          No Engagement Metrics Available Yet
        </h4>
        <p className="text-xs text-gray-500 dark:text-gray-400 max-w-sm mx-auto">
          Explore or scrape posts for <span className="font-mono text-blue-500">@{channelName}</span> to populate views growth, forward-in analysis, and hourly publishing cadence.
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
            <span>Avg Views / Post</span>
            <span className="text-sky-500 text-xs font-mono">👁️</span>
          </span>
          <div className="mt-2">
            <span className="text-2xl font-black text-gray-900 dark:text-white tabular-nums tracking-tight">
              {formatNumber(kpis.avgViews)}
            </span>
            <div className="text-[10px] text-gray-400 dark:text-gray-500 font-mono mt-0.5">
              {formatNumber(kpis.totalViews)} total impressions
            </div>
          </div>
        </div>

        {/* Metric 2: Forward-In Content Ratio */}
        <div className="p-4 rounded-2xl bg-white dark:bg-gray-800 border border-gray-200/80 dark:border-gray-700/80 shadow-xs flex flex-col justify-between">
          <span className="text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center justify-between">
            <span>Forward-In Ratio</span>
            <span className="text-emerald-500 text-xs font-mono">📥</span>
          </span>
          <div className="mt-2">
            <span className="text-2xl font-black text-emerald-600 dark:text-emerald-400 tabular-nums tracking-tight">
              {kpis.forwardInRatio}%
            </span>
            <div className="text-[10px] text-gray-400 dark:text-gray-500 font-mono mt-0.5">
              {kpis.forwardInCount} forwarded · {kpis.nativeCount} original
            </div>
          </div>
        </div>

        {/* Metric 3: Top Upstream Source */}
        <div className="p-4 rounded-2xl bg-white dark:bg-gray-800 border border-gray-200/80 dark:border-gray-700/80 shadow-xs flex flex-col justify-between">
          <span className="text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center justify-between">
            <span>Top Forward Source</span>
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
              {kpis.uniqueSourcesCount > 0
                ? `${kpis.uniqueSourcesCount} upstream channel${kpis.uniqueSourcesCount > 1 ? "s" : ""} detected`
                : "All messages created natively"}
            </div>
          </div>
        </div>

        {/* Metric 4: Forwarded vs Native Views */}
        <div className="p-4 rounded-2xl bg-white dark:bg-gray-800 border border-gray-200/80 dark:border-gray-700/80 shadow-xs flex flex-col justify-between">
          <span className="text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center justify-between">
            <span>Fwd vs Native Views</span>
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
                ? "No forwarded posts"
                : kpis.forwardInAvgViews >= kpis.nativeAvgViews
                ? "Forwarded content performs higher"
                : "Native content performs higher"}
            </div>
          </div>
        </div>
      </div>

      {/* 2. Interactive Chart Canvas Card */}
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
                {activeTab === "growth" && "Chronological Views & Momentum Trajectory"}
                {activeTab === "forwards" && "Forwarded-In Content Distribution & Upstream Sources"}
                {activeTab === "hourly" && "24-Hour Publishing Activity Rhythm"}
              </h3>
              <p className="text-[11px] text-gray-400 dark:text-gray-500 font-mono">
                {activeTab === "growth" && `Showing post views alongside 5-post rolling average for @${channelName}`}
                {activeTab === "forwards" && `Inflow analysis of messages forwarded into @${channelName} from upstream channels`}
                {activeTab === "hourly" && `Posting frequency and engagement by time of day (00:00 - 23:00)`}
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
                Views Growth
              </button>
              <button
                onClick={() => setActiveTab("forwards")}
                className={`px-3 py-1.5 rounded-lg font-bold transition cursor-pointer flex items-center gap-1.5 ${
                  activeTab === "forwards"
                    ? "bg-white dark:bg-gray-800 text-emerald-600 dark:text-emerald-400 shadow-xs"
                    : "text-gray-500 hover:text-gray-900 dark:hover:text-white"
                }`}
              >
                <span>Forward In</span>
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
                24H Rhythms
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
                  All ({processedData.length})
                </button>
                <button
                  onClick={() => setTimeRange("50")}
                  className={`px-2.5 py-1 rounded-lg font-bold transition cursor-pointer ${
                    timeRange === "50"
                      ? "bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-xs"
                      : "text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                  }`}
                >
                  Last 50
                </button>
                <button
                  onClick={() => setTimeRange("20")}
                  className={`px-2.5 py-1 rounded-lg font-bold transition cursor-pointer ${
                    timeRange === "20"
                      ? "bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-xs"
                      : "text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                  }`}
                >
                  Last 20
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
                  <span>📥 Forwarded In:</span>
                  <span>{kpis.forwardInCount} posts ({kpis.forwardInRatio}%)</span>
                </span>
                <span className="text-gray-500 dark:text-gray-400 flex items-center gap-1">
                  <span>📝 Native:</span>
                  <span>{kpis.nativeCount} posts ({(100 - Number(kpis.forwardInRatio)).toFixed(1)}%)</span>
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
                  Upstream Sources:
                </span>
                {selectedForwardSource && (
                  <button
                    onClick={() => setSelectedForwardSource(null)}
                    className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-300 transition-colors flex items-center gap-1 cursor-pointer"
                  >
                    <span>Show All Sources</span>
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
                      title={`${src.count} posts from ${src.name} (Avg ${formatNumber(src.avgViews)} views)`}
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
                    <>
                      Zoom: <strong className="font-bold text-sky-800 dark:text-sky-200">{displayData.length}</strong> of {baseData.length} posts ({Math.round((displayData.length / baseData.length) * 100)}%)
                    </>
                  ) : (
                    <>Showing all <strong>{baseData.length}</strong> posts · Scroll inside chart to zoom</>
                  )}
                </span>
              </span>
              {zoomWindow && (
                <span className="text-[11px] text-gray-500 dark:text-gray-400 hidden sm:inline">
                  Drag chart to pan · Click any node to view post
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleZoomIn}
                className="w-7 h-7 rounded-lg bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm font-bold flex items-center justify-center transition-all cursor-pointer border border-gray-200 dark:border-gray-700 shadow-2xs"
                title="Zoom in (or mouse wheel up)"
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
                title="Zoom out (or mouse wheel down)"
              >
                −
              </button>
              {zoomWindow && (
                <button
                  type="button"
                  onClick={() => setZoomWindow(null)}
                  className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-sky-600 hover:bg-sky-500 text-white shadow-xs transition-all cursor-pointer flex items-center gap-1 ml-0.5"
                  title="Reset zoom to view all posts"
                >
                  <span>Reset</span>
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
                  if (e && e.activePayload && e.activePayload[0] && onPostClick) {
                    onPostClick(e.activePayload[0].payload.rawPost);
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
                <Area
                  type="monotone"
                  dataKey="views"
                  name="Post Views"
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
                        {/* Enlarged transparent hit target for effortless clicking */}
                        <circle
                          cx={cx}
                          cy={cy}
                          r={Math.max(14, r * 2.2)}
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
                          r={20}
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
                <Line
                  type="monotone"
                  dataKey="movingAvgViews"
                  name="5-Post Moving Avg"
                  stroke={chartColors.movingAvgLine}
                  strokeWidth={2}
                  strokeDasharray="4 4"
                  dot={false}
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
                  name="Views (Forwarded vs Native)"
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
                  name="Views Moving Avg"
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
                  name="Posts Published"
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
          <div className="flex items-center gap-1.5 font-bold text-gray-500 dark:text-gray-400">
            <span>📅 Day of Week Density:</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {weekdayData.map((w) => (
              <div
                key={w.day}
                className={`px-2.5 py-1 rounded-xl border text-[11px] font-mono flex items-center gap-1.5 transition-colors ${
                  w.postsCount > 0
                    ? "bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-800 dark:text-gray-200"
                    : "bg-transparent border-dashed border-gray-200 dark:border-gray-800 text-gray-400 opacity-60"
                }`}
                title={`${w.postsCount} posts on ${w.day} (Avg ${formatNumber(w.avgViews)} views)`}
              >
                <span className="font-bold">{w.day}</span>
                <span className="tabular-nums font-black text-sky-600 dark:text-sky-400">
                  {w.postsCount}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
