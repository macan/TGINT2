# Article Reader Mode for Channel Posts

An editorial, distraction-free reading mode integrated seamlessly into the Explorer tab alongside Feed, Masonry, and Timeline views, designed specifically for long-form channel posts with customizable typography, reading time estimates, collapsible media, and archival reading themes.

## User Review & Critical Decisions

> [!IMPORTANT]
> Based on your confirmed choices in Phase 1:
> - **Seamless Toggle Mode**: Article Reader is integrated directly into the Explorer tab view switcher as a fourth first-class layout mode (`Feed` | `Masonry` | `Timeline` | `Article Reader`), letting you switch effortlessly while preserving search queries, channel context, and filters.
> - **Typography & Reading Controls**: A floating/sticky toolbar provides live adjustments for font family (Editorial Serif vs. Modern Sans), font scale (`15px` to `21px`), line height (`Relaxed` vs. `Loose`), column measure (`65ch`–`80ch`), and paper themes (`Pure White`, `Warm Parchment / Sepia`, `Muted Charcoal`, `Night Dark`).
> - **Long-Form Focus & Collapsible Media**: Posts display estimated reading time (e.g. `3 min read · 480 words`), clear date headers, drop-cap styling on primary paragraphs, and clean inline collapsible media drawers so images/videos don't disrupt reading flow.

---

## 1. Overview & Core Concept

When channels publish extensive essays, analytical briefings, transcripts, or multi-paragraph reporting, the traditional social feed card clutter (repetitive profile avatars, metric badges, tool tags, and dense action bars) causes visual fatigue. 

The **Article Reader** view strips away peripheral interface noise and transforms the channel's chronological post stream into an elegant, high-legibility digital publication. Posts are rendered with generous editorial margins, balanced line lengths, clear typographical rhythm, and reading metadata (word counts, reading duration), while media galleries (photos, video players, doc attachments) are cleanly tucked into elegant expandable drawers.

---

## 2. User Experience & Visual Design

### Key User Flows

1. **Activating Reader View**: In the Explorer tab, the view mode switcher is expanded with an **Article Reader** button (`BookOpen` icon) alongside Feed, Masonry, and Timeline. Clicking it smoothly transitions the feed into reader layout.
2. **Customizing Reading Aesthetics**: A discreet, floating or header-adjacent Reading Controls bar allows instant adjustment of:
   - **Font Style**: Book Serif (`Lora` / `Merriweather` / Georgia fallback) vs. Contemporary Sans (`Plus Jakarta Sans` / `Manrope`).
   - **Text Size**: 4-step stepper (`A-` / `A+`: Small 15px, Medium 17px, Large 19px, X-Large 21px).
   - **Line Spacing**: Relaxed (1.75) vs. Loose (1.95).
   - **Reading Measure / Column Width**: Compact (`600px`), Standard (`720px` / `65ch`), Wide (`860px`).
   - **Theme Canvas**:
     - *Clean Light*: Pure white background with deep charcoal typography.
     - *Warm Parchment / Sepia*: Soft ivory paper (`#FBF9F5` / `#F7F4EE`) with antique ink text (`#1C1917`).
     - *Subdued Slate*: Slate gray surface (`#1E293B`) with soft silver text.
     - *OLED Night*: Pure black canvas (`#09090B`) with high-contrast text.
3. **Engaging with Long-Form Posts**:
   - Posts present an editorial header: title or opening sentence emphasis, publication date, time elapsed, and estimated reading duration (`· 4 min read`).
   - Body paragraphs feature comfortable margins and optional drop-cap on opening paragraphs.
   - Posts with photos or videos feature a compact media badge (e.g. `📷 3 Photos · Tap to expand`) that opens into an inline gallery without displacing the reader.
   - Action controls (Copy text, Share, Bookmark, Translate) are unobtrusive at the foot of each post.

### Visual Identity & Typographic Hierarchy

