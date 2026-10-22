# Natural Language Filter for Channel Classification (Types Tab)

A natural language filtering system in the **Types** tab powered by the **Kev SystemOne API**. Converts user intent queries (e.g. *"political China with Japan"*, *"critical military updates in Ukraine"*, *"high value domestic finance"*) into precise, distribution-aware classification filters with interactive rule chips and live suggestions.

## User Review & Critical Decisions

> [!IMPORTANT]
> Based on your confirmed choices in Phase 1:
> - **Kev SystemOne API Parsing**: Natural language queries are passed as `state` to `callSystemOne()` with structured choice questions (for Topic, Primary Target Region, Secondary Target Region, Domestic Orientation, and Read Value Threshold), picking high-confidence (>0.25) results.
> - **Distribution-Aware Matching**: Evaluates full category probability maps (`topicProbs`, `countryProbs`, `readValueProbs`, and `domestic`) rather than only primary single choices. For multi-country queries like *"China with Japan"*, matches channels with significant joint probability density across both regions.
> - **Interactive Rule Chips & Suggestions**: Displays an editorial natural language search bar with 1-click example suggestions, an active parsed filter ribbon with removable/editable chips (`[Topic: Political ×]`, `[Region: China + US Allies ×]`), and confidence indicators.

---

## 1. Overview & Architecture

### Query to Classification Pipeline
```
┌────────────────────────────────────────────────────────────────────────┐
│                        Natural Language Query                          │
│               "political China with Japan (high quality)"              │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                  Kev SystemOne Choice Questions API                    │
│   POST https://kev.gogingko.net/v1/systemone                           │
│   - state: "political China with Japan (high quality)"                 │
│   - questions: { topic, primary_region, secondary_region,              │
│                  domestic_orientation, read_value_threshold }          │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ High confidence answers (>0.25)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                  Parsed Filter Criteria Object                         │
│   • topic: "political" (conf: 0.94)                                    │
│   • targetRegions: ["china", "us_allies_asia"] (conf: 0.91, 0.86)       │
│   • minReadValue: 1.5 (Level 2 Substantive)                            │
│   • domesticMin: null, domesticMax: null                               │
│   • matchMode: "distribution_joint" (covers both aspects)              │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│             Types Tab UI & Distribution-Aware Match Engine             │
│   1. Interactive Filter Chips Ribbon (editable, removable tags)        │
│   2. Distribution-Aware Channel Filter over 50,000+ items:             │
│      - item.topicProbs['political'] >= 0.15                            │
│      - item.countryProbs['china'] >= 0.08                              │
│      - item.countryProbs['us_allies_asia'] >= 0.05                      │
│      - item.readValueScore >= 1.5                                      │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Technical Implementation Details

### A. SystemOne Choice Questions Specification
Constructed in `src/utils/systemoneFilter.ts`:
1. **Topic Question (`topic`)**:
   - Instructions: *"Identify the primary content topic requested in this query, or select 'any' if unspecified."*
   - Criteria: All 9 dataset topics (`political`, `military`, `financial`, `technology`, `blog`, `general_news`, `university`, `game`, `spam`) + `any`.
2. **Primary Region Question (`primary_region`)**:
   - Instructions: *"Identify the primary target country or geopolitical region requested, or 'any' if none."*
   - Criteria: All 12 regions (`china`, `us_allies_asia`, `united_states`, `european_union`, `russia`, `ukraine`, `taiwan`, `israel_palestine`, `iran`, `africa`, `international`, `other`, `any`).
3. **Secondary Region Question (`secondary_region`)**:
   - Instructions: *"Identify any secondary target country/region mentioned in conjunction (e.g. 'China with Japan', 'Russia and Ukraine'), or 'none'."*
   - Criteria: Same 12 regions + `none`.
4. **Domestic Orientation Question (`domestic_orientation`)**:
   - Instructions: *"Does the query focus on internal domestic affairs, foreign external affairs, or neutral/any?"*
   - Criteria: `domestic` (>=0.6), `external` (<=0.3), `balanced`, `any`.
5. **Read Value Threshold Question (`read_value_importance`)**:
   - Instructions: *"Does the query require high information quality or critical disclosures?"*
   - Criteria: `critical` (L3 >= 2.2), `substantive` (L2 >= 1.5), `background` (L1 >= 0.8), `any`.

### B. Client-Side Fast Hybrid Pre-Parser
To ensure instant feedback while the SystemOne network request processes:
- Immediate keyword/regex tokenizer extracts clear terms (`"political"`, `"china"`, `"japan" -> "us_allies_asia"`, `"ukraine"`, etc.) in `< 5ms`.
- Asynchronously calls `callSystemOne()` to extract nuanced semantic relations and assign model confidence scores.
- Updates the active filter chips with verified AI confidence.

### C. Distribution-Aware Matching Logic
Rather than matching only `item.topic === choice` and `item.country === choice`:
- **Topic Probability Check**:
  `item.topic === filter.topic || (item.topicProbs[filter.topic] || 0) >= 0.15`
- **Multi-Region Co-Occurrence**:
  For queries with multiple regions (e.g. China + US Allies/Japan):
  - Primary country probability `>= 0.08`
  - Secondary country probability `>= 0.05`
  - Or joint probability score $\sqrt{P_1 \times P_2} \ge 0.05$
  This surfaces channels that report on bilateral relations between both target nations.
- **Domestic & Read Value Bounds**:
  - `item.domestic >= 0.55` for domestic focus
  - `item.readValueScore >= filter.minReadValue` for scored items

---

## 3. UI & Visual Design (Frontend Design Compliance)

1. **Natural Language Input Deck**:
   - Placed prominently above the manual filter row in `TypesTab.vue`.
   - Polished search input with Sparkles icon, loading spinner indicator, clear button, and `"Filter with Kev AI"` action button.
   - 1-click popular query presets:
     - `🇨🇳 🇯🇵 Political China with Japan`
     - `🪖 🇺🇦 Critical military updates in Ukraine`
     - `💶 🇪🇺 European financial & economic news`
     - `🔬 🇺🇸 High read value tech in US`
     - `🏛️ Domestic affairs in Asian allies`
2. **Active Parsed Filter Ribbon**:
   - Displays unboxed, clean interactive tags for each parsed criterion:
     - `[Topic: Political · 94% conf ×]`
     - `[Region 1: China · 91% conf ×]`
     - `[Region 2: US Allies (Asia) / Japan · 86% conf ×]`
     - `[Quality: Substantive (≥1.5) ×]`
   - Users can remove any individual chip with one click to broaden the search.
   - Shows live matching channel count: `Showing 342 matching channels`.
3. **Seamless Coordination with Manual Filters**:
   - Natural language parsed filters seamlessly synchronize with existing channel sorting, pagination, and inspection drawers.

---

## 4. Verification & Testing Plan

1. **Build & Type Checking**:
   - Run `compile_applet` and `lint_applet` to ensure full TypeScript typing and zero compilation errors.
2. **Parsing Verification**:
   - Test queries:
     - `"political China with Japan"` -> parsed as `topic=political`, `regions=[china, us_allies_asia]`.
     - `"critical military in Ukraine"` -> parsed as `topic=military`, `regions=[ukraine]`, `minReadValue=2.0`.
     - `"domestic tech in US allies"` -> parsed as `topic=technology`, `regions=[us_allies_asia]`, `domestic=domestic`.
3. **UI Edge Cases**:
   - Removing individual chips updates results immediately.
   - Clearing the input restores the full channel view.
   - Offline / latency fallback gracefully uses fast keyword parser if network is slow.
