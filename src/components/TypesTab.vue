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
  FileText,
  BookmarkCheck,
  Award,
  AlertTriangle,
  WifiOff,
  Zap,
  Users,
  CheckCircle2,
  Copy,
  Loader2,
  Image as ImageIcon,
  Info
} from "lucide-vue-next";
import { useI18n } from "../i18n";
import {
  probeLz4Endpoint,
  StreamingLz4FrameDecoder,
  CLASSIFY_LZ4_URL,
  CLASSIFY_RAW_URL
} from "../utils/lz4Stream";
import {
  parseNaturalLanguageQueryWithSystemOne,
  parseQueryFastRules,
  matchesDistributionAwareFilter,
  calculateDistributionAwareScore,
  type ParsedFilterCriteria
} from "../utils/systemoneFilter";

const { t } = useI18n();

const emit = defineEmits<{
  (e: "explore-channel", channel: string): void;
}>();

// Compact data structure supporting both legacy and new format
export interface ClassifiedChannel {
  channel: string;
  topic: string;
  topicConf: number;
  topicProbs: Record<string, number>;
  country: string;
  countryConf: number;
  countryProbs: Record<string, number>;
  domestic: number;
  // Read Value scoring (new format)
  hasReadValue: boolean;
  readValueScore: number | null;
  readValueProbs: Record<string, number>;
  readValueLegend?: Record<string, string> | null;
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
const totalBytesEstimated = ref(88906687); // Exact size on i.gogingko.net: 88,906,687 bytes (~88.9 MB)
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

// Resumable Range Streaming & Auto-Recovery State
const isAutoRetrying = ref(false);
const retryAttempt = ref(0);
const maxRetries = 25;
const retryCountdown = ref(0);
const lastResumedByteOffset = ref<number | null>(null);
const isRangeSupported = ref(true);
const hasParsedTotalFromContentRange = ref(false);
const contentRangeTotalLength = ref<number | null>(null);
const serverTotalLength = ref<number | null>(null);

// LZ4 Compressed Stream & Probing State
const isUsingLz4 = ref(false);
const isProbingLz4 = ref(false);
const lz4ProbeStatus = ref<"probing" | "available" | "unavailable">("probing");
const lz4ProbeMessage = ref<string>("");
const decompressedBytesCount = ref(0);
const activeStreamEndpoint = ref<string>(CLASSIFY_RAW_URL);

let abortController: AbortController | null = null;
let readerRef: ReadableStreamDefaultReader<Uint8Array> | null = null;
let streamLineRemainder = "";
let lastChunkReceivedTime = Date.now();
let stallWatchdogTimer: any = null;
let isStallTriggered = false;
let retryTimeoutId: any = null;
let retryCountdownInterval: any = null;
let profileHoverTimer: any = null;
let profileLeaveTimer: any = null;

// Filtering and Search State
const searchQuery = ref("");
const selectedTopic = ref<string>("all");
const selectedCountry = ref<string>("all");

// Natural Language SystemOne Filter State
const nlQuery = ref("");
const isNlParsing = ref(false);
const activeNlFilter = ref<ParsedFilterCriteria | null>(null);

const hasActiveNlRules = computed(() => {
  if (!activeNlFilter.value) return false;
  return (
    !!activeNlFilter.value.topic ||
    (activeNlFilter.value.targetTopics && activeNlFilter.value.targetTopics.length > 0) ||
    (activeNlFilter.value.targetRegions && activeNlFilter.value.targetRegions.length > 0) ||
    !!activeNlFilter.value.domesticOrientation ||
    (activeNlFilter.value.minReadValue !== null && activeNlFilter.value.minReadValue !== undefined)
  );
});

const NL_SUGGESTIONS = [
  { label: "🇨🇳 🇯🇵 Political China with Japan", query: "political China with Japan" },
  { label: "🪖 🇺🇦 Critical military updates in Ukraine", query: "critical military updates in Ukraine" },
  { label: "✊ 🏳️‍🌈 Social justice & civil rights", query: "social movements and civil rights" },
  { label: "💡 🤖 Tech and AI overseas developments", query: "external technology and AI" },
  { label: "📈 🇪🇺 Substantive EU financial markets", query: "substantive financial European Union" },
  { label: "🏛️ 🇺🇸 US domestic affairs", query: "domestic United States politics" }
];

const handleNlSearch = async (queryText?: string) => {
  const target = (queryText !== undefined ? queryText : nlQuery.value).trim();
  if (!target) {
    activeNlFilter.value = null;
    return;
  }
  nlQuery.value = target;

  // 1. Immediate instant fast-rules pre-filter (<5ms latency)
  activeNlFilter.value = parseQueryFastRules(target);
  sortBy.value = "aiRelevance";

  // 2. Background Kev SystemOne AI call
  isNlParsing.value = true;
  try {
    const aiParsed = await parseNaturalLanguageQueryWithSystemOne(target);
    if (nlQuery.value.trim() === target) {
      activeNlFilter.value = aiParsed;
    }
  } catch (err) {
    console.warn("Kev SystemOne NL parse error:", err);
  } finally {
    isNlParsing.value = false;
  }
};

const clearNlFilter = () => {
  nlQuery.value = "";
  activeNlFilter.value = null;
  if (sortBy.value === "aiRelevance") {
    sortBy.value = "readValDesc";
  }
};

const removeTopicCriteria = (topicToRemove?: string) => {
  if (!activeNlFilter.value) return;
  if (!topicToRemove) {
    activeNlFilter.value = {
      ...activeNlFilter.value,
      topic: null,
      topicConfidence: undefined,
      targetTopics: [],
      topicConfidences: {}
    };
    return;
  }
  const updatedTopics = (activeNlFilter.value.targetTopics || []).filter((t) => t !== topicToRemove);
  const updatedConf = { ...(activeNlFilter.value.topicConfidences || {}) };
  delete updatedConf[topicToRemove];
  activeNlFilter.value = {
    ...activeNlFilter.value,
    targetTopics: updatedTopics,
    topicConfidences: updatedConf,
    topic: updatedTopics[0] || null,
    topicConfidence: updatedTopics[0] ? updatedConf[updatedTopics[0]] : undefined
  };
};

const removeRegionCriteria = (region: string) => {
  if (!activeNlFilter.value) return;
  const updatedRegions = activeNlFilter.value.targetRegions.filter((r) => r !== region);
  const updatedConf = { ...(activeNlFilter.value.regionConfidences || {}) };
  delete updatedConf[region];
  activeNlFilter.value = {
    ...activeNlFilter.value,
    targetRegions: updatedRegions,
    regionConfidences: updatedConf
  };
};

const removeDomesticCriteria = () => {
  if (!activeNlFilter.value) return;
  activeNlFilter.value = {
    ...activeNlFilter.value,
    domesticOrientation: null,
    domesticConfidence: undefined
  };
};

const removeReadValueCriteria = () => {
  if (!activeNlFilter.value) return;
  activeNlFilter.value = {
    ...activeNlFilter.value,
    minReadValue: null,
    readValueTier: null,
    readValueConfidence: undefined
  };
};

const applyNlPreset = (presetQuery: string) => {
  handleNlSearch(presetQuery);
};

// Domestic Affairs filter
const domesticPreset = ref<"all" | "high" | "mid" | "low">("all");
const domesticMinScore = ref<number>(0);

// Read Value filter (Supports score slider, presets, and mixed legacy format)
const readValuePreset = ref<"all" | "critical" | "substantive" | "background" | "low" | "hasReadValue" | "legacyOnly" | "custom">("all");
const readValueMinScore = ref<number>(0);

const sortBy = ref<
  "aiRelevance" | "readValDesc" | "readValAsc" | "topicConf" | "countryConf" | "domesticDesc" | "domesticAsc" | "channelAsc" | "latencyAsc"
>("readValDesc");

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
  social_movements: { label: "Social Movements", color: "text-violet-700 dark:text-violet-300", bg: "bg-violet-50 dark:bg-violet-950/60", border: "border-violet-200 dark:border-violet-800" },
  spam: { label: "Spam", color: "text-gray-700 dark:text-gray-300", bg: "bg-gray-100 dark:bg-gray-800/80", border: "border-gray-200 dark:border-gray-700" }
};

// Target Country Metadata & Styling (Expanded with us_allies_asia, european_union, africa)
export interface CountryMeta {
  label: string;
  flag: string;
  isNew?: boolean;
}

const COUNTRY_CONFIG: Record<string, CountryMeta> = {
  russia: { label: "Russia", flag: "🇷🇺" },
  china: { label: "China", flag: "🇨🇳" },
  united_states: { label: "United States", flag: "🇺🇸" },
  european_union: { label: "European Union", flag: "🇪🇺", isNew: true },
  us_allies_asia: { label: "US Allies (Asia)", flag: "🌏", isNew: true },
  ukraine: { label: "Ukraine", flag: "🇺🇦" },
  taiwan: { label: "Taiwan", flag: "🇹🇼" },
  israel_palestine: { label: "Israel/Palestine", flag: "🕊️" },
  iran: { label: "Iran", flag: "🇮🇷" },
  africa: { label: "Africa", flag: "🌍", isNew: true },
  international: { label: "International", flag: "🌐" },
  other: { label: "Other", flag: "🗺️" }
};

// Standard Read Value Legend
const DEFAULT_READ_LEGEND: Record<string, string> = {
  "0": "0: Fluff, greetings, boilerplate, rhetorical banter, or low-information chatter.",
  "1": "1: Background context, emotional sentiment, subjective opinion, or common knowledge.",
  "2": "2: Relevant circumstantial context, unverified claims, or secondary commentary.",
  "3": "3: Critical facts, quantitative metrics, verified actions, breaking events, entity disclosures, or decisive operational changes."
};

// Read Value Level Definition Helper
const getReadValueTier = (score: number | null) => {
  if (score === null || score === undefined) {
    return {
      label: "Legacy (No Score)",
      shortLabel: "Legacy",
      color: "text-gray-500 dark:text-gray-400",
      bg: "bg-gray-100 dark:bg-gray-800",
      border: "border-gray-200 dark:border-gray-700",
      level: -1
    };
  }
  if (score >= 2.2) {
    return {
      label: "Critical Facts",
      shortLabel: "L3 Critical",
      color: "text-emerald-700 dark:text-emerald-300",
      bg: "bg-emerald-50 dark:bg-emerald-950/60",
      border: "border-emerald-200 dark:border-emerald-800",
      level: 3
    };
  }
  if (score >= 1.5) {
    return {
      label: "Substantive",
      shortLabel: "L2 Substantive",
      color: "text-blue-700 dark:text-blue-300",
      bg: "bg-blue-50 dark:bg-blue-950/60",
      border: "border-blue-200 dark:border-blue-800",
      level: 2
    };
  }
  if (score >= 0.8) {
    return {
      label: "Background",
      shortLabel: "L1 Background",
      color: "text-amber-700 dark:text-amber-300",
      bg: "bg-amber-50 dark:bg-amber-950/60",
      border: "border-amber-200 dark:border-amber-800",
      level: 1
    };
  }
  return {
    label: "Low Info Chatter",
    shortLabel: "L0 Chatter",
    color: "text-slate-600 dark:text-slate-400",
    bg: "bg-slate-100 dark:bg-slate-800/80",
    border: "border-slate-200 dark:border-slate-700",
    level: 0
  };
};

// Parse NDJSON line into strongly-typed ClassifiedChannel
const parseLineToItem = (raw: string): ClassifiedChannel | null => {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.channel || !parsed.res || !parsed.res.answers) {
      return null;
    }

    const answers = parsed.res.answers;
    const topic = answers.topic?.choice || "unknown";
    const topicConf = Number(answers.topic?.confidence || 0);
    const topicProbs = answers.topic?.probabilities || {};

    const country = answers.target_country?.choice || "unknown";
    const countryConf = Number(answers.target_country?.confidence || 0);
    const countryProbs = answers.target_country?.probabilities || {};

    const domestic = Number(answers.is_domestic_affairs?.noul ?? 0);

    // Parse read_value (handles both old format without read_value and new format with read_value)
    const readVal = answers.read_value;
    const hasReadValue = Boolean(readVal && typeof readVal.score === "number");
    const readValueScore = hasReadValue ? Number(readVal.score) : null;
    const readValueProbs = (hasReadValue && readVal.probabilities) ? readVal.probabilities : {};
    const readValueLegend = (hasReadValue && readVal.legend) ? readVal.legend : null;

    const tokensIn = Number(parsed.res.usage?.input_tokens || 0);
    const tokensOut = Number(parsed.res.usage?.output_tokens || 0);
    const latencyMs = Number(parsed.res.latency_ms || 0);
    const model = String(parsed.res.model || "kev-latest");

    return {
      channel: parsed.channel,
      topic,
      topicConf,
      topicProbs,
      country,
      countryConf,
      countryProbs,
      domestic,
      hasReadValue,
      readValueScore,
      readValueProbs,
      readValueLegend,
      tokensIn,
      tokensOut,
      latencyMs,
      model
    };
  } catch (e) {
    return null;
  }
};

