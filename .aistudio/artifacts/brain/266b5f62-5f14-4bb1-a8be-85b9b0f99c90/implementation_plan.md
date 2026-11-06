# Performance Optimization Plan: Ultra-High Volume Post Engine (200K–500K Posts)

A high-throughput architectural overhaul targeting extreme memory efficiency, zero-jank DOM rendering, and instant responsiveness when IndexedDB caches accumulate 200,000 to 500,000+ Telegram posts.

## User Review & Critical Decisions

> [!IMPORTANT]
> The following architectural parameters were selected during the interactive interview:
> - **Optimization Scope**: Dual-target optimization covering both the main feed rendering (`PostItemView` list) and the background Hots analytics engine.
> - **Feed Architecture**: Virtualized windowing with shallow reactive state (`shallowRef` / `markRaw`) to eliminate deep Vue proxy allocation and limit live DOM nodes to only those visible in the viewport.
> - **Cache Retention Policy**: Intelligent 60-day time-window pruning per channel with a **Latest-Posts Safeguard** (retaining at least the newest 30 posts per channel so inactive channels never become blank).

---

## 1. System Bottleneck Analysis

When local storage scales to 200,000–500,000 posts, the system experiences three distinct compounding performance bottlenecks:

1. **Deep Vue Reactivity Heap Bloat (~800MB–1.5GB RAM)**:
   - Assigning large post arrays to standard Vue `ref<any[]>` causes Vue 3's reactivity engine to recursively traverse every post object, its nested `data`, `attributes`, and media arrays, creating millions of reactive `Proxy` instances.
   - This triggers frequent, lengthy Garbage Collection (GC) pauses (200ms–800ms) that freeze scrolling and user input.

2. **Monolithic IndexedDB Reads (`store.getAll()`)**:
   - `getAllCachedPostsIndexedDB()` currently reads all channels and posts into memory at once. At 500K posts, deserializing 500MB+ of structured clone data blocks the main thread for seconds and leads to out-of-memory (OOM) risks on mobile/low-memory devices.
   - Sanitizing these objects for Web Worker transfer using `JSON.parse(JSON.stringify(channels))` doubles the peak memory footprint.

3. **DOM Element Overload in Feed View**:
   - Scrolling through a channel with thousands of posts currently appends hundreds of full `PostItemView` components into the DOM tree. Each card contains avatars, badges, text parsers, reaction chips, and media previews, resulting in 10,000+ active DOM elements that degrade layout calculation and repaint performance.

---

## 2. Technical Architecture & Optimization Strategy

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Listen View & Feed UI                           │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Virtual Windowing Container (renders only 8–15 visible cards)    │  │
│  │  • Dynamic height tracking via ResizeObserver                    │  │
│  │  • Overscan buffer: 3–5 items above and below viewport           │  │
│  │  • Absolute translateY positioning with virtual spacer container │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                     Shallow Reactivity Layer                           │
│   • listenPosts: shallowRef<HotPostItem[]>                             │
│   • Raw post objects wrapped with markRaw() / Object.freeze()          │
│   • Zero recursive Proxy allocation -> Saves 75–85% Heap Memory        │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
          ┌─────────────────────────┴─────────────────────────┐
          ▼                                                   ▼
┌───────────────────────────────────┐   ┌────────────────────────────────┐
│   IndexedDB Intelligent Pruner    │   │   Streamed Hots Aggregator     │
│ • Runs during idle callback       │   │ • Cursor/batch channel reads   │
│ • Prunes posts older than 60 days │   │ • Lightweight field projection │
│ • Safeguard: Preserves latest 30  │   │   (timestamp, views, snippet)  │
│   posts per channel unconditionally│  │ • Discards raw payload early   │
└─────────────────┬─────────────────┘   └─────────────────┬──────────────┘
                  │                                       │
                  └───────────────────┬───────────────────┘
                                      ▼
┌────────────────────────────────────────────────────────────────────────┐
│                  IndexedDB: GingkoListenPostsDB                        │
│               Object Store: 'posts' (Key: nodeId)                      │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Detailed Component Plan

