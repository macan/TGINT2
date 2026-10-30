# LCP Performance Optimization Plan

Comprehensive multi-tier performance overhaul to resolve the 8+ second Largest Contentful Paint (LCP) on Cloudflare by decomposing the monolithic 2.42MB JavaScript bundle into optimized vendor chunks, preloading secondary view chunks post-initial paint, and deferring background network polling outside the critical rendering path.

## User Review & Critical Decisions

> [!IMPORTANT]
> The following architectural decisions were aligned and confirmed in Phase 1:
> - **Strategy Choice**: Comprehensive multi-tier optimization (Rollup manual chunking, asynchronous sub-component splitting, deferred network polling).
> - **Tab Loading Architecture**: Separate chunked bundles for heavy tabs (`TypesTab`, `Network Graph / Cytoscape`, `ArticleReaderView`), preloaded asynchronously after the initial paint to guarantee instant subsequent tab switching with zero cold lag.
> - **Hydration Presentation**: Clean progressive hydration without intrusive skeleton layout shifts, prioritizing immediate availability of the Explorer search interface.

---

## 1. Overview & Core Concept

- **What It Does**: Optimizes the web application's initial bundle size, critical rendering path, and main-thread execution budget so that the Explorer viewport achieves an sub-1.5 second LCP score on real-world networks (including Cloudflare edge hosting).
- **The Core Problem**: The current production build produces a single, monolithic JavaScript bundle of **2,421.88 kB** (nearly 700kB gzipped). On cold start over Cloudflare, the browser must finish downloading, uncompressing, parsing, compiling, and executing this entire script before Vue can mount or paint the Explorer interface. Compounding this, `onMounted` immediately triggers six simultaneous background HTTP polling intervals and IndexedDB sweeps, saturating the CPU during the critical LCP measurement window.
- **Key Value**:
  - Drops initial payload by over 65% for the first paint.
  - Frees the browser main thread during the first 2 seconds of page load.
  - Ensures Cloudflare edge nodes deliver lightweight, cached vendor chunks in parallel.

---

## 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Instant First Paint**: The Explorer view header, navigation bar, and search form appear crisply without delay.
  2. **Non-Blocking Post-Paint Preloading**: Heavy libraries (e.g. `cytoscape` for network relations, `lz4js` and `StreamingLz4FrameDecoder` for Types tab, `markdown-it`, `ArticleReaderView`) load silently in the background using browser idle cycles (`requestIdleCallback`).
  3. **Smooth Tab Transitions**: When a user switches to **Types**, **Network**, or **Article** reader, the chunks are already cached in browser memory, avoiding spinners or layout shifts.
