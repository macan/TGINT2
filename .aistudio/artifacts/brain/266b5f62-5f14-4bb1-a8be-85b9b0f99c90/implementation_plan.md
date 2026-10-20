# Types Tab - Telegram Channel Classification & Intelligence Studio

A high-performance classification analysis tab located after Listen in the main navigation, delivering streaming line-by-line NDJSON ingestion of over 50,000 AI-classified channels (`exchange/classify.json`), rich probability distributions, and instant multi-dimensional filtering.

---

### User Review & Critical Decisions

> [!IMPORTANT]
> The following architectural and UX decisions were confirmed during Phase 1 clarification:
> - **Primary Layout & Visualization**: Paginated data cards featuring proportional probability bars, confidence ratings, and a slide-over inspection drawer for deep analysis.
> - **Loading & Ingestion Model**: Streaming `ReadableStream` reader with a live progressive progress indicator, rendering channels into the interface incrementally without blocking UI threads.
> - **Channel Interaction**: Clicking a channel item seamlessly switches to the **Explorer** tab, automatically populates the channel name, and loads its real-time posts and metadata, while an in-tab inspection drawer allows instant probability scrutiny.

---

### 1. Overview & Core Concept

- **What It Does**: The **Types** tab connects to the GOS object store (`namespace=exchange`, `key=classify.json`) to stream and parse 55,000+ channel classifications produced by the `kev-latest` model. It categorizes each channel into primary topics (`technology`, `general_news`, `blog`, `financial`, `military`, `university`, `political`, `game`, `spam`), target countries (`russia`, `china`, `united_states`, `ukraine`, `taiwan`, `israel_palestine`, `iran`, `international`, `other`), and evaluates an `is_domestic_affairs` confidence score.
- **Target Audience**: Open-source intelligence (OSINT) researchers, regional analysts, and Telegram network monitors evaluating channel thematic focuses, geographic targeting, and domestic/international orientation.
- **Key Value**: Eliminates manual auditing by transforming a 31MB raw NDJSON classification dataset into an instant, searchable, filterable visual catalog with instant jump-to-source inspection.

---

### 2. User Experience & Visual Design

#### Key User Flows
1. **Initial Entry & Streaming Ingestion**:
   - The user clicks the **Types** tab (positioned immediately after **Listen**).
   - If not yet fetched, the app begins streaming `https://i.gogingko.net/api/v1/v/exchange/classify.json` via chunked stream reader.
   - A clean top progress bar displays streamed bytes and parsed channel counts in real time (e.g. `2,450 / ~55,000 channels loaded`).
   - Cards populate progressively, allowing users to start filtering and browsing immediately without waiting for the full 31MB download.
2. **Multi-Faceted Filtering & Sorting**:
   - **Quick Search**: Debounced search by channel handle or title.
   - **Topic Filter**: Segmented chips for each topic category (`All`, `Tech`, `News`, `Blog`, `Finance`, `Military`, `Uni`, `Politics`, `Game`, `Spam`) with instant item counts.
   - **Target Country Filter**: Dropdown or segmented buttons for countries with geographic distribution preview.
   - **Domestic Affairs Slider / Range**: Quick slider/presets (`All`, `Low < 0.3`, `Medium 0.3–0.7`, `High > 0.7`) to isolate domestic vs international discourse.
   - **Sorting**: By Channel Name (A-Z), Topic Confidence (High-Low), Country Confidence (High-Low), or Domestic Score (High-Low).
3. **Card Presentation**:
   - Each channel card displays:
     - Avatar with fallback and channel handle `@channel`.
     - Primary **Topic** with its top choice label, confidence percentage, and a miniature segmented probability bar showing the distribution across topics.
     - Primary **Target Country** with confidence percentage and a miniature country probability bar.
     - **Domestic Affairs** score gauge / progress bar indicating the `is_domestic_affairs` ratio.
     - Model latency and token usage metrics.
4. **Action Handlers**:
   - **Primary Action (Card Click)**: Switches to the **Explorer** tab with `channelName` set, launching search and post fetching.
   - **Inspect Action (Drawer Button)**: Opens a sliding side drawer displaying full probability tables, token consumption (`input_tokens`, `output_tokens`), latency, and raw JSON view.

#### Visual Identity & Styling
- **Palette & Accents**: Indigo / Slate theme with clean Tailwind neutral surfaces (`dark:bg-gray-800`, `dark:border-gray-700/80`).
  - Topic tags & bars: Indigo / Cyan accents.
  - Target Country: Amber / Emerald accents.
  - Domestic Affairs: Violet / Purple accents.
- **Tabular Figures**: All percentages, token counts, and latency numbers rendered with `font-mono tabular-nums`.
- **Anti-Slop Discipline**: Zero decorative pulsing dots; clean unboxed metadata with `·` separators; functional interactive segmented buttons for active filtering states.

---

### 3. Key Product Decisions & Trade-Offs

