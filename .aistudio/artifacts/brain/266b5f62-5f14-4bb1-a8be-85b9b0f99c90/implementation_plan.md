# Instant Directory Freshness Engine (O(1) Indexed Metadata & Tiered Real-Time Tags)

A high-performance metadata architecture and live UI badge system that displays immediate, accurate freshness tags for all Listen Directory items on initial load without requiring item clicks or expensive B-tree scans over 100K–1M+ posts.

## User Review & Critical Decisions

> [!IMPORTANT]
> The following architectural parameters were selected during the interactive interview:
> - **Storage Strategy**: Dedicated IndexedDB metadata store (`listen_freshness_meta`) for instant O(1) bulk freshness lookups across all directory items.
> - **Calculation & Refresh Timing**: Proactive instant load on mount with background incremental refresh on writes/syncs.
> - **Display Styling**: Tiered color badge with live relative time (e.g. "12m ago", "2h ago", "1d ago") and tabular typography.

---

## 1. Overview & Core Concept

### What It Does
Currently, items in the Listen Directory only update their freshness tags when a user actively clicks on an item or when the background fetcher processes it. If a user tracks dozens or hundreds of channels, unopened items either remain blank or trigger scattered, individual queries that degrade performance on large datasets.

This feature establishes an **instant O(1) freshness pipeline**:
1. Upgrades `GingkoListenPostsDB` to version 4 with a dedicated `listen_freshness_meta` object store.
2. Performs a single, lightning-fast bulk read (`store.getAll()`) on app mount to populate the directory's freshness map in < 2ms.
3. Automatically updates `listen_freshness_meta` whenever posts are written or synced, guaranteeing that freshness tags remain permanently in sync without scanning the `posts` store.
4. Renders tiered status badges with tabular relative time stamps that tick live every minute.

### Key Value
- **Zero-Click Freshness**: Users immediately see which channels have new activity the moment they open the app.
- **Sub-2ms Cold Start**: Replaces $N$ separate index seeks with a single bulk metadata read.
- **Zero Main-Thread Lock**: No scanning or deserializing post bodies from the 100K–1M post store.

---

## 2. User Experience & Visual Design

### Key User Flows
1. **App Mount / Listen Tab Open**:
   - The Listen Directory renders instantly with cached freshness data from `localStorage` (0ms).
   - In parallel, `getAllListenFreshnessMetaIndexedDB()` reads the dedicated metadata store in ~1–2ms and seamlessly reconciles timestamps.
   - If any new or imported items lack metadata, a lightweight background backfill resolves them via index seek without blocking the UI.
2. **Directory Browsing & Sorting**:
   - Every channel and folder displays a clean, tiered status tag indicating how recently posts were published.
   - Clicking "Sort by Freshness" (Newest First or Oldest First) immediately re-orders the directory in 0ms using the pre-indexed timestamps.
3. **Live Sync / New Post Arrival**:
   - When a channel is synced or a background scrape completes, the newest timestamp writes directly into `listen_freshness_meta`.
   - The directory node's badge updates reactively in real time.

### Visual Identity & Theme Tokens
- **Tiered Freshness Levels**:
  - `today` ($\le 24\text{h}$): Emerald tint (`bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200/80 dark:border-emerald-800/60 text-emerald-700 dark:text-emerald-300`), emerald status dot.
  - `recent` ($1\text{–}3\text{d}$): Teal/cyan tint (`bg-teal-50 dark:bg-teal-950/60 border-teal-200/80 dark:border-teal-800/60 text-teal-700 dark:text-teal-300`), teal status dot.
  - `week` ($3\text{–}7\text{d}$): Indigo/blue tint (`bg-indigo-50 dark:bg-indigo-950/60 border-indigo-200/80 dark:border-indigo-800/60 text-indigo-700 dark:text-indigo-300`), indigo status dot.
  - `month` ($7\text{–}30\text{d}$): Amber/warm tint (`bg-amber-50 dark:bg-amber-950/60 border-amber-200/80 dark:border-amber-900/60 text-amber-700 dark:text-amber-300`), amber status dot.
  - `stale` ($> 30\text{d}$): Muted slate gray tint (`bg-gray-100 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400`), gray status dot.
- **Tabular Monospace Numerals**: Timestamps formatted with `font-mono tabular-nums text-[10px]` to maintain visual alignment across rows.
- **Live Minute Ticker**: A lightweight global interval updates relative time strings every 60 seconds without re-querying IndexedDB.

---

## 3. Key Product Decisions & Trade-Offs

