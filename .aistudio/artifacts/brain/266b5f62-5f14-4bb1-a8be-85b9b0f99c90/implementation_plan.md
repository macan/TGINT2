# Listen Tab Hots Mode: Hot Topics, Posts & Channels Analytics

A high-performance intelligence dashboard integrated into the Listen tab that scans and aggregates all local posts stored in IndexedDB (`GingkoListenPostsDB`). Computes semantic topic clusters, top-performing posts by view count, and channel activity rankings across flexible time horizons (Today, Yesterday, Last 3 Days, Last Week).

## User Review & Critical Decisions

> [!IMPORTANT]
> The following product decisions were confirmed during the interactive interview:
> - **Topic Clustering & Summaries**: Hybrid client-side semantic clustering analyzing post text content, hashtags, and extracted link-preview domains/metadata with fast heuristic title synthesis and an optional server-side Gemini AI summarization trigger.
> - **Hot Channel Ranking Formula**: Multi-factor activity score blending post publishing volume ($W_{\text{vol}} = 0.4$) and aggregate engagement views/forwards ($W_{\text{eng}} = 0.6$) normalized over the selected date range.
> - **Visual Dashboard Layout**: Unified executive command center presenting Hot Topics, Hot Posts, and Hot Channels side-by-side in responsive Bento cards, each supporting 1-click drill-down to a full modal/drawer list with message jump-to links and search.

---

## 1. Overview & Core Concept

- **What It Does**: Unlocks the dormant intelligence in the background-fetched IndexedDB post cache (`GingkoListenPostsDB`). Rather than browsing channel by channel, users can switch the Listen tab to **Hots Mode** to see:
  1. **Hot Topics**: Post clusters grouped by semantic lexical patterns, common URL domains, and shared hashtags, ranked by cumulative cluster heat score.
  2. **Hot Posts**: Top messages ordered in descending order of view count (`views`) with quick previews, channel badges, and direct channel jump actions.
  3. **Hot Channels**: Most active and high-impact channels within the selected time window, ranked by publishing frequency and total impressions.
  4. **Dynamic Time Windows**: Instant client-side switching between **Today**, **Yesterday**, **Last 3 Days**, and **Last Week** (plus **All Cached Time**).
- **Target Audience / Persona**: OSINT researchers, media curators, and community managers who monitor dozens of Telegram channels and need an executive daily brief on what narrative is trending without manual message scanning.
- **Key Value**: Transforms passive background archiving into proactive situational awareness.

---

## 2. User Experience & Visual Design

- **Navigation Integration**:
  - In the Listen tab mode switcher (`listenLayoutMode`), a fourth segmented control item is added: **Hots** (`Flame` icon) alongside **View** (`Eye`), **Rearrange** (`FolderTree`), and **Flexible** (`LayoutGrid`).
