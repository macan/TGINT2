# Tile Mode in Listen Tab

A hierarchical treemap/tile visualization mode placed immediately after **View Mode** in the Listen tab. In **Tile Mode**, users view their Listen Directory structured inside an interactive rectangular canvas where each folder and stream tile is sized proportionally based on its total item count relative to the directory level. Users can click on directory tiles to drill down level-by-level with breadcrumb navigation, or click listen stream items to load and view their full posts feed beneath the treemap.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> The user confirmed the following architectural and visual choices:
> - **Visual Tiling Algorithm**: Interactive squarified treemap with proportional tile areas based on `node.itemCount / totalItemsCount`.
> - **Directory Navigation Flow**: Clicking a folder tile drills into that folder's contents, showing a top path/breadcrumb bar with quick back navigation.
> - **Post Feed Presentation**: Clicking a listen item displays the full posts feed with channel header, metrics, and live filtering right below the treemap rectangle.
> - **Mode Order**: Placed right after **View Mode** (`view` → `tile` → `rearrange` → `flexible` → `hots`).

---

## 1. Overview & Core Concept

- **What It Does**: Provides a top-down spatial overview of the Listen Directory. Rather than scrolling a flat tree, users see a high-density, beautifully partitioned treemap rectangle. Larger collections occupy larger surface areas.
- **Target Audience**: Power users, analysts, and curators monitoring dozens or hundreds of Telegram channels and keyword streams who need quick visual intuition of directory density and rapid item switching.
- **Key Value**: Instant spatial comprehension of stream collections, rapid drill-down into nested topics, and seamless transition from directory exploration to active post reading.

---

## 2. User Experience & Visual Design

### Key User Flows

1. **Mode Activation**:
   - In the Listen tab's mode segmented control, a new **Tile Mode** button (icon: `Layout` or `Grid2x2`, label: `Tile Mode`) sits directly after `View Mode`.
   - Activating Tile Mode displays the treemap rectangle at the top with level breadcrumbs and summary statistics.
2. **Initial Layer (Root View)**:
   - Only root-level directories (folders) and root-level listen items (channels/keywords) are rendered as tiles inside a crisp, high-contrast bounding box.
   - Each tile's area equals its proportional weight:
     $$\text{Weight} = \frac{\text{Leaf Items in Node}}{\text{Total Leaf Items in Current View}}$$
     *(Single items have a weight of 1; folders have a weight equal to their recursive leaf count; empty folders have a weight of 1).*
3. **Tile Interaction & Level Drilldown**:
   - **Hovering a tile**: Subtle scale micro-interaction (`scale-[1.01]`), border illumination, and tooltip displaying name, type, item count, and freshness status.
   - **Clicking a Folder Tile**: Smoothly transitions the treemap to render only that folder's children (sub-folders and listen items). A clean breadcrumb trail (`Root / Tech Streams / AI`) updates above the rectangle with 1-click back buttons.
   - **Clicking a Listen Item Tile**: Selects the stream (`selectedListenNode`), highlights the active tile with an accent ring, triggers `fetchListenPosts(item, true)`, and smoothly reveals the full channel posts feed below the treemap canvas.
4. **Post Feed Pane (Below Canvas)**:
   - Includes channel title, description, tags, avatar, search/filter bar, freshness badge, and the virtual post list with full interactive actions (translate, copy, share, lightbox, article reader).

### Visual Identity & Theme Tokens

- **Palette**: Deep slate/teal palette consistent with the application theme.
  - Folders: Subtle cool indigo/teal gradient background (`from-teal-500/10 via-cyan-500/10 to-teal-600/15` in dark mode: `dark:from-teal-950/40 dark:via-cyan-950/30 dark:to-gray-800`), folder icon, leaf count badge.
  - Channels: Emerald/teal tint (`from-emerald-500/10 to-teal-500/10`), radio icon, handle/link preview.
  - Keywords: Violet/indigo tint (`from-purple-500/10 to-indigo-500/10`), hashtag/tag icon, search terms preview.
  - Active Selected Tile: 2px solid teal ring (`ring-2 ring-teal-500 dark:ring-teal-400 ring-offset-2`).
- **Typography**: Clean tabular numbers (`tabular-nums font-mono`) for item counts and percentages. High legibility with automatic font scaling for smaller tiles.
- **Canvas Dimensions**: Responsive height ($420\text{px}$–$520\text{px}$ based on viewport) with minimum tile size clamping so small items remain legible and clickable.

---

## 3. Key Product Decisions & Trade-Offs