### Decision 1: Dedicated Metadata Store vs. Live Index Cursors
- **Chosen Approach**: Create a dedicated `listen_freshness_meta` object store with primary key `nodeId`.
- **Why**: An application tracking 100+ channels would require 100+ separate index cursor transactions if queried individually. A dedicated metadata store allows reading all directory node timestamps in a single `store.getAll()` call in $< 2\text{ms}$.
- **Alternatives Considered**: Querying the existing `listen_item_ts` index. While fast for a single node, running it across 200 items creates 200 asynchronous promises and micro-transactions.

### Decision 2: Write-Through Metadata Synchronization
- **Chosen Approach**: Update `listen_freshness_meta` in the same IndexedDB transaction whenever `setCachedPostsIndexedDB()` or `savePostsIndexedDB()` writes posts.
- **Why**: Zero runtime query cost. The freshest timestamp is computed once during write time and permanently stored, eliminating read-time computation.

### Decision 3: Automatic Migration & Non-Blocking Backfill
- **Chosen Approach**: On first run with DB version 4, if `listen_freshness_meta` is empty, run a background one-pass backfill that scans newest keys from `channel_timestamp` or `listen_item_ts` and seeds the metadata store.
- **Why**: Existing user databases with 100K+ posts upgrade smoothly without blank badges or manual user action.

---

## 4. Technical Architecture & Data Strategy

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Listen Directory UI                             │
│  • Directory Tree Nodes (Channels & Folders)                           │
│  • Tiered Freshness Badges (Today / Recent / Week / Month / Stale)     │
│  • 60s Live Relative Ticker (12m ago, 2h ago, 1d ago)                  │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                     Reactive Freshness State                           │
│  • listenItemsFreshnessMap: Record<string, ListenItemFreshness>        │
│  • Synchronized in memory + localStorage snapshot for 0ms cold start   │
└───────────────────▲───────────────────────────────┬────────────────────┘
                    │ Read Path                     │ Write Path
                    │ (Mount: < 2ms)                │ (On Sync/Scrape)
┌───────────────────┴───────────────────────────────▼────────────────────┐
│                    GingkoListenPostsDB (Version 4)                     │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Store: 'listen_freshness_meta' (Key: nodeId)                     │  │
│  │ Record: { nodeId, timestamp, rawDate, channelId, updatedAt }     │  │
│  │ • O(1) single-key put / get                                      │  │
│  │ • O(N) instant bulk read via store.getAll()                      │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Store: 'posts' (Key: postKey)                                    │  │
│  │ Indexes: channel_timestamp, timestamp, listen_items, etc.        │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

### Data Schema: `listen_freshness_meta`
```typescript
export interface ListenFreshnessMetaRecord {
  nodeId: string;
  timestamp: number;
  rawDateVal: any;
  channelId?: string;
  postCount?: number;
  updatedAt: number;
}
```

### Execution Steps
1. **Schema & DB Upgrade (`src/utils/indexedDbPosts.ts`)**:
   - Increment `DB_VERSION` to 4.
   - In `onupgradeneeded`, create object store `listen_freshness_meta` with `{ keyPath: "nodeId" }`.
   - Add helper functions:
     - `getAllListenFreshnessMetaIndexedDB()`: Reads all metadata records in one operation.
     - `setListenFreshnessMetaIndexedDB(records: ListenFreshnessMetaRecord[])`: Batch upsert.
     - `updateNodeFreshnessMeta(nodeId: string, timestamp: number, rawDateVal: any, channelId?: string)`: Single upsert.
2. **Write-Path Integration (`src/utils/indexedDbPosts.ts`)**:
   - In `setCachedPostsIndexedDB()`, compute the max timestamp of incoming posts and write to `listen_freshness_meta` within the same transaction.
3. **Proactive Mount & Backfill (`src/App.vue`)**:
   - Trigger `loadAllListenPostsFreshnessFromIndexedDB()` proactively on `onMounted` instead of deferring it behind a 3-second timer.
   - Use `getAllListenFreshnessMetaIndexedDB()` as the primary source.
   - If meta records are missing for any leaf node, query `getNewestPostTimestampForNode` in background and persist the result into `listen_freshness_meta`.
4. **Live Relative Time Refresh (`src/App.vue`)**:
   - Ensure a 60-second ticker refreshes relative time strings (`relativeTime`) so "2m ago" transitions to "3m ago" without database hits.
5. **Verification**:
   - Build and lint with zero errors.
   - Verify directory nodes show immediate freshness tags on page reload.