// Retry Timer and Watchdog Management
const clearRetryTimers = () => {
  if (retryTimeoutId) {
    clearTimeout(retryTimeoutId);
    retryTimeoutId = null;
  }
  if (retryCountdownInterval) {
    clearInterval(retryCountdownInterval);
    retryCountdownInterval = null;
  }
  isAutoRetrying.value = false;
  retryCountdown.value = 0;
};

const stopStallWatchdog = () => {
  if (stallWatchdogTimer) {
    clearInterval(stallWatchdogTimer);
    stallWatchdogTimer = null;
  }
};

const startStallWatchdog = () => {
  stopStallWatchdog();
  stallWatchdogTimer = setInterval(() => {
    if (isStreaming.value && !isPaused.value && readerRef) {
      const elapsed = Date.now() - lastChunkReceivedTime;
      // If 20 seconds pass with zero bytes received during active streaming, network is throttled/stalled
      if (elapsed > 20000) {
        console.warn(`[Stream Watchdog] Stall detected (${Math.round(elapsed / 1000)}s without incoming data). Triggering Range resumption from byte ${loadedBytes.value}...`);
        isStallTriggered = true;
        if (abortController) {
          abortController.abort();
        }
      }
    }
  }, 2500);
};

// RFC 7233 / 9110 Content-Range parser
export interface ParsedContentRange {
  unit: string;
  start: number | null;
  end: number | null;
  total: number | null;
  raw: string;
}

const parseContentRangeHeader = (headerValue: string | null): ParsedContentRange | null => {
  if (!headerValue) return null;
  const raw = headerValue.trim();
  // Examples:
  // "bytes 0-1048575/88906687"
  // "bytes 88906687-88906686/88906687"
  // "bytes */88906687"
  // "bytes 1000-2000/*"
  const match = raw.match(/^([a-zA-Z]+)\s+(?:(\d+)-(\d+)|\*)\/(\d+|\*)$/);
  if (match) {
    const unit = match[1];
    const start = match[2] !== undefined ? parseInt(match[2], 10) : null;
    const end = match[3] !== undefined ? parseInt(match[3], 10) : null;
    const total = match[4] !== "*" ? parseInt(match[4], 10) : null;
    return { unit, start, end, total, raw };
  }

  // Fallback: extract /<number> total if present
  const totalMatch = raw.match(/\/(\d+)/);
  return {
    unit: "bytes",
    start: null,
    end: null,
    total: totalMatch ? parseInt(totalMatch[1], 10) : null,
    raw
  };
};

