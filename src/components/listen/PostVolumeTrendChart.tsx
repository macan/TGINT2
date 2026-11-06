import React, { useMemo } from 'react';
import { createRoot, Root } from 'react-dom/client';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import { PostTrendDataPoint, PostTrendStats } from '../../utils/postTrendData';

export type TrendViewMode = 'volume' | 'views' | 'breakdown';

export interface TrendChartProps {
  dataPoints: PostTrendDataPoint[];
  stats: PostTrendStats;
  viewMode: TrendViewMode;
  isDark: boolean;
  dateRange: string;
}

const CustomChartTooltip: React.FC<any> = ({ active, payload, isDark }) => {
  if (!active || !payload || !payload.length) return null;

  const data: PostTrendDataPoint = payload[0]?.payload;
  if (!data) return null;

  const bgClass = isDark
    ? 'bg-gray-900/95 text-gray-100 border-gray-700/80 shadow-2xl'
    : 'bg-white/95 text-gray-900 border-gray-200/90 shadow-xl';

  return (
    <div
      className={`p-3.5 rounded-2xl border backdrop-blur-md text-xs min-w-[210px] pointer-events-none transition-all ${bgClass}`}
      style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}
    >
      {/* Time Header */}
      <div className="flex items-center justify-between gap-2 pb-2 mb-2 border-b border-gray-200/60 dark:border-gray-800/80">
        <span className="font-semibold text-gray-600 dark:text-gray-300 font-mono text-[11px]">
          {data.fullDateLabel || data.timeLabel}
        </span>
      </div>

      {/* Main Metric: Volume */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1.5 font-medium text-teal-700 dark:text-teal-300">
            <span className="w-2.5 h-2.5 rounded-full bg-teal-500 shrink-0 inline-block"></span>
            Total Volume
          </span>
          <span className="font-mono font-bold text-sm text-teal-600 dark:text-teal-400 tabular-nums">
            {data.volume.toLocaleString()} {data.volume === 1 ? 'post' : 'posts'}
          </span>
        </div>

        {/* Breakdown: Substantive vs Media-only */}
        <div className="grid grid-cols-2 gap-2 pt-1 pb-1 border-t border-dashed border-gray-200/50 dark:border-gray-800/60 text-[11px]">
          <div className="text-gray-500 dark:text-gray-400">
            Meaningful: <span className="font-semibold text-gray-800 dark:text-gray-200 tabular-nums">{data.substantiveVolume}</span>
          </div>
          <div className="text-gray-500 dark:text-gray-400 text-right">
            Media/Short: <span className="font-semibold text-amber-600 dark:text-amber-400 tabular-nums">{data.mediaOnlyVolume}</span>
          </div>
        </div>

        {/* Engagement */}
        <div className="flex items-center justify-between gap-2 text-[11px] text-gray-500 dark:text-gray-400 pt-1 border-t border-gray-100 dark:border-gray-800">
          <span>Total Views</span>
          <span className="font-mono font-semibold text-gray-700 dark:text-gray-300 tabular-nums">
            {data.views.toLocaleString()}
          </span>
        </div>

        {/* Top Channels */}
        {data.topChannels && data.topChannels.length > 0 && (
          <div className="pt-1.5 mt-1 border-t border-gray-100 dark:border-gray-800 text-[10px]">
            <span className="text-gray-400 dark:text-gray-500 block mb-0.5">Top Channels:</span>
            <div className="font-mono text-gray-600 dark:text-gray-300 truncate max-w-[200px]">
              {data.topChannels.join(', ')}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export const PostVolumeTrendChart: React.FC<TrendChartProps> = ({
  dataPoints,
  stats,
  viewMode = 'volume',
  isDark = false,
  dateRange
}) => {
  const tickColor = isDark ? '#9ca3af' : '#6b7280';
  const gridColor = isDark ? '#374151' : '#e5e7eb';

  // Responsive interval to avoid label collision
  const xAxisInterval = useMemo(() => {
    const len = dataPoints.length;
    if (len <= 8) return 0;
    if (len <= 16) return 1;
    if (len <= 26) return 2;
    return Math.floor(len / 8);
  }, [dataPoints.length]);

  if (!dataPoints || dataPoints.length === 0) {
    return (
      <div className="h-44 w-full flex items-center justify-center text-xs text-gray-400 dark:text-gray-500 font-mono">
        No volume trend data available
      </div>
    );
  }

  return (
    <div className="w-full h-full min-h-[220px] select-none">
      <ResponsiveContainer width="100%" height={230}>
        <AreaChart
          data={dataPoints}
          margin={{ top: 12, right: 12, left: -16, bottom: 0 }}
        >
          <defs>
            {/* Emerald/Teal Volume Gradient */}
            <linearGradient id="trendVolumeGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={isDark ? '#2dd4bf' : '#0d9488'} stopOpacity={0.35} />
              <stop offset="95%" stopColor={isDark ? '#2dd4bf' : '#0d9488'} stopOpacity={0.02} />
            </linearGradient>

            {/* Indigo Substantive Gradient */}
            <linearGradient id="trendSubstantiveGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#6366f1" stopOpacity={0.02} />
            </linearGradient>

            {/* Amber Views Gradient */}
            <linearGradient id="trendViewsGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.32} />
              <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.02} />
            </linearGradient>
          </defs>

          <CartesianGrid
            strokeDasharray="3 3"
            vertical={false}
            stroke={gridColor}
            strokeOpacity={0.6}
          />

          <XAxis
            dataKey="timeLabel"
            interval={xAxisInterval}
            tickLine={false}
            axisLine={{ stroke: gridColor, strokeOpacity: 0.8 }}
            tick={{ fill: tickColor, fontSize: 10, fontFamily: 'ui-monospace, monospace' }}
            dy={6}
          />

          <YAxis
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
            tick={{ fill: tickColor, fontSize: 10, fontFamily: 'ui-monospace, monospace' }}
            tickFormatter={(val: number) => {
              if (val >= 1000000) return `${(val / 1000000).toFixed(1)}M`;
              if (val >= 1000) return `${(val / 1000).toFixed(1)}k`;
              return String(val);
            }}
          />

          <Tooltip
            content={<CustomChartTooltip isDark={isDark} />}
            cursor={{
              stroke: isDark ? '#4b5563' : '#cbd5e1',
              strokeWidth: 1.5,
              strokeDasharray: '4 4'
            }}
          />

          {viewMode === 'volume' && (
            <Area
              type="monotone"
              dataKey="volume"
              name="Post Volume"
              stroke={isDark ? '#2dd4bf' : '#0d9488'}
              strokeWidth={2.5}
              fill="url(#trendVolumeGradient)"
              activeDot={{
                r: 5,
                strokeWidth: 2,
                stroke: isDark ? '#2dd4bf' : '#0d9488',
                fill: isDark ? '#111827' : '#ffffff'
              }}
              isAnimationActive={true}
              animationDuration={650}
            />
          )}

          {viewMode === 'views' && (
            <Area
              type="monotone"
              dataKey="views"
              name="Total Views"
              stroke="#f59e0b"
              strokeWidth={2.5}
              fill="url(#trendViewsGradient)"
              activeDot={{
                r: 5,
                strokeWidth: 2,
                stroke: '#f59e0b',
                fill: isDark ? '#111827' : '#ffffff'
              }}
              isAnimationActive={true}
              animationDuration={650}
            />
          )}

          {viewMode === 'breakdown' && (
            <>
              {/* Total Volume line */}
              <Area
                type="monotone"
                dataKey="volume"
                name="Total Posts"
                stroke={isDark ? '#2dd4bf' : '#0d9488'}
                strokeWidth={2}
                fill="url(#trendVolumeGradient)"
                activeDot={{ r: 4 }}
                isAnimationActive={true}
              />
              {/* Substantive Volume Line */}
              <Line
                type="monotone"
                dataKey="substantiveVolume"
                name="Meaningful Posts"
                stroke="#6366f1"
                strokeWidth={2}
                strokeDasharray="4 3"
                dot={false}
                activeDot={{ r: 4, stroke: '#6366f1', fill: '#ffffff' }}
                isAnimationActive={true}
              />
            </>
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};

export function mountTrendChart(
  container: HTMLElement,
  props: TrendChartProps
): { update: (newProps: TrendChartProps) => void; destroy: () => void } {
  let root: Root | null = createRoot(container);
  root.render(<PostVolumeTrendChart {...props} />);

  return {
    update(newProps: TrendChartProps) {
      if (root) {
        root.render(<PostVolumeTrendChart {...newProps} />);
      }
    },
    destroy() {
      if (root) {
        root.unmount();
        root = null;
      }
    }
  };
}
