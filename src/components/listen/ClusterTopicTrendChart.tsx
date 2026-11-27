import React, { useMemo } from 'react';
import { createRoot, Root } from 'react-dom/client';
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import type {
  ClusterTopicTrendPoint,
  ClusterTrendDisplayMode,
} from '../../utils/clusterTopicTrendData';

export interface ClusterTopicTrendChartProps {
  dataPoints: ClusterTopicTrendPoint[];
  displayMode: ClusterTrendDisplayMode;
  showPosts: boolean;
  showViews: boolean;
  isDark: boolean;
  labels?: {
    posts: string;
    views: string;
    cumulativePosts: string;
    cumulativeViews: string;
    channels: string;
    noData: string;
  };
}

function formatCompactAxis(val: number): string {
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `${(val / 1_000).toFixed(val >= 10_000 ? 0 : 1)}k`;
  return String(val);
}

const ClusterTrendTooltip: React.FC<any> = ({
  active,
  payload,
  isDark,
  displayMode,
  labels,
}) => {
  if (!active || !payload || !payload.length) return null;

  const data: ClusterTopicTrendPoint | undefined = payload[0]?.payload;
  if (!data) return null;

  const bgClass = isDark
    ? 'bg-gray-950/96 text-gray-100 border-gray-700/90 shadow-2xl'
    : 'bg-white/97 text-gray-900 border-gray-200/90 shadow-xl';

  const postsLabel = labels?.posts || 'Posts';
  const viewsLabel = labels?.views || 'Views';
  const channelsLabel = labels?.channels || 'Channels';

  return (
    <div
      className={`p-3.5 rounded-2xl border backdrop-blur-md text-xs w-[270px] pointer-events-none ${bgClass}`}
      style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}
    >
      <div className="pb-2 mb-2 border-b border-gray-200/70 dark:border-gray-800 font-mono text-[11px] font-semibold text-gray-600 dark:text-gray-300 tabular-nums">
        {data.fullDateLabel || data.timeLabel}
      </div>

      <div className="space-y-1.5 font-mono tabular-nums">
        {/* Posts metric */}
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 font-sans font-semibold text-teal-700 dark:text-teal-300">
            <span className="w-2.5 h-2.5 rounded-[3px] bg-teal-500 shrink-0 inline-block" />
            {displayMode === 'cumulative'
              ? labels?.cumulativePosts || 'Cumulative Posts'
              : postsLabel}
          </span>
          <span className="font-bold text-teal-600 dark:text-teal-400">
            {displayMode === 'cumulative'
              ? `${data.cumulativePosts.toLocaleString()} (+${data.posts})`
              : data.posts.toLocaleString()}
          </span>
        </div>

        {/* Views metric */}
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 font-sans font-semibold text-amber-700 dark:text-amber-300">
            <span className="w-2.5 h-0.5 rounded-full bg-amber-500 shrink-0 inline-block" />
            {displayMode === 'cumulative'
              ? labels?.cumulativeViews || 'Cumulative Views'
              : viewsLabel}
          </span>
          <span className="font-bold text-amber-600 dark:text-amber-400">
            {displayMode === 'cumulative'
              ? `${data.cumulativeViews.toLocaleString()} (+${formatCompactAxis(data.views)})`
              : data.views.toLocaleString()}
          </span>
        </div>

        {/* Active channels */}
        <div className="flex items-center justify-between gap-2 text-[11px] text-gray-500 dark:text-gray-400 pt-1 border-t border-dashed border-gray-200/70 dark:border-gray-800">
          <span className="font-sans">{channelsLabel}</span>
          <span className="font-semibold text-gray-700 dark:text-gray-200">
            {data.channelCount}
          </span>
        </div>
      </div>

      {/* Top sample posts in this time slot */}
      {data.samplePosts && data.samplePosts.length > 0 && (
        <div className="mt-2 pt-2 border-t border-gray-200/70 dark:border-gray-800 space-y-1.5">
          {data.samplePosts.slice(0, 2).map((sp) => (
            <div key={sp.id} className="text-[11px] leading-snug text-gray-600 dark:text-gray-300">
              <span className="font-semibold text-teal-700 dark:text-teal-300">
                {sp.channelName}:
              </span>{' '}
              <span className="line-clamp-2">{sp.snippet}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export const ClusterTopicTrendChart: React.FC<ClusterTopicTrendChartProps> = ({
  dataPoints,
  displayMode,
  showPosts,
  showViews,
  isDark,
  labels,
}) => {
  const tickColor = isDark ? '#9ca3af' : '#6b7280';
  const gridColor = isDark ? '#374151' : '#e5e7eb';
  const postsColor = isDark ? '#2dd4bf' : '#0d9488';
  const viewsColor = isDark ? '#fbbf24' : '#d97706';

  const xAxisInterval = useMemo(() => {
    const len = dataPoints.length;
    if (len <= 9) return 0;
    if (len <= 18) return 1;
    if (len <= 28) return 2;
    return Math.floor(len / 9);
  }, [dataPoints.length]);

  if (!dataPoints || dataPoints.length === 0) {
    return (
      <div className="h-[220px] w-full flex items-center justify-center text-xs text-gray-400 dark:text-gray-500 font-mono">
        {labels?.noData || 'No timeline data available for this cluster'}
      </div>
    );
  }

  const postsDataKey = displayMode === 'cumulative' ? 'cumulativePosts' : 'posts';
  const viewsDataKey = displayMode === 'cumulative' ? 'cumulativeViews' : 'views';

  return (
    <div className="w-full h-[230px] select-none">
      <ResponsiveContainer width="100%" height={230} minWidth={120} debounce={50}>
        <ComposedChart
          data={dataPoints}
          margin={{ top: 10, right: 10, left: -8, bottom: 0 }}
        >
          <defs>
            <linearGradient id="clusterPostsAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={postsColor} stopOpacity={0.34} />
              <stop offset="95%" stopColor={postsColor} stopOpacity={0.03} />
            </linearGradient>
            <linearGradient id="clusterViewsAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={viewsColor} stopOpacity={0.28} />
              <stop offset="95%" stopColor={viewsColor} stopOpacity={0.02} />
            </linearGradient>
          </defs>

          <CartesianGrid
            strokeDasharray="3 3"
            vertical={false}
            stroke={gridColor}
            strokeOpacity={0.55}
          />

          <XAxis
            dataKey="timeLabel"
            interval={xAxisInterval}
            tickLine={false}
            axisLine={{ stroke: gridColor, strokeOpacity: 0.75 }}
            tick={{
              fill: tickColor,
              fontSize: 10,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            }}
            dy={6}
          />

          {/* Left Y-Axis: Posts Trend */}
          <YAxis
            yAxisId="posts"
            orientation="left"
            hide={!showPosts}
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
            width={36}
            tick={{
              fill: postsColor,
              fontSize: 10,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            }}
            tickFormatter={(val: number) => formatCompactAxis(val)}
          />

          {/* Right Y-Axis: Views Trend */}
          <YAxis
            yAxisId="views"
            orientation="right"
            hide={!showViews}
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
            width={44}
            tick={{
              fill: viewsColor,
              fontSize: 10,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            }}
            tickFormatter={(val: number) => formatCompactAxis(val)}
          />

          <Tooltip
            content={
              <ClusterTrendTooltip
                isDark={isDark}
                displayMode={displayMode}
                labels={labels}
              />
            }
            cursor={{
              stroke: isDark ? '#4b5563' : '#cbd5e1',
              strokeWidth: 1.5,
              strokeDasharray: '4 4',
            }}
          />

          {/* Interval Mode: Distinct Teal Bars (Posts) + Smooth Amber Area/Line (Views) */}
          {displayMode === 'interval' && showPosts && (
            <Bar
              yAxisId="posts"
              dataKey={postsDataKey}
              name={labels?.posts || 'Posts'}
              fill={postsColor}
              fillOpacity={isDark ? 0.62 : 0.55}
              stroke={postsColor}
              strokeWidth={1}
              radius={[4, 4, 0, 0]}
              maxBarSize={26}
              isAnimationActive={true}
              animationDuration={450}
            />
          )}

          {displayMode === 'interval' && showViews && (
            <Area
              yAxisId="views"
              type="monotone"
              dataKey={viewsDataKey}
              name={labels?.views || 'Views'}
              stroke={viewsColor}
              strokeWidth={2.5}
              fill="url(#clusterViewsAreaGrad)"
              dot={
                dataPoints.length <= 18
                  ? {
                      r: 3,
                      strokeWidth: 1.5,
                      stroke: viewsColor,
                      fill: isDark ? '#111827' : '#ffffff',
                    }
                  : false
              }
              activeDot={{
                r: 5,
                strokeWidth: 2,
                stroke: viewsColor,
                fill: isDark ? '#111827' : '#ffffff',
              }}
              isAnimationActive={true}
              animationDuration={500}
            />
          )}

          {/* Cumulative Mode: Teal Filled Area (Cumulative Posts) + Amber Line (Cumulative Views) */}
          {displayMode === 'cumulative' && showPosts && (
            <Area
              yAxisId="posts"
              type="monotone"
              dataKey={postsDataKey}
              name={labels?.cumulativePosts || 'Cumulative Posts'}
              stroke={postsColor}
              strokeWidth={2.25}
              fill="url(#clusterPostsAreaGrad)"
              activeDot={{
                r: 4.5,
                strokeWidth: 2,
                stroke: postsColor,
                fill: isDark ? '#111827' : '#ffffff',
              }}
              isAnimationActive={true}
              animationDuration={450}
            />
          )}

          {displayMode === 'cumulative' && showViews && (
            <Line
              yAxisId="views"
              type="monotone"
              dataKey={viewsDataKey}
              name={labels?.cumulativeViews || 'Cumulative Views'}
              stroke={viewsColor}
              strokeWidth={2.5}
              dot={
                dataPoints.length <= 18
                  ? {
                      r: 2.5,
                      strokeWidth: 1.5,
                      stroke: viewsColor,
                      fill: isDark ? '#111827' : '#ffffff',
                    }
                  : false
              }
              activeDot={{
                r: 5,
                strokeWidth: 2,
                stroke: viewsColor,
                fill: isDark ? '#111827' : '#ffffff',
              }}
              isAnimationActive={true}
              animationDuration={500}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
};

export function mountClusterTopicTrendChart(
  container: HTMLElement,
  props: ClusterTopicTrendChartProps
): { update: (newProps: ClusterTopicTrendChartProps) => void; destroy: () => void } {
  let root: Root | null = createRoot(container);
  root.render(<ClusterTopicTrendChart {...props} />);

  return {
    update(newProps: ClusterTopicTrendChartProps) {
      if (root) {
        root.render(<ClusterTopicTrendChart {...newProps} />);
      }
    },
    destroy() {
      if (root) {
        root.unmount();
        root = null;
      }
    },
  };
}
