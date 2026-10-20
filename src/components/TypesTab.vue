<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import {
  Tag,
  Search,
  SlidersHorizontal,
  ChevronLeft,
  ChevronRight,
  ArrowUpRight,
  Eye,
  X,
  RefreshCw,
  Pause,
  Play,
  RotateCcw,
  ExternalLink,
  ShieldAlert,
  Globe2,
  Sparkles,
  BarChart3,
  Layers,
  Cpu,
  Clock,
  Compass,
  Check,
  Radio,
  FileText
} from "lucide-vue-next";
import { useI18n } from "../i18n";

const { t } = useI18n();

const emit = defineEmits<{
  (e: "explore-channel", channel: string): void;
}>();

// Compact data structure for memory efficiency when scaling to millions
export interface ClassifiedChannel {
  channel: string;
  topic: string;
  topicConf: number;
  topicProbs: Record<string, number>;
  country: string;
  countryConf: number;
  countryProbs: Record<string, number>;
  domestic: number;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  model: string;
}

// Ingestion and Streaming State
const items = ref<ClassifiedChannel[]>([]);
const isStreaming = ref(false);
const isPaused = ref(false);
const isCompleted = ref(false);
const streamError = ref<string | null>(null);
const loadedBytes = ref(0);
const totalBytesEstimated = ref(31941532); // ~31.9 MB current size
const totalParsedLines = ref(0);

// Memory safety limit for multi-million scaling
const MAX_LIMIT_OPTIONS = [
  { label: "25,000", value: 25000 },
  { label: "50,000", value: 50000 },
  { label: "100,000", value: 100000 },
  { label: "250,000", value: 250000 },
  { label: "Unlimited", value: Infinity }
];
const memoryLimit = ref<number>(100000);

let abortController: AbortController | null = null;
let readerRef: ReadableStreamDefaultReader<Uint8Array> | null = null;

// Filtering and Search State
const searchQuery = ref("");
const selectedTopic = ref<string>("all");
const selectedCountry = ref<string>("all");
const domesticPreset = ref<"all" | "high" | "mid" | "low">("all");
const domesticMinScore = ref<number>(0);
const sortBy = ref<"topicConf" | "countryConf" | "domesticDesc" | "domesticAsc" | "channelAsc" | "latencyAsc">("topicConf");

// Pagination State
const currentPage = ref(1);
const pageSize = ref(24);
const PAGE_SIZE_OPTIONS = [24, 48, 96];

// Slide-over Drawer for Deep Inspection
const selectedInspectionItem = ref<ClassifiedChannel | null>(null);
const isDrawerOpen = ref(false);

const openDrawer = (item: ClassifiedChannel) => {
  selectedInspectionItem.value = item;
  isDrawerOpen.value = true;
};

const closeDrawer = () => {
  isDrawerOpen.value = false;
};

// Topic Metadata & Styling
const TOPIC_CONFIG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  technology: { label: "Technology", color: "text-cyan-700 dark:text-cyan-300", bg: "bg-cyan-50 dark:bg-cyan-950/60", border: "border-cyan-200 dark:border-cyan-800" },
  general_news: { label: "News", color: "text-blue-700 dark:text-blue-300", bg: "bg-blue-50 dark:bg-blue-950/60", border: "border-blue-200 dark:border-blue-800" },
  blog: { label: "Blog", color: "text-emerald-700 dark:text-emerald-300", bg: "bg-emerald-50 dark:bg-emerald-950/60", border: "border-emerald-200 dark:border-emerald-800" },
  financial: { label: "Finance", color: "text-amber-700 dark:text-amber-300", bg: "bg-amber-50 dark:bg-amber-950/60", border: "border-amber-200 dark:border-amber-800" },
  military: { label: "Military", color: "text-rose-700 dark:text-rose-300", bg: "bg-rose-50 dark:bg-rose-950/60", border: "border-rose-200 dark:border-rose-800" },
  university: { label: "University", color: "text-purple-700 dark:text-purple-300", bg: "bg-purple-50 dark:bg-purple-950/60", border: "border-purple-200 dark:border-purple-800" },
  political: { label: "Politics", color: "text-indigo-700 dark:text-indigo-300", bg: "bg-indigo-50 dark:bg-indigo-950/60", border: "border-indigo-200 dark:border-indigo-800" },
  game: { label: "Game", color: "text-fuchsia-700 dark:text-fuchsia-300", bg: "bg-fuchsia-50 dark:bg-fuchsia-950/60", border: "border-fuchsia-200 dark:border-fuchsia-800" },
  spam: { label: "Spam", color: "text-gray-700 dark:text-gray-300", bg: "bg-gray-100 dark:bg-gray-800/80", border: "border-gray-200 dark:border-gray-700" }
};

// Target Country Metadata & Styling
const COUNTRY_CONFIG: Record<string, { label: string; flag: string }> = {
  russia: { label: "Russia", flag: "🇷🇺" },
  china: { label: "China", flag: "🇨🇳" },
  united_states: { label: "United States", flag: "🇺🇸" },
  ukraine: { label: "Ukraine", flag: "🇺🇦" },
  taiwan: { label: "Taiwan", flag: "🇹🇼" },
  israel_palestine: { label: "Israel/Palestine", flag: "🌐" },
  iran: { label: "Iran", flag: "🇮🇷" },
  international: { label: "International", flag: "🌍" },
  other: { label: "Other", flag: "🗺️" }
};

