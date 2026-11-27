<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from "vue";
import { useI18n } from "../../i18n";
import {
  ShieldCheck,
  ShieldAlert,
  ShieldOff,
  X,
  Search,
  Sparkles,
  Cpu,
  Cloud,
  RotateCcw,
  Trash2,
  Loader2,
  CheckCircle2,
  AlertTriangle
} from "lucide-vue-next";
import type { HotPostItem } from "../../utils/hotsEngine";
import {
  type HotsSpamFilterMode,
  type HotsSpamSensitivity,
  type FilteredSpamPostItem,
  type SpamCacheStats,
  getSpamThreshold,
  getSpamCacheStats,
  clearSpamEvaluationCache,
  setPostSpamOverride
} from "../../utils/hotsSpamFilter";
import { verifyPostsWithSystemOneOnDemand } from "../../utils/hotsWorkerClient";

const props = defineProps<{
  isOpen: boolean;
  mode: HotsSpamFilterMode;
  sensitivity: HotsSpamSensitivity;
  filteredSpamPosts: FilteredSpamPostItem[];
  substantivePosts: HotPostItem[];
  isComputing?: boolean;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "update:mode", mode: HotsSpamFilterMode): void;
  (e: "update:sensitivity", sensitivity: HotsSpamSensitivity): void;
  (e: "recompute"): void;
  (e: "select-channel", channelId: string): void;
}>();

const { t } = useI18n();

const cacheStats = ref<SpamCacheStats>({
  totalRecords: 0,
  spamRecords: 0,
  systemOneRecords: 0,
  overrideRecords: 0
});
const searchQuery = ref("");
const showAllFiltered = ref(false);
const restoringKey = ref<string | null>(null);
const isClearingCache = ref(false);
const isVerifyingSystemOne = ref(false);
const verifyProgress = ref<{ done: number; total: number }>({ done: 0, total: 0 });
const feedbackMessage = ref("");
const feedbackTone = ref<"success" | "info" | "error">("info");
let verifyAbortController: AbortController | null = null;
let feedbackTimer: ReturnType<typeof setTimeout> | null = null;

function setFeedback(msg: string, tone: "success" | "info" | "error" = "info") {
  if (feedbackTimer) {
    clearTimeout(feedbackTimer);
    feedbackTimer = null;
  }
  feedbackMessage.value = msg;
  feedbackTone.value = tone;
  feedbackTimer = setTimeout(() => {
    feedbackMessage.value = "";
    feedbackTimer = null;
  }, 6000);
}

async function refreshCacheStats() {
  try {
    cacheStats.value = await getSpamCacheStats();
  } catch {
    // ignore indexedDB read errors
  }
}

watch(
  () => props.isOpen,
  (open) => {
    if (open) {
      searchQuery.value = "";
      showAllFiltered.value = false;
      void refreshCacheStats();
    } else if (verifyAbortController) {
      verifyAbortController.abort();
      verifyAbortController = null;
      isVerifyingSystemOne.value = false;
    }
  }
);

watch(
  () => props.filteredSpamPosts.length,
  () => {
    if (props.isOpen) {
      void refreshCacheStats();
    }
  }
);

onUnmounted(() => {
  if (verifyAbortController) {
    verifyAbortController.abort();
    verifyAbortController = null;
  }
  if (feedbackTimer) {
    clearTimeout(feedbackTimer);
    feedbackTimer = null;
  }
});

const engineDescription = computed(() => {
  switch (props.mode) {
    case "local":
      return (
        t("listen.hots.spamModeLocalDesc") ||
        "Instant multilingual heuristics, cross-channel ad-blast detection, and local MiniLM semantic classification. Zero network latency."
      );
    case "hybrid":
      return (
        t("listen.hots.spamModeHybridDesc") ||
        "Fast local screening plus automatic Kev SystemOne API verification for borderline posts, cached permanently in IndexedDB."
      );
    case "systemone":
      return (
        t("listen.hots.spamModeSystemOneDesc") ||
        "Verifies uncached posts via Kev SystemOne API with local pre-filtering and IndexedDB caching for highest precision."
      );
    case "off":
      return (
        t("listen.hots.spamModeOffDesc") ||
        "Spam filtering is disabled. All substantive posts are passed directly into topic clustering."
      );
  }
});