// Stream Ingestion Logic with HTTP Range Resume and LZ4 Frame Stream Decompression
const startStreaming = async (resume = false) => {
  clearRetryTimers();
  if (isStreaming.value && !isPaused.value) return;

  if (!resume) {
    items.value = [];
    loadedBytes.value = 0;
    decompressedBytesCount.value = 0;
    totalParsedLines.value = 0;
    streamLineRemainder = "";
    lastResumedByteOffset.value = null;
    isCompleted.value = false;
    streamError.value = null;
    retryAttempt.value = 0;
    hasParsedTotalFromContentRange.value = false;
    contentRangeTotalLength.value = null;
    serverTotalLength.value = null;

    // Step 1: Probe whether compressed object classify.json.lz4 is available
    isProbingLz4.value = true;
    lz4ProbeStatus.value = "probing";
    try {
      const probe = await probeLz4Endpoint(CLASSIFY_LZ4_URL);
      if (probe.available) {
        isUsingLz4.value = true;
        lz4ProbeStatus.value = "available";
        activeStreamEndpoint.value = CLASSIFY_LZ4_URL;
        lz4ProbeMessage.value = `LZ4 frame active (${CLASSIFY_LZ4_URL})`;
        if (probe.totalBytes) {
          totalBytesEstimated.value = probe.totalBytes;
        }
        console.log(`[LZ4 Probe] Detected valid LZ4 stream at ${CLASSIFY_LZ4_URL}. Streaming in LZ4 frame mode.`);
      } else {
        isUsingLz4.value = false;
        lz4ProbeStatus.value = "unavailable";
        activeStreamEndpoint.value = CLASSIFY_RAW_URL;
        lz4ProbeMessage.value = probe.error || "LZ4 endpoint not found, falling back to NDJSON";
        totalBytesEstimated.value = 88906687; // fallback to uncompressed size
        console.log(`[LZ4 Probe] classify.json.lz4 not available (${probe.error || '404'}). Cleanly falling back to NDJSON stream on ${CLASSIFY_RAW_URL}.`);
      }
    } catch (probeErr: any) {
      isUsingLz4.value = false;
      lz4ProbeStatus.value = "unavailable";
      activeStreamEndpoint.value = CLASSIFY_RAW_URL;
      totalBytesEstimated.value = 88906687;
      console.warn("[LZ4 Probe Error, falling back to uncompressed stream]:", probeErr);
    } finally {
      isProbingLz4.value = false;
    }
  } else {
    lastResumedByteOffset.value = loadedBytes.value;
  }

  isStreaming.value = true;
  isPaused.value = false;
  abortController = new AbortController();
  lastChunkReceivedTime = Date.now();

  const batch: ClassifiedChannel[] = [];
  const FLUSH_INTERVAL = 150; // flush to Vue state every 150ms to keep UI silky smooth
  let lastFlushTime = Date.now();
  let receivedChunks = 0;

  const flushBatch = () => {
    if (batch.length > 0) {
      items.value.push(...batch);
      batch.length = 0;
      lastFlushTime = Date.now();
    }
  };

  try {
    const headers: Record<string, string> = {};
    // Only send Range header when resuming from an already fetched offset > 0 (for raw NDJSON streams)
    if (resume && loadedBytes.value > 0 && !isUsingLz4.value) {
      headers["Range"] = `bytes=${loadedBytes.value}-`;
    }

    const targetUrl = isUsingLz4.value ? CLASSIFY_LZ4_URL : CLASSIFY_RAW_URL;
    let res = await fetch(targetUrl, {
      signal: abortController.signal,
      headers
    });

    // If LZ4 mode was requested but returned 404, immediately fallback to raw stream on i.gogingko.net
    if (isUsingLz4.value && (res.status === 404 || (!res.ok && res.status !== 206))) {
      console.warn(`[LZ4 Stream] ${targetUrl} returned ${res.status}. Falling back to ${CLASSIFY_RAW_URL}.`);
      isUsingLz4.value = false;
      totalBytesEstimated.value = 88906687;
      res = await fetch(CLASSIFY_RAW_URL, {
        signal: abortController.signal,
        headers
      });
    }

    // 416: Range Not Satisfiable
    if (res.status === 416) {
      const headerMeta: Record<string, string> = {};
      res.headers.forEach((val, key) => {
        headerMeta[key] = val;
      });

      // User instruction: Only parse Content-Range from 206, 200 response.
      // If we already parsed total object length from Content-Range in a previous 206 response:
      if (hasParsedTotalFromContentRange.value && contentRangeTotalLength.value !== null) {
        console.warn(
          `[Stream 416 Warning] Received HTTP 416 (Range Not Satisfiable), but total object length was previously parsed from Content-Range as ${contentRangeTotalLength.value} bytes (currently loaded ${loadedBytes.value} bytes). Not marking stream as completed.`,
          {
            status: res.status,
            statusText: res.statusText,
            requestedRange: headers["Range"],
            loadedBytes: loadedBytes.value,
            parsedTotalLength: contentRangeTotalLength.value,
            responseHeaders: headerMeta
          }
        );
        isStreaming.value = false;
        isAutoRetrying.value = false;
        streamError.value = `Server returned HTTP 416 (Range Not Satisfiable) at offset ${loadedBytes.value} bytes of total ${contentRangeTotalLength.value} bytes. Stream halted without marking completed.`;
        return;
      }

      console.warn(
        `[Stream 416] Received HTTP 416 with no prior Content-Range total length parsed. Marking completed.`,
        {
          status: res.status,
          statusText: res.statusText,
          requestedRange: headers["Range"],
          loadedBytes: loadedBytes.value,
          responseHeaders: headerMeta
        }
      );
      isCompleted.value = true;
      isStreaming.value = false;
      retryAttempt.value = 0;
      streamError.value = null;
      return;
    }

    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status} (${res.statusText})`);
    }

    // Inspect server response status (only parse Content-Range on 206 / 200)
    if (res.status === 206) {
      isRangeSupported.value = true;
      const contentRange = res.headers.get("content-range");
      if (contentRange) {
        const cr = parseContentRangeHeader(contentRange);
        if (cr && cr.total !== null && cr.total > 0) {
          serverTotalLength.value = cr.total;
          contentRangeTotalLength.value = cr.total;
          totalBytesEstimated.value = cr.total;
          hasParsedTotalFromContentRange.value = true;
        }

        // Synchronize loadedBytes with range start if server specified start offset
        if (cr && cr.start !== null && resume && loadedBytes.value !== cr.start && !isUsingLz4.value) {
          console.log(`[Stream Sync] Syncing loadedBytes offset from ${loadedBytes.value} to server range start ${cr.start}`);
          loadedBytes.value = cr.start;
        }

        // If server indicated range is already at or past the end, e.g. bytes 88906687-88906686/88906687
        if (cr && cr.total !== null && cr.start !== null && cr.start >= cr.total) {
          console.log(`[Stream Complete] Server 206 confirmed offset ${cr.start} has reached total object length ${cr.total} bytes.`);
          loadedBytes.value = cr.total;
          isCompleted.value = true;
          isStreaming.value = false;
          retryAttempt.value = 0;
          streamError.value = null;
          return;
        }
      }
    } else if (res.status === 200) {
      // Server returned 200 OK (initial request or server ignored Range header)
      if (resume && loadedBytes.value > 0 && !isUsingLz4.value) {
        console.warn("Server responded with 200 OK instead of 206 Partial Content. Resetting offset to 0 to prevent duplicates.");
        items.value = [];
        loadedBytes.value = 0;
        decompressedBytesCount.value = 0;
        totalParsedLines.value = 0;
        streamLineRemainder = "";
        lastResumedByteOffset.value = 0;
      }
      const contentLength = res.headers.get("content-length");
      if (contentLength) {
        const parsedLen = parseInt(contentLength, 10);
        if (!isNaN(parsedLen) && parsedLen > 0) {
          serverTotalLength.value = parsedLen;
          totalBytesEstimated.value = parsedLen;
        }
      }
    }

    if (!res.body) {
      throw new Error("ReadableStream not supported or empty body");
    }

    const reader = res.body.getReader();
    readerRef = reader;
    const decoder = new TextDecoder("utf-8");

    // Initialize Streaming LZ4 Frame Decompressor if streaming compressed file
    let lz4Decoder: StreamingLz4FrameDecoder | null = null;
    if (isUsingLz4.value) {
      lz4Decoder = new StreamingLz4FrameDecoder((decompBlock) => {
        decompressedBytesCount.value += decompBlock.byteLength;
        const chunkText = decoder.decode(decompBlock, { stream: true });
        const lines = (streamLineRemainder + chunkText).split("\n");
        streamLineRemainder = lines.pop() || "";

        for (let i = 0; i < lines.length; i++) {
          const rawLine = lines[i].trim();
          if (!rawLine) continue;

          totalParsedLines.value++;
          const item = parseLineToItem(rawLine);
          if (item) {
            batch.push(item);
            if (items.value.length + batch.length >= memoryLimit.value) {
              break;
            }
          }
        }
      });
    }

    // Start stall watchdog now that reader is actively acquired
    lastChunkReceivedTime = Date.now();
    startStallWatchdog();

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
        // Flush any trailing decompression buffer
        if (isUsingLz4.value && lz4Decoder) {
          lz4Decoder.finish();
        }

        // Check if stream closed prematurely on unreliable network
        // Only test premature break if we confirmed total from 206 Content-Range
        if (hasParsedTotalFromContentRange.value && contentRangeTotalLength.value !== null) {
          const expectedTotal = contentRangeTotalLength.value;
          if (loadedBytes.value < expectedTotal - 1024 && (items.value.length + batch.length < memoryLimit.value)) {
            console.warn(`[Stream Premature Break] Reader returned done=true prematurely! Received ${loadedBytes.value} of ${expectedTotal} bytes (missing ${expectedTotal - loadedBytes.value} bytes). Auto-retrying with Range header...`);
            throw new Error(`Connection closed prematurely (${(loadedBytes.value / (1024 * 1024)).toFixed(1)} MB of ${(expectedTotal / (1024 * 1024)).toFixed(1)} MB received)`);
          }
        }
        break;
      }

      if (value) {
        lastChunkReceivedTime = Date.now();
        receivedChunks++;

        // Reset retry counters when data is actively flowing cleanly
        if (receivedChunks > 2 && (retryAttempt.value > 0 || streamError.value)) {
          retryAttempt.value = 0;
          isAutoRetrying.value = false;
          streamError.value = null;
        }

        loadedBytes.value += value.byteLength;

        if (isUsingLz4.value && lz4Decoder) {
          // Decode compressed chunk on the fly
          lz4Decoder.append(value);
        } else {
          // Raw NDJSON chunk
          const chunkText = decoder.decode(value, { stream: true });
          const lines = (streamLineRemainder + chunkText).split("\n");
          streamLineRemainder = lines.pop() || "";

          for (let i = 0; i < lines.length; i++) {
            const rawLine = lines[i].trim();
            if (!rawLine) continue;

            totalParsedLines.value++;
            const item = parseLineToItem(rawLine);
            if (item) {
              batch.push(item);
              if (items.value.length + batch.length >= memoryLimit.value) {
                break;
              }
            }
          }
        }

        if (Date.now() - lastFlushTime > FLUSH_INTERVAL) {
          flushBatch();
          // Yield to main thread for render frame
          await new Promise((r) => setTimeout(r, 0));
        }
      }
    }

    stopStallWatchdog();

    // Process leftover line only if completed naturally without pause
    if (!isPaused.value && streamLineRemainder.trim() && items.value.length + batch.length < memoryLimit.value) {
      const item = parseLineToItem(streamLineRemainder.trim());
      if (item) {
        batch.push(item);
      }
      streamLineRemainder = "";
    }

    flushBatch();

    if (!isPaused.value) {
      isCompleted.value = true;
      retryAttempt.value = 0;
      isAutoRetrying.value = false;
      streamError.value = null;
    }
  } catch (err: any) {
    stopStallWatchdog();
    const wasStall = isStallTriggered;
    isStallTriggered = false;

    // Flush any pending items parsed prior to the error/stall
    flushBatch();

    // If user clicked Pause, exit cleanly without retrying
    if (isPaused.value) {
      return;
    }

    const errorMsg = wasStall
      ? `Stream stalled (${(loadedBytes.value / (1024 * 1024)).toFixed(1)} MB loaded, no incoming data for 15s)`
      : (err.message || "Network stream connection dropped");

    console.warn("[Classification Stream Error/Stall]:", errorMsg);
    streamError.value = errorMsg;

    // Trigger auto-retry with HTTP Range header if under maxRetries and not paused
    if (retryAttempt.value < maxRetries && !isPaused.value) {
      retryAttempt.value++;
      isAutoRetrying.value = true;
      // Exponential backoff capped at 8s so resumption is snappy
      const delaySec = Math.min(8, Math.max(1, retryAttempt.value * 1.5));
      retryCountdown.value = Math.ceil(delaySec);

      clearInterval(retryCountdownInterval);
      retryCountdownInterval = setInterval(() => {
        retryCountdown.value--;
        if (retryCountdown.value <= 0) {
          clearInterval(retryCountdownInterval);
        }
      }, 1000);

      clearTimeout(retryTimeoutId);
      retryTimeoutId = setTimeout(() => {
        if (!isPaused.value && !isCompleted.value) {
          console.log(`Auto-resuming stream with Range header: bytes=${loadedBytes.value}- (Attempt ${retryAttempt.value}/${maxRetries})`);
          startStreaming(true);
        }
      }, delaySec * 1000);
    } else {
      isAutoRetrying.value = false;
      streamError.value = `${errorMsg}. Stopped after ${retryAttempt.value} attempts. Click Resume to restart with Range offset.`;
    }
  } finally {
    isStreaming.value = false;
    readerRef = null;
    stopStallWatchdog();
  }
};

const pauseStream = () => {
  isPaused.value = true;
  clearRetryTimers();
  stopStallWatchdog();
  if (abortController) {
    abortController.abort();
  }
  isStreaming.value = false;
};

const reloadStream = () => {
  pauseStream();
  startStreaming(false);
};

const reprobeAndReload = () => {
  pauseStream();
  startStreaming(false);
};

const manualResumeNow = () => {
  clearRetryTimers();
  startStreaming(true);
};

// Start streaming automatically on mount
onMounted(() => {
  startStreaming(false);
  window.addEventListener("mouseup", handleWindowMouseUp);
  window.addEventListener("mousedown", handleGlobalMouseDown);
  window.addEventListener("keydown", handleGlobalKeyDown);
});

onUnmounted(() => {
  stopStallWatchdog();
  clearRetryTimers();
  closeProfileTooltip();
  window.removeEventListener("mouseup", handleWindowMouseUp);
  window.removeEventListener("mousedown", handleGlobalMouseDown);
  window.removeEventListener("keydown", handleGlobalKeyDown);
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

// Count of items with Read Value
const readValueStats = computed(() => {
  let hasCount = 0;
  let criticalCount = 0;
  let substantiveCount = 0;
  let backgroundCount = 0;
  let lowCount = 0;
  for (const item of items.value) {
    if (item.hasReadValue && item.readValueScore !== null) {
      hasCount++;
      if (item.readValueScore >= 2.2) criticalCount++;
      else if (item.readValueScore >= 1.5) substantiveCount++;
      else if (item.readValueScore >= 0.8) backgroundCount++;
      else lowCount++;
    }
  }
  return { hasCount, criticalCount, substantiveCount, backgroundCount, lowCount, legacyCount: items.value.length - hasCount };
});

// Preset domestic handler
const applyDomesticPreset = (preset: "all" | "high" | "mid" | "low") => {
  domesticPreset.value = preset;
  if (preset === "all") domesticMinScore.value = 0;
  else if (preset === "high") domesticMinScore.value = 0.6;
  else if (preset === "mid") domesticMinScore.value = 0.3;
  else if (preset === "low") domesticMinScore.value = 0;
};

// Preset Read Value handler
const applyReadValuePreset = (preset: "all" | "critical" | "substantive" | "background" | "low" | "hasReadValue" | "legacyOnly") => {
  readValuePreset.value = preset;
  if (preset === "all") readValueMinScore.value = 0;
  else if (preset === "critical") readValueMinScore.value = 2.2;
  else if (preset === "substantive") readValueMinScore.value = 1.5;
  else if (preset === "background") readValueMinScore.value = 0.8;
  else if (preset === "low") readValueMinScore.value = 0;
  else if (preset === "hasReadValue") readValueMinScore.value = 0;
  else if (preset === "legacyOnly") readValueMinScore.value = 0;
};

// Filtered and Sorted Channel List (Gracefully handles mixed formats)
const filteredItems = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();
  const topicFilter = selectedTopic.value;
  const countryFilter = selectedCountry.value;

  const domPreset = domesticPreset.value;
  const minDom = domesticMinScore.value;

  const rvPreset = readValuePreset.value;
  const minRv = readValueMinScore.value;

  return items.value
    .filter((item) => {
      // 0. Natural Language Distribution-Aware Filter (Kev SystemOne)
      if (activeNlFilter.value && !matchesDistributionAwareFilter(item, activeNlFilter.value)) {
        return false;
      }

      // 1. Channel Search
      if (query && !item.channel.toLowerCase().includes(query)) {
        return false;
      }
      // 2. Topic
      if (topicFilter !== "all" && item.topic !== topicFilter) {
        return false;
      }
      // 3. Country (handles both traditional and expanded countries)
      if (countryFilter !== "all" && item.country !== countryFilter) {
        return false;
      }
      // 4. Domestic Affairs
      if (domPreset === "high" && item.domestic < 0.6) {
        return false;
      } else if (domPreset === "mid" && (item.domestic < 0.3 || item.domestic >= 0.6)) {
        return false;
      } else if (domPreset === "low" && item.domestic >= 0.3) {
        return false;
      } else if (domPreset === "all" && minDom > 0 && item.domestic < minDom) {
        return false;
      }

      // 5. Read Value Filter (mixed format aware)
      if (rvPreset === "critical") {
        if (!item.hasReadValue || (item.readValueScore ?? 0) < 2.2) return false;
      } else if (rvPreset === "substantive") {
        if (!item.hasReadValue || (item.readValueScore ?? 0) < 1.5) return false;
      } else if (rvPreset === "background") {
        if (!item.hasReadValue || (item.readValueScore ?? 0) < 0.8) return false;
      } else if (rvPreset === "low") {
        if (!item.hasReadValue || (item.readValueScore ?? 0) >= 0.8) return false;
      } else if (rvPreset === "hasReadValue") {
        if (!item.hasReadValue) return false;
      } else if (rvPreset === "legacyOnly") {
        if (item.hasReadValue) return false;
      } else if (minRv > 0) {
        if (!item.hasReadValue || (item.readValueScore ?? 0) < minRv) return false;
      }

      return true;
    })
    .sort((a, b) => {
      if (sortBy.value === "aiRelevance" && activeNlFilter.value) {
        const scoreA = calculateDistributionAwareScore(a, activeNlFilter.value);
        const scoreB = calculateDistributionAwareScore(b, activeNlFilter.value);
        if (Math.abs(scoreB - scoreA) > 0.001) {
          return scoreB - scoreA;
        }
        const valA = a.hasReadValue && a.readValueScore !== null ? a.readValueScore : -1;
        const valB = b.hasReadValue && b.readValueScore !== null ? b.readValueScore : -1;
        if (valB !== valA) return valB - valA;
        return b.topicConf - a.topicConf;
      }
      if (sortBy.value === "readValDesc") {
        const valA = a.hasReadValue && a.readValueScore !== null ? a.readValueScore : -1;
        const valB = b.hasReadValue && b.readValueScore !== null ? b.readValueScore : -1;
        if (valB !== valA) return valB - valA;
        return b.topicConf - a.topicConf;
      }
      if (sortBy.value === "readValAsc") {
        const valA = a.hasReadValue && a.readValueScore !== null ? a.readValueScore : 999;
        const valB = b.hasReadValue && b.readValueScore !== null ? b.readValueScore : 999;
        if (valA !== valB) return valA - valB;
        return a.topicConf - b.topicConf;
      }
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
watch(
  [
    searchQuery,
    selectedTopic,
    selectedCountry,
    domesticPreset,
    domesticMinScore,
    readValuePreset,
    readValueMinScore,
    sortBy,
    pageSize,
    activeNlFilter
  ],
  () => {
    currentPage.value = 1;
  }
);

// Paginated View Items
const totalFilteredPages = computed(() => Math.max(1, Math.ceil(filteredItems.value.length / pageSize.value)));

const paginatedItems = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value;
  return filteredItems.value.slice(start, start + pageSize.value);
});

// Helper for topic configuration
const getTopicInfo = (topic: string) => {
  return (
    TOPIC_CONFIG[topic] || {
      label: topic,
      color: "text-gray-700 dark:text-gray-300",
      bg: "bg-gray-100 dark:bg-gray-800",
      border: "border-gray-200 dark:border-gray-700"
    }
  );
};

const getCountryInfo = (country: string) => {
  return COUNTRY_CONFIG[country] || { label: country.replace(/_/g, " "), flag: "🌐" };
};

// Sort probabilities for multi-segment bars
const getSortedProbs = (probs: Record<string, number>, max = 3) => {
  if (!probs) return [];
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
    social_movements: "bg-violet-500",
    spam: "bg-gray-400"
  };
  return map[topic] || "bg-indigo-400";
};

const getCountrySegmentColor = (country: string) => {
  const map: Record<string, string> = {
    russia: "bg-rose-500",
    china: "bg-red-500",
    united_states: "bg-blue-500",
    us_allies_asia: "bg-sky-500",
    european_union: "bg-blue-600",
    ukraine: "bg-yellow-400",
    taiwan: "bg-emerald-500",
    israel_palestine: "bg-teal-500",
    iran: "bg-green-600",
    africa: "bg-amber-500",
    international: "bg-indigo-500",
    other: "bg-slate-400"
  };
  return map[country] || "bg-sky-400";
};

// Trigger Explorer Tab Jump
const handleExplore = (channel: string) => {
  emit("explore-channel", channel);
};

// Channel Profile Hover Hint Card State (Explorer Tab Style)
export interface ChannelProfileMetadata {
  title?: string;
  username?: string;
  verified?: boolean;
  photo?: string;
  description?: string;
  members?: number;
  participants_count?: number;
  photos?: number;
  files?: number;
  videos?: number;
  links?: number;
  _type?: string;
  cdnNumber?: number;
  cdnRegion?: string[];
}

const channelProfileCache = new Map<string, ChannelProfileMetadata | null>();
const isProfileTooltipVisible = ref(false);
const hoveredProfileChannel = ref<string | null>(null);
const hoveredProfileMetadata = ref<ChannelProfileMetadata | null>(null);
const isProfileLoading = ref(false);
const profileTooltipPos = ref({ top: 0, left: 0, placement: "bottom" as "bottom" | "top" });
const isProfileCopied = ref(false);
const profileTooltipRef = ref<HTMLElement | null>(null);
const isMouseDownInsideTooltip = ref(false);

const closeProfileTooltip = () => {
  if (profileHoverTimer) {
    clearTimeout(profileHoverTimer);
    profileHoverTimer = null;
  }
  if (profileLeaveTimer) {
    clearTimeout(profileLeaveTimer);
    profileLeaveTimer = null;
  }
  isMouseDownInsideTooltip.value = false;
  isProfileTooltipVisible.value = false;
  hoveredProfileChannel.value = null;
};

const handleTooltipCardMouseDown = () => {
  isMouseDownInsideTooltip.value = true;
  if (profileLeaveTimer) {
    clearTimeout(profileLeaveTimer);
    profileLeaveTimer = null;
  }
};

const handleWindowMouseUp = () => {
  isMouseDownInsideTooltip.value = false;
};

const hasActiveSelectionInsideTooltip = (): boolean => {
  const sel = window.getSelection();
  if (!sel || !sel.toString().trim()) return false;
  if (!profileTooltipRef.value) return false;
  try {
    if (sel.anchorNode && profileTooltipRef.value.contains(sel.anchorNode)) return true;
    if (sel.focusNode && profileTooltipRef.value.contains(sel.focusNode)) return true;
  } catch {
    return false;
  }
  return false;
};

const formatMemberCount = (num?: number): string => {
  if (num === undefined || num === null) return "N/A";
  if (num >= 1_000_000) {
    return (num / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  }
  if (num >= 1_000) {
    return (num / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  }
  return num.toLocaleString();
};

const getChannelAvatarSrc = (channelName: string): string => {
  const clean = (channelName || "").replace(/^@/, "").trim();
  const cached = channelProfileCache.get(clean);
  if (cached?.photo && cached.photo.startsWith("data:")) {
    return cached.photo;
  }
  return `https://i.gogingko.net/api/v1/v/telegram-profile/${clean}`;
};