- **Date Range Filter Ribbon**:
  - Compact, single-line segmented control at the top:
    - `Today` (midnight to now)
    - `Yesterday` (yesterday's 24h window)
    - `Last 3 Days` (rolling 72h)
    - `Last Week` (rolling 7d)
    - `All Time` (all cached posts)
  - Live metric count indicator showing total posts analyzed (e.g., `4,210 posts analyzed across 38 channels`).
- **Unified Executive Dashboard (3-Column / Bento Grid)**:
  - **Column 1: Hot Topics**:
    - Cards displaying cluster title, post count, total views, top keywords/domains, and a visual heat bar.
    - Clickable card header: `"View All Topics"` opening a detailed topic drawer/modal showing all member posts and full text.
  - **Column 2: Hot Posts**:
    - Cards displaying author/channel handle, post snippet, view count with tabular figures, forward counts, media badges, and date.
    - Clickable to view the full post modal and navigate directly to that message in Explorer or Listen view.
  - **Column 3: Hot Channels**:
    - Cards displaying channel name, avatar initials, recent post volume in range, total views, and activity velocity badge.
    - Clickable to select and inspect the channel in Listen directory or Explorer.
- **Full-List Modal / Drawer**:
  - Clicking any section's `"See All"` or card opens a dedicated slide-over / dialog with search filtering, sort toggles, and rich post previews.
- **Visual Styling & Dual Theme**:
  - Light mode: crisp slate borders (`border-slate-200`), clean typography, emerald/amber heat indicators.
  - Dark mode: deep obsidian surfaces (`dark:bg-gray-800`), high-contrast tabular typography, subtle borders.
  - Strict adherence to zero-pill rules for static metadata (unboxed text with `·` separators) and single-elevation containers.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Direct IndexedDB Bulk Reader (`getAllCachedPostsIndexedDB`)**
  - *Chosen Approach*: Implement a single indexed scan iterating over `GingkoListenPostsDB`'s `posts` store to extract all posts with channel identifiers in a single indexed read.
  - *Why*: Eliminates thousands of separate queries, loading hundreds of cached channels in <100ms.
  - *Alternatives Considered*: Iterating channel by channel sequentially (slow, high UI jank).

- **Decision 2: Semantic Clustering Pipeline (Local TF-IDF & URL Domain Clustering)**
  - *Chosen Approach*:
    1. Extract tokens, hashtags, and normalized link-preview URLs (`host` + canonical path).
    2. Compute pairwise Jaccard / Cosine similarity on frequent terms and shared links.
    3. Form agglomerative clusters with a minimum threshold.
    4. Generate cluster titles using key n-grams and prominent link domains.
    5. Provide an optional `"Enhance Titles with AI"` button that calls server-side Gemini (`gemini-3.8-flash`) to generate human-grade editorial headlines for the top clusters.
  - *Why*: Instant, zero-cost, works completely offline with no API key required, while allowing AI enhancement on demand.
  - *Alternatives Considered*: Requiring Gemini API for every cluster (fails offline, adds latency and token costs).

- **Decision 3: Hot Score Calculation Formulas**
  - *Hot Post Score*: $S_{\text{post}} = \text{views} + (\text{forwards} \times 5)$.
  - *Hot Topic Score*: $S_{\text{topic}} = \sum_{p \in C} S_{\text{post}} \times \log_2(|C| + 1)$.
  - *Hot Channel Activity*: $A_{\text{channel}} = (\text{postsCount} \times 100) + \sqrt{\sum \text{views}}$.

---

## 4. Technical Architecture & Data Strategy

### Component & Data Flow Diagram

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Listen Tab (src/App.vue)                        │
│   • listenLayoutMode: 'view' | 'rearrange' | 'flexible' | 'hots'       │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                         Active mode === 'hots'
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│               HotsDashboard.vue (New Dedicated Component)              │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ 1. Time Range Selector [Today | Yesterday | 3 Days | Week | All] │  │
│  │ 2. Aggregate Status Strip (Total posts, channels, last sync)     │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                   │                                    │
│       ┌───────────────────────────┼───────────────────────────┐        │
│       ▼                           ▼                           ▼        │
│ ┌───────────────┐         ┌───────────────┐         ┌───────────────┐  │
│ │  Hot Topics   │         │   Hot Posts   │         │ Hot Channels  │  │
│ │  Top 5 Cards  │         │  Top 5 Cards  │         │  Top 5 Cards  │  │
│ │  [See All ➔]  │         │  [See All ➔]  │         │  [See All ➔]  │  │
│ └───────┬───────┘         └───────┬───────┘         └───────┬───────┘  │
│         │                         │                         │          │
│         └─────────────────────────┼─────────────────────────┘          │
│                                   ▼                                    │
│             Drill-down Modal / Drawer (Full Filterable List)           │
└────────────────────────────────────────────────────────────────────────┘
                                    ▲
                                    │ Reads bulk posts
┌───────────────────────────────────┴────────────────────────────────────┐
│                    IndexedDB: GingkoListenPostsDB                      │
│             Object Store: 'posts' (Key: nodeId -> Post[])              │
└────────────────────────────────────────────────────────────────────────┘
```

### Data Structures & State Model

```typescript
export type HotsDateRange = 'today' | 'yesterday' | '3days' | 'week' | 'all';

export interface HotTopicCluster {
  id: string;
  title: string;
  aiTitle?: string;
  summary?: string;
  keywords: string[];
  domains: string[];
  posts: any[];
  postCount: number;
  totalViews: number;
  totalForwards: number;
  hotScore: number;
  channels: string[];
  timeRange: { start: number; end: number };
}

export interface HotPostItem {
  id: string | number;
  channelId: string;
  channelName: string;
  text: string;
  views: number;
  forwards: number;
  date: number;
  dateStr: string;
  url?: string;
  linkPreview?: any;
  hasMedia: boolean;
  score: number;
}

export interface HotChannelItem {
  channelId: string;
  channelName: string;
  title: string;
  avatar?: string;
  postCount: number;
  totalViews: number;
  totalForwards: number;
  avgViews: number;
  activityScore: number;
  subscribers?: number;
  latestPostTime: number;
}
```

### Planned Implementation Steps

1. **Storage Utility (`src/utils/indexedDbPosts.ts`)**:
   - Add `getAllCachedPostsIndexedDB(): Promise<{ channelId: string; posts: any[] }[]>`.
2. **Clustering & Ranking Engine (`src/utils/hotsEngine.ts`)**:
   - Implement date filtering according to the 4 user-requested ranges.
   - Implement lexical tokenization, link-domain extraction, cluster aggregation, and scoring.
   - Implement hot posts sorting by views (`DSC`) and hot channels activity sorting (`DSC`).
3. **UI Component (`src/components/listen/HotsDashboard.vue`)**:
   - Build responsive 3-column dashboard matching existing aesthetic.
   - Add date range buttons (`Today`, `Yesterday`, `Last 3 Days`, `Last Week`).
   - Implement interactive cards with hover states, tabular numbers, and modal drill-down.
   - Implement drill-down modal for full topic/post/channel exploration.
4. **Integration in `src/App.vue`**:
   - Add `'hots'` to `listenLayoutMode` type and switcher bar with `Flame` icon.
   - Render `<HotsDashboard />` when `listenLayoutMode === 'hots'`.
   - Add internationalization strings for all 6 supported locales (`en`, `zh-CN`, `zh-TW`, `es`, `ja`, `ru`).
5. **Verification & Optimization Deliverables**:
   - Run `lint_applet` (`tsc --noEmit`) and `compile_applet`.
   - **Meaningless Posts Filter Count Display**: Rendered distinct badge for filtered-out noise/media-only/short posts alongside in-range count in the top control strip and column header.
   - **Foreign Title Chinese Translation Subtitles**: Automatic detection of foreign headlines with dual Gemini and neural MT translation displaying `中译` subtitle across all topic views.