- **Visual Identity & Theme**:
  - Preserves the established enterprise SaaS aesthetic, dual light/dark mode design tokens, and unboxed typography.
  - Zero layout shifts (CLS < 0.05) achieved by maintaining stable component boundaries during hydration.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Vite Rollup `manualChunks` Strategy**
  - *Chosen Approach*: Group dependencies into dedicated vendor chunks:
    - `vendor-vue`: `vue`, `@vue/*`, `i18n`.
    - `vendor-cytoscape`: `cytoscape` (graph visualization engine).
    - `vendor-compression`: `pako`, `lz4js`, `@addmaple/lz4`.
    - `vendor-markdown`: `markdown-it`, `dompurify`.
    - `vendor-icons`: `lucide-vue-next`.
  - *Why*: Allows the browser to download smaller chunks concurrently via HTTP/2 / HTTP/3 on Cloudflare, and enables long-term edge caching (vendor chunks don't change between minor app updates).
  - *Alternatives Considered*: Standard automatic chunking (creates too many tiny fragments that increase HTTP handshake overhead).

- **Decision 2: Asynchronous Component Splitting with Idle Preloading**
  - *Chosen Approach*: Convert heavy view components (`TypesTab`, `ArticleReaderView`, `AutoClassDistributionChart`) into `defineAsyncComponent`. Trigger an idle preload immediately after `window.addEventListener('load')` or during `requestIdleCallback`.
  - *Why*: Keeps the entry chunk ultra-lightweight while guaranteeing zero user-perceived delay when navigating between tabs.
  - *Alternatives Considered*: Pure lazy loading on tab click (causes a 200–400ms visual hitch on the first tab switch).

- **Decision 3: Defer Non-Critical Background Polling and Telemetry**
  - *Chosen Approach*: Move `fetchCounters()`, `fetchNamespaceStats()`, `fetchPendingJobs()`, `fetchQ0Jobs()`, `fetchQ1Jobs()`, and `loadAllListenPostsFreshnessFromIndexedDB()` inside a 1,500ms deferred timeout / `requestIdleCallback` block.
  - *Why*: Prevents network and CPU contention during the first 1–2 seconds when the browser's performance observer is registering LCP and FCP.
  - *Alternatives Considered*: Running them synchronously in `onMounted` (blocks the event loop and delays the first frame render).

---

## 4. Technical Architecture & Data Strategy

### Bundle & Preload Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                          Initial Page Request                          │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
       ┌────────────────────────────────────────────────────────┐
       │   Fast Critical Path (<350kB gzipped across HTTP/2)   │
       │   • index.html                                         │
       │   • vendor-vue.js                                      │
       │   • vendor-icons.js                                    │
       │   • entry-app.js (Explorer Search & Core State)        │
       └────────────────────────────┬───────────────────────────┘
                                    │
                                    ▼
           [FIRST CONTENTFUL PAINT & LCP COMPLETE (<1.5s)]
                                    │
                  ┌─────────────────┴─────────────────┐
                  │ requestIdleCallback / post-paint  │
                  ▼                                   ▼
┌───────────────────────────────────┐ ┌──────────────────────────────────┐
│  Idle Preload Async View Chunks   │ │  Deferred Background Polling     │
│  • chunk-TypesTab.js              │ │  • fetchCounters() (1.5s delay)  │
│  • chunk-ArticleReaderView.js     │ │  • fetchNamespaceStats() (1.5s)  │
│  • chunk-cytoscape.js             │ │  • fetchPendingJobs() (2.0s)     │
│  • chunk-compression.js (lz4/pako)│ │  • IndexedDB freshness sweep     │
└───────────────────────────────────┘ └──────────────────────────────────┘
```

### Component & Chunk Mapping

| View / Feature | Implementation Strategy | Target Chunk Name |
| :--- | :--- | :--- |
| **Explorer & Top Navigation** | Synchronous Main Chunk | `index` + `vendor-vue` |
| **Types Tab** | `defineAsyncComponent` + Idle Preload | `view-types-tab` |
| **Article Reader Mode** | `defineAsyncComponent` + Idle Preload | `view-article-reader` |
| **Cytoscape Graph Visualizer** | Dynamic `import('cytoscape')` in render | `vendor-cytoscape` |
| **Compression (LZ4 / Pako)** | Shared Async Vendor Chunk | `vendor-compression` |
| **Markdown Parser** | Shared Async Vendor Chunk | `vendor-markdown` |

### Step-by-Step Execution Sequence

1. **Vite Configuration**:
   - Update `vite.config.ts` with custom `rollupOptions.output.manualChunks` to split heavy vendor modules cleanly.
2. **Component Code Splitting**:
   - In `src/App.vue`, convert `TypesTab`, `ArticleReaderView`, and `AutoClassDistributionChart` to `defineAsyncComponent()`.
   - Implement an idle preload helper that invokes component loaders during `requestIdleCallback` or after initial render tick.
3. **Lazy-Load Cytoscape Engine**:
   - Refactor cytoscape import to dynamically import on-demand when the Network tab is opened or preloaded.
4. **Deferred Background Timers in `onMounted`**:
   - Wrap secondary telemetry and indexing jobs in `setTimeout(..., 1500)` / `requestIdleCallback` so initial rendering has 100% of the main-thread budget.
5. **Verification**:
   - Run `npm run build` and inspect the generated chunk breakdown table to confirm the entry bundle is significantly reduced and warnings are eliminated.
   - Run `lint_applet` and `compile_applet`.