const fetchChannelMetadata = async (cleanChannel: string): Promise<ChannelProfileMetadata | null> => {
  if (channelProfileCache.has(cleanChannel)) {
    return channelProfileCache.get(cleanChannel) || null;
  }
  try {
    const res = await fetch(`https://i.gogingko.net/api/v1/v/telegram-channel/${encodeURIComponent(cleanChannel)}`);
    if (!res.ok) {
      channelProfileCache.set(cleanChannel, null);
      return null;
    }
    const data = await res.json();
    channelProfileCache.set(cleanChannel, data);
    return data;
  } catch (e) {
    console.warn(`[Profile Hover] Failed to fetch channel profile for ${cleanChannel}:`, e);
    channelProfileCache.set(cleanChannel, null);
    return null;
  }
};

const handleChannelMouseEnter = (event: MouseEvent, rawChannel: string) => {
  if (profileLeaveTimer) {
    clearTimeout(profileLeaveTimer);
    profileLeaveTimer = null;
  }
  if (profileHoverTimer) {
    clearTimeout(profileHoverTimer);
  }

  const cleanChannel = rawChannel.replace(/^@/, "").trim();
  const targetEl = event.currentTarget as HTMLElement | null;
  if (!targetEl || !cleanChannel) return;

  // Short 180ms debounce so mouse movement over cards does not flicker
  profileHoverTimer = setTimeout(async () => {
    hoveredProfileChannel.value = cleanChannel;
    isProfileCopied.value = false;

    // Viewport-aware boundary positioning
    const rect = targetEl.getBoundingClientRect();
    const tooltipWidth = 340;
    const tooltipHeight = 280;

    let left = rect.left;
    if (left + tooltipWidth > window.innerWidth - 16) {
      left = Math.max(16, window.innerWidth - tooltipWidth - 16);
    }
    if (left < 16) left = 16;

    let top = rect.bottom + 8;
    let placement: "bottom" | "top" = "bottom";

    if (top + tooltipHeight > window.innerHeight - 16 && rect.top > tooltipHeight + 16) {
      top = rect.top - tooltipHeight - 8;
      placement = "top";
    }

    profileTooltipPos.value = { top, left, placement };
    isProfileTooltipVisible.value = true;

    // Check cache first for instant display
    if (channelProfileCache.has(cleanChannel)) {
      hoveredProfileMetadata.value = channelProfileCache.get(cleanChannel) || null;
      isProfileLoading.value = false;
    } else {
      isProfileLoading.value = true;
      hoveredProfileMetadata.value = null;
      const meta = await fetchChannelMetadata(cleanChannel);
      if (hoveredProfileChannel.value === cleanChannel) {
        hoveredProfileMetadata.value = meta;
        isProfileLoading.value = false;
      }
    }
  }, 180);
};

const handleChannelMouseLeave = () => {
  if (profileHoverTimer) {
    clearTimeout(profileHoverTimer);
    profileHoverTimer = null;
  }
  if (profileLeaveTimer) {
    clearTimeout(profileLeaveTimer);
  }
  profileLeaveTimer = setTimeout(() => {
    // If user is selecting text or mouse is pressed, keep open
    if (isMouseDownInsideTooltip.value || hasActiveSelectionInsideTooltip()) {
      return;
    }
    isProfileTooltipVisible.value = false;
    hoveredProfileChannel.value = null;
  }, 300);
};

const handleTooltipCardMouseEnter = () => {
  if (profileLeaveTimer) {
    clearTimeout(profileLeaveTimer);
    profileLeaveTimer = null;
  }
};

const handleTooltipCardMouseLeave = () => {
  if (profileLeaveTimer) {
    clearTimeout(profileLeaveTimer);
  }
  profileLeaveTimer = setTimeout(() => {
    // If user is selecting text or mouse is pressed, keep open
    if (isMouseDownInsideTooltip.value || hasActiveSelectionInsideTooltip()) {
      return;
    }
    isProfileTooltipVisible.value = false;
    hoveredProfileChannel.value = null;
  }, 350);
};

const handleGlobalMouseDown = (e: MouseEvent) => {
  if (!isProfileTooltipVisible.value) return;
  const target = e.target as HTMLElement | null;
  if (!target) return;
  // If clicked inside tooltip card, allow selection and interaction
  if (profileTooltipRef.value && profileTooltipRef.value.contains(target)) {
    return;
  }
  // If clicked on a channel trigger, allow trigger handler to respond
  if (target.closest("[data-profile-trigger]")) {
    return;
  }
  // User clicked elsewhere on the page: close tooltip
  closeProfileTooltip();
};

const handleGlobalKeyDown = (e: KeyboardEvent) => {
  if (e.key === "Escape" && isProfileTooltipVisible.value) {
    closeProfileTooltip();
  }
};