- **Anti-AI Slop Compliance**:
  - No static pill capsules or candy-colored badges over text.
  - Zero decorative pulsing dots or pseudo-technical comment prefixes.
  - Generous negative space between consecutive posts with subtle hairline dividers (`border-b border-stone-200 dark:border-stone-800`).
  - True `text-wrap: balance` on section titles and headlines.
  - Tabular numerals for dates, timestamps, and word metrics.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: View Switcher vs. Isolated Modal**
  - *Chosen Approach*: Add `viewMode = 'reader'` to the existing Explorer view mode state (`list`, `masonry`, `timeline`, `reader`).
  - *Why*: Allows users to search, filter by date/topic/channel, and paginate naturally through the channel's history without losing their spot or opening nested modal dialogs.
  - *Alternative Considered*: A standalone modal view was considered, but it breaks continuous multi-post reading and channel exploration.

- **Decision 2: Client-Side Reading State Persistence**
  - *Chosen Approach*: Save reader preferences (`fontFamily`, `fontSize`, `theme`, `lineHeight`, `readingWidth`) to `localStorage` (`telegram-reader-preferences`).
  - *Why*: Users configure their ideal reading comfort once and enjoy it consistently across sessions and different channels.

- **Decision 3: Media Handling in Editorial Layout**
  - *Chosen Approach*: Show a clean inline media teaser (`[Expand 2 Photos]`) by default in Reader mode, with one-click full display for users who want to inspect images.
  - *Why*: Long-form channel posts frequently feature large banner photos that push text below the fold; collapsing them keeps the eye focused on reading.

---

## 4. Technical Architecture & Component Structure

### Architecture Diagram

```
┌────────────────────────────────────────────────────────────────────────┐
│                              Explorer Tab                              │
├────────────────────────────────────────────────────────────────────────┤
│ Header & Search Bar (Channel @name, Search Query, Date Filter)        │
│                                                                        │
│ View Mode Switcher:                                                    │
│ [ 📄 Feed ]  [ 🧱 Masonry ]  [ ⏱ Timeline ]  [ 📖 Article Reader ]    │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ viewMode === 'reader'
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   Reader Controls Bar (Sticky / Toolbar)               │
│  Font: [ Serif | Sans ]   Size: [ A- | A+ ]   Theme: [ ⚪ | 📜 | 🌙 ]   │
│  Measure: [ Narrow | Optimal | Wide ]   Media: [ Auto-Collapse Toggle ]│
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│               Article Reader Post Stream (Max Width Container)         │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Article Post Item                                                │  │
│  │ ──────────────────────────────────────────────────────────────── │  │
│  │ Oct 19, 2026 · 14:32 · 520 words · 3 min read                   │  │
│  │                                                                  │  │
│  │ [D] uring recent discussions surrounding regional infrastructure,│  │
│  │     the committee outlined new regulatory guidelines...          │  │
│  │                                                                  │  │
│  │ [🖼 2 Photos Attached - Click to Expand / Collapse]              │  │
│  │                                                                  │  │
│  │ ── Actions: [Copy Text] [Translate] [Explore Link] ───────────── │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Next Article Post Item...                                        │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

### State & Logic Specifications

1. **View Mode State**:
   ```ts
   const viewMode = ref<"list" | "masonry" | "timeline" | "reader">("list");
   ```
2. **Reader Customization Preferences**:
   ```ts
   interface ReaderPreferences {
     fontFamily: "serif" | "sans";
     fontSize: number; // 15, 17, 19, 21
     lineHeight: "relaxed" | "loose";
     maxWidth: "narrow" | "standard" | "wide";
     theme: "white" | "sepia" | "slate" | "oled";
     collapseMedia: boolean;
   }
   ```
3. **Reading Duration & Word Count Calculator**:
   ```ts
   const getPostReadingStats = (text: string) => {
     const words = text ? text.trim().split(/\s+/).filter(Boolean).length : 0;
     const minutes = Math.max(1, Math.ceil(words / 200));
     return { words, minutes };
   };
   ```
4. **Interactive Component Handlers**:
   - Live font style and size toggles updating reactive CSS classes.
   - Collapsible media gallery drawer with thumbnail preview.
   - Synchronized timeline and search filters matching standard Explorer capabilities.