const activeThresholdPercent = computed(() => Math.round(getSpamThreshold(props.sensitivity) * 100));

const sortedFilteredPosts = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  const list = [...props.filteredSpamPosts].sort(
    (a, b) => (b.evaluation.spamScore || 0) - (a.evaluation.spamScore || 0)
  );
  if (!q) return list;
  return list.filter((item) => {
    const channel = (item.post.channelUsername || item.post.channelName || "").toLowerCase();
    const text = (item.post.text || "").toLowerCase();
    const reasons = (item.evaluation.reasons || []).join(" ").toLowerCase();
    return channel.includes(q) || text.includes(q) || reasons.includes(q);
  });
});

const displayedFilteredPosts = computed(() => {
  if (showAllFiltered.value) return sortedFilteredPosts.value;
  return sortedFilteredPosts.value.slice(0, 60);
});

function formatSourceLabel(source: string): string {
  switch (source) {
    case "systemone":
      return t("listen.hots.spamSourceSystemOne") || "SystemOne API";
    case "local-neural":
      return t("listen.hots.spamSourceLocalNeural") || "Local AI";
    case "override":
      return t("listen.hots.spamSourceOverride") || "Manual";
    default:
      return t("listen.hots.spamSourceRule") || "Local Rule";
  }
}

function formatPostTime(ts?: number): string {
  if (!ts) return "";
  try {
    const d = new Date(ts);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    });
  } catch {
    return "";
  }
}

function handleSelectMode(nextMode: HotsSpamFilterMode) {
  if (nextMode === props.mode) return;
  emit("update:mode", nextMode);
}

function handleSelectSensitivity(nextSensitivity: HotsSpamSensitivity) {
  if (nextSensitivity === props.sensitivity) return;
  emit("update:sensitivity", nextSensitivity);
}

async function handleRestorePost(item: FilteredSpamPostItem) {
  if (restoringKey.value) return;
  restoringKey.value = item.post.key;
  try {
    await setPostSpamOverride(item.post.key, item.evaluation.contentHash, "ham");
    await refreshCacheStats();
    setFeedback(
      t("listen.hots.spamRestoredNotice") ||
        "Post marked as Not Spam and restored. Recomputing clusters...",
      "success"
    );
    emit("recompute");
  } catch (err) {
    console.error("Failed to save spam override:", err);
    setFeedback(
      t("listen.hots.spamActionError") || "Could not update spam override.",
      "error"
    );
  } finally {
    restoringKey.value = null;
  }
}

async function handleVerifyWithSystemOne() {
  if (isVerifyingSystemOne.value || props.substantivePosts.length === 0) return;

  isVerifyingSystemOne.value = true;
  verifyProgress.value = { done: 0, total: Math.min(40, props.substantivePosts.length) };
  verifyAbortController = new AbortController();

  try {
    const result = await verifyPostsWithSystemOneOnDemand(
      props.substantivePosts,
      props.sensitivity,
      (done, total) => {
        verifyProgress.value = { done, total };
      },
      verifyAbortController.signal
    );

    await refreshCacheStats();

    if (result.checked === 0) {
      setFeedback(
        t("listen.hots.spamVerifyAllCached") ||
          "All candidate posts in this range are already verified by SystemOne.",
        "info"
      );
    } else if (result.flaggedSpam > 0) {
      setFeedback(
        t("listen.hots.spamVerifyFlagged", {
          checked: result.checked,
          flagged: result.flaggedSpam
        }) ||
          `SystemOne checked ${result.checked} posts and filtered ${result.flaggedSpam} additional spam posts.`,
        "success"
      );
      emit("recompute");
    } else {
      setFeedback(
        t("listen.hots.spamVerifyClean", { checked: result.checked }) ||
          `SystemOne verified ${result.checked} posts — no additional spam found.`,
        "info"
      );
    }
  } catch (err) {
    if ((err as { name?: string })?.name !== "AbortError") {
      console.warn("On-demand SystemOne spam verification failed:", err);
      setFeedback(
        t("listen.hots.spamVerifyError") ||
          "SystemOne verification could not complete. Local filter remains active.",
        "error"
      );
    }
  } finally {
    verifyAbortController = null;
    isVerifyingSystemOne.value = false;
  }
}

function handleCancelVerify() {
  if (verifyAbortController) {
    verifyAbortController.abort();
    verifyAbortController = null;
  }
  isVerifyingSystemOne.value = false;
}