const copyProfileChannelName = async (channel: string) => {
  try {
    await navigator.clipboard.writeText(`@${channel}`);
    isProfileCopied.value = true;
    setTimeout(() => {
      isProfileCopied.value = false;
    }, 2000);
  } catch {
    // fallback
  }
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
              <h2 class="text-lg font-extrabold text-gray-900 dark:text-white tracking-tight flex items-center gap-2 flex-wrap">
                Types & Classification Intelligence
                <span
                  class="text-xs font-mono px-2 py-0.5 rounded-full border inline-flex items-center gap-1"
                  :class="isUsingLz4 ? 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-900/40 dark:text-purple-300 dark:border-purple-800' : 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-900/40 dark:text-indigo-300 dark:border-indigo-800'"
                >
                  <Zap v-if="isUsingLz4" class="w-3 h-3 text-purple-600 dark:text-purple-400 fill-purple-500/20" />
                  {{ isUsingLz4 ? 'classify.json.lz4 (Stream)' : 'classify.json (NDJSON)' }}
                </span>
              </h2>
              <p class="text-xs text-gray-500 dark:text-gray-400">
                Live stream analysis of topic taxonomies, 12 regional geopolitical targets, and Level 0–3 Read Value informativeness
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
          <div class="flex items-center gap-2 flex-wrap">
            <span v-if="isProbingLz4" class="flex items-center gap-1.5 text-purple-600 dark:text-purple-400 font-bold">
              <RefreshCw class="w-3 h-3 animate-spin text-purple-500" />
              Probing classify.json.lz4...
            </span>
            <span v-else-if="isAutoRetrying" class="flex items-center gap-1.5 text-amber-600 dark:text-amber-400 font-bold">
              <RefreshCw class="w-3 h-3 animate-spin text-amber-500" />
              Retrying in {{ retryCountdown }}s (Attempt {{ retryAttempt }}/{{ maxRetries }})...
            </span>
            <span v-else-if="isStreaming" class="flex items-center gap-1.5 font-bold" :class="isUsingLz4 ? 'text-purple-600 dark:text-purple-400' : 'text-indigo-600 dark:text-indigo-400'">
              <Zap v-if="isUsingLz4" class="w-3.5 h-3.5 text-purple-500 fill-purple-500/20 animate-pulse" />
              <span v-else class="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></span>
              {{ isUsingLz4 ? 'Streaming LZ4 Frame...' : 'Streaming NDJSON...' }}
            </span>
            <span v-else-if="isCompleted" class="text-emerald-600 dark:text-emerald-400 font-bold">
              ✓ Ingestion Complete
            </span>
            <span v-else-if="isPaused" class="text-amber-600 dark:text-amber-400 font-bold">
              ⏸ Paused
            </span>
            <span class="tabular-nums">
              {{ items.length.toLocaleString() }} channels active
              <span v-if="readValueStats.hasCount > 0" class="text-emerald-600 dark:text-emerald-400">
                ({{ readValueStats.hasCount.toLocaleString() }} with Read Value)
              </span>
            </span>

            <!-- Compression Mode Badge -->
            <span
              class="hidden sm:inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-mono border"
              :class="isUsingLz4
                ? 'bg-purple-50 dark:bg-purple-950/80 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700'"
              :title="isUsingLz4 ? 'Live stream LZ4 chunk decompressor' : 'Uncompressed fallback stream. Click to re-probe .lz4'"
            >
              <Zap v-if="isUsingLz4" class="w-2.5 h-2.5 text-purple-600 dark:text-purple-400" />
              <span>{{ isUsingLz4 ? '⚡ LZ4 Stream' : 'Raw NDJSON' }}</span>
              <span v-if="isUsingLz4 && decompressedBytesCount > 0" class="text-purple-600 dark:text-purple-400 opacity-90">
                ({{ (decompressedBytesCount / (1024 * 1024)).toFixed(1) }} MB decomp)
              </span>
              <button
                v-if="!isUsingLz4 && !isStreaming"
                @click="reprobeAndReload"
                class="ml-1 text-[10px] text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer flex items-center gap-0.5 font-bold"
                title="Probe whether classify.json.lz4 has been uploaded"
              >
                <RefreshCw class="w-2.5 h-2.5" /> Probe .lz4
              </button>
            </span>
          </div>
          <div class="flex items-center gap-2 tabular-nums">
            <span
              v-if="lastResumedByteOffset && lastResumedByteOffset > 0"
              class="hidden sm:inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 border border-indigo-200/60 dark:border-indigo-800/60 font-mono"
              title="Stream resumed using HTTP Range header from byte offset"
            >
              <span>Range:</span>
              <span>{{ (lastResumedByteOffset / (1024 * 1024)).toFixed(1) }}MB+</span>
            </span>
            <div>
              {{ (loadedBytes / (1024 * 1024)).toFixed(1) }} MB
              <span class="text-gray-400">/ ~{{ (totalBytesEstimated / (1024 * 1024)).toFixed(1) }} MB</span>
              ({{ Math.min(100, Math.round((loadedBytes / totalBytesEstimated) * 100)) }}%)
            </div>
          </div>
        </div>
        <div class="w-full h-1.5 bg-gray-100 dark:bg-gray-700/60 rounded-full overflow-hidden">
          <div
            class="h-full bg-gradient-to-r from-indigo-500 via-cyan-500 to-emerald-500 transition-all duration-300"
            :style="{ width: `${Math.min(100, Math.round((loadedBytes / totalBytesEstimated) * 100))}%` }"
          ></div>
        </div>

        <!-- Network Throttle Auto-Recovery Banner -->
        <div
          v-if="isAutoRetrying"
          class="mt-2.5 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs shadow-2xs"
        >
          <div class="flex items-start sm:items-center gap-2 text-amber-800 dark:text-amber-200">
            <RefreshCw class="w-4 h-4 text-amber-600 dark:text-amber-400 animate-spin shrink-0 mt-0.5 sm:mt-0" />
            <div>
              <span class="font-bold">Network throttled or connection dropped:</span>
              <span class="text-amber-700 dark:text-amber-300 ml-1">
                Auto-resuming with HTTP Range from {{ (loadedBytes / (1024 * 1024)).toFixed(2) }} MB in {{ retryCountdown }}s (Attempt {{ retryAttempt }}/{{ maxRetries }})...
              </span>
            </div>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <button
              @click="manualResumeNow"
              class="px-2.5 py-1 text-xs font-bold rounded-lg bg-amber-600 hover:bg-amber-700 text-white cursor-pointer transition shadow-2xs"
            >
              Resume Now
            </button>
            <button
              @click="pauseStream"
              class="px-2.5 py-1 text-xs font-semibold rounded-lg bg-amber-100 hover:bg-amber-200 dark:bg-amber-900/60 dark:hover:bg-amber-900 text-amber-800 dark:text-amber-200 cursor-pointer transition"
            >
              Pause
            </button>
          </div>
        </div>

        <!-- Error & Manual Resume Banner (Exhausted retries or non-recoverable error) -->
        <div
          v-else-if="streamError && !isPaused"
          class="mt-2.5 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs shadow-2xs"
        >
          <div class="flex items-start sm:items-center gap-2 text-rose-800 dark:text-rose-200">
            <AlertTriangle class="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5 sm:mt-0" />
            <div>
              <span class="font-bold">Stream Stopped:</span>
              <span class="text-rose-700 dark:text-rose-300 ml-1">{{ streamError }}</span>
            </div>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <button
              v-if="loadedBytes > 0"
              @click="manualResumeNow"
              class="px-2.5 py-1 text-xs font-bold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer transition shadow-2xs"
            >
              Resume from {{ (loadedBytes / (1024 * 1024)).toFixed(1) }} MB
            </button>
            <button
              @click="reloadStream"
              class="px-2.5 py-1 text-xs font-semibold rounded-lg bg-rose-100 hover:bg-rose-200 dark:bg-rose-900/60 dark:hover:bg-rose-900 text-rose-800 dark:text-rose-200 cursor-pointer transition"
            >
              Reload from 0
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Filters, Search & Facet Control Deck -->
    <div class="bg-white dark:bg-gray-800/90 rounded-2xl border border-gray-200/80 dark:border-gray-700/80 p-5 shadow-sm space-y-4">
      <!-- Natural Language Multi-Aspect Filter Bar (Kev SystemOne AI) -->
      <div class="rounded-xl p-3.5 bg-gradient-to-r from-indigo-50/80 via-purple-50/60 to-sky-50/80 dark:from-indigo-950/40 dark:via-purple-950/30 dark:to-sky-950/40 border border-indigo-200/80 dark:border-indigo-800/70 space-y-3">
        <!-- Input row with AI icon, submit and clear buttons -->
        <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          <div class="relative flex-1">
            <div class="absolute left-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 pointer-events-none">
              <Sparkles class="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            </div>
            <input
              v-model="nlQuery"
              @keydown.enter.prevent="handleNlSearch()"
              type="text"
              placeholder="Ask in natural language: e.g. 'political China with Japan', 'critical military in Ukraine'..."
              class="w-full pl-9 pr-8 py-2 text-xs sm:text-sm bg-white dark:bg-gray-900 border border-indigo-200 dark:border-indigo-800/80 rounded-xl focus:ring-2 focus:ring-indigo-500/50 outline-none text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 shadow-xs"
            />
            <button
              v-if="nlQuery"
              @click="clearNlFilter"
              class="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-0.5 cursor-pointer"
              title="Clear natural language query"
            >
              <X class="w-3.5 h-3.5" />
            </button>
          </div>

          <div class="flex items-center gap-1.5 shrink-0">
            <button
              @click="handleNlSearch()"
              :disabled="!nlQuery.trim() || isNlParsing"
              class="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white transition cursor-pointer shadow-xs"
            >
              <RefreshCw v-if="isNlParsing" class="w-3.5 h-3.5 animate-spin" />
              <Sparkles v-else class="w-3.5 h-3.5" />
              <span>{{ isNlParsing ? "Kev AI Parsing..." : "Filter with Kev AI" }}</span>
            </button>

            <button
              v-if="activeNlFilter"
              @click="clearNlFilter"
              class="px-2.5 py-2 text-xs font-semibold rounded-xl bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 transition cursor-pointer"
              title="Reset all natural language filters"
            >
              Reset
            </button>
          </div>
        </div>

        <!-- 1-Click Suggestion Presets -->
        <div class="flex items-center gap-1.5 flex-wrap text-[11px]">
          <span class="text-gray-500 dark:text-gray-400 font-semibold flex items-center gap-1 shrink-0">
            <span>Suggestions:</span>
          </span>
          <button
            v-for="sug in NL_SUGGESTIONS"
            :key="sug.query"
            @click="applyNlPreset(sug.query)"
            :class="[
              'px-2 py-0.5 rounded-lg border transition cursor-pointer text-left',
              nlQuery.trim().toLowerCase() === sug.query.toLowerCase()
                ? 'bg-indigo-100 dark:bg-indigo-900/60 border-indigo-300 dark:border-indigo-700 text-indigo-800 dark:text-indigo-200 font-bold'
                : 'bg-white/80 dark:bg-gray-900/60 border-indigo-100 dark:border-indigo-900/50 text-gray-700 dark:text-gray-300 hover:bg-indigo-50/80 dark:hover:bg-indigo-950/60'
            ]"
          >
            {{ sug.label }}
          </button>
        </div>

        <!-- Interactive Editable Filter Chips Ribbon -->
        <div
          v-if="hasActiveNlRules && activeNlFilter"
          class="pt-2 border-t border-indigo-100 dark:border-indigo-900/50 flex flex-wrap items-center gap-2 text-xs"
        >
          <span class="text-[10px] font-black uppercase tracking-wider text-indigo-700 dark:text-indigo-300 flex items-center gap-1">
            <span>Parsed Rules:</span>
          </span>

          <!-- Topic Chips (Supports multi-aspect distribution-aware topics) -->
          <template v-if="activeNlFilter.targetTopics && activeNlFilter.targetTopics.length > 0">
            <div
              v-for="top in activeNlFilter.targetTopics"
              :key="top"
              class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-100 dark:bg-indigo-900/70 border border-indigo-300 dark:border-indigo-700 text-indigo-900 dark:text-indigo-100 text-xs font-semibold shadow-2xs"
            >
              <span class="text-[10px] font-bold uppercase text-indigo-600 dark:text-indigo-400">Topic:</span>
              <span>{{ TOPIC_CONFIG[top]?.label || top }}</span>
              <span
                v-if="activeNlFilter.topicConfidences?.[top] || (top === activeNlFilter.topic && activeNlFilter.topicConfidence)"
                class="text-[10px] font-mono px-1 rounded bg-indigo-200/80 dark:bg-indigo-950 text-indigo-800 dark:text-indigo-200"
              >
                {{ Math.round((activeNlFilter.topicConfidences?.[top] || activeNlFilter.topicConfidence || 0) * 100) }}%
              </span>
              <button
                @click="removeTopicCriteria(top)"
                class="text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-200 ml-0.5 cursor-pointer"
                title="Remove Topic Rule"
              >
                <X class="w-3 h-3" />
              </button>
            </div>
          </template>
          <div
            v-else-if="activeNlFilter.topic"
            class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-100 dark:bg-indigo-900/70 border border-indigo-300 dark:border-indigo-700 text-indigo-900 dark:text-indigo-100 text-xs font-semibold shadow-2xs"
          >
            <span class="text-[10px] font-bold uppercase text-indigo-600 dark:text-indigo-400">Topic:</span>
            <span>{{ TOPIC_CONFIG[activeNlFilter.topic]?.label || activeNlFilter.topic }}</span>
            <span
              v-if="activeNlFilter.topicConfidence"
              class="text-[10px] font-mono px-1 rounded bg-indigo-200/80 dark:bg-indigo-950 text-indigo-800 dark:text-indigo-200"
            >
              {{ Math.round(activeNlFilter.topicConfidence * 100) }}%
            </span>
            <button
              @click="removeTopicCriteria()"
              class="text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-200 ml-0.5 cursor-pointer"
              title="Remove Topic Rule"
            >
              <X class="w-3 h-3" />
            </button>
          </div>

          <!-- Region Chips (Supports multi-aspect distribution-aware regions) -->
          <template v-if="activeNlFilter.targetRegions && activeNlFilter.targetRegions.length > 0">
            <div
              v-for="region in activeNlFilter.targetRegions"
              :key="region"
              class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-sky-100 dark:bg-sky-900/70 border border-sky-300 dark:border-sky-700 text-sky-900 dark:text-sky-100 text-xs font-semibold shadow-2xs"
            >
              <span class="text-[10px] font-bold uppercase text-sky-600 dark:text-sky-400">Region:</span>
              <span>{{ COUNTRY_CONFIG[region]?.flag }} {{ COUNTRY_CONFIG[region]?.label || region }}</span>
              <span
                v-if="activeNlFilter.regionConfidences?.[region]"
                class="text-[10px] font-mono px-1 rounded bg-sky-200/80 dark:bg-sky-950 text-sky-800 dark:text-sky-200"
              >
                {{ Math.round(activeNlFilter.regionConfidences[region] * 100) }}%
              </span>
              <button
                @click="removeRegionCriteria(region)"
                class="text-sky-400 hover:text-sky-700 dark:hover:text-sky-200 ml-0.5 cursor-pointer"
                title="Remove Region Rule"
              >
                <X class="w-3 h-3" />
              </button>
            </div>
          </template>

          <!-- Domestic Orientation Chip -->
          <div
            v-if="activeNlFilter.domesticOrientation"
            class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-purple-100 dark:bg-purple-900/70 border border-purple-300 dark:border-purple-700 text-purple-900 dark:text-purple-100 text-xs font-semibold shadow-2xs"
          >
            <span class="text-[10px] font-bold uppercase text-purple-600 dark:text-purple-400">Orientation:</span>
            <span>
              {{
                activeNlFilter.domesticOrientation === "domestic"
                  ? "Domestic Focus (≥55%)"
                  : activeNlFilter.domesticOrientation === "external"
                  ? "Foreign Focus (≤35%)"
                  : "Balanced Focus"
              }}
            </span>
            <button
              @click="removeDomesticCriteria"
              class="text-purple-400 hover:text-purple-700 dark:hover:text-purple-200 ml-0.5 cursor-pointer"
              title="Remove Orientation Rule"
            >
              <X class="w-3 h-3" />
            </button>
          </div>

          <!-- Read Value Chip -->
          <div
            v-if="activeNlFilter.minReadValue !== null && activeNlFilter.minReadValue !== undefined"
            class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-100 dark:bg-emerald-900/70 border border-emerald-300 dark:border-emerald-700 text-emerald-900 dark:text-emerald-100 text-xs font-semibold shadow-2xs"
          >
            <span class="text-[10px] font-bold uppercase text-emerald-600 dark:text-emerald-400">Quality:</span>
            <span>{{ activeNlFilter.readValueTier || `≥ ${activeNlFilter.minReadValue}` }}</span>
            <button
              @click="removeReadValueCriteria"
              class="text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-200 ml-0.5 cursor-pointer"
              title="Remove Quality Rule"
            >
              <X class="w-3 h-3" />
            </button>
          </div>

          <!-- Matching Count & AI Status Tag -->
          <div class="ml-auto flex items-center gap-2">
            <span class="text-[11px] font-mono text-gray-500 dark:text-gray-400">
              <strong class="text-indigo-600 dark:text-indigo-400">{{ filteredItems.length.toLocaleString() }}</strong> matches
            </span>
            <span
              v-if="activeNlFilter.isAiParsed"
              class="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-800"
            >
              <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
              Kev SystemOne Verified
            </span>
            <span
              v-else
              class="inline-flex items-center gap-1 text-[10px] font-medium text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/60 px-2 py-0.5 rounded-full border border-indigo-200 dark:border-indigo-800"
            >
              ⚡ Fast-Rule Pre-Filtered
            </span>
          </div>
        </div>
      </div>

      <!-- Row 1: Search & Sort Bar -->
      <div class="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        <!-- Channel Search -->
        <div class="relative flex-1 max-w-md">
          <Search class="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            v-model="searchQuery"
            type="text"
            placeholder="Search channel username (e.g. info65mchs, husainov_photo)..."
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

        <!-- Sort Select -->
        <div class="flex items-center gap-1.5 text-xs bg-gray-50 dark:bg-gray-900 px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700">
          <SlidersHorizontal class="w-3.5 h-3.5 text-gray-400" />
          <select
            v-model="sortBy"
            class="bg-transparent font-bold text-gray-800 dark:text-gray-200 outline-none cursor-pointer"
          >
            <option v-if="activeNlFilter" value="aiRelevance" class="dark:bg-gray-800 text-indigo-600 dark:text-indigo-400 font-bold">✨ AI Relevance (Best Match)</option>
            <option value="readValDesc" class="dark:bg-gray-800">Read Value (High → Low)</option>
            <option value="readValAsc" class="dark:bg-gray-800">Read Value (Low → High)</option>
            <option value="topicConf" class="dark:bg-gray-800">Topic Confidence (High → Low)</option>
            <option value="countryConf" class="dark:bg-gray-800">Country Confidence (High → Low)</option>
            <option value="domesticDesc" class="dark:bg-gray-800">Domestic Score (High → Low)</option>
            <option value="domesticAsc" class="dark:bg-gray-800">Domestic Score (Low → High)</option>
            <option value="channelAsc" class="dark:bg-gray-800">Channel Name (A → Z)</option>
            <option value="latencyAsc" class="dark:bg-gray-800">Latency (Fastest)</option>
          </select>
        </div>
      </div>

      <!-- Row 2: Read Value Scoring & Domestic Presets (Double Feature Row) -->
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-3 pt-2 border-t border-gray-100 dark:border-gray-700/60">
        <!-- Read Value Filters (7 cols) -->
        <div class="lg:col-span-7 space-y-1.5">
          <div class="flex items-center justify-between">
            <label class="block text-[10px] font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
              <Award class="w-3.5 h-3.5" />
              <span>Read Value Scoring</span>
            </label>
            <div class="flex items-center gap-2">
              <span class="text-[10px] font-mono text-gray-400">
                Min: {{ readValueMinScore.toFixed(1) }} / 3.0
              </span>
              <button
                @click="sortBy = 'readValDesc'"
                :class="[
                  'px-2 py-0.5 rounded-lg text-[10px] font-bold transition flex items-center gap-1 cursor-pointer',
                  sortBy === 'readValDesc'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'bg-gray-100 dark:bg-gray-900/60 text-gray-600 dark:text-gray-300 hover:text-emerald-600'
                ]"
                title="Sort channels by Read Value High to Low"
              >
                <span>⚡ High → Low</span>
              </button>
            </div>
          </div>

          <!-- Interactive Score Slider -->
          <div class="flex items-center gap-2 pt-0.5">
            <span class="text-[10px] font-mono text-gray-400 shrink-0">0.0</span>
            <input
              type="range"
              min="0"
              max="3"
              step="0.05"
              v-model.number="readValueMinScore"
              @input="readValuePreset = 'custom'"
              class="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-emerald-600 dark:accent-emerald-500"
              title="Slide to filter channels by minimum Read Value score"
            />
            <span class="text-[10px] font-mono text-gray-400 shrink-0">3.0</span>
            <button
              v-if="readValueMinScore > 0"
              @click="readValueMinScore = 0; readValuePreset = 'all'"
              class="text-[10px] font-bold text-gray-400 hover:text-rose-500 dark:hover:text-rose-400 px-1 py-0.5 transition cursor-pointer shrink-0"
              title="Reset score slider"
            >
              Reset
            </button>
          </div>

          <!-- Quick Presets -->
          <div class="flex flex-wrap items-center gap-1.5">
            <button
              @click="applyReadValuePreset('all')"
              :class="[
                'px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer',
                readValuePreset === 'all'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'bg-gray-100 dark:bg-gray-900/60 text-gray-600 dark:text-gray-300 hover:bg-gray-200'
              ]"
            >
              All
            </button>
            <button
              @click="applyReadValuePreset('critical')"
              :class="[
                'px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1',
                readValuePreset === 'critical'
                  ? 'bg-emerald-600 text-white shadow-sm ring-2 ring-emerald-500/40'
                  : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100'
              ]"
            >
              <span>L3 Critical (≥2.2)</span>
              <span class="text-[10px] px-1 rounded-full font-mono bg-black/10 dark:bg-white/10">
                {{ readValueStats.criticalCount.toLocaleString() }}
              </span>
            </button>
            <button
              @click="applyReadValuePreset('substantive')"
              :class="[
                'px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1',
                readValuePreset === 'substantive'
                  ? 'bg-blue-600 text-white shadow-sm ring-2 ring-blue-500/40'
                  : 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 hover:bg-blue-100'
              ]"
            >
              <span>L2 Substantive (≥1.5)</span>
              <span class="text-[10px] px-1 rounded-full font-mono bg-black/10 dark:bg-white/10">
                {{ readValueStats.substantiveCount.toLocaleString() }}
              </span>
            </button>
            <button
              @click="applyReadValuePreset('background')"
              :class="[
                'px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1',
                readValuePreset === 'background'
                  ? 'bg-amber-600 text-white shadow-sm ring-2 ring-amber-500/40'
                  : 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 hover:bg-amber-100'
              ]"
            >
              <span>L1 (≥0.8)</span>
            </button>
            <button
              @click="applyReadValuePreset('low')"
              :class="[
                'px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1',
                readValuePreset === 'low'
                  ? 'bg-slate-600 text-white shadow-sm ring-2 ring-slate-500/40'
                  : 'bg-slate-100 dark:bg-slate-900/60 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-200'
              ]"
            >
              <span>L0 (&lt;0.8)</span>
            </button>
            <button
              @click="applyReadValuePreset('hasReadValue')"
              :class="[
                'px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1',
                readValuePreset === 'hasReadValue'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'bg-gray-100 dark:bg-gray-900/60 text-gray-700 dark:text-gray-300 hover:bg-gray-200'
              ]"
            >
              <span>Scored</span>
              <span class="text-[10px] px-1 rounded-full font-mono bg-black/10 dark:bg-white/10">
                {{ readValueStats.hasCount.toLocaleString() }}
              </span>
            </button>
            <button
              @click="applyReadValuePreset('legacyOnly')"
              :class="[
                'px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1',
                readValuePreset === 'legacyOnly'
                  ? 'bg-gray-700 text-white shadow-sm'
                  : 'bg-gray-100 dark:bg-gray-900/60 text-gray-500 dark:text-gray-400 hover:bg-gray-200'
              ]"
              title="Filter channels from legacy batch without Read Value scoring"
            >
              <span>Legacy</span>
              <span class="text-[10px] px-1 rounded-full font-mono bg-black/10 dark:bg-white/10">
                {{ readValueStats.legacyCount.toLocaleString() }}
              </span>
            </button>
          </div>
        </div>

        <!-- Domestic Affairs Filter (5 cols) -->
        <div class="lg:col-span-5 space-y-1.5">
          <div class="flex items-center justify-between">
            <label class="block text-[10px] font-black uppercase tracking-wider text-purple-600 dark:text-purple-400">
              Domestic Affairs Orientation
            </label>
            <span class="text-[10px] font-mono text-gray-400">
              Ratio: 0.0–1.0
            </span>
          </div>

          <div class="flex items-center gap-1 p-1 bg-gray-100 dark:bg-gray-900/60 rounded-xl border border-gray-200/60 dark:border-gray-700/60 text-xs">
            <button
              @click="applyDomesticPreset('all')"
              :class="[
                'flex-1 py-1 rounded-lg font-bold transition text-center cursor-pointer',
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
                'flex-1 py-1 rounded-lg font-bold transition text-center cursor-pointer',
                domesticPreset === 'high'
                  ? 'bg-white dark:bg-gray-800 text-purple-600 dark:text-purple-400 shadow-sm'
                  : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'
              ]"
            >
              Domestic (≥0.6)
            </button>
            <button
              @click="applyDomesticPreset('mid')"
              :class="[
                'flex-1 py-1 rounded-lg font-bold transition text-center cursor-pointer',
                domesticPreset === 'mid'
                  ? 'bg-white dark:bg-gray-800 text-purple-600 dark:text-purple-400 shadow-sm'
                  : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'
              ]"
            >
              Mid
            </button>
            <button
              @click="applyDomesticPreset('low')"
              :class="[
                'flex-1 py-1 rounded-lg font-bold transition text-center cursor-pointer',
                domesticPreset === 'low'
                  ? 'bg-white dark:bg-gray-800 text-purple-600 dark:text-purple-400 shadow-sm'
                  : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'
              ]"
            >
              External (&lt;0.3)
            </button>
          </div>
        </div>
      </div>

      <!-- Row 3: Topic Chips -->
      <div class="space-y-1.5 pt-2 border-t border-gray-100 dark:border-gray-700/60">
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

      <!-- Row 4: Target Country Chips (Expanded to 12 regions) -->
      <div class="space-y-1.5">
        <label class="block text-[10px] font-black uppercase tracking-wider text-gray-400 dark:text-gray-500 flex items-center justify-between">
          <span>Filter By Target Country / Region</span>
          <span class="text-indigo-600 dark:text-indigo-400 lowercase font-normal">Includes European Union, US Allies Asia, Africa</span>
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
              'px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer relative',
              selectedCountry === key
                ? 'bg-cyan-600 text-white shadow-sm ring-2 ring-cyan-500/40'
                : cfg.isNew
                  ? 'bg-cyan-50/80 dark:bg-cyan-950/30 text-cyan-800 dark:text-cyan-300 border border-cyan-200 dark:border-cyan-800/60 hover:bg-cyan-100 dark:hover:bg-cyan-900/50'
                  : 'bg-gray-50 dark:bg-gray-900/60 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800'
            ]"
          >
            <span>{{ cfg.flag }} {{ cfg.label }}</span>
            <span
              v-if="cfg.isNew"
              class="text-[9px] uppercase px-1 py-0.2 rounded font-extrabold bg-amber-400/20 text-amber-700 dark:text-amber-300 border border-amber-300/40"
            >
              New
            </span>
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
        Try resetting the search query or expanding topic, country, or Read Value thresholds.
      </p>
      <button
        @click="searchQuery = ''; selectedTopic = 'all'; selectedCountry = 'all'; applyDomesticPreset('all'); applyReadValuePreset('all')"
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
        :id="`types-channel-${item.channel.replace(/^@/, '')}`"
        :data-types-channel="item.channel.replace(/^@/, '')"
        class="bg-white dark:bg-gray-800/90 rounded-2xl border border-gray-200/80 dark:border-gray-700/80 p-4.5 shadow-sm hover:shadow-md transition-all duration-200 flex flex-col justify-between space-y-3 group relative"
      >
        <!-- Card Header: Avatar, Name & Actions -->
        <div class="flex items-start justify-between gap-2.5">
          <div class="flex items-center gap-2.5 min-w-0 flex-1">
            <div
              class="relative shrink-0 cursor-pointer"
              data-profile-trigger="true"
              @mouseenter="handleChannelMouseEnter($event, item.channel)"
              @mouseleave="handleChannelMouseLeave"
              @click.stop="handleExplore(item.channel)"
              :title="`View profile hint card for @${item.channel}`"
            >
              <img
                :src="getChannelAvatarSrc(item.channel)"
                @error="($event.target as HTMLElement).style.display = 'none'"
                class="w-9 h-9 rounded-full object-cover border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-700 hover:ring-2 hover:ring-indigo-500/40 transition"
                alt=""
              />
              <div class="w-9 h-9 rounded-full bg-indigo-100 dark:bg-indigo-950/80 text-indigo-600 dark:text-indigo-400 flex items-center justify-center text-xs font-bold uppercase -z-10 absolute inset-0">
                {{ item.channel.charAt(0) }}
              </div>
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-1.5 flex-wrap">
                <h4
                  class="text-xs font-extrabold text-gray-900 dark:text-white truncate hover:text-indigo-600 dark:hover:text-indigo-400 hover:underline cursor-pointer transition select-text"
                  data-profile-trigger="true"
                  :title="`View profile hint card for @${item.channel}`"
                  @mouseenter="handleChannelMouseEnter($event, item.channel)"
                  @mouseleave="handleChannelMouseLeave"
                  @click.stop="handleExplore(item.channel)"
                >
                  @{{ item.channel }}
                </h4>
                <!-- Quality Score Badge on Card -->
                <div
                  v-if="item.hasReadValue && item.readValueScore !== null"
                  :class="[
                    'inline-flex items-center gap-1 px-1.5 py-0.2 rounded-full text-[9px] font-black tracking-wide border shrink-0',
                    item.readValueScore >= 2.2
                      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/80 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700 ring-1 ring-emerald-500/20'
                      : item.readValueScore >= 1.5
                        ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/80 dark:text-blue-300 border-blue-300 dark:border-blue-700'
                        : item.readValueScore >= 0.8
                          ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/80 dark:text-amber-300 border-amber-300 dark:border-amber-700'
                          : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-300 dark:border-slate-700'
                  ]"
                  :title="`Read Value Score: ${item.readValueScore.toFixed(2)} / 3.0`"
                >
                  <Award class="w-2.5 h-2.5 shrink-0" />
                  <span>{{ item.readValueScore.toFixed(2) }} · {{ getReadValueTier(item.readValueScore).shortLabel }}</span>
                </div>
                <!-- AI Match Affinity Badge -->
                <div
                  v-if="activeNlFilter"
                  class="inline-flex items-center gap-1 px-1.5 py-0.2 rounded-full text-[9px] font-black tracking-wide border shrink-0 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/80 dark:text-indigo-300 border-indigo-300 dark:border-indigo-700"
                  :title="`AI Match Affinity: ${Math.round(calculateDistributionAwareScore(item, activeNlFilter) * 100)}%`"
                >
                  <Sparkles class="w-2.5 h-2.5 shrink-0 text-indigo-500" />
                  <span>{{ Math.round(calculateDistributionAwareScore(item, activeNlFilter) * 100) }}% Match</span>
                </div>
                <div
                  v-else-if="!item.hasReadValue"
                  class="inline-flex items-center gap-1 px-1.5 py-0.2 rounded-full text-[9px] font-medium text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 border border-dashed border-gray-300 dark:border-gray-700 shrink-0"
                  title="Legacy batch without Read Value scoring"
                >
                  <span>Legacy</span>
                </div>
              </div>
              <div class="flex items-center gap-1.5 text-[10px] text-gray-400 font-mono mt-0.5">
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
              title="Inspect full distributions and legend"
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

        <!-- Section 2: Target Country Distribution (Supports expanded regions) -->
        <div class="space-y-1.5 bg-gray-50/70 dark:bg-gray-900/40 p-2.5 rounded-xl border border-gray-100 dark:border-gray-800/60">
          <div class="flex items-center justify-between text-xs">
            <span class="text-[10px] font-black uppercase tracking-wider text-gray-400 dark:text-gray-500">
              Target Region
            </span>
            <span class="font-extrabold text-gray-800 dark:text-gray-200 capitalize flex items-center gap-1 truncate max-w-[170px]" :title="getCountryInfo(item.country).label">
              <span>{{ getCountryInfo(item.country).flag }}</span>
              <span class="truncate">{{ getCountryInfo(item.country).label }}</span>
              <span class="text-[10px] font-mono font-normal text-cyan-600 dark:text-cyan-400 tabular-nums shrink-0">
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

        <!-- Section 3: Dual Intelligence Strip: Domestic Affairs & Read Value -->
        <div class="grid grid-cols-2 gap-2">
          <!-- Domestic Affairs -->
          <div class="space-y-1 bg-gray-50/70 dark:bg-gray-900/40 p-2.5 rounded-xl border border-gray-100 dark:border-gray-800/60">
            <div class="flex items-center justify-between text-xs">
              <span class="text-[9px] font-black uppercase tracking-wider text-gray-400 dark:text-gray-500">
                Domestic
              </span>
              <span class="font-mono font-extrabold text-[11px] tabular-nums" :class="item.domestic >= 0.6 ? 'text-purple-600 dark:text-purple-400' : 'text-gray-700 dark:text-gray-300'">
                {{ item.domestic.toFixed(2) }}
              </span>
            </div>
            <div class="w-full h-1.5 bg-gray-200/80 dark:bg-gray-700/60 rounded-full overflow-hidden">
              <div
                class="h-full bg-gradient-to-r from-purple-500 to-indigo-500"
                :style="{ width: `${Math.round(item.domestic * 100)}%` }"
              ></div>
            </div>
            <div class="text-[9px] text-gray-400 truncate">
              {{ item.domestic >= 0.6 ? 'Domestic Focus' : item.domestic >= 0.3 ? 'Balanced' : 'External Focus' }}
            </div>
          </div>

          <!-- Read Value (Quality score badge with level meter and breakdown bar) -->
          <div class="space-y-1.5 bg-gray-50/70 dark:bg-gray-900/40 p-2.5 rounded-xl border border-gray-100 dark:border-gray-800/60">
            <div class="flex items-center justify-between text-xs">
              <span class="text-[9px] font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                <Award class="w-3 h-3" />
                <span>Read Value</span>
              </span>
              <span
                v-if="item.hasReadValue && item.readValueScore !== null"
                class="font-mono font-extrabold text-[11px] tabular-nums text-emerald-600 dark:text-emerald-400"
              >
                {{ item.readValueScore.toFixed(2) }}
              </span>
              <span v-else class="text-[10px] text-gray-400 font-mono">
                Legacy
              </span>
            </div>

            <!-- Stepped Level Meter (0..3) -->
            <div class="space-y-0.5">
              <div class="grid grid-cols-4 gap-1 py-0.5" title="Stepped Quality Meter (L0: Chatter, L1: Background, L2: Substantive, L3: Critical)">
                <div
                  :class="[
                    'h-2 rounded-xs transition-all flex items-center justify-center text-[7.5px] font-mono font-black',
                    (item.hasReadValue && item.readValueScore !== null)
                      ? 'bg-slate-400 text-white'
                      : 'bg-gray-200 dark:bg-gray-700 text-gray-400 opacity-40'
                  ]"
                  title="Level 0: Fluff/Chatter (Score ≥ 0.0)"
                >
                  0
                </div>
                <div
                  :class="[
                    'h-2 rounded-xs transition-all flex items-center justify-center text-[7.5px] font-mono font-black',
                    (item.hasReadValue && item.readValueScore !== null && item.readValueScore >= 0.8)
                      ? 'bg-amber-500 text-white shadow-xs'
                      : 'bg-gray-200 dark:bg-gray-700 text-gray-400 opacity-40'
                  ]"
                  title="Level 1: Background/Sentiment (Score ≥ 0.8)"
                >
                  1
                </div>
                <div
                  :class="[
                    'h-2 rounded-xs transition-all flex items-center justify-center text-[7.5px] font-mono font-black',
                    (item.hasReadValue && item.readValueScore !== null && item.readValueScore >= 1.5)
                      ? 'bg-blue-500 text-white shadow-xs'
                      : 'bg-gray-200 dark:bg-gray-700 text-gray-400 opacity-40'
                  ]"
                  title="Level 2: Circumstantial/Claims (Score ≥ 1.5)"
                >
                  2
                </div>
                <div
                  :class="[
                    'h-2 rounded-xs transition-all flex items-center justify-center text-[7.5px] font-mono font-black',
                    (item.hasReadValue && item.readValueScore !== null && item.readValueScore >= 2.2)
                      ? 'bg-emerald-500 text-white shadow-xs ring-1 ring-emerald-300'
                      : 'bg-gray-200 dark:bg-gray-700 text-gray-400 opacity-40'
                  ]"
                  title="Level 3: Critical Facts (Score ≥ 2.2)"
                >
                  3
                </div>
              </div>
            </div>

            <!-- 4-Level Read Value Breakdown Bar (0..3) -->
            <div
              v-if="item.hasReadValue && Object.keys(item.readValueProbs).length > 0"
              class="w-full h-1.5 bg-gray-200/80 dark:bg-gray-700/60 rounded-full overflow-hidden flex"
              :title="`L0: ${Math.round((item.readValueProbs['0'] || 0) * 100)}% · L1: ${Math.round((item.readValueProbs['1'] || 0) * 100)}% · L2: ${Math.round((item.readValueProbs['2'] || 0) * 100)}% · L3: ${Math.round((item.readValueProbs['3'] || 0) * 100)}%`"
            >
              <div
                class="bg-slate-400"
                :style="{ width: `${Math.round((item.readValueProbs['0'] || 0) * 100)}%` }"
                title="Level 0: Fluff/Banter"
              ></div>
              <div
                class="bg-amber-400"
                :style="{ width: `${Math.round((item.readValueProbs['1'] || 0) * 100)}%` }"
                title="Level 1: Background/Sentiment"
              ></div>
              <div
                class="bg-sky-500"
                :style="{ width: `${Math.round((item.readValueProbs['2'] || 0) * 100)}%` }"
                title="Level 2: Circumstantial/Unverified"
              ></div>
              <div
                class="bg-emerald-500"
                :style="{ width: `${Math.round((item.readValueProbs['3'] || 0) * 100)}%` }"
                title="Level 3: Critical Facts"
              ></div>
            </div>
            <div v-else class="w-full h-1.5 bg-gray-200/60 dark:bg-gray-800 rounded-full border border-dashed border-gray-300 dark:border-gray-700" title="Legacy format without score breakdown"></div>

            <div class="flex items-center justify-between text-[9px]">
              <span class="truncate font-bold" :class="getReadValueTier(item.readValueScore).color">
                {{ getReadValueTier(item.readValueScore).shortLabel }}
              </span>
              <span v-if="item.hasReadValue" class="text-gray-400 font-mono text-[8.5px]">
                L3: {{ Math.round((item.readValueProbs['3'] || 0) * 100) }}%
              </span>
            </div>
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
                    :src="getChannelAvatarSrc(selectedInspectionItem.channel)"
                    class="w-11 h-11 rounded-full object-cover border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-700"
                    alt=""
                  />
                  <div>
                    <h3 class="text-base font-extrabold text-gray-900 dark:text-white">
                      @{{ selectedInspectionItem.channel }}
                    </h3>
                    <p class="text-xs text-gray-500 dark:text-gray-400">
                      Channel Taxonomy, Read Value & Geopolitical Distribution
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

              <!-- Primary Highlights: 4-Grid Breakdown -->
              <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-center">
                <!-- Topic -->
                <div class="p-2.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200/60 dark:border-indigo-800/60">
                  <div class="text-[9px] font-black uppercase text-indigo-700 dark:text-indigo-300">Topic</div>
                  <div class="text-xs font-bold text-gray-900 dark:text-white capitalize truncate mt-0.5">
                    {{ selectedInspectionItem.topic }}
                  </div>
                  <div class="text-[11px] font-mono font-bold text-indigo-600 dark:text-indigo-400">
                    {{ Math.round(selectedInspectionItem.topicConf * 100) }}%
                  </div>
                </div>

                <!-- Country -->
                <div class="p-2.5 rounded-xl bg-cyan-50 dark:bg-cyan-950/40 border border-cyan-200/60 dark:border-cyan-800/60">
                  <div class="text-[9px] font-black uppercase text-cyan-700 dark:text-cyan-300">Region</div>
                  <div class="text-xs font-bold text-gray-900 dark:text-white capitalize truncate mt-0.5" :title="getCountryInfo(selectedInspectionItem.country).label">
                    {{ getCountryInfo(selectedInspectionItem.country).label }}
                  </div>
                  <div class="text-[11px] font-mono font-bold text-cyan-600 dark:text-cyan-400">
                    {{ Math.round(selectedInspectionItem.countryConf * 100) }}%
                  </div>
                </div>

                <!-- Domestic -->
                <div class="p-2.5 rounded-xl bg-purple-50 dark:bg-purple-950/40 border border-purple-200/60 dark:border-purple-800/60">
                  <div class="text-[9px] font-black uppercase text-purple-700 dark:text-purple-300">Domestic</div>
                  <div class="text-xs font-bold text-gray-900 dark:text-white truncate mt-0.5">
                    {{ selectedInspectionItem.domestic >= 0.6 ? 'Domestic' : 'External' }}
                  </div>
                  <div class="text-[11px] font-mono font-bold text-purple-600 dark:text-purple-400">
                    {{ selectedInspectionItem.domestic.toFixed(2) }}
                  </div>
                </div>

                <!-- Read Value -->
                <div class="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200/60 dark:border-emerald-800/60">
                  <div class="text-[9px] font-black uppercase text-emerald-700 dark:text-emerald-300">Read Value</div>
                  <div class="text-xs font-bold text-gray-900 dark:text-white truncate mt-0.5">
                    {{ selectedInspectionItem.hasReadValue ? getReadValueTier(selectedInspectionItem.readValueScore).shortLabel : 'Legacy' }}
                  </div>
                  <div class="text-[11px] font-mono font-bold text-emerald-600 dark:text-emerald-400">
                    {{ selectedInspectionItem.hasReadValue && selectedInspectionItem.readValueScore !== null ? selectedInspectionItem.readValueScore.toFixed(2) : 'N/A' }}
                  </div>
                </div>
              </div>

              <!-- Read Value Deep Analysis Section -->
              <div class="space-y-2.5 bg-gray-50/70 dark:bg-gray-900/40 p-3.5 rounded-2xl border border-gray-100 dark:border-gray-800/60">
                <div class="flex items-center justify-between">
                  <h4 class="text-xs font-black uppercase tracking-wider text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
                    <Award class="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    <span>Read Value Quality Breakdown</span>
                  </h4>
                  <span
                    v-if="selectedInspectionItem.hasReadValue && selectedInspectionItem.readValueScore !== null"
                    class="font-mono text-xs font-extrabold px-2 py-0.5 rounded-lg bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200 border border-emerald-300 dark:border-emerald-700"
                  >
                    Score: {{ selectedInspectionItem.readValueScore.toFixed(3) }} / 3.000
                  </span>
                  <span v-else class="text-[10px] text-gray-400 font-mono">
                    Legacy Format (Score Not Included)
                  </span>
                </div>

                <div v-if="selectedInspectionItem.hasReadValue" class="space-y-2">
                  <!-- Levels 0 to 3 with Official Model Legend -->
                  <div class="space-y-2">
                    <!-- Level 3 -->
                    <div class="space-y-1 bg-white dark:bg-gray-900/70 p-2.5 rounded-xl border border-emerald-200/60 dark:border-emerald-900/60">
                      <div class="flex items-center justify-between text-xs">
                        <span class="font-bold text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5">
                          <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
                          Level 3: Critical Facts & Disclosures
                        </span>
                        <span class="font-mono text-[11px] font-bold tabular-nums text-emerald-800 dark:text-emerald-200">
                          {{ (((selectedInspectionItem.readValueProbs['3'] || 0)) * 100).toFixed(2) }}%
                        </span>
                      </div>
                      <div class="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                        <div class="h-full bg-emerald-500 rounded-full" :style="{ width: `${Math.round((selectedInspectionItem.readValueProbs['3'] || 0) * 100)}%` }"></div>
                      </div>
                      <p class="text-[10px] text-gray-500 dark:text-gray-400 italic leading-snug">
                        {{ selectedInspectionItem.readValueLegend?.['3'] || DEFAULT_READ_LEGEND['3'] }}
                      </p>
                    </div>

                    <!-- Level 2 -->
                    <div class="space-y-1 bg-white dark:bg-gray-900/70 p-2.5 rounded-xl border border-blue-200/60 dark:border-blue-900/60">
                      <div class="flex items-center justify-between text-xs">
                        <span class="font-bold text-blue-700 dark:text-blue-300 flex items-center gap-1.5">
                          <span class="w-2 h-2 rounded-full bg-blue-500"></span>
                          Level 2: Circumstantial Context & Claims
                        </span>
                        <span class="font-mono text-[11px] font-bold tabular-nums text-blue-800 dark:text-blue-200">
                          {{ (((selectedInspectionItem.readValueProbs['2'] || 0)) * 100).toFixed(2) }}%
                        </span>
                      </div>
                      <div class="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                        <div class="h-full bg-blue-500 rounded-full" :style="{ width: `${Math.round((selectedInspectionItem.readValueProbs['2'] || 0) * 100)}%` }"></div>
                      </div>
                      <p class="text-[10px] text-gray-500 dark:text-gray-400 italic leading-snug">
                        {{ selectedInspectionItem.readValueLegend?.['2'] || DEFAULT_READ_LEGEND['2'] }}
                      </p>
                    </div>

                    <!-- Level 1 -->
                    <div class="space-y-1 bg-white dark:bg-gray-900/70 p-2.5 rounded-xl border border-amber-200/60 dark:border-amber-900/60">
                      <div class="flex items-center justify-between text-xs">
                        <span class="font-bold text-amber-700 dark:text-amber-300 flex items-center gap-1.5">
                          <span class="w-2 h-2 rounded-full bg-amber-500"></span>
                          Level 1: Background & Opinion
                        </span>
                        <span class="font-mono text-[11px] font-bold tabular-nums text-amber-800 dark:text-amber-200">
                          {{ (((selectedInspectionItem.readValueProbs['1'] || 0)) * 100).toFixed(2) }}%
                        </span>
                      </div>
                      <div class="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                        <div class="h-full bg-amber-500 rounded-full" :style="{ width: `${Math.round((selectedInspectionItem.readValueProbs['1'] || 0) * 100)}%` }"></div>
                      </div>
                      <p class="text-[10px] text-gray-500 dark:text-gray-400 italic leading-snug">
                        {{ selectedInspectionItem.readValueLegend?.['1'] || DEFAULT_READ_LEGEND['1'] }}
                      </p>
                    </div>

                    <!-- Level 0 -->
                    <div class="space-y-1 bg-white dark:bg-gray-900/70 p-2.5 rounded-xl border border-slate-200/60 dark:border-slate-800/60">
                      <div class="flex items-center justify-between text-xs">
                        <span class="font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                          <span class="w-2 h-2 rounded-full bg-slate-400"></span>
                          Level 0: Fluff & Chatter
                        </span>
                        <span class="font-mono text-[11px] font-bold tabular-nums text-slate-800 dark:text-slate-200">
                          {{ (((selectedInspectionItem.readValueProbs['0'] || 0)) * 100).toFixed(2) }}%
                        </span>
                      </div>
                      <div class="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                        <div class="h-full bg-slate-400 rounded-full" :style="{ width: `${Math.round((selectedInspectionItem.readValueProbs['0'] || 0) * 100)}%` }"></div>
                      </div>
                      <p class="text-[10px] text-gray-500 dark:text-gray-400 italic leading-snug">
                        {{ selectedInspectionItem.readValueLegend?.['0'] || DEFAULT_READ_LEGEND['0'] }}
                      </p>
                    </div>
                  </div>
                </div>

                <div v-else class="text-xs text-gray-500 dark:text-gray-400 italic bg-white dark:bg-gray-900/50 p-3 rounded-xl border border-gray-200/60 dark:border-gray-800">
                  This record belongs to the legacy classification model run before Read Value scoring was implemented. Re-running the classifier on this channel will populate 0–3 level informativeness.
                </div>
              </div>

              <!-- Topic Probabilities Table -->
              <div class="space-y-2">
                <h4 class="text-xs font-black uppercase tracking-wider text-gray-600 dark:text-gray-300 flex items-center justify-between">
                  <span>Topic Distribution (All 9 Categories)</span>
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

              <!-- Target Country Probabilities Table (Supports 12 regions) -->
              <div class="space-y-2">
                <h4 class="text-xs font-black uppercase tracking-wider text-gray-600 dark:text-gray-300 flex items-center justify-between">
                  <span>Geopolitical Target Region Distribution</span>
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

    <!-- Beautiful Channel Profile Popup Hint Card (Explorer Tab Style) -->
    <Teleport to="body">
      <div
        ref="profileTooltipRef"
        v-if="isProfileTooltipVisible && hoveredProfileChannel"
        class="fixed z-[99999] pointer-events-auto transition-all duration-150 ease-out select-text"
        :style="{
          top: `${profileTooltipPos.top}px`,
          left: `${profileTooltipPos.left}px`,
        }"
        @mouseenter="handleTooltipCardMouseEnter"
        @mouseleave="handleTooltipCardMouseLeave"
        @mousedown="handleTooltipCardMouseDown"
        @click.stop
      >
        <div
          class="w-[330px] sm:w-[350px] bg-white/95 dark:bg-gray-900/95 backdrop-blur-xl border border-gray-200/90 dark:border-gray-700/80 rounded-3xl shadow-2xl p-4.5 flex flex-col gap-3 animate-in fade-in zoom-in-95 duration-150 ring-1 ring-black/5 dark:ring-white/10 select-text selection:bg-indigo-500 selection:text-white dark:selection:bg-indigo-600 dark:selection:text-white"
        >
          <!-- Top Header: Avatar + Title + Handle + Channel Badge + Close Button -->
          <div class="flex items-start justify-between gap-2.5">
            <div class="flex items-center gap-2.5 min-w-0 flex-1">
              <!-- Avatar with fallback -->
              <div class="relative w-11 h-11 rounded-2xl shrink-0 overflow-hidden border border-indigo-500/25 bg-gradient-to-br from-indigo-500/20 to-indigo-700/15 flex items-center justify-center shadow-xs select-none">
                <img
                  :key="hoveredProfileChannel"
                  :src="(hoveredProfileMetadata?.photo && hoveredProfileMetadata.photo.startsWith('data:'))
                    ? hoveredProfileMetadata.photo
                    : `https://i.gogingko.net/api/v1/v/telegram-profile/${hoveredProfileChannel}`"
                  @error="($event.target as HTMLElement).style.display = 'none'"
                  class="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                  alt=""
                />
                <div class="absolute inset-0 flex items-center justify-center text-xs font-black font-mono text-indigo-600 dark:text-indigo-400 -z-10 uppercase select-none">
                  {{ hoveredProfileChannel.charAt(0) }}
                </div>
                <!-- Entity Type Icon Badge -->
                <span class="absolute -bottom-0.5 -right-0.5 p-0.5 rounded-md text-white shadow-xs bg-indigo-600 select-none">
                  <Radio class="w-2.5 h-2.5" />
                </span>
              </div>

              <!-- Channel Title & Handle -->
              <div class="min-w-0 flex-1 select-text">
                <div class="flex items-center gap-1.5 flex-wrap">
                  <h4
                    class="text-xs font-black text-gray-900 dark:text-white truncate max-w-[170px] select-text cursor-text"
                    :title="hoveredProfileMetadata?.title || hoveredProfileChannel"
                  >
                    {{ hoveredProfileMetadata?.title || `@${hoveredProfileChannel}` }}
                  </h4>
                  <!-- Channel Badge -->
                  <span class="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border border-indigo-500/30 rounded-md shrink-0 select-text cursor-text">
                    CHANNEL
                  </span>
                  <!-- Verified Badge -->
                  <span
                    v-if="hoveredProfileMetadata?.verified"
                    class="text-[9px] font-bold text-teal-600 dark:text-teal-400 shrink-0 select-none"
                    title="Verified"
                  >
                    <CheckCircle2 class="w-3.5 h-3.5" />
                  </span>
                </div>
                <div class="flex items-center gap-1 mt-0.5 select-text">
                  <span class="text-[11px] font-mono font-medium truncate text-indigo-600 dark:text-indigo-400 select-text cursor-text">
                    @{{ hoveredProfileChannel }}
                  </span>
                </div>
              </div>
            </div>

            <!-- Dismiss Button -->
            <button
              @click="closeProfileTooltip"
              class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors shrink-0 cursor-pointer select-none"
              title="Close"
            >
              <X class="w-3.5 h-3.5" />
            </button>
          </div>

          <!-- Loading State Skeleton -->
          <div v-if="isProfileLoading" class="py-3 px-1 flex flex-col items-center justify-center gap-2 text-center select-none">
            <div class="flex items-center gap-2 text-xs font-bold text-indigo-600 dark:text-indigo-400">
              <Loader2 class="w-3.5 h-3.5 animate-spin" />
              <span>Fetching channel profile...</span>
            </div>
            <div class="w-full space-y-1.5 mt-1">
              <div class="h-2 bg-gray-100 dark:bg-gray-800 rounded-full animate-pulse w-4/5 mx-auto"></div>
              <div class="h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full animate-pulse w-3/5 mx-auto"></div>
            </div>
          </div>

          <!-- Metadata Found State -->
          <div v-else-if="hoveredProfileMetadata" class="space-y-2.5 select-text">
            <!-- Bio / About Description if present -->
            <div v-if="hoveredProfileMetadata.description" class="space-y-1 select-text">
              <p class="text-[11px] text-gray-600 dark:text-gray-300 font-normal leading-relaxed bg-gray-50/80 dark:bg-gray-950/40 p-2.5 rounded-xl border border-gray-150/40 dark:border-gray-800/50 max-h-24 overflow-y-auto custom-scrollbar break-words whitespace-pre-wrap select-text cursor-text">
                {{ hoveredProfileMetadata.description }}
              </p>
            </div>

            <!-- Bento Stats Grid -->
            <div class="grid grid-cols-2 gap-1.5 text-[11px] select-text">
              <!-- Subscribers / Members Count -->
              <div class="p-2 rounded-xl bg-gray-50/70 dark:bg-gray-800/60 border border-gray-150/40 dark:border-gray-700/50 select-text">
                <span class="text-[9px] uppercase font-black tracking-wider text-gray-400 flex items-center gap-1 select-text cursor-text">
                  <Users class="w-2.5 h-2.5 select-none" />
                  Subscribers
                </span>
                <span class="font-bold font-mono text-indigo-600 dark:text-indigo-400 text-xs block mt-0.5 select-text cursor-text">
                  {{ formatMemberCount(hoveredProfileMetadata.members || hoveredProfileMetadata.participants_count) }}
                </span>
              </div>

              <!-- Media Highlights (Photos / Files / Links) -->
              <div class="p-2 rounded-xl bg-gray-50/70 dark:bg-gray-800/60 border border-gray-150/40 dark:border-gray-700/50 select-text">
                <span class="text-[9px] uppercase font-black tracking-wider text-gray-400 flex items-center gap-1 select-text cursor-text">
                  <ImageIcon class="w-2.5 h-2.5 select-none" />
                  Media Items
                </span>
                <span class="font-bold font-mono text-gray-800 dark:text-gray-200 text-xs block mt-0.5 select-text cursor-text">
                  {{ ((hoveredProfileMetadata.photos || 0) + (hoveredProfileMetadata.files || 0) + (hoveredProfileMetadata.videos || 0)).toLocaleString() }}
                </span>
              </div>

              <!-- Detailed media breakdown pills -->
              <div
                v-if="hoveredProfileMetadata.photos !== undefined || hoveredProfileMetadata.links !== undefined || hoveredProfileMetadata.files !== undefined"
                class="col-span-2 px-2.5 py-1.5 rounded-xl bg-gray-50/70 dark:bg-gray-800/60 border border-gray-150/40 dark:border-gray-700/50 flex items-center justify-between text-[10px] select-text"
              >
                <span class="font-mono text-gray-500 dark:text-gray-400 select-text cursor-text">
                  <span class="font-bold text-gray-700 dark:text-gray-200 select-text cursor-text">{{ hoveredProfileMetadata.photos ?? 0 }}</span> photos
                </span>
                <span class="font-mono text-gray-500 dark:text-gray-400 select-text cursor-text">
                  <span class="font-bold text-gray-700 dark:text-gray-200 select-text cursor-text">{{ hoveredProfileMetadata.files ?? 0 }}</span> files
                </span>
                <span class="font-mono text-gray-500 dark:text-gray-400 select-text cursor-text">
                  <span class="font-bold text-gray-700 dark:text-gray-200 select-text cursor-text">{{ hoveredProfileMetadata.links ?? 0 }}</span> links
                </span>
              </div>
            </div>
          </div>

          <!-- Uncached / Not Found Fallback State -->
          <div v-else class="space-y-1.5 py-1.5 text-center select-text">
            <div class="flex items-center justify-center gap-1.5 text-amber-600 dark:text-amber-400 text-xs font-bold select-text cursor-text">
              <Info class="w-3.5 h-3.5 shrink-0 select-none" />
              <span>Public Profile Bio Not Cached</span>
            </div>
            <p class="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed select-text cursor-text">
              Channel is actively indexed in the live stream. Click Explore to inspect recent posts.
            </p>
          </div>

          <!-- Action Footer Buttons -->
          <div class="pt-2 border-t border-gray-150/70 dark:border-gray-800/70 flex items-center gap-1.5 select-none">
            <!-- Jump to Explorer Button -->
            <button
              @click="handleExplore(hoveredProfileChannel); closeProfileTooltip();"
              class="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs transition-colors cursor-pointer select-none"
            >
              <ArrowUpRight class="w-3.5 h-3.5" />
              <span>Explore Channel</span>
            </button>

            <!-- Open in Telegram Web -->
            <a
              :href="`https://t.me/${hoveredProfileChannel}`"
              target="_blank"
              rel="noopener noreferrer"
              class="flex items-center justify-center gap-1 py-1.5 px-2.5 rounded-xl text-xs font-bold bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-750 text-gray-700 dark:text-gray-300 border border-gray-200/60 dark:border-gray-700/60 transition-colors select-none"
              title="Open in Telegram Web"
            >
              <ExternalLink class="w-3.5 h-3.5" />
              <span class="hidden sm:inline">Telegram</span>
            </a>

            <!-- Copy Handle -->
            <button
              @click="copyProfileChannelName(hoveredProfileChannel)"
              class="p-1.5 rounded-xl bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-750 text-gray-600 dark:text-gray-300 border border-gray-200/60 dark:border-gray-700/60 transition-colors cursor-pointer shrink-0 select-none"
              :title="isProfileCopied ? 'Copied!' : 'Copy @handle'"
            >
              <CheckCircle2 v-if="isProfileCopied" class="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
              <Copy v-else class="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