### Deliverable 1: Virtualized Feed Windowing (`src/components/listen/VirtualPostList.vue`)
- **Virtual Viewport Manager**:
  - Replaces flat `v-for` loops in `App.vue` (`visibleListenPosts`) with a high-performance virtualized viewport.
  - Automatically measures item heights using a lightweight `ResizeObserver` cache to support variable text lengths, media previews, and quoted replies without layout popping.
  - Calculates start/end indices based on scroll offset with an overscan margin of 4 items for seamless 60fps scrolling.
  - Provides a total height spacer so native scrollbars and scroll jumps maintain precise visual position.

### Deliverable 2: Shallow Reactivity & Memory De-bloat (`src/App.vue`)
- **Convert Deep Refs to Shallow Refs**:
  - Update `listenPosts` from `ref<any[]>([])` to `shallowRef<any[]>([])`.
  - When loading posts from IndexedDB or remote scrape batches, pass post arrays through `markRaw()` or `Object.freeze()`.
  - Mutate `listenPosts.value` by replacing the array reference (e.g., `listenPosts.value = [...updatedPosts]`), ensuring Vue re-renders instantly without creating deep reactive proxies for individual message keys.

### Deliverable 3: Lightweight Projection Streaming for Hots Mode (`src/utils/indexedDbPosts.ts` & `src/utils/hotsEngine.ts`)
- **Batch Cursor Traversal**:
  - Refactor `getAllCachedPostsIndexedDB()` to support batched/cursor streaming rather than a single monolithic `store.getAll()`.
  - Read channels iteratively in manageable chunks (e.g., 50 channels per transaction).
- **Early Projection & Payload Pruning**:
  - Filter by date range at the earliest stage: if a channel's newest post is older than the selected date range start, bypass the entire channel collection immediately.
  - Extract only the minimal fields required for hot score and topic clustering (`timestamp`, `views`, `forwards`, `replies`, `cleanSnippet`, `channelName`, `key`, `linkPreview`).
  - Drop heavy binary arrays, full text HTML, and raw protocol attributes before passing data to the background Web Worker, cutting postMessage payload size by over 80%.

### Deliverable 4: Intelligent 60-Day Cache Pruner (`src/utils/indexedDbPosts.ts`)
- **Retention Policy Rules**:
  - Cutoff timestamp: $T_{\text{cutoff}} = \text{Date.now()} - (60 \times 24 \times 60 \times 60 \times 1000)$.
  - **Latest-Post Safeguard**: Always retain the newest 30 posts for any channel, regardless of age. If a channel has $\le 30$ posts in total, or its posts are all older than 60 days, the newest 30 are preserved intact so channels never show as empty.
  - Posts beyond the newest 30 that are older than 60 days are purged during idle cycles (`requestIdleCallback`).
- **Compaction & Diagnostics**:
  - Added safe cleanup trigger after background synchronization finishes.
  - Provides a clean utility function to inspect current cache storage statistics (total posts, channel count, estimated storage footprint).

---

## 4. Verification & Benchmarking Strategy

1. **Memory & Heap Verification**:
   - Verify with Chrome DevTools Memory Profiler that opening a channel with 10,000+ posts does not cause heap spikes or long GC pauses.
   - Confirm `listenPosts` shallow reactivity holds raw objects without Vue Proxy wrapping.
2. **Scrolling Frame Rate**:
   - Verify smooth 60fps scrolling inside `VirtualPostList` with zero layout thrashing or blank flash frames.
3. **Retention Pruning Test**:
   - Verify unit test scenarios:
     - Channel with 500 posts over 90 days $\rightarrow$ Pruned to posts within 60 days (keeping $\ge 30$).
     - Inactive channel with 20 posts from 180 days ago $\rightarrow$ All 20 posts preserved (safeguard active).
4. **Compilation & Linting**:
   - Run `compile_applet` and `lint_applet` to ensure full TypeScript typing and zero regressions across existing Explorer and Listen workflows.