async function handleClearCache() {
  if (isClearingCache.value) return;
  isClearingCache.value = true;
  try {
    await clearSpamEvaluationCache(true);
    await refreshCacheStats();
    setFeedback(
      t("listen.hots.spamCacheCleared") ||
        "Spam verdict cache cleared (manual overrides preserved). Recomputing...",
      "info"
    );
    emit("recompute");
  } catch (err) {
    console.error("Failed to clear spam cache:", err);
  } finally {
    isClearingCache.value = false;
  }
}
</script>

<template>
  <div
    v-if="isOpen"
    class="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200"
    @click.self="emit('close')"
  >
    <div
      class="bg-white dark:bg-gray-800 rounded-3xl border border-gray-200 dark:border-gray-700 shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden"
    >
      <!-- Header -->
      <div class="px-5 sm:px-6 py-4 border-b border-gray-200/80 dark:border-gray-700/80 flex items-center justify-between gap-3 shrink-0">
        <div class="flex items-center gap-3 min-w-0">
          <div
            class="h-9 w-9 rounded-xl border flex items-center justify-center shrink-0"
            :class="
              mode === 'off'
                ? 'bg-gray-100 dark:bg-gray-900/70 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-700'
                : 'bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 border-rose-200/70 dark:border-rose-800/60'
            "
          >
            <ShieldOff v-if="mode === 'off'" class="h-4 w-4" />
            <ShieldAlert v-else-if="filteredSpamPosts.length > 0" class="h-4 w-4" />
            <ShieldCheck v-else class="h-4 w-4" />
          </div>
          <div class="min-w-0">
            <h4 class="text-sm sm:text-base font-black text-gray-900 dark:text-white truncate">
              {{ t("listen.hots.spamModalTitle") || "Pre-Clustering Spam Filter" }}
            </h4>
            <p class="text-[11px] text-gray-500 dark:text-gray-400 truncate">
              {{
                t("listen.hots.spamModalSubtitle") ||
                "Filter ads, scams, and promotional spam before hot topic clustering"
              }}
            </p>
          </div>
        </div>
        <button
          type="button"
          @click="emit('close')"
          class="h-8 w-8 rounded-full bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-500 dark:text-gray-300 flex items-center justify-center cursor-pointer shrink-0 transition-colors"
          :aria-label="t('common.close') || 'Close'"
        >
          <X class="h-4 w-4" />
        </button>
      </div>

      <!-- Scrollable Body -->
      <div class="flex-1 overflow-y-auto px-5 sm:px-6 py-4 space-y-5">
        <!-- Engine Selector -->
        <div class="space-y-2">
          <div class="flex items-center justify-between gap-2">
            <span class="text-xs font-bold text-gray-700 dark:text-gray-200">
              {{ t("listen.hots.spamEngineLabel") || "Detection Engine" }}
            </span>
            <span class="text-[11px] font-mono tabular-nums text-gray-500 dark:text-gray-400">
              {{ t("listen.hots.spamThresholdReadout", { pct: activeThresholdPercent }) || `Threshold ≥ ${activeThresholdPercent}%` }}
            </span>
          </div>

          <div class="grid grid-cols-2 sm:grid-cols-4 gap-1.5 bg-gray-100/90 dark:bg-gray-900/70 p-1 rounded-2xl border border-gray-200/70 dark:border-gray-700/70">
            <button
              type="button"
              @click="handleSelectMode('local')"
              class="flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap"
              :class="
                mode === 'local'
                  ? 'bg-white dark:bg-gray-800 text-teal-600 dark:text-teal-400 shadow-xs'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              "
            >
              <Cpu class="h-3.5 w-3.5 shrink-0" />
              <span>{{ t("listen.hots.spamModeLocal") || "Local Fast + AI" }}</span>
            </button>

            <button
              type="button"
              @click="handleSelectMode('hybrid')"
              class="flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap"
              :class="
                mode === 'hybrid'
                  ? 'bg-white dark:bg-gray-800 text-indigo-600 dark:text-indigo-400 shadow-xs'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              "
            >
              <Sparkles class="h-3.5 w-3.5 shrink-0" />
              <span>{{ t("listen.hots.spamModeHybrid") || "Hybrid" }}</span>
            </button>

            <button
              type="button"
              @click="handleSelectMode('systemone')"
              class="flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap"
              :class="
                mode === 'systemone'
                  ? 'bg-white dark:bg-gray-800 text-sky-600 dark:text-sky-400 shadow-xs'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              "
            >
              <Cloud class="h-3.5 w-3.5 shrink-0" />
              <span>{{ t("listen.hots.spamModeSystemOne") || "SystemOne API" }}</span>
            </button>

            <button
              type="button"
              @click="handleSelectMode('off')"
              class="flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap"
              :class="
                mode === 'off'
                  ? 'bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 shadow-xs'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              "
            >
              <ShieldOff class="h-3.5 w-3.5 shrink-0" />
              <span>{{ t("listen.hots.spamModeOff") || "Off" }}</span>
            </button>
          </div>

          <p class="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
            {{ engineDescription }}
          </p>
        </div>

        <!-- Sensitivity + Cache Controls Grid -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <!-- Sensitivity -->
          <div class="p-3.5 rounded-2xl bg-gray-50 dark:bg-gray-900/60 border border-gray-200/70 dark:border-gray-700/70 space-y-2">
            <div class="flex items-center justify-between">
              <span class="text-xs font-bold text-gray-700 dark:text-gray-200">
                {{ t("listen.hots.spamSensitivityLabel") || "Filter Sensitivity" }}
              </span>
              <span class="text-[11px] text-gray-500 dark:text-gray-400">
                {{ t("listen.hots.spamSensitivityHint") || "News guard active" }}
              </span>
            </div>
            <div class="grid grid-cols-3 gap-1 bg-gray-200/60 dark:bg-gray-800 p-1 rounded-xl">
              <button
                type="button"
                @click="handleSelectSensitivity('strict')"
                :disabled="mode === 'off'"
                class="px-2 py-1.5 rounded-lg text-[11px] font-bold transition-all cursor-pointer disabled:opacity-40 whitespace-nowrap"
                :class="
                  sensitivity === 'strict'
                    ? 'bg-white dark:bg-gray-700 text-rose-600 dark:text-rose-400 shadow-xs'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                "
              >
                {{ t("listen.hots.spamSensitivityStrict") || "Strict" }}
              </button>
              <button
                type="button"
                @click="handleSelectSensitivity('balanced')"
                :disabled="mode === 'off'"
                class="px-2 py-1.5 rounded-lg text-[11px] font-bold transition-all cursor-pointer disabled:opacity-40 whitespace-nowrap"
                :class="
                  sensitivity === 'balanced'
                    ? 'bg-white dark:bg-gray-700 text-teal-600 dark:text-teal-400 shadow-xs'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                "
              >
                {{ t("listen.hots.spamSensitivityBalanced") || "Balanced" }}
              </button>
              <button
                type="button"
                @click="handleSelectSensitivity('conservative')"
                :disabled="mode === 'off'"
                class="px-2 py-1.5 rounded-lg text-[11px] font-bold transition-all cursor-pointer disabled:opacity-40 whitespace-nowrap"
                :class="
                  sensitivity === 'conservative'
                    ? 'bg-white dark:bg-gray-700 text-amber-600 dark:text-amber-400 shadow-xs'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                "
              >
                {{ t("listen.hots.spamSensitivityConservative") || "Conservative" }}
              </button>
            </div>
          </div>

          <!-- IndexedDB Verdict Cache & On-Demand SystemOne -->
          <div class="p-3.5 rounded-2xl bg-gray-50 dark:bg-gray-900/60 border border-gray-200/70 dark:border-gray-700/70 flex flex-col justify-between gap-2.5">
            <div class="flex items-center justify-between gap-2 text-[11px]">
              <span class="font-bold text-gray-700 dark:text-gray-200">
                {{ t("listen.hots.spamCacheLabel") || "Verdict Cache" }}
              </span>
              <div class="flex items-center gap-2 font-mono tabular-nums text-gray-600 dark:text-gray-300">
                <span>{{ cacheStats.totalRecords.toLocaleString() }} {{ t("listen.hots.spamCachedUnit") || "cached" }}</span>
                <span class="text-gray-300 dark:text-gray-600">·</span>
                <span>{{ cacheStats.systemOneRecords.toLocaleString() }} SystemOne</span>
                <template v-if="cacheStats.overrideRecords > 0">
                  <span class="text-gray-300 dark:text-gray-600">·</span>
                  <span>{{ cacheStats.overrideRecords }} {{ t("listen.hots.spamOverridesUnit") || "overrides" }}</span>
                </template>
              </div>
            </div>

            <div class="flex items-center gap-2 flex-wrap">
              <button
                v-if="!isVerifyingSystemOne"
                type="button"
                @click="handleVerifyWithSystemOne"
                :disabled="mode === 'off' || substantivePosts.length === 0 || isComputing"
                class="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white transition-colors cursor-pointer disabled:opacity-40 whitespace-nowrap"
              >
                <Cloud class="h-3.5 w-3.5 shrink-0" />
                <span>{{ t("listen.hots.spamVerifyBtn") || "Verify with SystemOne" }}</span>
              </button>

              <button
                v-else
                type="button"
                @click="handleCancelVerify"
                class="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-amber-100 hover:bg-amber-200 dark:bg-amber-950/70 dark:hover:bg-amber-900/70 text-amber-800 dark:text-amber-200 border border-amber-300/70 dark:border-amber-700/70 transition-colors cursor-pointer whitespace-nowrap"
              >
                <Loader2 class="h-3.5 w-3.5 animate-spin shrink-0" />
                <span class="font-mono tabular-nums">
                  {{ verifyProgress.done }}/{{ verifyProgress.total }} · {{ t("common.cancel") || "Cancel" }}
                </span>
              </button>

              <button
                type="button"
                @click="handleClearCache"
                :disabled="isClearingCache || cacheStats.totalRecords === 0"
                class="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-bold bg-white hover:bg-gray-100 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 transition-colors cursor-pointer disabled:opacity-40 whitespace-nowrap"
                :title="t('listen.hots.spamClearCacheTooltip') || 'Clear cached verdicts (keeps your manual Not Spam overrides)'"
              >
                <Trash2 class="h-3.5 w-3.5 shrink-0" />
                <span>{{ t("listen.hots.spamClearCacheBtn") || "Clear Cache" }}</span>
              </button>
            </div>
          </div>
        </div>

        <!-- Inline Action Feedback Banner -->
        <div
          v-if="feedbackMessage"
          class="flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-semibold border"
          :class="
            feedbackTone === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border-emerald-200/80 dark:border-emerald-800/70'
              : feedbackTone === 'error'
                ? 'bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 border-rose-200/80 dark:border-rose-800/70'
                : 'bg-sky-50 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300 border-sky-200/80 dark:border-sky-800/70'
          "
        >
          <CheckCircle2 v-if="feedbackTone === 'success'" class="h-4 w-4 shrink-0" />
          <AlertTriangle v-else class="h-4 w-4 shrink-0" />
          <span>{{ feedbackMessage }}</span>
        </div>

        <!-- Filtered Spam Posts Inspector -->
        <div class="space-y-3">
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              <h5 class="text-xs font-extrabold uppercase tracking-wider text-gray-600 dark:text-gray-300">
                {{ t("listen.hots.spamFilteredListTitle") || "Filtered Spam Posts" }}
              </h5>
              <span class="px-2 py-0.5 rounded-lg text-[11px] font-mono font-bold tabular-nums bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-200/70 dark:border-rose-800/60">
                {{ filteredSpamPosts.length.toLocaleString() }}
              </span>
            </div>

            <div v-if="filteredSpamPosts.length > 4" class="relative w-full sm:w-64">
              <Search class="h-3.5 w-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                v-model="searchQuery"
                type="text"
                :placeholder="t('listen.hots.spamSearchPlaceholder') || 'Filter by channel, text, or reason...'"
                class="w-full pl-8 pr-3 py-1.5 rounded-xl text-xs bg-gray-50 dark:bg-gray-900/70 text-gray-800 dark:text-gray-100 border border-gray-200 dark:border-gray-700 focus:outline-none focus:ring-2 focus:ring-teal-500/40"
              />
            </div>
          </div>

          <!-- Empty State -->
          <div
            v-if="sortedFilteredPosts.length === 0"
            class="py-8 px-4 rounded-2xl border border-dashed border-gray-200 dark:border-gray-700 bg-gray-50/70 dark:bg-gray-900/40 text-center space-y-1.5"
          >
            <ShieldCheck class="h-6 w-6 mx-auto text-teal-600 dark:text-teal-400" />
            <p class="text-xs font-bold text-gray-700 dark:text-gray-200">
              {{
                mode === "off"
                  ? t("listen.hots.spamEmptyOff") || "Spam filtering is currently turned off."
                  : searchQuery.trim()
                    ? t("listen.hots.spamEmptySearch") || "No filtered spam posts match your search."
                    : t("listen.hots.spamEmptyClean") || "No spam posts detected in the current date range."
              }}
            </p>
            <p v-if="mode !== 'off' && !searchQuery.trim()" class="text-[11px] text-gray-500 dark:text-gray-400">
              {{
                t("listen.hots.spamEmptyHint") ||
                "You can also run Verify with SystemOne above to double-check borderline posts."
              }}
            </p>
          </div>

          <!-- Filtered Spam List -->
          <div v-else class="space-y-2">
            <div
              v-for="item in displayedFilteredPosts"
              :key="item.post.key"
              class="p-3.5 rounded-2xl bg-gray-50/80 dark:bg-gray-900/50 border border-gray-200/75 dark:border-gray-700/75 space-y-2"
            >
              <div class="flex items-start justify-between gap-3">
                <div class="flex items-center gap-2 flex-wrap min-w-0 text-xs">
                  <button
                    type="button"
                    @click="emit('select-channel', item.post.channelUsername)"
                    class="font-bold text-gray-900 dark:text-white hover:text-teal-600 dark:hover:text-teal-400 truncate max-w-[180px] cursor-pointer transition-colors"
                  >
                    {{ item.post.channelName || `@${item.post.channelUsername}` }}
                  </button>
                  <span class="text-[11px] font-mono tabular-nums text-gray-400 dark:text-gray-500">
                    {{ formatPostTime(item.post.timestamp) }}
                  </span>
                  <span
                    class="px-1.5 py-0.5 rounded-md text-[10px] font-mono font-bold tabular-nums bg-rose-100/90 dark:bg-rose-950/80 text-rose-700 dark:text-rose-300 border border-rose-200/80 dark:border-rose-800/70"
                  >
                    {{ Math.round((item.evaluation.spamScore || 0) * 100) }}%
                  </span>
                  <span
                    class="px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-200/80 dark:border-gray-700/80"
                  >
                    {{ formatSourceLabel(item.evaluation.source) }}
                  </span>
                </div>

                <button
                  type="button"
                  @click="handleRestorePost(item)"
                  :disabled="restoringKey === item.post.key"
                  class="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-[11px] font-bold bg-white hover:bg-teal-50 dark:bg-gray-800 dark:hover:bg-teal-950/60 text-teal-700 dark:text-teal-300 border border-teal-200/80 dark:border-teal-800/70 transition-colors cursor-pointer shrink-0 disabled:opacity-50 whitespace-nowrap"
                >
                  <Loader2 v-if="restoringKey === item.post.key" class="h-3 w-3 animate-spin" />
                  <RotateCcw v-else class="h-3 w-3" />
                  <span>{{ t("listen.hots.spamRestoreBtn") || "Not Spam" }}</span>
                </button>
              </div>

              <p class="text-xs text-gray-700 dark:text-gray-300 leading-relaxed line-clamp-3 break-words">
                {{ item.post.text }}
              </p>

              <div
                v-if="item.evaluation.reasons && item.evaluation.reasons.length > 0"
                class="flex items-center gap-1.5 flex-wrap"
              >
                <span
                  v-for="(reason, idx) in item.evaluation.reasons.slice(0, 4)"
                  :key="idx"
                  class="px-2 py-0.5 rounded-md text-[10px] font-medium bg-amber-50/90 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border border-amber-200/70 dark:border-amber-800/60"
                >
                  {{ reason }}
                </span>
              </div>
            </div>

            <div
              v-if="sortedFilteredPosts.length > displayedFilteredPosts.length"
              class="pt-1 text-center"
            >
              <button
                type="button"
                @click="showAllFiltered = true"
                class="px-3.5 py-1.5 rounded-xl text-xs font-bold bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 transition-colors cursor-pointer"
              >
                {{
                  t("listen.hots.spamShowAllBtn", { count: sortedFilteredPosts.length }) ||
                  `Show all ${sortedFilteredPosts.length} filtered posts`
                }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