// Stream Ingestion Logic
const startStreaming = async (resume = false) => {
  if (isStreaming.value && !isPaused.value) return;

  if (!resume) {
    items.value = [];
    loadedBytes.value = 0;
    totalParsedLines.value = 0;
    isCompleted.value = false;
    streamError.value = null;
  }

  isStreaming.value = true;
  isPaused.value = false;
  abortController = new AbortController();

  try {
    const url = "https://i.gogingko.net/api/v1/v/exchange/classify.json";
    const res = await fetch(url, {
      signal: abortController.signal
    });

    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`);
    }

    const contentLength = res.headers.get("content-length");
    if (contentLength) {
      totalBytesEstimated.value = parseInt(contentLength, 10);
    }

    if (!res.body) {
      throw new Error("ReadableStream not supported or empty body");
    }

    const reader = res.body.getReader();
    readerRef = reader;
    const decoder = new TextDecoder("utf-8");

    let lineRemainder = "";
    const batch: ClassifiedChannel[] = [];
    const FLUSH_INTERVAL = 150; // flush to Vue state every 150ms to keep UI silky smooth
    let lastFlushTime = Date.now();

    const flushBatch = () => {
      if (batch.length > 0) {
        items.value.push(...batch);
        batch.length = 0;
        lastFlushTime = Date.now();
      }
    };

    while (true) {
      if (isPaused.value) {
        break;
      }

      if (items.value.length + batch.length >= memoryLimit.value) {
        // Reached user memory limit
        break;
      }

      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      if (value) {
        loadedBytes.value += value.byteLength;
        const chunkText = decoder.decode(value, { stream: true });
        const lines = (lineRemainder + chunkText).split("\n");
        lineRemainder = lines.pop() || "";

        for (let i = 0; i < lines.length; i++) {
          const rawLine = lines[i].trim();
          if (!rawLine) continue;

          totalParsedLines.value++;

          try {
            const parsed = JSON.parse(rawLine);
            if (!parsed || !parsed.channel || !parsed.res || !parsed.res.answers) {
              continue;
            }

            const answers = parsed.res.answers;
            const topic = answers.topic?.choice || "unknown";
            const topicConf = Number(answers.topic?.confidence || 0);
            const topicProbs = answers.topic?.probabilities || {};

            const country = answers.target_country?.choice || "unknown";
            const countryConf = Number(answers.target_country?.confidence || 0);
            const countryProbs = answers.target_country?.probabilities || {};

            const domestic = Number(answers.is_domestic_affairs?.noul ?? 0);

            const tokensIn = Number(parsed.res.usage?.input_tokens || 0);
            const tokensOut = Number(parsed.res.usage?.output_tokens || 0);
            const latencyMs = Number(parsed.res.latency_ms || 0);
            const model = String(parsed.res.model || "kev-latest");

            batch.push({
              channel: parsed.channel,
              topic,
              topicConf,
              topicProbs,
              country,
              countryConf,
              countryProbs,
              domestic,
              tokensIn,
              tokensOut,
              latencyMs,
              model
            });

            if (items.value.length + batch.length >= memoryLimit.value) {
              break;
            }
          } catch (e) {
            // Ignore malformed line
          }
        }

        if (Date.now() - lastFlushTime > FLUSH_INTERVAL) {
          flushBatch();
          // Yield to main thread for render frame
          await new Promise((r) => setTimeout(r, 0));
        }
      }
    }

    // Process leftover line
    if (lineRemainder.trim() && items.value.length + batch.length < memoryLimit.value) {
      try {
        const parsed = JSON.parse(lineRemainder.trim());
        if (parsed?.channel && parsed?.res?.answers) {
          const answers = parsed.res.answers;
          batch.push({
            channel: parsed.channel,
            topic: answers.topic?.choice || "unknown",
            topicConf: Number(answers.topic?.confidence || 0),
            topicProbs: answers.topic?.probabilities || {},
            country: answers.target_country?.choice || "unknown",
            countryConf: Number(answers.target_country?.confidence || 0),
            countryProbs: answers.target_country?.probabilities || {},
            domestic: Number(answers.is_domestic_affairs?.noul ?? 0),
            tokensIn: Number(parsed.res.usage?.input_tokens || 0),
            tokensOut: Number(parsed.res.usage?.output_tokens || 0),
            latencyMs: Number(parsed.res.latency_ms || 0),
            model: String(parsed.res.model || "kev-latest")
          });
        }
      } catch (e) {}
    }

    flushBatch();
    isCompleted.value = true;
  } catch (err: any) {
    if (err.name !== "AbortError") {
      console.error("Classification stream error:", err);
      streamError.value = err.message || "Failed to stream classification data";
    }
  } finally {
    isStreaming.value = false;
    readerRef = null;
  }
};

const pauseStream = () => {
  isPaused.value = true;
  if (abortController) {
    abortController.abort();
  }
  isStreaming.value = false;
};

const reloadStream = () => {
  pauseStream();
  startStreaming(false);
};

// Start streaming automatically on mount
onMounted(() => {
  startStreaming(false);
});

onUnmounted(() => {
  if (abortController) {
    abortController.abort();
  }
});

// Topic & Country count aggregations for quick filter badges
const topicCounts = computed(() => {
  const map: Record<string, number> = {};
  for (const item of items.value) {
    map[item.topic] = (map[item.topic] || 0) + 1;
  }
  return map;
});

const countryCounts = computed(() => {
  const map: Record<string, number> = {};
  for (const item of items.value) {
    map[item.country] = (map[item.country] || 0) + 1;
  }
  return map;
});

// Preset domestic handler
const applyDomesticPreset = (preset: "all" | "high" | "mid" | "low") => {
  domesticPreset.value = preset;
  if (preset === "all") domesticMinScore.value = 0;
  else if (preset === "high") domesticMinScore.value = 0.6;
  else if (preset === "mid") domesticMinScore.value = 0.3;
  else if (preset === "low") domesticMinScore.value = 0;
};

// Filtered and Sorted Channel List
const filteredItems = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();
  const topicFilter = selectedTopic.value;
  const countryFilter = selectedCountry.value;
  const preset = domesticPreset.value;
  const minDom = domesticMinScore.value;

  return items.value
    .filter((item) => {
      // 1. Channel Search
      if (query && !item.channel.toLowerCase().includes(query)) {
        return false;
      }
      // 2. Topic
      if (topicFilter !== "all" && item.topic !== topicFilter) {
        return false;
      }
      // 3. Country
      if (countryFilter !== "all" && item.country !== countryFilter) {
        return false;
      }
      // 4. Domestic Affairs
      if (preset === "high" && item.domestic < 0.6) {
        return false;
      } else if (preset === "mid" && (item.domestic < 0.3 || item.domestic >= 0.6)) {
        return false;
      } else if (preset === "low" && item.domestic >= 0.3) {
        return false;
      } else if (preset === "all" && minDom > 0 && item.domestic < minDom) {
        return false;
      }

      return true;
    })
    .sort((a, b) => {
      if (sortBy.value === "topicConf") return b.topicConf - a.topicConf;
      if (sortBy.value === "countryConf") return b.countryConf - a.countryConf;
      if (sortBy.value === "domesticDesc") return b.domestic - a.domestic;
      if (sortBy.value === "domesticAsc") return a.domestic - b.domestic;
      if (sortBy.value === "channelAsc") return a.channel.localeCompare(b.channel);
      if (sortBy.value === "latencyAsc") return a.latencyMs - b.latencyMs;
      return 0;
    });
});

// Reset page on filter changes
watch([searchQuery, selectedTopic, selectedCountry, domesticPreset, domesticMinScore, sortBy, pageSize], () => {
  currentPage.value = 1;
});

// Paginated View Items
const totalFilteredPages = computed(() => Math.max(1, Math.ceil(filteredItems.value.length / pageSize.value)));

const paginatedItems = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value;
  return filteredItems.value.slice(start, start + pageSize.value);
});

// Helper for topic configuration
const getTopicInfo = (topic: string) => {
  return TOPIC_CONFIG[topic] || { label: topic, color: "text-gray-700 dark:text-gray-300", bg: "bg-gray-100 dark:bg-gray-800", border: "border-gray-200 dark:border-gray-700" };
};

const getCountryInfo = (country: string) => {
  return COUNTRY_CONFIG[country] || { label: country, flag: "🌐" };
};

// Sort probabilities for multi-segment bars
const getSortedProbs = (probs: Record<string, number>, max = 3) => {
  return Object.entries(probs)
    .sort((a, b) => b[1] - a[1])
    .slice(0, max);
};

// Color palettes for multi-segment bars
const getTopicSegmentColor = (topic: string) => {
  const map: Record<string, string> = {
    technology: "bg-cyan-500",
    general_news: "bg-blue-500",
    blog: "bg-emerald-500",
    financial: "bg-amber-500",
    military: "bg-rose-500",
    university: "bg-purple-500",
    political: "bg-indigo-500",
    game: "bg-fuchsia-500",
    spam: "bg-gray-400"
  };
  return map[topic] || "bg-indigo-400";
};

const getCountrySegmentColor = (country: string) => {
  const map: Record<string, string> = {
    russia: "bg-rose-500",
    china: "bg-red-500",
    united_states: "bg-blue-500",
    ukraine: "bg-yellow-400",
    taiwan: "bg-emerald-500",
    israel_palestine: "bg-teal-500",
    iran: "bg-green-600",
    international: "bg-indigo-500",
    other: "bg-slate-400"
  };
  return map[country] || "bg-sky-400";
};

// Trigger Explorer Tab Jump
const handleExplore = (channel: string) => {
  emit("explore-channel", channel);
};
</script>

<template>
  <div class="w-full max-w-full mx-auto px-0 pt-1 pb-20 space-y-6">
    <!-- Header & Intelligence Summary -->
    <div class="bg-white dark:bg-gray-800/90 rounded-2xl border border-gray-200/80 dark:border-gray-700/80 p-5 shadow-sm space-y-4">
      <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div class="flex items-center gap-2.5">
            <div class="p-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 border border-indigo-200/60 dark:border-indigo-800/50">
              <Tag class="w-5 h-5" />
            </div>
            <div>
              <h2 class="text-lg font-extrabold text-gray-900 dark:text-white tracking-tight flex items-center gap-2">
                Types & Classification Intelligence
                <span class="text-xs font-mono px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                  exchange/classify.json
                </span>
              </h2>
              <p class="text-xs text-gray-500 dark:text-gray-400">
                Streaming model inferences for topic taxonomy, target country distribution, and domestic affairs assessment
              </p>
            </div>
          </div>
        </div>

        <!-- Ingestion Controls & Safety Cap -->
        <div class="flex flex-wrap items-center gap-3">
          <!-- Memory Cap Selector -->
          <div class="flex items-center gap-1.5 text-xs bg-gray-50 dark:bg-gray-900/60 px-3 py-1.5 rounded-xl border border-gray-200 dark:border-gray-700">
            <span class="text-gray-500 dark:text-gray-400 font-medium">Memory Cap:</span>
            <select
              v-model="memoryLimit"
              @change="reloadStream"
              class="bg-transparent font-bold text-gray-800 dark:text-gray-200 outline-none cursor-pointer"
            >
              <option
                v-for="opt in MAX_LIMIT_OPTIONS"
                :key="opt.label"
                :value="opt.value"
                class="dark:bg-gray-800 text-gray-900 dark:text-white"
              >
                {{ opt.label }}
              </option>
            </select>
          </div>

          <!-- Action Buttons -->
          <div class="flex items-center gap-1.5">
            <button
              v-if="isStreaming && !isPaused"
              @click="pauseStream"
              class="flex items-center gap-1 px-3 py-1.5 text-xs font-bold rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:hover:bg-amber-900/60 dark:text-amber-300 border border-amber-200 dark:border-amber-800 transition cursor-pointer"
              title="Pause streaming ingestion"
            >
              <Pause class="w-3.5 h-3.5" />
              <span>Pause</span>
            </button>
            <button
              v-else-if="!isCompleted"
              @click="startStreaming(true)"
              class="flex items-center gap-1 px-3 py-1.5 text-xs font-bold rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:hover:bg-emerald-900/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 transition cursor-pointer"
              title="Resume streaming ingestion"
            >
              <Play class="w-3.5 h-3.5" />
              <span>Resume</span>
            </button>
            <button
              @click="reloadStream"
              class="flex items-center gap-1 px-3 py-1.5 text-xs font-bold rounded-xl bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 transition cursor-pointer"
              title="Reload from beginning"
            >
              <RefreshCw :class="['w-3.5 h-3.5', isStreaming ? 'animate-spin text-indigo-500' : '']" />
              <span>Reload</span>
            </button>
          </div>
        </div>
      </div>

      <!-- Ingestion Stream Progress Bar -->
      <div class="space-y-1.5 pt-1">
        <div class="flex items-center justify-between text-[11px] font-mono text-gray-500 dark:text-gray-400">
          <div class="flex items-center gap-2">
            <span v-if="isStreaming" class="flex items-center gap-1.5 text-indigo-600 dark:text-indigo-400 font-bold">
              <span class="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></span>
              Streaming NDJSON...
            </span>
            <span v-else-if="isCompleted" class="text-emerald-600 dark:text-emerald-400 font-bold">
              ✓ Ingestion Complete
            </span>
            <span v-else-if="isPaused" class="text-amber-600 dark:text-amber-400 font-bold">
              ⏸ Paused
            </span>
            <span class="tabular-nums">
              {{ items.length.toLocaleString() }} channels active
              <span v-if="totalParsedLines > items.length" class="text-gray-400">({{ totalParsedLines.toLocaleString() }} parsed)</span>
            </span>
          </div>
          <div class="tabular-nums">
            {{ (loadedBytes / (1024 * 1024)).toFixed(1) }} MB
            <span class="text-gray-400">/ ~{{ (totalBytesEstimated / (1024 * 1024)).toFixed(1) }} MB</span>
            ({{ Math.min(100, Math.round((loadedBytes / totalBytesEstimated) * 100)) }}%)
          </div>
        </div>
        <div class="w-full h-1.5 bg-gray-100 dark:bg-gray-700/60 rounded-full overflow-hidden">
          <div
            class="h-full bg-gradient-to-r from-indigo-500 to-cyan-500 transition-all duration-300"
            :style="{ width: `${Math.min(100, Math.round((loadedBytes / totalBytesEstimated) * 100))}%` }"
          ></div>
        </div>
      </div>
    </div>

    <!-- Filters, Search & Facet Control Deck -->
    <div class="bg-white dark:bg-gray-800/90 rounded-2xl border border-gray-200/80 dark:border-gray-700/80 p-5 shadow-sm space-y-4">
      <!-- Row 1: Search & Sort Bar -->
      <div class="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        <!-- Channel Search -->
        <div class="relative flex-1 max-w-md">
          <Search class="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            v-model="searchQuery"
            type="text"
            placeholder="Search channel username (e.g. husainov_photo, a11y)..."
            class="w-full pl-10 pr-9 py-2 text-xs sm:text-sm bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-indigo-500/40 outline-none text-gray-900 dark:text-white transition"
          />
          <button
            v-if="searchQuery"
            @click="searchQuery = ''"
            class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          >
            <X class="w-3.5 h-3.5" />
          </button>
        </div>

        <!-- Sort & Domestic Quick Controls -->
        <div class="flex flex-wrap items-center gap-2.5">
          <!-- Domestic Affairs Presets -->
          <div class="flex items-center gap-1 p-1 bg-gray-100 dark:bg-gray-900/60 rounded-xl border border-gray-200/60 dark:border-gray-700/60 text-xs">
            <span class="text-[10px] uppercase font-bold tracking-wider text-gray-400 px-2">Domestic:</span>
            <button
              @click="applyDomesticPreset('all')"
              :class="[
                'px-2.5 py-1 rounded-lg font-bold transition cursor-pointer',
                domesticPreset === 'all'
                  ? 'bg-white dark:bg-gray-800 text-indigo-600 dark:text-indigo-400 shadow-sm'
                  : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'
              ]"
            >
              All
            </button>
            <button
              @click="applyDomesticPreset('high')"
              :class="[
                'px-2.5 py-1 rounded-lg font-bold transition cursor-pointer',
                domesticPreset === 'high'
                  ? 'bg-white dark:bg-gray-800 text-purple-600 dark:text-purple-400 shadow-sm'
                  : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'
              ]"
            >
              High (≥0.6)
            </button>
            <button
              @click="applyDomesticPreset('mid')"
              :class="[
                'px-2.5 py-1 rounded-lg font-bold transition cursor-pointer',
                domesticPreset === 'mid'
                  ? 'bg-white dark:bg-gray-800 text-purple-600 dark:text-purple-400 shadow-sm'
                  : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'
              ]"
            >
              Mid (0.3-0.6)
            </button>
            <button
              @click="applyDomesticPreset('low')"
              :class="[
                'px-2.5 py-1 rounded-lg font-bold transition cursor-pointer',
                domesticPreset === 'low'
                  ? 'bg-white dark:bg-gray-800 text-purple-600 dark:text-purple-400 shadow-sm'
                  : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'
              ]"
            >
              Low (&lt;0.3)
            </button>
          </div>

          <!-- Sort Select -->
          <div class="flex items-center gap-1.5 text-xs bg-gray-50 dark:bg-gray-900 px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700">
            <SlidersHorizontal class="w-3.5 h-3.5 text-gray-400" />
            <select
              v-model="sortBy"
              class="bg-transparent font-bold text-gray-800 dark:text-gray-200 outline-none cursor-pointer"
            >
              <option value="topicConf" class="dark:bg-gray-800">Topic Confidence (High → Low)</option>
              <option value="countryConf" class="dark:bg-gray-800">Country Confidence (High → Low)</option>
              <option value="domesticDesc" class="dark:bg-gray-800">Domestic Score (High → Low)</option>
              <option value="domesticAsc" class="dark:bg-gray-800">Domestic Score (Low → High)</option>
              <option value="channelAsc" class="dark:bg-gray-800">Channel Name (A → Z)</option>
              <option value="latencyAsc" class="dark:bg-gray-800">Latency (Fastest)</option>
            </select>
          </div>
        </div>
      </div>

      <!-- Row 2: Topic Chips -->
      <div class="space-y-1.5">
        <label class="block text-[10px] font-black uppercase tracking-wider text-gray-400 dark:text-gray-500">
          Filter By Topic
        </label>
        <div class="flex flex-wrap items-center gap-1.5">
          <button
            @click="selectedTopic = 'all'"
            :class="[
              'px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer',
              selectedTopic === 'all'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'bg-gray-100 hover:bg-gray-200 dark:bg-gray-700/60 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300'
            ]"
          >
            All Topics
            <span class="text-[10px] px-1.5 py-0.2 rounded-full font-mono" :class="selectedTopic === 'all' ? 'bg-white/20' : 'bg-gray-200 dark:bg-gray-600'">
              {{ items.length.toLocaleString() }}
            </span>
          </button>
          <button
            v-for="(cfg, key) in TOPIC_CONFIG"
            :key="key"
            @click="selectedTopic = key"
            :class="[
              'px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer',
              selectedTopic === key
                ? 'bg-indigo-600 text-white shadow-sm ring-2 ring-indigo-500/40'
                : `${cfg.bg} ${cfg.color} border ${cfg.border} hover:opacity-80`
            ]"
          >
            <span>{{ cfg.label }}</span>
            <span
              class="text-[10px] px-1.5 py-0.2 rounded-full font-mono"
              :class="selectedTopic === key ? 'bg-white/20' : 'bg-black/5 dark:bg-white/10'"
            >
              {{ (topicCounts[key] || 0).toLocaleString() }}
            </span>
          </button>
        </div>
      </div>

      <!-- Row 3: Target Country Chips -->
      <div class="space-y-1.5">
        <label class="block text-[10px] font-black uppercase tracking-wider text-gray-400 dark:text-gray-500">
          Filter By Target Country
        </label>
        <div class="flex flex-wrap items-center gap-1.5">
          <button
            @click="selectedCountry = 'all'"
            :class="[
              'px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer',
              selectedCountry === 'all'
                ? 'bg-cyan-600 text-white shadow-sm'
                : 'bg-gray-100 hover:bg-gray-200 dark:bg-gray-700/60 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300'
            ]"
          >
            All Countries
            <span class="text-[10px] px-1.5 py-0.2 rounded-full font-mono" :class="selectedCountry === 'all' ? 'bg-white/20' : 'bg-gray-200 dark:bg-gray-600'">
              {{ items.length.toLocaleString() }}
            </span>
          </button>
          <button
            v-for="(cfg, key) in COUNTRY_CONFIG"
            :key="key"
            @click="selectedCountry = key"
            :class="[
              'px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer',
              selectedCountry === key
                ? 'bg-cyan-600 text-white shadow-sm ring-2 ring-cyan-500/40'
                : 'bg-gray-50 dark:bg-gray-900/60 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800'
            ]"
          >
            <span>{{ cfg.flag }} {{ cfg.label }}</span>
            <span
              class="text-[10px] px-1.5 py-0.2 rounded-full font-mono"
              :class="selectedCountry === key ? 'bg-white/20' : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400'"
            >
              {{ (countryCounts[key] || 0).toLocaleString() }}
            </span>
          </button>
        </div>
      </div>
    </div>

    <!-- Active Filter Summary & Pagination Bar -->
    <div class="flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-gray-500 dark:text-gray-400 px-1">
      <div class="flex items-center gap-2">
        <span>
          Showing
          <strong class="text-gray-900 dark:text-white font-mono tabular-nums">
            {{ filteredItems.length === 0 ? 0 : (currentPage - 1) * pageSize + 1 }}
          </strong>
          –
          <strong class="text-gray-900 dark:text-white font-mono tabular-nums">
            {{ Math.min(currentPage * pageSize, filteredItems.length) }}
          </strong>
          of
          <strong class="text-gray-900 dark:text-white font-mono tabular-nums">
            {{ filteredItems.length.toLocaleString() }}
          </strong>
          matching channels
        </span>
      </div>

      <!-- Page Nav Controls -->
      <div class="flex items-center gap-2">
        <!-- Page size selector -->
        <div class="flex items-center gap-1">
          <span class="text-[11px]">Per page:</span>
          <select
            v-model="pageSize"
            class="bg-gray-100 dark:bg-gray-800 font-bold px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 outline-none cursor-pointer"
          >
            <option v-for="sz in PAGE_SIZE_OPTIONS" :key="sz" :value="sz">{{ sz }}</option>
          </select>
        </div>

        <div class="flex items-center gap-1">
          <button
            @click="currentPage = Math.max(1, currentPage - 1)"
            :disabled="currentPage <= 1"
            class="p-1.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition"
          >
            <ChevronLeft class="w-4 h-4" />
          </button>
          <span class="px-2 font-mono font-bold text-gray-800 dark:text-gray-200">
            {{ currentPage }} / {{ totalFilteredPages }}
          </span>
          <button
            @click="currentPage = Math.min(totalFilteredPages, currentPage + 1)"
            :disabled="currentPage >= totalFilteredPages"
            class="p-1.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition"
          >
            <ChevronRight class="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>

    <!-- Empty State -->
    <div
      v-if="filteredItems.length === 0"
      class="bg-white dark:bg-gray-800/80 rounded-3xl border border-gray-200 dark:border-gray-700 p-12 text-center space-y-3"
    >
      <div class="w-12 h-12 rounded-2xl bg-gray-100 dark:bg-gray-700 text-gray-400 mx-auto flex items-center justify-center">
        <Search class="w-6 h-6" />
      </div>
      <h3 class="text-sm font-bold text-gray-900 dark:text-white">No classified channels match current filters</h3>
      <p class="text-xs text-gray-500 dark:text-gray-400 max-w-md mx-auto">
        Try resetting the search query or expanding the topic/country filters.
      </p>
      <button
        @click="searchQuery = ''; selectedTopic = 'all'; selectedCountry = 'all'; applyDomesticPreset('all')"
        class="px-4 py-2 text-xs font-bold rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 transition cursor-pointer"
      >
        Reset Filters
      </button>
    </div>

    <!-- Classified Channels Card Grid -->
    <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      <div
        v-for="item in paginatedItems"
        :key="item.channel"
        class="bg-white dark:bg-gray-800/90 rounded-2xl border border-gray-200/80 dark:border-gray-700/80 p-4.5 shadow-sm hover:shadow-md transition-all duration-200 flex flex-col justify-between space-y-3.5 group relative"
      >
        <!-- Card Header: Avatar, Name & Actions -->
        <div class="flex items-start justify-between gap-2.5">
          <div class="flex items-center gap-2.5 min-w-0 flex-1">
            <div class="relative shrink-0">
              <img
                :src="`https://i.gogingko.net/api/v1/v/telegram-profile/${item.channel}`"
                @error="($event.target as HTMLElement).style.display = 'none'"
                class="w-9 h-9 rounded-full object-cover border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-700"
                alt=""
              />
              <div class="w-9 h-9 rounded-full bg-indigo-100 dark:bg-indigo-950/80 text-indigo-600 dark:text-indigo-400 flex items-center justify-center text-xs font-bold uppercase -z-10 absolute inset-0">
                {{ item.channel.charAt(0) }}
              </div>
            </div>
            <div class="min-w-0 flex-1">
              <h4 class="text-xs font-extrabold text-gray-900 dark:text-white truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition" :title="item.channel">
                @{{ item.channel }}
              </h4>
              <div class="flex items-center gap-1.5 text-[10px] text-gray-400 font-mono">
                <span>{{ item.model }}</span>
                <span>·</span>
                <span>{{ Math.round(item.latencyMs) }}ms</span>
              </div>
            </div>
          </div>

          <!-- Quick Action Buttons -->
          <div class="flex items-center gap-1 shrink-0">
            <button
              @click="openDrawer(item)"
              class="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition cursor-pointer"
              title="Inspect probability distributions"
            >
              <Eye class="w-4 h-4" />
            </button>
            <button
              @click="handleExplore(item.channel)"
              class="p-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/60 dark:hover:bg-indigo-900 text-indigo-600 dark:text-indigo-300 transition cursor-pointer"
              title="Jump to Explorer to view posts"
            >
              <ArrowUpRight class="w-4 h-4" />
            </button>
          </div>
        </div>

        <!-- Section 1: Topic Distribution -->
        <div class="space-y-1.5 bg-gray-50/70 dark:bg-gray-900/40 p-2.5 rounded-xl border border-gray-100 dark:border-gray-800/60">
          <div class="flex items-center justify-between text-xs">
            <span class="text-[10px] font-black uppercase tracking-wider text-gray-400 dark:text-gray-500">
              Topic
            </span>
            <span class="font-extrabold text-gray-800 dark:text-gray-200 capitalize">
              {{ getTopicInfo(item.topic).label }}
              <span class="text-[10px] font-mono font-normal text-indigo-600 dark:text-indigo-400 tabular-nums">
                ({{ Math.round(item.topicConf * 100) }}%)
              </span>
            </span>
          </div>

          <!-- Proportional Multi-Segment Topic Bar -->
          <div class="w-full h-2 bg-gray-200/80 dark:bg-gray-700/60 rounded-full overflow-hidden flex" title="Topic probability distribution">
            <div
              v-for="[topKey, prob] in getSortedProbs(item.topicProbs, 4)"
              :key="topKey"
              :class="getTopicSegmentColor(topKey)"
              :style="{ width: `${Math.round(prob * 100)}%` }"
              :title="`${getTopicInfo(topKey).label}: ${Math.round(prob * 100)}%`"
            ></div>
          </div>

          <div class="flex items-center justify-between text-[10px] text-gray-400 font-mono">
            <span class="truncate">
              {{ getSortedProbs(item.topicProbs, 2).map(([k, p]) => `${getTopicInfo(k).label} ${Math.round(p * 100)}%`).join(' · ') }}
            </span>
          </div>
        </div>

        <!-- Section 2: Target Country Distribution -->
        <div class="space-y-1.5 bg-gray-50/70 dark:bg-gray-900/40 p-2.5 rounded-xl border border-gray-100 dark:border-gray-800/60">
          <div class="flex items-center justify-between text-xs">
            <span class="text-[10px] font-black uppercase tracking-wider text-gray-400 dark:text-gray-500">
              Target Country
            </span>
            <span class="font-extrabold text-gray-800 dark:text-gray-200 capitalize flex items-center gap-1">
              <span>{{ getCountryInfo(item.country).flag }}</span>
              <span>{{ getCountryInfo(item.country).label }}</span>
              <span class="text-[10px] font-mono font-normal text-cyan-600 dark:text-cyan-400 tabular-nums">
                ({{ Math.round(item.countryConf * 100) }}%)
              </span>
            </span>
          </div>

          <!-- Proportional Multi-Segment Country Bar -->
          <div class="w-full h-2 bg-gray-200/80 dark:bg-gray-700/60 rounded-full overflow-hidden flex" title="Country probability distribution">
            <div
              v-for="[cKey, prob] in getSortedProbs(item.countryProbs, 4)"
              :key="cKey"
              :class="getCountrySegmentColor(cKey)"
              :style="{ width: `${Math.round(prob * 100)}%` }"
              :title="`${getCountryInfo(cKey).label}: ${Math.round(prob * 100)}%`"
            ></div>
          </div>

          <div class="flex items-center justify-between text-[10px] text-gray-400 font-mono">
            <span class="truncate">
              {{ getSortedProbs(item.countryProbs, 2).map(([k, p]) => `${getCountryInfo(k).label} ${Math.round(p * 100)}%`).join(' · ') }}
            </span>
          </div>
        </div>

        <!-- Section 3: Domestic Affairs Ratio -->
        <div class="space-y-1 bg-gray-50/70 dark:bg-gray-900/40 p-2.5 rounded-xl border border-gray-100 dark:border-gray-800/60">
          <div class="flex items-center justify-between text-xs">
            <span class="text-[10px] font-black uppercase tracking-wider text-gray-400 dark:text-gray-500">
              Domestic Affairs
            </span>
            <span class="font-mono font-extrabold text-xs tabular-nums" :class="item.domestic >= 0.6 ? 'text-purple-600 dark:text-purple-400' : 'text-gray-700 dark:text-gray-300'">
              {{ item.domestic.toFixed(2) }}
              <span class="text-[10px] font-normal text-gray-400">
                ({{ item.domestic >= 0.6 ? 'Domestic' : item.domestic >= 0.3 ? 'Balanced' : 'External' }})
              </span>
            </span>
          </div>
          <div class="w-full h-1.5 bg-gray-200/80 dark:bg-gray-700/60 rounded-full overflow-hidden">
            <div
              class="h-full bg-gradient-to-r from-purple-500 to-indigo-500"
              :style="{ width: `${Math.round(item.domestic * 100)}%` }"
            ></div>
          </div>
        </div>

        <!-- Card Footer Action Bar -->
        <div class="pt-2 border-t border-gray-100 dark:border-gray-700/60 flex items-center justify-between">
          <div class="text-[10px] font-mono text-gray-400">
            Tokens: {{ (item.tokensIn / 1000).toFixed(1) }}k in
          </div>
          <button
            @click="handleExplore(item.channel)"
            class="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 flex items-center gap-1 cursor-pointer"
          >
            <span>Explore Channel</span>
            <ArrowUpRight class="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>

    <!-- Bottom Pagination Footer -->
    <div v-if="filteredItems.length > 0" class="flex flex-col sm:flex-row items-center justify-between gap-3 pt-4 border-t border-gray-200/80 dark:border-gray-700/80 text-xs">
      <div class="text-gray-500 dark:text-gray-400 font-mono">
        Page {{ currentPage }} of {{ totalFilteredPages }} ({{ filteredItems.length.toLocaleString() }} total channels)
      </div>

      <div class="flex items-center gap-1.5">
        <button
          @click="currentPage = 1"
          :disabled="currentPage <= 1"
          class="px-2.5 py-1.5 rounded-xl border border-gray-200 dark:border-gray-700 font-bold hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition"
        >
          First
        </button>
        <button
          @click="currentPage = Math.max(1, currentPage - 1)"
          :disabled="currentPage <= 1"
          class="px-3 py-1.5 rounded-xl border border-gray-200 dark:border-gray-700 font-bold hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition flex items-center gap-1"
        >
          <ChevronLeft class="w-3.5 h-3.5" />
          <span>Prev</span>
        </button>
        <button
          @click="currentPage = Math.min(totalFilteredPages, currentPage + 1)"
          :disabled="currentPage >= totalFilteredPages"
          class="px-3 py-1.5 rounded-xl border border-gray-200 dark:border-gray-700 font-bold hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition flex items-center gap-1"
        >
          <span>Next</span>
          <ChevronRight class="w-3.5 h-3.5" />
        </button>
        <button
          @click="currentPage = totalFilteredPages"
          :disabled="currentPage >= totalFilteredPages"
          class="px-2.5 py-1.5 rounded-xl border border-gray-200 dark:border-gray-700 font-bold hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition"
        >
          Last
        </button>
      </div>
    </div>

    <!-- Slide-over Inspection Drawer -->
    <Teleport to="body">
      <Transition
        enter-active-class="transition-opacity ease-out duration-300"
        enter-from-class="opacity-0"
        enter-to-class="opacity-100"
        leave-active-class="transition-opacity ease-in duration-200"
        leave-from-class="opacity-100"
        leave-to-class="opacity-0"
      >
        <div
          v-if="isDrawerOpen && selectedInspectionItem"
          class="fixed inset-0 z-[120] bg-black/60 backdrop-blur-xs flex justify-end"
          @click="closeDrawer"
        >
          <div
            class="w-full max-w-lg bg-white dark:bg-gray-800 h-full shadow-2xl p-6 overflow-y-auto space-y-6 flex flex-col justify-between"
            @click.stop
          >
            <!-- Drawer Header -->
            <div class="space-y-4">
              <div class="flex items-center justify-between pb-3 border-b border-gray-100 dark:border-gray-700/60">
                <div class="flex items-center gap-3">
                  <img
                    :src="`https://i.gogingko.net/api/v1/v/telegram-profile/${selectedInspectionItem.channel}`"
                    class="w-11 h-11 rounded-full object-cover border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-700"
                    alt=""
                  />
                  <div>
                    <h3 class="text-base font-extrabold text-gray-900 dark:text-white">
                      @{{ selectedInspectionItem.channel }}
                    </h3>
                    <p class="text-xs text-gray-500 dark:text-gray-400">
                      Deep Probability Breakdown & Metrics
                    </p>
                  </div>
                </div>
                <button
                  @click="closeDrawer"
                  class="p-2 rounded-xl text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition cursor-pointer"
                >
                  <X class="w-5 h-5" />
                </button>
              </div>

              <!-- Primary Highlights -->
              <div class="grid grid-cols-3 gap-3 text-center">
                <div class="p-3 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200/60 dark:border-indigo-800/60">
                  <div class="text-[10px] font-black uppercase text-indigo-700 dark:text-indigo-300">Topic</div>
                  <div class="text-xs font-bold text-gray-900 dark:text-white capitalize truncate mt-0.5">
                    {{ selectedInspectionItem.topic }}
                  </div>
                  <div class="text-[11px] font-mono font-bold text-indigo-600 dark:text-indigo-400">
                    {{ Math.round(selectedInspectionItem.topicConf * 100) }}%
                  </div>
                </div>

                <div class="p-3 rounded-xl bg-cyan-50 dark:bg-cyan-950/40 border border-cyan-200/60 dark:border-cyan-800/60">
                  <div class="text-[10px] font-black uppercase text-cyan-700 dark:text-cyan-300">Country</div>
                  <div class="text-xs font-bold text-gray-900 dark:text-white capitalize truncate mt-0.5">
                    {{ selectedInspectionItem.country }}
                  </div>
                  <div class="text-[11px] font-mono font-bold text-cyan-600 dark:text-cyan-400">
                    {{ Math.round(selectedInspectionItem.countryConf * 100) }}%
                  </div>
                </div>

                <div class="p-3 rounded-xl bg-purple-50 dark:bg-purple-950/40 border border-purple-200/60 dark:border-purple-800/60">
                  <div class="text-[10px] font-black uppercase text-purple-700 dark:text-purple-300">Domestic</div>
                  <div class="text-xs font-bold text-gray-900 dark:text-white truncate mt-0.5">
                    {{ selectedInspectionItem.domestic >= 0.6 ? 'Domestic' : 'External' }}
                  </div>
                  <div class="text-[11px] font-mono font-bold text-purple-600 dark:text-purple-400">
                    {{ selectedInspectionItem.domestic.toFixed(3) }}
                  </div>
                </div>
              </div>

              <!-- Topic Probabilities Table -->
              <div class="space-y-2">
                <h4 class="text-xs font-black uppercase tracking-wider text-gray-600 dark:text-gray-300 flex items-center justify-between">
                  <span>Topic Distribution (All Categories)</span>
                  <span class="text-[10px] font-mono font-normal text-gray-400">Probabilities</span>
                </h4>
                <div class="space-y-1.5 bg-gray-50 dark:bg-gray-900/60 p-3 rounded-xl border border-gray-200/60 dark:border-gray-700/60">
                  <div
                    v-for="[key, prob] in Object.entries(selectedInspectionItem.topicProbs).sort((a,b) => b[1] - a[1])"
                    :key="key"
                    class="space-y-0.5"
                  >
                    <div class="flex items-center justify-between text-xs">
                      <span class="capitalize text-gray-700 dark:text-gray-300 font-medium">
                        {{ getTopicInfo(key).label }}
                      </span>
                      <span class="font-mono text-[11px] tabular-nums font-bold text-gray-900 dark:text-gray-100">
                        {{ (prob * 100).toFixed(2) }}%
                      </span>
                    </div>
                    <div class="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                      <div
                        class="h-full bg-indigo-500 rounded-full"
                        :style="{ width: `${Math.round(prob * 100)}%` }"
                      ></div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Target Country Probabilities Table -->
              <div class="space-y-2">
                <h4 class="text-xs font-black uppercase tracking-wider text-gray-600 dark:text-gray-300 flex items-center justify-between">
                  <span>Target Country Distribution</span>
                  <span class="text-[10px] font-mono font-normal text-gray-400">Probabilities</span>
                </h4>
                <div class="space-y-1.5 bg-gray-50 dark:bg-gray-900/60 p-3 rounded-xl border border-gray-200/60 dark:border-gray-700/60">
                  <div
                    v-for="[key, prob] in Object.entries(selectedInspectionItem.countryProbs).sort((a,b) => b[1] - a[1])"
                    :key="key"
                    class="space-y-0.5"
                  >
                    <div class="flex items-center justify-between text-xs">
                      <span class="capitalize text-gray-700 dark:text-gray-300 font-medium flex items-center gap-1.5">
                        <span>{{ getCountryInfo(key).flag }}</span>
                        <span>{{ getCountryInfo(key).label }}</span>
                      </span>
                      <span class="font-mono text-[11px] tabular-nums font-bold text-gray-900 dark:text-gray-100">
                        {{ (prob * 100).toFixed(2) }}%
                      </span>
                    </div>
                    <div class="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                      <div
                        class="h-full bg-cyan-500 rounded-full"
                        :style="{ width: `${Math.round(prob * 100)}%` }"
                      ></div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Inference Telemetry -->
              <div class="space-y-2">
                <h4 class="text-xs font-black uppercase tracking-wider text-gray-600 dark:text-gray-300">
                  Model Inference Telemetry
                </h4>
                <div class="grid grid-cols-2 gap-2 text-xs bg-gray-50 dark:bg-gray-900/60 p-3 rounded-xl border border-gray-200/60 dark:border-gray-700/60 font-mono">
                  <div>
                    <span class="text-gray-400">Model:</span>
                    <span class="ml-1 text-gray-800 dark:text-gray-200 font-bold">{{ selectedInspectionItem.model }}</span>
                  </div>
                  <div>
                    <span class="text-gray-400">Latency:</span>
                    <span class="ml-1 text-gray-800 dark:text-gray-200 font-bold">{{ selectedInspectionItem.latencyMs.toFixed(1) }}ms</span>
                  </div>
                  <div>
                    <span class="text-gray-400">Input Tokens:</span>
                    <span class="ml-1 text-gray-800 dark:text-gray-200 font-bold">{{ selectedInspectionItem.tokensIn.toLocaleString() }}</span>
                  </div>
                  <div>
                    <span class="text-gray-400">Output Tokens:</span>
                    <span class="ml-1 text-gray-800 dark:text-gray-200 font-bold">{{ selectedInspectionItem.tokensOut.toLocaleString() }}</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Drawer Bottom Actions -->
            <div class="pt-4 border-t border-gray-100 dark:border-gray-700/60 space-y-2">
              <button
                @click="handleExplore(selectedInspectionItem.channel); closeDrawer()"
                class="w-full py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-md shadow-indigo-600/20 transition flex items-center justify-center gap-2 cursor-pointer"
              >
                <span>Jump to Explorer & Fetch Channel Posts</span>
                <ArrowUpRight class="w-4 h-4" />
              </button>
              <a
                :href="`https://t.me/${selectedInspectionItem.channel}`"
                target="_blank"
                rel="noopener noreferrer"
                class="w-full py-2 px-4 rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs font-bold transition flex items-center justify-center gap-1.5"
              >
                <span>Open in Telegram Web</span>
                <ExternalLink class="w-3.5 h-3.5" />
              </a>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
