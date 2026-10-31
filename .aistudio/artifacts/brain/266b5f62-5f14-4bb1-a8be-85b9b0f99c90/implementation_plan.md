# Recharts Channel Engagement & Activity Analytics

Architectural blueprint for introducing an interactive channel data visualization suite in the Explorer tab, leveraging a React-in-Vue bridge container to render Recharts visualizations for engagement growth, viral forwarding momentum, and 24-hour activity heat patterns.

## User Review & Critical Decisions

> [!IMPORTANT]
> The following architectural decisions were confirmed in Phase 1:
> - **Metrics Scope**: Multi-metric suite featuring post view growth trajectory, forwarding amplification ratio, and 24-hour / weekly activity rhythm patterns.
> - **Library & Framework Bridge**: A clean React micro-container bridge running Recharts inside a Vue 3 component wrapper, leveraging the already-installed React 19 runtime with seamless light/dark theme synchronization.
> - **Placement & Experience**: Integrated directly into the Explorer tab view mode ribbon (`list`, `masonry`, `timeline`, `reader`, and new `analytics` mode) with prominent channel-level KPI summaries.

---

## 1. Overview & Core Concept

- **What It Does**: Provides deep visual intelligence for any public Telegram channel explored in the app. Analyzes the active post stream to calculate and display:
  1. **Engagement & Views Trajectory**: Time-series Area & Line curves showing individual post view counts, cumulative reach, and rolling 5-post moving averages.
  2. **Forward Amplification Momentum**: Stacked bar / compose charts illustrating which posts achieved viral outbound reach via forwards relative to raw impressions.
  3. **Activity Rhythms & Heat Patterns**: 24-hour hourly posting distribution and day-of-week posting density to reveal the channel's operational cadence.
  4. **Executive Metric Tiles**: High-level KPI indicators for Average Views per Post, Forward Velocity Rate, Peak Posting Hour, and Most Engaging Post.
- **Target Audience / Persona**: Channel managers, OSINT researchers, media analysts, and community curators tracking channel reach and posting habits.
- **Key Value**: Replaces raw message parsing with instant visual clarity on whether a channel is accelerating in reach, experiencing bot/inconsistent spikes, or operating on a predictable publishing schedule.

---

## 2. User Experience & Visual Design

- **Key User Flows**:
  1. User explores any Telegram channel handle (e.g. `@durov`, `@telegram`) in the Explorer tab.
  2. In the feed header controls ribbon, a new **Analytics** button (`BarChart3` icon) appears alongside List, Grid, Timeline, and Article modes.
  3. Clicking **Analytics** transitions into the dedicated Recharts analytics dashboard.
  4. The user can toggle metric scopes (e.g., Views Growth, Forward Momentum, Hourly Activity), hover over data points to inspect post preview cards with timestamps, and click data points to jump directly to the specific message.
- **Visual Identity & Theme**:
  - Fully supports the app's dual-theme palette: clean slate/white in light mode (`#0F172A`, `#F8FAFC`, `#0284C7`) and deep obsidian/slate in dark mode (`#030712`, `#1E293B`, `#38BDF8`).
  - Strict compliance with `frontend-design` rules: no pill capsules for static metrics, tabular numerals (`tabular-nums`) for all numbers and percentages, responsive container height without vertical layout overflow.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: React-in-Vue Micro-Bridge (`ChannelAnalyticsWrapper.vue`)**
  - *Chosen Approach*: Create a dedicated Vue wrapper that mounts a React root via `ReactDOM.createRoot(containerRef)` to render the pure React `ChannelEngagementDashboard` component with Recharts.
  - *Why*: Satisfies the explicit requirement for Recharts while maintaining the Vue 3 application architecture cleanly without polluting global state.
  - *Alternatives Considered*: Custom SVG / Chart.js (does not leverage Recharts declarative API).

- **Decision 2: Asynchronous Lazy Loading for the Recharts Chunk**
  - *Chosen Approach*: Split Recharts and its React bridge into an isolated async chunk (`defineAsyncComponent`), loaded on-demand when the user clicks the Analytics tab or during idle preload.
  - *Why*: Prevents adding to the initial bundle, preserving the recently optimized <1.5s Largest Contentful Paint (LCP).
  - *Alternatives Considered*: Static bundle inclusion (would increase initial payload).

- **Decision 3: Client-Side Post Stream Metric Aggregation**
  - *Chosen Approach*: Derive all statistics dynamically from the loaded `posts` collection in memory (date timestamps, `views`, `forwards`, and media types).
  - *Why*: Requires zero additional backend endpoints, works completely offline/cached, and updates reactively whenever the user loads more channel posts or scrapes fresh batches.

---

## 4. Technical Architecture & Data Strategy

### Component & Data Flow Diagram

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Explorer Tab (App.vue)                          │
│   • viewMode: 'list' | 'masonry' | 'timeline' | 'reader' | 'analytics' │
│   • activeChannel / metadata / posts data stream                       │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ (active posts & dark mode prop)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│              ChannelAnalyticsWrapper.vue (Async Component)              │
│   • Vue lifecycle: onMounted / watch / onUnmounted                     │
│   • ReactDOM.createRoot(mountPoint) & root.render()                    │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ (React Props)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│            ChannelEngagementDashboard.tsx (React + Recharts)           │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │ 1. Executive Summary Cards (Avg Views, Fwd Rate, Peak Hour)    │   │
│   ├────────────────────────────────────────────────────────────────┤   │
│   │ 2. AreaChart: Chronological Views & 5-Post Moving Average      │   │
│   ├────────────────────────────────────────────────────────────────┤   │
│   │ 3. BarChart: Outbound Forwards & Amplification Momentum        │   │
│   ├────────────────────────────────────────────────────────────────┤   │
│   │ 4. BarChart: 24-Hour Publishing Distribution (00:00 - 23:00)   │   │
│   └────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────┘
```

### Data Aggregation Schema

```typescript
export interface EngagementDataPoint {
  id: string | number;
  dateStr: string;
  timestamp: number;
  views: number;
  forwards: number;
  movingAvgViews: number;
  engagementRatio: number; // (forwards / views) * 100
  snippet: string;
  hasMedia: boolean;
}

export interface HourlyActivityPoint {
  hour: string; // "00:00", "01:00", ... "23:00"
  postsCount: number;
  avgViews: number;
}
```

### Step-by-Step Implementation Sequence

1. **Dependency Installation**:
   - Install `recharts` package via `install_applet_package`.
2. **React Dashboard Component (`src/components/analytics/ChannelEngagementDashboard.tsx`)**:
   - Build pure React component with Recharts `ResponsiveContainer`, `AreaChart`, `BarChart`, `XAxis`, `YAxis`, `Tooltip`, `Legend`, and custom dark-mode tooltips.
3. **Vue Micro-Bridge (`src/components/ChannelAnalyticsWrapper.vue`)**:
   - Create Vue 3 component using `defineAsyncComponent`, mounting the React component into a clean responsive container.
4. **Explorer Integration (`src/App.vue`)**:
   - Add `analytics` mode to `viewMode` toggle buttons.
   - Render `<ChannelAnalyticsWrapper :posts="posts" :is-dark="isDark" :channel-name="channelName" />` when `viewMode === 'analytics'`.
   - Add i18n localization keys across languages (`explorer.analyticsView`).
5. **Rollup Manual Chunk Configuration (`vite.config.ts`)**:
   - Assign `recharts` to `vendor-recharts` so it loads on-demand without affecting the entry bundle.
6. **Verification & Build**:
   - Run `lint_applet` and `compile_applet` to verify compilation and clean bundle distribution.
