<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "../../i18n";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  ExternalLink,
  Hash,
  Image as ImageIcon,
  LayoutGrid,
  List,
  Loader2,
  Pause,
  Play,
  ScanSearch,
  Search,
  Trash2,
  Upload,
  User,
  Users,
  X,
} from "lucide-vue-next";
import MemoryQuickToggle from "../memory/MemoryQuickToggle.vue";
import { useVisualProfileSearch } from "../../composables/useVisualProfileSearch";
import type {
  VisualEntityType,
  VisualProfileMetadataSnapshot,
  VisualSearchScope,
  VisualSimilarityMatch,
} from "../../utils/visualEmbedStore";

const props = defineProps<{
  loadedProfilesCount?: number;
}>();

const emit = defineEmits<{
  (e: "open-explorer", payload: { handle: string; channel: any }): void;
  (e: "inspect-profile", handle: string): void;
  (e: "index-loaded-batch"): void;
}>();

const { t } = useI18n();
const visual = useVisualProfileSearch();

const rootRef = ref<HTMLElement | null>(null);
const fileInputRef = ref<HTMLInputElement | null>(null);
const importJsonInputRef = ref<HTMLInputElement | null>(null);

const queryInput = ref("");
const thresholdPercent = ref(55);
const topK = ref(20);
const scope = ref<VisualSearchScope>("all");
const viewMode = ref<"card" | "list">("card");
const isDraggingFile = ref(false);
const confirmClear = ref(false);
const failedImageKeys = ref<Record<string, boolean>>({});
const queryImageFailed = ref(false);
const transferNotice = ref<{ tone: "success" | "warning" | "error"; message: string } | null>(null);
let transferNoticeTimer: ReturnType<typeof setTimeout> | null = null;

const topKOptions = [10, 20, 50, 100];

const searchOptions = computed(() => ({
  threshold: thresholdPercent.value / 100,
  topK: topK.value,
  scope: scope.value,
}));

watch([thresholdPercent, topK, scope], () => {
  if (visual.hasSearched.value && !visual.isSearching.value) {
    void visual.rerankLastQuery(searchOptions.value);
  }
});

watch(
  () => visual.activeQuery.value?.previewUrl,
  () => {
    queryImageFailed.value = false;
  }
);