- **Squarified Treemap Algorithm (In-Component Pure TypeScript)**:
  - *Chosen Approach*: Implement a pure, high-performance squarified treemap layout generator (based on Bruls, Huizing, and van Wijk's algorithm) directly within a dedicated component `TileTreemapView.vue`.
  - *Why*: Zero external bundle bloat, zero dependencies, lightning-fast recalculation on window resize or directory changes, and full reactive control over Vue template transitions and clicks.
- **Hierarchical Drilldown vs. Cluttered Nested View**:
  - *Chosen Approach*: Level-by-level drilldown with breadcrumbs.
  - *Why*: Deep nested treemaps in small viewports lead to visual noise and unreadable text. Showing one level at a time ensures generous clickable areas and pristine typography.
- **Reusing Established Post Feed & Engagement Components**:
  - *Chosen Approach*: The feed beneath the rectangle directly leverages `VirtualPostList`, `PostItemView`, and the app's established cached post streaming handlers.
  - *Why*: Guarantees feature parity—search filter, translations, media viewer, engagement tracking, and infinite scrolling work identically to View Mode.

---

## 4. Technical Architecture & Data Strategy

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Listen Tab Header                               │
│  [View Mode]  ->  [Tile Mode]  ->  [Rearrange]  ->  [Flexible]  ->  [Hots]  │
└────────────────────────────────────────────────────────────────────────┘
                                 │
                    ┌────────────▼─────────────┐
                    │  listenLayoutMode ===    │
                    │         'tile'           │
                    └────────────┬─────────────┘
                                 │
     ┌───────────────────────────┴───────────────────────────┐
     ▼                                                       ▼
┌────────────────────────────────────────────────────────┐ ┌────────────────────────────────────────────────────────┐
│ Breadcrumb & Context Bar                               │ │ Storage & Sync Progress Header                         │
│ [Root] > [Folder A] > [Sub B]   (Total: 42 items)      │ │ Real-time status & background fetch indicators         │
└────────────────────────────────────────┬───────────────┘ └────────────────────────────────────────────────────────┘
                                         ▼
┌───────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Interactive Tile Rectangle (Treemap Canvas, 460px height)                                                          │
│ ┌──────────────────────────────────────────────┬────────────────────────────────────────────────────────────────┐ │
│ │ Folder: "Tech Streams" (28 items, 67%)       │ Channel: "@durov" (1 item, 2.4%)                              │ │
│ │ [Folder Icon] Click to drill down            │ [Radio] Click to view feed                                     │ │
│ ├───────────────────────┬──────────────────────┼────────────────────────────────────────────────────────────────┤ │
│ │ Keyword: "AI Models"  │ Folder: "News"       │ Channel: "@toncoin"                                            │ │
│ │ (1 item, 2.4%)        │ (12 items, 28%)      │ (1 item, 2.4%)                                                 │ │
│ └───────────────────────┴──────────────────────┴────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────┬──────────────────────────────────────────────────────────────────────────┘
                                         ▼ (Click Listen Item Tile)
┌───────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Active Channel Header & Live Posts Feed List                                                                      │
│ ┌───────────────────────────────────────────────────────────────────────────────────────────────────────────────┐ │
│ │ Channel Avatar · Title · @handle · Tags · Freshness Badge · Search Filter Input · Live Sync Button            │ │
│ ├───────────────────────────────────────────────────────────────────────────────────────────────────────────────┤ │
│ │ VirtualPostList & PostItemView (Full post cards, media grid, translation fallback, actions)                  │ │
│ └───────────────────────────────────────────────────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Component Structure & File Plan

1. **`src/components/listen/TileTreemapView.vue`**:
   - Encapsulates squarified treemap calculation:
     - Input: current folder nodes (`ListenItem[]`), parent path (`{ id: string, name: string }[]`), selected item ID, container width/height.
     - Layout Math: Computes normalized coordinates `(x, y, w, h)` for each child node.
     - Handles tile clicks: emits `@drill-down(folderNode)` or `@select-item(listenNode)`.
     - Breadcrumb bar with reset to root, back button, and parent crumbs.
     - Search / filter within current level if needed.
2. **`src/App.vue` Integration**:
   - Extend `listenLayoutMode` union type: `'view' | 'tile' | 'rearrange' | 'flexible' | 'hots'`.
   - Add Tile Mode segmented button right after View Mode with matching icon (`Grid2x2` / `LayoutGrid`).
   - Add template branch `<template v-else-if="listenLayoutMode === 'tile'">` mounting `TileTreemapView`.
   - Render the active feed below `TileTreemapView` when `selectedListenNode` is selected.
3. **`src/i18n/locales/*.ts`**:
   - Add locale entries for `modeTile`, `modeTileHint`, `drillDown`, `backToParent`, `rootDirectory`, `tilesCount`.

---

## 5. Verification Plan

1. **Compilation & Linting**:
   - Co-execute `compile_applet` and `lint_applet` to ensure 100% clean TypeScript compilation and zero template errors.
2. **Interactive UI Verification**:
   - Switch between `View Mode` and `Tile Mode`.
   - Verify initial layer displays root-level folders and items.
   - Verify tile proportions match item counts.
   - Click a folder tile: verify seamless drilldown and breadcrumb updates.
   - Click breadcrumbs or Back button: verify returning to parent level.
   - Click a listen item tile: verify active selection highlight and post feed rendering below the canvas.
   - Test translation, media lightbox, and post interactions within the feed.