- **Decision 1: Streaming ReadableStream with Chunked Line-Buffer vs. `await res.text()`**
  - *Chosen Approach*: Stream response body using `res.body.getReader()`, splitting chunks by newline with a buffer remainder, and updating reactive arrays in batched frames (`requestAnimationFrame` / 250ms intervals).
  - *Why*: Parsing 31MB / 55,000 lines synchronously freezes the browser main thread for 1.5–3 seconds. Streaming keeps the tab 100% interactive and shows data within the first 150ms.
- **Decision 2: Client-Side Virtualized / Paginated Grid vs Infinite Scroll**
  - *Chosen Approach*: Responsive paginated card grid (e.g. 24 or 48 items per page) with page jump controls and summary stats (`Showing 1-24 of 55,106`).
  - *Why*: Renders efficiently on mobile and desktop without memory leaks or DOM node bloat, while allowing exact page jumps.
- **Decision 3: Seamless Cross-Tab State Preservation**
  - *Chosen Approach*: Once fetched, parsed channel items remain in-memory so switching between Explorer, Types, and Listen is instantaneous without re-fetching.

---

### 4. Technical Architecture & Data Strategy

#### System & Component Flow Diagram
```
┌────────────────────────────────────────────────────────────────────────┐
│                        Top Navigation Bar                              │
│ [Channel] [Explorer] [Search] [Network] [Listen] [Types] ... [Monitor]  │
└───────────────────────────────────────────────────┬────────────────────┘
                                                    │
                                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                              Types Tab                                 │
│                                                                        │
│ ┌────────────────────────────────────────────────────────────────────┐ │
│ │ Stream Ingestion & Progress: Loaded 55,106 items (100%) [Cached]   │ │
│ └────────────────────────────────────────────────────────────────────┘ │
│                                                                        │
│ ┌────────────────────────────────────────────────────────────────────┐ │
│ │ Controls: [ Search Channel... ] [ Topic Filter ] [ Country Filter ]│ │
│ │           [ Domestic Slider: ≥ 0.0 ] [ Sort: Confidence ▼ ]         │ │
│ └────────────────────────────────────────────────────────────────────┘ │
│                                                                        │
│ ┌───────────────────────┐  ┌───────────────────────┐  ┌─────────────┐ │
│ │ Channel Card          │  │ Channel Card          │  │ Channel ... │ │
│ │ @a11yminsk            │  │ @husainov_photo       │  │             │ │
│ │ Topic: technology 78% │  │ Topic: blog 45%       │  │             │ │
│ │ Country: other 55%    │  │ Country: russia 50%   │  │             │ │
│ │ Domestic: 0.09        │  │ Domestic: 0.36        │  │             │ │
│ │ [Explore] [Details →] │  │ [Explore] [Details →] │  │             │ │
│ └───────────┬───────────┘  └───────────────────────┘  └─────────────┘ │
│             │                                                          │
│             ▼                                                          │
│  Switches to Explorer Tab                                              │
│  or opens Inspection Slide-over Drawer                                 │
└────────────────────────────────────────────────────────────────────────┘
```

#### Data Schema & Parsing Model
```typescript
interface ClassificationTopic {
  type: string;
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

interface ClassificationCountry {
  type: string;
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

interface ClassificationDomestic {
  type: string;
  noul: number;
}

interface ClassificationItem {
  channel: string;
  res: {
    model: string;
    answers: {
      topic: ClassificationTopic;
      target_country: ClassificationCountry;
      is_domestic_affairs: ClassificationDomestic;
    };
    usage?: {
      input_tokens: number;
      output_tokens: number;
    };
    latency_ms?: number;
  };
}
```

#### Integration Plan
1. **Navigation Extension**:
   - Add `"types"` to `activeTab` union type: `"explorer" | "search" | "network" | "listen" | "types" | "monitor" | "auto-finding" | "workspace" | "profile" | "channel"`.
   - Insert the **Types** tab button immediately after **Listen** in `src/App.vue` (default visible, independent of access token).
   - Update `tabSequence` array to insert `"types"` right after `"listen"`.
   - Add i18n locale entries (`types: "Types"`) across `en.ts`, `zh-CN.ts`, `ru.ts`, etc.
2. **Ingestion & State Engine**:
   - Implement `fetchClassificationData()` with chunked streaming text decoding and line splitting.
   - Maintain reactive `classificationList`, `isClassificationLoading`, `classificationLoadedBytes`, and `classificationTotalBytes`.
   - Reactive filtering with computed `filteredClassificationList`: channel handle search, topic selection, country selection, domestic threshold range, and sort ordering.
3. **Types View Template**:
   - Render hero filter bar with search input, topic chips, country select, domestic threshold slider, and sort controls.
   - Render paginated card grid with topic probability bars, country probability bars, and domestic indicator.
   - Slide-over inspection drawer for inspecting full probabilities and token metrics.
   - Explorer navigation button on each card (`activeTab = 'explorer'; channelName = item.channel; searchChannel()`).