function formatMb(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 MB";
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatCompactCount(val: number | undefined): string {
  if (val == null || !Number.isFinite(val)) return "";
  return val.toLocaleString();
}

function formatScorePercent(score: number): string {
  return `${(Math.max(0, Math.min(1, score)) * 100).toFixed(1)}%`;
}

function scoreBarWidth(score: number): string {
  const pct = Math.max(4, Math.min(100, Math.round(score * 100)));
  return `${pct}%`;
}

function scoreTextClass(score: number): string {
  if (score >= 0.8) return "text-emerald-700 dark:text-emerald-400";
  if (score >= 0.65) return "text-teal-700 dark:text-teal-400";
  return "text-gray-700 dark:text-gray-300";
}

function scoreBarClass(score: number): string {
  if (score >= 0.8) return "bg-emerald-600 dark:bg-emerald-400";
  if (score >= 0.65) return "bg-teal-600 dark:bg-teal-400";
  return "bg-slate-400 dark:bg-slate-500";
}

function getDisplayTitle(meta: VisualProfileMetadataSnapshot): string {
  const fullName = `${meta.first_name || ""} ${meta.last_name || ""}`.trim();
  return meta.title || fullName || meta.name || meta.username || meta.entityKey;
}

function getDisplayInitial(label: string): string {
  const clean = (label || "").replace(/^@/, "").trim();
  return clean ? clean.charAt(0).toUpperCase() : "?";
}

function getStatusText(meta: VisualProfileMetadataSnapshot): string {
  if (!meta.status) return "";
  if (typeof meta.status === "string") return meta.status;
  return meta.status.status || "";
}

function tryToggleNumericProfileUrl(img: HTMLImageElement): boolean {
  if (!img?.src || !img.src.includes("/telegram-profile/") || img.dataset.retried) {
    return false;
  }
  img.dataset.retried = "true";
  const parts = img.src.split("/telegram-profile/");
  if (parts.length < 2) return false;
  const rawIdent = decodeURIComponent(parts[1].split(/[?#]/)[0] || "").trim();
  if (!/^-?\d+$/.test(rawIdent)) return false;
  const toggled = rawIdent.startsWith("-100") ? rawIdent.slice(4) : `-100${rawIdent}`;
  img.src = `${parts[0]}/telegram-profile/${encodeURIComponent(toggled)}`;
  return true;
}

function handleQueryImageError(ev: Event) {
  const target = ev.target as HTMLImageElement | null;
  if (target && tryToggleNumericProfileUrl(target)) return;
  queryImageFailed.value = true;
}

function handleMatchImageError(ev: Event, key: string) {
  const target = ev.target as HTMLImageElement | null;
  if (target && tryToggleNumericProfileUrl(target)) return;
  failedImageKeys.value = { ...failedImageKeys.value, [key]: true };
}

async function handleNameSearch() {
  const trimmed = queryInput.value.trim();
  if (!trimmed) return;
  await visual.searchByName(trimmed, searchOptions.value);
}

function triggerFileDialog() {
  fileInputRef.value?.click();
}

async function handleFileSelected(ev: Event) {
  const input = ev.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  await visual.searchByUploadedFile(file, searchOptions.value);
}

async function handleDrop(ev: DragEvent) {
  isDraggingFile.value = false;
  const file = ev.dataTransfer?.files?.[0];
  if (!file || !file.type.startsWith("image/")) return;
  await visual.searchByUploadedFile(file, searchOptions.value);
}

async function handlePaste(ev: ClipboardEvent) {
  const items = ev.clipboardData?.items;
  if (!items) return;
  for (const item of Array.from(items)) {
    if (item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) {
        ev.preventDefault();
        await visual.searchByUploadedFile(file, searchOptions.value);
        return;
      }
    }
  }
}

async function handleFindSimilarFromMatch(match: VisualSimilarityMatch) {
  queryInput.value = match.metadata.username || match.entityKey;
  await visual.searchByProfile(match.metadata, match.entityType, searchOptions.value);
}

async function triggerFindSimilarForProfile(rawProfile: any, entityType: VisualEntityType) {
  const handle =
    rawProfile?.username || rawProfile?.name || rawProfile?.key || rawProfile?.id || "";
  if (handle) {
    queryInput.value = String(handle).replace(/^@/, "");
  }
  rootRef.value?.scrollIntoView({ behavior: "smooth", block: "start" });
  await visual.searchByProfile(rawProfile, entityType, searchOptions.value);
}

function handleOpenExplorer(match: VisualSimilarityMatch) {
  const handle = match.metadata.username || match.metadata.name || match.metadata.key || match.entityKey;
  if (!handle) return;
  emit("open-explorer", { handle, channel: match.metadata });
}

function handleInspectProfile(match: VisualSimilarityMatch) {
  const handle = match.metadata.username || match.metadata.name || match.entityKey;
  if (!handle) return;
  emit("inspect-profile", handle);
}

function handleLowerThreshold() {
  thresholdPercent.value = Math.max(35, Math.min(thresholdPercent.value - 15, 40));
}

function showTransferNotice(tone: "success" | "warning" | "error", message: string) {
  transferNotice.value = { tone, message };
  if (transferNoticeTimer) clearTimeout(transferNoticeTimer);
  transferNoticeTimer = setTimeout(() => {
    transferNotice.value = null;
    transferNoticeTimer = null;
  }, 6000);
}

async function handleExportEmbeddings() {
  if (visual.isExporting.value || visual.indexedTotal.value === 0) return;
  try {
    const bundle = await visual.exportIndexedEmbeddings();
    const blob = new Blob([JSON.stringify(bundle)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `gingko-visual-embeddings-${stamp}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showTransferNotice("success", t("channels.visualExportSuccess", { count: bundle.count }));
  } catch (err) {
    console.error("[VisualEmbeddings] Export failed:", err);
    showTransferNotice("error", t("channels.visualExportError"));
  }
}

function triggerImportEmbeddingsDialog() {
  if (visual.isImporting.value) return;
  importJsonInputRef.value?.click();
}

async function handleImportEmbeddingsSelected(ev: Event) {
  const input = ev.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const summary = await visual.importIndexedEmbeddings(parsed);
    const ignored = summary.skipped + summary.incompatible;
    if (summary.totalImported === 0 && ignored > 0) {
      showTransferNotice(
        "warning",
        t("channels.visualImportEmpty", { skipped: ignored })
      );
    } else if (ignored > 0) {
      showTransferNotice(
        "warning",
        t("channels.visualImportPartial", {
          added: summary.added,
          updated: summary.updated,
          skipped: ignored,
        })
      );
    } else {
      showTransferNotice(
        "success",
        t("channels.visualImportSuccess", {
          added: summary.added,
          updated: summary.updated,
        })
      );
    }
  } catch (err) {
    console.error("[VisualEmbeddings] Import failed:", err);
    showTransferNotice("error", t("channels.visualImportError"));
  }
}

async function handleClearIndex() {
  if (!confirmClear.value) {
    confirmClear.value = true;
    setTimeout(() => {
      confirmClear.value = false;
    }, 4000);
    return;
  }
  confirmClear.value = false;
  await visual.clearIndexedVectors(false);
}

const formattedQueryError = computed(() => {
  const raw = visual.queryError.value;
  if (!raw) return "";
  if (raw === "NO_VALID_PROFILE_PHOTO") {
    return t("channels.visualNoPhotoError");
  }
  return raw;
});

const modelStatusMessage = computed(() => {
  const stage = visual.modelStage.value;
  if (stage === "downloading") {
    return t("channels.visualDownloadingModel", {
      loaded: formatMb(visual.modelLoadedBytes.value),
      total: formatMb(visual.modelTotalBytes.value),
      percent: visual.modelPercent.value,
    });
  }
  if (stage === "retrying") {
    return t("channels.visualRetryingModel", {
      attempt: visual.retryAttempt.value,
      max: visual.maxRetries.value,
    });
  }
  if (stage === "loading_cache") {
    return t("channels.visualLoadingCachedModel");
  }
  if (stage === "initializing") {
    return t("channels.visualInitializingModel");
  }
  if (stage === "checking") {
    return t("channels.visualCheckingModel");
  }
  return "";
});

const showActivityStrip = computed(
  () => visual.isModelBusy.value || visual.isIndexing.value || (visual.isPaused.value && visual.pendingCount.value > 0)
);

const indexingProgressPercent = computed(() => {
  if (visual.isModelBusy.value) {
    return visual.modelStage.value === "downloading" ? visual.modelPercent.value : 100;
  }
  const total = visual.processedCount.value + visual.pendingCount.value;
  if (total <= 0) return 0;
  return Math.min(100, Math.round((visual.processedCount.value / total) * 100));
});

defineExpose({
  triggerFindSimilarForProfile,
});
</script>

<template>
  <section
    ref="rootRef"
    @dragover.prevent="isDraggingFile = true"
    @dragleave.self="isDraggingFile = false"
    @drop.prevent="handleDrop"
    @paste="handlePaste"
    :class="[
      'bg-white dark:bg-gray-800 border rounded-3xl p-6 shadow-sm transition-colors duration-200 space-y-5',
      isDraggingFile
        ? 'border-teal-500 ring-2 ring-teal-500/20 bg-teal-50/30 dark:bg-teal-950/20'
        : 'border-gray-200/80 dark:border-gray-700',
    ]"
  >
    <!-- Header Row -->
    <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
      <div class="space-y-1 min-w-0">
        <h3 class="text-sm font-semibold text-gray-900 dark:text-white tracking-tight">
          {{ t("channels.visualSearchTitle") }}
        </h3>
        <p class="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
          {{ t("channels.visualSearchSubtitle") }}
        </p>
      </div>

      <!-- Functional Indexer Stats & Pause/Resume Controls -->
      <div class="flex flex-wrap items-center gap-3 shrink-0">
        <div class="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 tabular-nums">
          <span class="font-semibold text-gray-900 dark:text-gray-100">
            {{ visual.indexedTotal.value.toLocaleString() }} {{ t("channels.visualIndexedLabel") }}
          </span>
          <span aria-hidden="true" class="text-gray-300 dark:text-gray-600">·</span>
          <span>{{ visual.indexedChannels.value.toLocaleString() }} {{ t("channels.channels") }}</span>
          <span aria-hidden="true" class="text-gray-300 dark:text-gray-600">·</span>
          <span>{{ visual.indexedUsers.value.toLocaleString() }} {{ t("channels.users") }}</span>
        </div>

        <input
          ref="importJsonInputRef"
          type="file"
          accept=".json,application/json"
          class="hidden"
          @change="handleImportEmbeddingsSelected"
        />

        <button
          type="button"
          @click="triggerImportEmbeddingsDialog"
          :disabled="visual.isImporting.value"
          class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border bg-gray-50 hover:bg-gray-100 dark:bg-gray-900 dark:hover:bg-gray-700/70 text-gray-700 dark:text-gray-200 border-gray-200 dark:border-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer whitespace-nowrap shrink-0"
          :title="t('channels.visualImportIndexTooltip')"
        >
          <Loader2 v-if="visual.isImporting.value" class="w-3.5 h-3.5 animate-spin shrink-0" />
          <Upload v-else class="w-3.5 h-3.5 shrink-0" />
          <span>{{ t("channels.visualImportIndex") }}</span>
        </button>

        <button
          type="button"
          @click="handleExportEmbeddings"
          :disabled="visual.isExporting.value || visual.indexedTotal.value === 0"
          class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border bg-gray-50 hover:bg-gray-100 dark:bg-gray-900 dark:hover:bg-gray-700/70 text-gray-700 dark:text-gray-200 border-gray-200 dark:border-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer whitespace-nowrap shrink-0"
          :title="t('channels.visualExportIndexTooltip')"
        >
          <Loader2 v-if="visual.isExporting.value" class="w-3.5 h-3.5 animate-spin shrink-0" />
          <Download v-else class="w-3.5 h-3.5 shrink-0" />
          <span>{{ t("channels.visualExportIndex") }}</span>
        </button>

        <button
          type="button"
          @click="visual.togglePauseIndexing()"
          :class="[
            'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors cursor-pointer whitespace-nowrap shrink-0',
            visual.isPaused.value
              ? 'bg-teal-600 hover:bg-teal-700 text-white border-transparent'
              : 'bg-gray-50 hover:bg-gray-100 dark:bg-gray-900 dark:hover:bg-gray-700/70 text-gray-700 dark:text-gray-200 border-gray-200 dark:border-gray-700',
          ]"
        >
          <Play v-if="visual.isPaused.value" class="w-3.5 h-3.5 shrink-0" />
          <Pause v-else class="w-3.5 h-3.5 shrink-0" />
          <span>{{
            visual.isPaused.value ? t("channels.visualResumeIndexing") : t("channels.visualPauseIndexing")
          }}</span>
        </button>

        <button
          v-if="visual.indexedTotal.value > 0"
          type="button"
          @click="handleClearIndex"
          :class="[
            'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors cursor-pointer whitespace-nowrap shrink-0',
            confirmClear
              ? 'bg-rose-600 hover:bg-rose-700 text-white border-transparent'
              : 'bg-transparent hover:bg-gray-100 dark:hover:bg-gray-700/60 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-700',
          ]"
          :title="t('channels.visualClearIndex')"
        >
          <Trash2 class="w-3.5 h-3.5 shrink-0" />
          <span>{{ confirmClear ? t("channels.visualConfirmClear") : t("channels.visualClearIndex") }}</span>
        </button>
      </div>
    </div>

    <!-- Export / Import Transfer Notice -->
    <div
      v-if="transferNotice"
      :class="[
        'flex items-center gap-2.5 px-4 py-2.5 rounded-2xl border text-xs',
        transferNotice.tone === 'success'
          ? 'bg-emerald-50/80 dark:bg-emerald-950/30 border-emerald-200/80 dark:border-emerald-900/60 text-emerald-800 dark:text-emerald-300'
          : transferNotice.tone === 'warning'
            ? 'bg-amber-50/80 dark:bg-amber-950/30 border-amber-200/80 dark:border-amber-900/60 text-amber-800 dark:text-amber-300'
            : 'bg-rose-50/80 dark:bg-rose-950/30 border-rose-200/80 dark:border-rose-900/60 text-rose-700 dark:text-rose-300',
      ]"
    >
      <CheckCircle2 v-if="transferNotice.tone === 'success'" class="w-4 h-4 shrink-0" />
      <AlertCircle v-else class="w-4 h-4 shrink-0" />
      <span class="flex-1">{{ transferNotice.message }}</span>
      <button
        type="button"
        @click="transferNotice = null"
        class="p-0.5 hover:opacity-80 cursor-pointer"
        :aria-label="t('common.close')"
      >
        <X class="w-3.5 h-3.5" />
      </button>
    </div>

    <!-- Real Activity Strip (only visible during model download or active/paused background queue) -->
    <div
      v-if="showActivityStrip"
      class="pt-3 border-t border-gray-100 dark:border-gray-700/70 space-y-2"
    >
      <div class="flex items-center justify-between gap-3 text-xs text-gray-600 dark:text-gray-300 tabular-nums">
        <span class="truncate">
          <template v-if="visual.isModelBusy.value">
            {{ modelStatusMessage }}
          </template>
          <template v-else-if="visual.isPaused.value">
            {{ t("channels.visualIndexingPaused", { pending: visual.pendingCount.value }) }}
          </template>
          <template v-else>
            {{
              t("channels.visualIndexingActive", {
                processed: visual.processedCount.value,
                pending: visual.pendingCount.value,
              })
            }}
          </template>
        </span>
        <span class="font-mono font-medium text-teal-700 dark:text-teal-400 shrink-0">
          {{ indexingProgressPercent }}%
        </span>
      </div>
      <div class="w-full h-1.5 bg-gray-100 dark:bg-gray-900 rounded-full overflow-hidden">
        <div
          class="h-full bg-teal-600 dark:bg-teal-500 transition-all duration-200"
          :style="{ width: `${indexingProgressPercent}%` }"
        ></div>
      </div>
    </div>

    <!-- Worker Error Notice (if any) -->
    <div
      v-if="visual.workerError.value"
      class="flex items-start gap-2.5 px-4 py-3 rounded-2xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200/80 dark:border-rose-900/60 text-xs text-rose-700 dark:text-rose-300"
    >
      <AlertCircle class="w-4 h-4 shrink-0 mt-0.5" />
      <span class="flex-1">{{ visual.workerError.value }}</span>
      <button
        type="button"
        @click="visual.workerError.value = null"
        class="p-0.5 hover:opacity-80 cursor-pointer"
        :aria-label="t('common.close')"
      >
        <X class="w-3.5 h-3.5" />
      </button>
    </div>

    <!-- Query Bar: Name Lookup + Upload Photo -->
    <div class="flex flex-col md:flex-row items-stretch md:items-center gap-2.5">
      <div class="relative flex items-center bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl px-4 py-2.5 focus-within:ring-2 focus-within:ring-teal-500/20 focus-within:border-teal-500 transition-colors flex-1 min-w-0">
        <ScanSearch class="w-4 h-4 text-teal-600 dark:text-teal-400 mr-2.5 shrink-0" />
        <input
          v-model="queryInput"
          type="text"
          @keyup.enter="handleNameSearch"
          :placeholder="t('channels.visualSearchPlaceholder')"
          class="bg-transparent text-xs font-medium outline-none text-gray-900 dark:text-white placeholder-gray-400 w-full pr-2"
        />
        <button
          v-if="queryInput"
          type="button"
          @click="queryInput = ''"
          class="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-lg transition-colors cursor-pointer shrink-0"
          :title="t('channels.clearSearch')"
        >
          <X class="w-3.5 h-3.5" />
        </button>
      </div>

      <div class="flex items-center gap-2 shrink-0">
        <button
          type="button"
          @click="handleNameSearch"
          :disabled="visual.isSearching.value || !queryInput.trim()"
          class="flex-1 md:flex-none px-4 py-2.5 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-2xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
        >
          <Loader2 v-if="visual.isSearching.value" class="w-3.5 h-3.5 animate-spin shrink-0" />
          <Search v-else class="w-3.5 h-3.5 shrink-0" />
          <span>{{ t("channels.visualFindSimilarBtn") }}</span>
        </button>

        <input
          ref="fileInputRef"
          type="file"
          accept="image/*"
          class="hidden"
          @change="handleFileSelected"
        />
        <button
          type="button"
          @click="triggerFileDialog"
          :disabled="visual.isSearching.value"
          class="px-3.5 py-2.5 bg-gray-50 hover:bg-gray-100 dark:bg-gray-900 dark:hover:bg-gray-700/70 disabled:opacity-50 text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-700 rounded-2xl text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          :title="t('channels.visualUploadHint')"
        >
          <Upload class="w-3.5 h-3.5 text-teal-600 dark:text-teal-400 shrink-0" />
          <span>{{ t("channels.visualUploadPhoto") }}</span>
        </button>
      </div>
    </div>

    <!-- Filter & View Controls Bar -->
    <div class="flex flex-wrap items-center justify-between gap-4 border-t border-gray-100 dark:border-gray-700/70 pt-4">
      <div class="flex flex-wrap items-center gap-4">
        <!-- Scope Segmented Control -->
        <div class="inline-flex items-center gap-1 bg-gray-100/90 dark:bg-gray-900 p-1 rounded-xl border border-gray-200/70 dark:border-gray-700">
          <button
            type="button"
            @click="scope = 'all'"
            :class="[
              'px-3 py-1 text-xs font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0',
              scope === 'all'
                ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-xs'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200',
            ]"
          >
            {{ t("channels.visualScopeAll") }}
          </button>
          <button
            type="button"
            @click="scope = 'channel'"
            :class="[
              'px-3 py-1 text-xs font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0',
              scope === 'channel'
                ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-xs'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200',
            ]"
          >
            {{ t("channels.channels") }}
          </button>
          <button
            type="button"
            @click="scope = 'user'"
            :class="[
              'px-3 py-1 text-xs font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0',
              scope === 'user'
                ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-xs'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200',
            ]"
          >
            {{ t("channels.users") }}
          </button>
        </div>

        <!-- Similarity Threshold Slider -->
        <label class="flex items-center gap-2.5 text-xs text-gray-600 dark:text-gray-300 select-none">
          <span class="whitespace-nowrap shrink-0">{{ t("channels.visualThreshold") }}</span>
          <input
            v-model.number="thresholdPercent"
            type="range"
            min="35"
            max="95"
            step="1"
            class="w-28 sm:w-32 accent-teal-600 cursor-pointer"
          />
          <span class="font-mono font-semibold text-gray-900 dark:text-white tabular-nums w-10 text-right shrink-0">
            {{ thresholdPercent }}%
          </span>
        </label>

        <!-- Top-K Selector -->
        <label class="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
          <span class="whitespace-nowrap shrink-0">{{ t("channels.visualTopK") }}</span>
          <select
            v-model.number="topK"
            class="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl px-2.5 py-1 text-xs font-mono font-semibold text-gray-900 dark:text-white outline-none focus:border-teal-500 cursor-pointer tabular-nums"
          >
            <option v-for="k in topKOptions" :key="k" :value="k">{{ k }}</option>
          </select>
        </label>
      </div>

      <!-- Card / List View Switcher -->
      <div class="inline-flex items-center gap-1 bg-gray-100/90 dark:bg-gray-900 p-1 rounded-xl border border-gray-200/70 dark:border-gray-700 shrink-0">
        <button
          type="button"
          @click="viewMode = 'card'"
          :class="[
            'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0',
            viewMode === 'card'
              ? 'bg-white dark:bg-gray-800 text-teal-700 dark:text-teal-400 shadow-xs'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200',
          ]"
          :title="t('channels.visualCardView')"
        >
          <LayoutGrid class="w-3.5 h-3.5 shrink-0" />
          <span>{{ t("channels.visualCardView") }}</span>
        </button>
        <button
          type="button"
          @click="viewMode = 'list'"
          :class="[
            'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0',
            viewMode === 'list'
              ? 'bg-white dark:bg-gray-800 text-teal-700 dark:text-teal-400 shadow-xs'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200',
          ]"
          :title="t('channels.listView')"
        >
          <List class="w-3.5 h-3.5 shrink-0" />
          <span>{{ t("channels.list") }}</span>
        </button>
      </div>
    </div>

    <!-- Active Query Subject Preview Bar -->
    <div
      v-if="visual.activeQuery.value"
      class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-4 border-t border-gray-100 dark:border-gray-700/70"
    >
      <div class="flex items-center gap-3.5 min-w-0">
        <div class="w-12 h-12 rounded-2xl overflow-hidden border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-900 shrink-0 flex items-center justify-center">
          <img
            v-if="visual.activeQuery.value.previewUrl && !queryImageFailed"
            :src="visual.activeQuery.value.previewUrl"
            :alt="visual.activeQuery.value.label"
            referrerPolicy="no-referrer"
            @error="handleQueryImageError($event)"
            class="w-full h-full object-cover"
          />
          <ImageIcon v-else class="w-5 h-5 text-gray-400" />
        </div>
        <div class="min-w-0">
          <div class="text-xs font-semibold text-gray-900 dark:text-white truncate">
            {{ visual.activeQuery.value.label }}
          </div>
          <div class="flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400 tabular-nums mt-0.5">
            <span v-if="visual.activeQuery.value.sublabel" class="truncate">
              {{ visual.activeQuery.value.sublabel }}
            </span>
            <template v-if="visual.hasSearched.value && !visual.isSearching.value && !formattedQueryError">
              <span aria-hidden="true" class="text-gray-300 dark:text-gray-600">·</span>
              <span>
                {{
                  t("channels.visualMatchesSummary", {
                    matches: visual.results.value.length,
                    scanned: visual.scannedCount.value,
                  })
                }}
              </span>
            </template>
          </div>
        </div>
      </div>

      <button
        type="button"
        @click="visual.clearQuery()"
        class="self-start sm:self-center inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-medium text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700/60 transition-colors cursor-pointer whitespace-nowrap shrink-0"
      >
        <X class="w-3.5 h-3.5 shrink-0" />
        <span>{{ t("channels.visualClearQuery") }}</span>
      </button>
    </div>

    <!-- Loading Skeleton State -->
    <div v-if="visual.isSearching.value" class="space-y-3 pt-2">
      <div class="flex items-center gap-2 text-xs text-teal-700 dark:text-teal-400 font-medium">
        <Loader2 class="w-4 h-4 animate-spin shrink-0" />
        <span>{{
          visual.isModelBusy.value && modelStatusMessage
            ? modelStatusMessage
            : t("channels.visualComputingQuery")
        }}</span>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div
          v-for="n in 4"
          :key="n"
          class="p-4 rounded-2xl border border-gray-200/70 dark:border-gray-700/70 space-y-3 animate-pulse"
        >
          <div class="flex items-center gap-3">
            <div class="w-11 h-11 rounded-xl bg-gray-200 dark:bg-gray-700 shrink-0"></div>
            <div class="flex-1 space-y-1.5">
              <div class="h-3 bg-gray-200 dark:bg-gray-700 rounded w-3/4"></div>
              <div class="h-2.5 bg-gray-100 dark:bg-gray-700/60 rounded w-1/2"></div>
            </div>
          </div>
          <div class="h-2.5 bg-gray-100 dark:bg-gray-700/60 rounded w-full"></div>
          <div class="h-2.5 bg-gray-100 dark:bg-gray-700/60 rounded w-2/3"></div>
        </div>
      </div>
    </div>

    <!-- Query Error State -->
    <div
      v-else-if="formattedQueryError"
      class="flex items-start gap-3 p-4 rounded-2xl bg-rose-50/70 dark:bg-rose-950/25 border border-rose-200/70 dark:border-rose-900/50 text-xs text-rose-700 dark:text-rose-300"
    >
      <AlertCircle class="w-4 h-4 shrink-0 mt-0.5" />
      <div class="space-y-1">
        <p class="font-semibold">{{ t("channels.visualSearchErrorTitle") }}</p>
        <p class="text-rose-600/90 dark:text-rose-300/90 leading-relaxed">{{ formattedQueryError }}</p>
      </div>
    </div>

    <!-- Empty Local Index Prompt (when 0 vectors indexed and not currently searching) -->
    <div
      v-else-if="visual.indexedTotal.value === 0 && !visual.isIndexing.value && !visual.isModelBusy.value"
      class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 py-4 px-4 rounded-2xl bg-gray-50/80 dark:bg-gray-900/50 border border-gray-200/70 dark:border-gray-700/70"
    >
      <div class="space-y-0.5">
        <p class="text-xs font-semibold text-gray-800 dark:text-gray-200">
          {{ t("channels.visualEmptyIndexTitle") }}
        </p>
        <p class="text-xs text-gray-500 dark:text-gray-400">
          {{ t("channels.visualEmptyIndexSubtitle") }}
        </p>
      </div>
      <button
        v-if="(props.loadedProfilesCount || 0) > 0"
        type="button"
        @click="emit('index-loaded-batch')"
        class="self-start sm:self-center px-3.5 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0"
      >
        {{ t("channels.visualIndexCurrentBatch", { count: props.loadedProfilesCount }) }}
      </button>
    </div>

    <!-- No Matches State -->
    <div
      v-else-if="visual.hasSearched.value && visual.results.value.length === 0"
      class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 py-5 px-4 rounded-2xl bg-gray-50/80 dark:bg-gray-900/50 border border-gray-200/70 dark:border-gray-700/70"
    >
      <div class="space-y-0.5">
        <p class="text-xs font-semibold text-gray-800 dark:text-gray-200">
          {{ t("channels.visualNoMatchesTitle") }}
        </p>
        <p class="text-xs text-gray-500 dark:text-gray-400">
          {{ t("channels.visualNoMatchesSubtitle", { threshold: thresholdPercent }) }}
        </p>
      </div>
      <button
        v-if="thresholdPercent > 40"
        type="button"
        @click="handleLowerThreshold"
        class="self-start sm:self-center px-3.5 py-2 bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-800 dark:text-gray-200 border border-gray-200 dark:border-gray-700 rounded-xl text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0"
      >
        {{ t("channels.visualLowerThreshold") }}
      </button>
    </div>

    <!-- Populated Results: Card View -->
    <div
      v-else-if="visual.results.value.length > 0 && viewMode === 'card'"
      class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 pt-1"
    >
      <article
        v-for="match in visual.results.value"
        :key="match.recordId"
        class="group relative flex flex-col justify-between p-4 rounded-2xl border border-gray-200/80 dark:border-gray-700/80 bg-gray-50/40 dark:bg-gray-900/35 hover:border-teal-500/40 transition-colors"
      >
        <MemoryQuickToggle
          v-if="match.entityType === 'channel'"
          item-type="channel"
          :channel="match.metadata"
          source-tab="explorer"
          offset-class="top-3 right-3"
        />

        <div class="space-y-3">
          <!-- Identity Header -->
          <div class="flex items-start gap-3 pr-7">
            <div class="relative shrink-0 w-12 h-12 rounded-2xl overflow-hidden border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-900 flex items-center justify-center">
              <img
                v-if="match.photoUrl && !failedImageKeys[match.recordId]"
                :src="match.photoUrl"
                :alt="getDisplayTitle(match.metadata)"
                referrerPolicy="no-referrer"
                @error="handleMatchImageError($event, match.recordId)"
                class="w-full h-full object-cover"
              />
              <span
                v-else
                class="text-sm font-semibold text-gray-500 dark:text-gray-400 select-none"
              >
                {{ getDisplayInitial(getDisplayTitle(match.metadata)) }}
              </span>
            </div>

            <div class="min-w-0 flex-1">
              <h4
                class="text-xs font-semibold text-gray-900 dark:text-white truncate"
                :title="getDisplayTitle(match.metadata)"
              >
                {{ getDisplayTitle(match.metadata) }}
              </h4>
              <div class="flex flex-wrap items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                <span v-if="match.metadata.username" class="truncate max-w-[140px]">
                  @{{ match.metadata.username }}
                </span>
                <span v-if="match.metadata.username" aria-hidden="true" class="text-gray-300 dark:text-gray-600">·</span>
                <span>{{
                  match.entityType === "channel"
                    ? t("channels.visualTypeChannel")
                    : match.metadata.bot
                      ? t("channels.bot")
                      : t("channels.user")
                }}</span>
              </div>
              <div
                v-if="match.metadata.id"
                class="text-[11px] font-mono text-gray-400 dark:text-gray-500 tabular-nums mt-0.5 truncate"
              >
                ID {{ match.metadata.id }}
              </div>
            </div>
          </div>

          <!-- Cosine Similarity Score Row (Tabular Numerals + Bar) -->
          <div class="space-y-1">
            <div class="flex items-center justify-between text-[11px] tabular-nums">
              <span class="text-gray-500 dark:text-gray-400">{{ t("channels.visualSimilarityScore") }}</span>
              <span :class="['font-mono font-semibold', scoreTextClass(match.score)]">
                {{ formatScorePercent(match.score) }}
              </span>
            </div>
            <div class="w-full h-1 bg-gray-200/80 dark:bg-gray-700/80 rounded-full overflow-hidden">
              <div
                :class="['h-full rounded-full', scoreBarClass(match.score)]"
                :style="{ width: scoreBarWidth(match.score) }"
              ></div>
            </div>
          </div>

          <!-- Description -->
          <p
            v-if="match.metadata.description || match.metadata.about"
            class="text-xs text-gray-600 dark:text-gray-300 leading-relaxed line-clamp-2 break-words"
          >
            {{ match.metadata.description || match.metadata.about }}
          </p>

          <!-- Clean Unboxed Metadata Line -->
          <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-gray-500 dark:text-gray-400 tabular-nums">
            <span v-if="match.metadata.members || match.metadata.participants_count">
              {{ formatCompactCount(match.metadata.members || match.metadata.participants_count) }} {{ t("channels.members") }}
            </span>
            <span
              v-if="(match.metadata.members || match.metadata.participants_count) && match.metadata.photos"
              aria-hidden="true"
              class="text-gray-300 dark:text-gray-600"
            >·</span>
            <span v-if="match.metadata.photos">
              {{ formatCompactCount(match.metadata.photos) }} {{ t("channels.photos") }}
            </span>
            <span
              v-if="(match.metadata.members || match.metadata.participants_count || match.metadata.photos) && match.metadata.cdnNumber"
              aria-hidden="true"
              class="text-gray-300 dark:text-gray-600"
            >·</span>
            <span v-if="match.metadata.cdnNumber" class="font-mono">
              DC {{ match.metadata.cdnNumber }}
            </span>
            <span v-if="getStatusText(match.metadata)" class="truncate max-w-full">
              {{ getStatusText(match.metadata) }}
            </span>
          </div>
        </div>

        <!-- Card Actions -->
        <div class="flex items-center gap-2 mt-4 pt-3 border-t border-gray-200/70 dark:border-gray-700/60">
          <button
            v-if="match.entityType === 'channel'"
            type="button"
            @click="handleOpenExplorer(match)"
            class="flex-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium bg-white dark:bg-gray-800 hover:bg-teal-600 text-teal-700 dark:text-teal-400 hover:text-white border border-gray-200 dark:border-gray-700 hover:border-transparent transition-colors cursor-pointer whitespace-nowrap"
          >
            <span>{{ t("channels.archive") }}</span>
            <ExternalLink class="w-3 h-3 shrink-0" />
          </button>
          <button
            v-else
            type="button"
            @click="handleInspectProfile(match)"
            class="flex-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium bg-white dark:bg-gray-800 hover:bg-teal-600 text-teal-700 dark:text-teal-400 hover:text-white border border-gray-200 dark:border-gray-700 hover:border-transparent transition-colors cursor-pointer whitespace-nowrap"
          >
            <User class="w-3 h-3 shrink-0" />
            <span>{{ t("channels.visualInspect") }}</span>
          </button>

          <button
            type="button"
            @click="handleFindSimilarFromMatch(match)"
            class="inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-medium bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-700 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            :title="t('channels.visualFindSimilarAction')"
          >
            <ScanSearch class="w-3.5 h-3.5 text-teal-600 dark:text-teal-400 shrink-0" />
            <span>{{ t("channels.visualSimilarShort") }}</span>
          </button>
        </div>
      </article>
    </div>

    <!-- Populated Results: List View -->
    <div
      v-else-if="visual.results.value.length > 0 && viewMode === 'list'"
      class="border border-gray-200/80 dark:border-gray-700/80 rounded-2xl divide-y divide-gray-100 dark:divide-gray-700/70 overflow-hidden"
    >
      <div
        v-for="match in visual.results.value"
        :key="match.recordId"
        class="group relative flex flex-col md:flex-row md:items-center justify-between gap-3 px-4 py-3 bg-white dark:bg-gray-800 hover:bg-gray-50/80 dark:hover:bg-gray-750/60 transition-colors"
      >
        <!-- Left: Avatar + Identity -->
        <div class="flex items-center gap-3 min-w-[210px] md:w-64 shrink-0">
          <div class="w-10 h-10 rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-900 shrink-0 flex items-center justify-center">
            <img
              v-if="match.photoUrl && !failedImageKeys[match.recordId]"
              :src="match.photoUrl"
              :alt="getDisplayTitle(match.metadata)"
              referrerPolicy="no-referrer"
              @error="handleMatchImageError($event, match.recordId)"
              class="w-full h-full object-cover"
            />
            <span v-else class="text-xs font-semibold text-gray-500 dark:text-gray-400">
              {{ getDisplayInitial(getDisplayTitle(match.metadata)) }}
            </span>
          </div>
          <div class="min-w-0 flex-1">
            <div class="text-xs font-semibold text-gray-900 dark:text-white truncate">
              {{ getDisplayTitle(match.metadata) }}
            </div>
            <div class="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400 truncate mt-0.5">
              <Hash v-if="match.entityType === 'channel'" class="w-3 h-3 text-teal-600 dark:text-teal-400 shrink-0" />
              <User v-else class="w-3 h-3 text-gray-400 shrink-0" />
              <span v-if="match.metadata.username" class="truncate">@{{ match.metadata.username }}</span>
              <span v-else class="font-mono tabular-nums">ID {{ match.metadata.id || match.entityKey }}</span>
            </div>
          </div>
        </div>

        <!-- Middle: Description & Unboxed Metrics -->
        <div class="flex-1 min-w-0 space-y-1">
          <p
            v-if="match.metadata.description || match.metadata.about"
            class="text-xs text-gray-600 dark:text-gray-300 truncate"
            :title="match.metadata.description || match.metadata.about"
          >
            {{ match.metadata.description || match.metadata.about }}
          </p>
          <div class="flex flex-wrap items-center gap-2 text-[11px] text-gray-400 dark:text-gray-500 tabular-nums">
            <span>{{
              match.entityType === "channel"
                ? t("channels.visualTypeChannel")
                : match.metadata.bot
                  ? t("channels.bot")
                  : t("channels.user")
            }}</span>
            <template v-if="match.metadata.members || match.metadata.participants_count">
              <span aria-hidden="true">·</span>
              <span class="inline-flex items-center gap-1">
                <Users class="w-3 h-3 shrink-0" />
                {{ formatCompactCount(match.metadata.members || match.metadata.participants_count) }}
              </span>
            </template>
            <template v-if="match.metadata.cdnNumber">
              <span aria-hidden="true">·</span>
              <span class="font-mono">DC {{ match.metadata.cdnNumber }}</span>
            </template>
            <template v-if="match.metadata.id">
              <span aria-hidden="true">·</span>
              <span class="font-mono">ID {{ match.metadata.id }}</span>
            </template>
          </div>
        </div>

        <!-- Right: Tabular Match Score + Actions -->
        <div class="flex items-center justify-between md:justify-end gap-3 shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-gray-100 dark:border-gray-700/60">
          <div class="w-24 space-y-1 shrink-0">
            <div :class="['text-xs font-mono font-semibold text-right tabular-nums', scoreTextClass(match.score)]">
              {{ formatScorePercent(match.score) }}
            </div>
            <div class="w-full h-1 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
              <div
                :class="['h-full rounded-full', scoreBarClass(match.score)]"
                :style="{ width: scoreBarWidth(match.score) }"
              ></div>
            </div>
          </div>

          <div class="flex items-center gap-1.5 shrink-0">
            <button
              v-if="match.entityType === 'channel'"
              type="button"
              @click="handleOpenExplorer(match)"
              class="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-medium bg-gray-50 dark:bg-gray-900 hover:bg-teal-600 text-teal-700 dark:text-teal-400 hover:text-white border border-gray-200 dark:border-gray-700 hover:border-transparent transition-colors cursor-pointer whitespace-nowrap"
            >
              <span>{{ t("channels.archive") }}</span>
              <ExternalLink class="w-3 h-3 shrink-0" />
            </button>
            <button
              v-else
              type="button"
              @click="handleInspectProfile(match)"
              class="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-medium bg-gray-50 dark:bg-gray-900 hover:bg-teal-600 text-teal-700 dark:text-teal-400 hover:text-white border border-gray-200 dark:border-gray-700 hover:border-transparent transition-colors cursor-pointer whitespace-nowrap"
            >
              <span>{{ t("channels.visualInspect") }}</span>
            </button>
            <button
              type="button"
              @click="handleFindSimilarFromMatch(match)"
              class="p-1.5 rounded-xl bg-gray-50 dark:bg-gray-900 hover:bg-gray-100 dark:hover:bg-gray-700 text-teal-600 dark:text-teal-400 border border-gray-200 dark:border-gray-700 transition-colors cursor-pointer shrink-0"
              :title="t('channels.visualFindSimilarAction')"
            >
              <ScanSearch class="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
