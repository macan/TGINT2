<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import {
  Bookmark,
  Search,
  Regex,
  Pin,
  PinOff,
  Compass,
  Trash2,
  Download,
  Upload,
  Maximize2,
  X,
  CheckSquare,
  Square,
  RotateCcw,
  FileText,
  Radio,
  Tag,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  Edit3,
  Clock,
  Calendar,
} from "lucide-vue-next";
import { useI18n } from "../../i18n";
import { useMemory } from "../../composables/useMemory";
import MemoryEditorPanel from "./MemoryEditorPanel.vue";
import {
  resolveMemoryChannelTarget,
  type MemoryDateBasis,
  type MemoryDateRange,
  type MemoryItemRecord,
  type MemorySearchMode,
} from "../../utils/indexedDbMemory";

const emit = defineEmits<{
  (e: "jump-to-explorer", item: MemoryItemRecord): void;
}>();

const { t } = useI18n();
const {
  memoryVersion,
  memoryStats,
  memoryTagCounts,
  queryMemory,
  updateMemoryMeta,
  removeMemoryItem,
  bulkRemoveMemory,
  bulkUpdateMemory,
  exportMemoryJson,
  importMemoryJson,
  showMemoryToast,
} = useMemory();

// Filter state
const typeFilter = ref<"all" | "post" | "channel">("all");
const dateRange = ref<MemoryDateRange>("all");
const dateBasis = ref<MemoryDateBasis>("savedAt");
const searchQuery = ref("");
const searchMode = ref<MemorySearchMode>("fulltext");
const pinnedOnly = ref(false);
const selectedTagFilters = ref<string[]>([]);

// Query result state
const items = ref<MemoryItemRecord[]>([]);
const totalMatched = ref(0);
const regexError = ref<string | null>(null);
const isLoading = ref(false);
const compactDisplayLimit = ref(8);

// Inline expand & Full-screen modal state
const expandedInlineId = ref<string | null>(null);
const isFullModalOpen = ref(false);
const modalSelectedId = ref<string | null>(null);

// Bulk selection state
const isBulkMode = ref(false);
const selectedIds = ref<Set<string>>(new Set());
const bulkTagInput = ref("");

// Hidden JSON file input ref
const fileInputRef = ref<HTMLInputElement | null>(null);

let queryDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let querySeq = 0;

const dateRangeOptions = computed<Array<{ value: MemoryDateRange; label: string }>>(() => [
  { value: "all", label: t("memory.dateAll") },
  { value: "today", label: t("memory.dateToday") },
  { value: "yesterday", label: t("memory.dateYesterday") },
  { value: "last3days", label: t("memory.dateLast3Days") },
  { value: "lastweek", label: t("memory.dateLastWeek") },
  { value: "lastmonth", label: t("memory.dateLastMonth") },
  { value: "lastyear", label: t("memory.dateLastYear") },
]);

const hasActiveFilters = computed(() => {
  return (
    typeFilter.value !== "all" ||
    dateRange.value !== "all" ||
    searchQuery.value.trim().length > 0 ||
    pinnedOnly.value ||
    selectedTagFilters.value.length > 0
  );
});

const activeHighlightRegex = computed<RegExp | null>(() => {
  const q = searchQuery.value.trim();
  if (!q || searchMode.value !== "regex" || regexError.value) return null;
  try {
    return new RegExp(q, "i");
  } catch {
    return null;
  }
});

const activeHighlightTerms = computed<string[]>(() => {
  const q = searchQuery.value.trim();
  if (!q || searchMode.value !== "fulltext") return [];
  return q.split(/\s+/).filter(Boolean);
});

const compactItems = computed(() => items.value.slice(0, compactDisplayLimit.value));

const modalSelectedItem = computed<MemoryItemRecord | null>(() => {
  if (!items.value.length) return null;
  if (modalSelectedId.value) {
    const found = items.value.find((i) => i.id === modalSelectedId.value);
    if (found) return found;
  }
  return items.value[0];
});

const selectedCount = computed(() => selectedIds.value.size);

const allVisibleSelected = computed(() => {
  const pool = isFullModalOpen.value ? items.value : compactItems.value;
  if (!pool.length) return false;
  return pool.every((item) => selectedIds.value.has(item.id));
});

async function runQuery() {
  const seq = ++querySeq;
  isLoading.value = true;
  try {
    const res = await queryMemory({
      type: typeFilter.value,
      dateRange: dateRange.value,
      dateBasis: dateBasis.value,
      query: searchQuery.value,
      searchMode: searchMode.value,
      pinnedOnly: pinnedOnly.value,
      tags: selectedTagFilters.value,
    });
    if (seq !== querySeq) return;
    items.value = res.items;
    totalMatched.value = res.totalMatched;
    regexError.value = res.regexError;

    // Keep modal selection valid
    if (modalSelectedId.value && !res.items.some((x) => x.id === modalSelectedId.value)) {
      modalSelectedId.value = res.items[0]?.id || null;
    } else if (!modalSelectedId.value && res.items.length > 0) {
      modalSelectedId.value = res.items[0].id;
    }

    // Prune stale bulk selection IDs
    if (selectedIds.value.size > 0) {
      const validIds = new Set(res.items.map((x) => x.id));
      const nextSel = new Set<string>();
      for (const id of selectedIds.value) {
        if (validIds.has(id)) nextSel.add(id);
      }
      selectedIds.value = nextSel;
    }
  } catch (err) {
    console.error("[MemoryMonitorWidget] Query failed:", err);
  } finally {
    if (seq === querySeq) isLoading.value = false;
  }
}

function scheduleQuery(immediate = false) {
  if (queryDebounceTimer) {
    clearTimeout(queryDebounceTimer);
    queryDebounceTimer = null;
  }
  if (immediate) {
    runQuery();
  } else {
    queryDebounceTimer = setTimeout(() => {
      queryDebounceTimer = null;
      runQuery();
    }, 120);
  }
}

watch([typeFilter, dateRange, dateBasis, searchMode, pinnedOnly, selectedTagFilters], () => {
  compactDisplayLimit.value = 8;
  scheduleQuery(true);
});

watch(searchQuery, () => {
  compactDisplayLimit.value = 8;
  scheduleQuery(false);
});

watch(memoryVersion, () => {
  scheduleQuery(true);
});

function handleModalEscape(e: KeyboardEvent) {
  if (e.key === "Escape" && isFullModalOpen.value) {
    isFullModalOpen.value = false;
  }
}

onMounted(() => {
  runQuery();
  window.addEventListener("keydown", handleModalEscape);
});

onUnmounted(() => {
  window.removeEventListener("keydown", handleModalEscape);
  if (queryDebounceTimer) clearTimeout(queryDebounceTimer);
});

function resetFilters() {
  typeFilter.value = "all";
  dateRange.value = "all";
  dateBasis.value = "savedAt";
  searchQuery.value = "";
  searchMode.value = "fulltext";
  pinnedOnly.value = false;
  selectedTagFilters.value = [];
  compactDisplayLimit.value = 8;
}

function toggleTagFilter(tag: string) {
  const exists = selectedTagFilters.value.some((x) => x.toLowerCase() === tag.toLowerCase());
  if (exists) {
    selectedTagFilters.value = selectedTagFilters.value.filter(
      (x) => x.toLowerCase() !== tag.toLowerCase()
    );
  } else {
    selectedTagFilters.value = [...selectedTagFilters.value, tag];
  }
}

function isTagFilterActive(tag: string): boolean {
  return selectedTagFilters.value.some((x) => x.toLowerCase() === tag.toLowerCase());
}

function toggleInlineExpand(id: string) {
  expandedInlineId.value = expandedInlineId.value === id ? null : id;
}

function toggleBulkMode() {
  isBulkMode.value = !isBulkMode.value;
  if (!isBulkMode.value) {
    selectedIds.value = new Set();
    bulkTagInput.value = "";
  }
}

function toggleRowSelect(id: string) {
  const next = new Set(selectedIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selectedIds.value = next;
}

function toggleSelectAllVisible() {
  const pool = isFullModalOpen.value ? items.value : compactItems.value;
  if (allVisibleSelected.value) {
    selectedIds.value = new Set();
  } else {
    selectedIds.value = new Set(pool.map((i) => i.id));
  }
}

async function applyBulkTag() {
  const tag = bulkTagInput.value.trim().replace(/^#+/, "");
  if (!tag || selectedIds.value.size === 0) return;
  const ids = Array.from(selectedIds.value);
  await bulkUpdateMemory(
    ids,
    { kind: "addTag", tag },
    t("memory.toastBulkTagged", { count: ids.length, tag })
  );
  bulkTagInput.value = "";
}

async function applyBulkPin(pinned: boolean) {
  if (selectedIds.value.size === 0) return;
  const ids = Array.from(selectedIds.value);
  await bulkUpdateMemory(
    ids,
    { kind: "setPinned", pinned },
    pinned
      ? t("memory.toastBulkPinned", { count: ids.length })
      : t("memory.toastBulkUnpinned", { count: ids.length })
  );
}

async function applyBulkDelete() {
  if (selectedIds.value.size === 0) return;
  const ids = Array.from(selectedIds.value);
  await bulkRemoveMemory(ids, t("memory.toastBulkRemoved", { count: ids.length }));
  selectedIds.value = new Set();
}

async function quickTogglePin(item: MemoryItemRecord) {
  await updateMemoryMeta(item.id, { pinned: item.pinned !== 1 });
}

async function quickDelete(item: MemoryItemRecord) {
  await removeMemoryItem(
    item.id,
    item.type === "post" ? t("memory.toastPostRemoved") : t("memory.toastChannelRemoved")
  );
  if (expandedInlineId.value === item.id) expandedInlineId.value = null;
}

function handleJumpToExplorer(item: MemoryItemRecord) {
  isFullModalOpen.value = false;
  emit("jump-to-explorer", item);
}

function openFullModal(focusItemId?: string) {
  if (focusItemId) {
    modalSelectedId.value = focusItemId;
  } else if (!modalSelectedId.value && items.value.length > 0) {
    modalSelectedId.value = items.value[0].id;
  }
  isFullModalOpen.value = true;
}

async function handleExportJson() {
  try {
    const bundle = await exportMemoryJson();
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `gingko-memory-archive-${stamp}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showMemoryToast(t("memory.toastExported", { count: bundle.count }), "info");
  } catch (err) {
    console.error("[Memory] Export failed:", err);
    showMemoryToast(t("memory.toastExportError"), "error");
  }
}

function triggerImportFile() {
  fileInputRef.value?.click();
}

async function handleImportFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const summary = await importMemoryJson(parsed);
    showMemoryToast(
      t("memory.toastImported", {
        added: summary.added,
        updated: summary.updated,
      }),
      "saved"
    );
  } catch (err) {
    console.error("[Memory] Import failed:", err);
    showMemoryToast(t("memory.toastImportError"), "error");
  } finally {
    input.value = "";
  }
}

function getRowChannelHandle(item: MemoryItemRecord): string {
  return resolveMemoryChannelTarget(item);
}

function getRowTitle(item: MemoryItemRecord): string {
  const handle = getRowChannelHandle(item);
  if (item.type === "channel") {
    return item.channelTitle || handle || "Channel";
  }
  return item.author || item.channelTitle || handle || "Telegram User";
}

function getRowSnippet(item: MemoryItemRecord): string {
  const raw = item.type === "channel" ? item.channelDescription || "" : item.content || "";
  return raw.replace(/\s+/g, " ").trim();
}

function formatShortDate(ms: number): string {
  if (!ms || !Number.isFinite(ms)) return "—";
  const d = new Date(ms);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(undefined, {
    year: sameYear ? undefined : "numeric",
    month: "short",
    day: "2-digit",
  });
}

function handleAvatarError(event: Event) {
  const target = event.target as HTMLImageElement;
  if (target && !target.src.includes("data:image/svg+xml")) {
    target.src =
      "data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Crect width='24' height='24' rx='6' fill='%23d97706'/%3E%3Cpath fill='%23fff' d='M6 4h12v16l-6-4-6 4V4z'/%3E%3C/svg%3E";
  }
}

interface TextSegment {
  text: string;
  match: boolean;
}

function highlightText(text: string): TextSegment[] {
  if (!text) return [];
  let matcher: RegExp | null = null;
  if (activeHighlightRegex.value) {
    try {
      const flags = activeHighlightRegex.value.flags.includes("g")
        ? activeHighlightRegex.value.flags
        : `${activeHighlightRegex.value.flags}g`;
      matcher = new RegExp(activeHighlightRegex.value.source, flags);
    } catch {
      matcher = null;
    }
  } else if (activeHighlightTerms.value.length > 0) {
    const escaped = activeHighlightTerms.value.map((term) =>
      term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    );
    if (escaped.length > 0) {
      matcher = new RegExp(`(${escaped.join("|")})`, "gi");
    }
  }
  if (!matcher) return [{ text, match: false }];

  const segments: TextSegment[] = [];
  let lastIdx = 0;
  let guard = 0;
  let m: RegExpExecArray | null;
  while ((m = matcher.exec(text)) !== null && guard < 80) {
    guard++;
    if (m[0].length === 0) {
      matcher.lastIndex++;
      continue;
    }
    if (m.index > lastIdx) segments.push({ text: text.slice(lastIdx, m.index), match: false });
    segments.push({ text: m[0], match: true });
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < text.length) segments.push({ text: text.slice(lastIdx), match: false });
  return segments.length ? segments : [{ text, match: false }];
}
</script>

<template>
  <section class="bg-white dark:bg-gray-800 p-6 rounded-3xl border border-gray-200 dark:border-gray-700 shadow-sm space-y-5">
    <!-- Hidden JSON archive input -->
    <input
      ref="fileInputRef"
      type="file"
      accept=".json,application/json"
      class="hidden"
      @change="handleImportFileChange"
    />

    <!-- Header Row -->
    <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-gray-150 dark:border-gray-700">
      <div class="flex items-start sm:items-center gap-3 min-w-0">
        <div class="w-10 h-10 rounded-2xl bg-amber-50 dark:bg-amber-950/50 border border-amber-200/70 dark:border-amber-800/60 flex items-center justify-center text-amber-600 dark:text-amber-400 shrink-0">
          <Bookmark class="w-5 h-5 fill-amber-500/20" />
        </div>
        <div class="min-w-0">
          <div class="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
            <h3 class="text-base sm:text-lg font-black text-gray-900 dark:text-white tracking-tight">
              {{ t("memory.title") }}
            </h3>
            <!-- Clean unboxed tabular summary metadata -->
            <div class="flex flex-wrap items-center gap-1.5 text-xs font-mono tabular-nums text-gray-500 dark:text-gray-400">
              <span>{{ t("memory.countTotal", { count: memoryStats.total }) }}</span>
              <span aria-hidden="true">·</span>
              <span>{{ t("memory.countPosts", { count: memoryStats.posts }) }}</span>
              <span aria-hidden="true">·</span>
              <span>{{ t("memory.countChannels", { count: memoryStats.channels }) }}</span>
              <template v-if="memoryStats.pinned > 0">
                <span aria-hidden="true">·</span>
                <span class="text-amber-600 dark:text-amber-400 font-semibold">
                  {{ t("memory.countPinned", { count: memoryStats.pinned }) }}
                </span>
              </template>
            </div>
          </div>
          <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            {{ t("memory.subtitle") }}
          </p>
        </div>
      </div>

      <!-- Header Utility Actions -->
      <div class="flex flex-wrap items-center gap-2 shrink-0">
        <button
          type="button"
          @click="toggleBulkMode"
          class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0"
          :class="
            isBulkMode
              ? 'bg-amber-50 dark:bg-amber-950/50 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300'
              : 'bg-gray-50 dark:bg-gray-900 hover:bg-gray-100 dark:hover:bg-gray-750 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300'
          "
        >
          <CheckSquare class="w-3.5 h-3.5" />
          <span>{{ isBulkMode ? t("memory.doneSelecting") : t("memory.bulkSelect") }}</span>
        </button>

        <button
          type="button"
          @click="triggerImportFile"
          class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 hover:bg-gray-100 dark:hover:bg-gray-750 text-gray-700 dark:text-gray-300 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0"
          :title="t('memory.importJsonTooltip')"
        >
          <Upload class="w-3.5 h-3.5" />
          <span>{{ t("memory.importJson") }}</span>
        </button>

        <button
          type="button"
          @click="handleExportJson"
          :disabled="memoryStats.total === 0"
          class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 hover:bg-gray-100 dark:hover:bg-gray-750 text-gray-700 dark:text-gray-300 text-xs font-semibold transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap shrink-0"
          :title="t('memory.exportJsonTooltip')"
        >
          <Download class="w-3.5 h-3.5" />
          <span>{{ t("memory.exportJson") }}</span>
        </button>

        <button
          type="button"
          @click="openFullModal()"
          class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gray-900 dark:bg-white hover:bg-gray-800 dark:hover:bg-gray-100 text-white dark:text-gray-900 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0"
          :title="t('memory.expandModalTooltip')"
        >
          <Maximize2 class="w-3.5 h-3.5" />
          <span>{{ t("memory.expand") }}</span>
        </button>
      </div>
    </div>

    <!-- Multi-Index Filter Toolbar -->
    <div class="space-y-3">
      <div class="flex flex-col xl:flex-row xl:items-center gap-2.5">
        <!-- Segmented Type Filter -->
        <div class="inline-flex items-center p-1 rounded-xl bg-gray-100 dark:bg-gray-900/80 border border-gray-200/70 dark:border-gray-700/70 shrink-0 self-start">
          <button
            v-for="opt in [
              { id: 'all', label: t('memory.filterAll') },
              { id: 'post', label: t('memory.filterPosts') },
              { id: 'channel', label: t('memory.filterChannels') },
            ]"
            :key="opt.id"
            type="button"
            @click="typeFilter = opt.id as 'all' | 'post' | 'channel'"
            class="px-3 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0"
            :class="
              typeFilter === opt.id
                ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-xs'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
            "
          >
            {{ opt.label }}
          </button>
        </div>

        <!-- Date Range + Date Basis Toggle -->
        <div class="flex flex-wrap items-center gap-2 shrink-0">
          <select
            v-model="dateRange"
            class="h-8.5 px-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-xs font-semibold text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-amber-500/40 cursor-pointer"
            :aria-label="t('memory.dateRangeLabel')"
          >
            <option v-for="opt in dateRangeOptions" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>

          <div
            class="inline-flex items-center p-0.5 rounded-xl bg-gray-100 dark:bg-gray-900/80 border border-gray-200/70 dark:border-gray-700/70"
            :title="t('memory.dateBasisTooltip')"
          >
            <button
              type="button"
              @click="dateBasis = 'savedAt'"
              class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0"
              :class="
                dateBasis === 'savedAt'
                  ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-xs'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
              "
            >
              <Clock class="w-3 h-3" />
              <span>{{ t("memory.basisSaved") }}</span>
            </button>
            <button
              type="button"
              @click="dateBasis = 'publishedAt'"
              class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0"
              :class="
                dateBasis === 'publishedAt'
                  ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-xs'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
              "
            >
              <Calendar class="w-3 h-3" />
              <span>{{ t("memory.basisPublished") }}</span>
            </button>
          </div>

          <button
            type="button"
            @click="pinnedOnly = !pinnedOnly"
            class="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0"
            :class="
              pinnedOnly
                ? 'bg-amber-50 dark:bg-amber-950/50 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300'
                : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
            "
          >
            <Pin class="w-3.5 h-3.5" />
            <span>{{ t("memory.pinnedOnly") }}</span>
          </button>
        </div>

        <!-- Content Search Input (Full-Text / Regex) -->
        <div class="relative flex-1 min-w-[220px] flex items-center">
          <Search class="w-4 h-4 text-gray-400 absolute left-3 pointer-events-none" />
          <input
            v-model="searchQuery"
            type="text"
            :placeholder="searchMode === 'regex' ? t('memory.searchRegexPlaceholder') : t('memory.searchPlaceholder')"
            class="w-full h-9 pl-9 pr-20 rounded-xl border text-xs text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 transition-colors"
            :class="
              regexError
                ? 'border-rose-400 dark:border-rose-600 focus:ring-rose-500/30'
                : 'border-gray-200 dark:border-gray-700 focus:ring-amber-500/35 focus:border-amber-500'
            "
          />
          <div class="absolute right-1.5 flex items-center gap-1">
            <button
              v-if="searchQuery"
              type="button"
              @click="searchQuery = ''"
              class="p-1 rounded-md text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 cursor-pointer"
              :aria-label="t('memory.clearSearch')"
            >
              <X class="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              @click="searchMode = searchMode === 'regex' ? 'fulltext' : 'regex'"
              class="inline-flex items-center gap-0.5 px-2 py-1 rounded-lg text-[11px] font-mono font-bold border transition-colors cursor-pointer whitespace-nowrap shrink-0"
              :class="
                searchMode === 'regex'
                  ? 'bg-amber-500 text-white border-amber-500'
                  : 'bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:text-gray-900 dark:hover:text-gray-200'
              "
              :title="t('memory.regexToggleTooltip')"
            >
              <Regex class="w-3 h-3" />
              <span>.*</span>
            </button>
          </div>
        </div>
      </div>

      <!-- Regex Syntax Error Hint -->
      <div
        v-if="regexError"
        class="flex items-center gap-2 px-3 py-2 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 text-xs text-rose-700 dark:text-rose-300"
      >
        <AlertCircle class="w-4 h-4 shrink-0" />
        <span>{{ t("memory.invalidRegex") }}: {{ regexError }}</span>
      </div>

      <!-- Tag Filter Bar & Active Filter Status -->
      <div
        v-if="memoryTagCounts.length > 0 || hasActiveFilters"
        class="flex flex-wrap items-center justify-between gap-2 text-xs"
      >
        <div class="flex flex-wrap items-center gap-1.5">
          <span v-if="memoryTagCounts.length > 0" class="inline-flex items-center gap-1 text-gray-400 dark:text-gray-500 mr-0.5">
            <Tag class="w-3 h-3" />
          </span>
          <button
            v-for="tc in memoryTagCounts.slice(0, 14)"
            :key="tc.tag"
            type="button"
            @click="toggleTagFilter(tc.tag)"
            class="px-2 py-0.5 rounded-lg border text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0"
            :class="
              isTagFilterActive(tc.tag)
                ? 'bg-amber-500 border-amber-500 text-white'
                : 'bg-gray-50 dark:bg-gray-900/70 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-amber-400 dark:hover:border-amber-600'
            "
          >
            #{{ tc.tag }}
            <span class="ml-0.5 font-mono tabular-nums opacity-70">{{ tc.count }}</span>
          </button>
        </div>

        <div v-if="hasActiveFilters" class="flex items-center gap-2.5 text-gray-500 dark:text-gray-400 font-mono tabular-nums shrink-0">
          <span>{{ t("memory.matchedCount", { count: totalMatched }) }}</span>
          <button
            type="button"
            @click="resetFilters"
            class="inline-flex items-center gap-1 font-sans font-semibold text-amber-600 dark:text-amber-400 hover:underline cursor-pointer"
          >
            <RotateCcw class="w-3 h-3" />
            <span>{{ t("memory.resetFilters") }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Bulk Action Bar -->
    <div
      v-if="isBulkMode"
      class="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 rounded-2xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-800/60"
    >
      <div class="flex items-center gap-3 text-xs">
        <button
          type="button"
          @click="toggleSelectAllVisible"
          class="inline-flex items-center gap-1.5 font-semibold text-gray-800 dark:text-gray-200 hover:text-amber-700 dark:hover:text-amber-300 cursor-pointer"
        >
          <component :is="allVisibleSelected ? CheckSquare : Square" class="w-4 h-4 text-amber-600 dark:text-amber-400" />
          <span>{{ allVisibleSelected ? t("memory.deselectAll") : t("memory.selectAllVisible") }}</span>
        </button>
        <span class="font-mono tabular-nums text-gray-600 dark:text-gray-300">
          {{ t("memory.selectedCount", { count: selectedCount }) }}
        </span>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <div class="flex items-center gap-1">
          <input
            v-model="bulkTagInput"
            type="text"
            @keydown.enter.prevent="applyBulkTag"
            :placeholder="t('memory.bulkTagPlaceholder')"
            class="w-32 sm:w-40 h-7 px-2.5 rounded-lg border border-amber-200 dark:border-amber-800 bg-white dark:bg-gray-900 text-xs text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
          />
          <button
            type="button"
            :disabled="selectedCount === 0 || !bulkTagInput.trim()"
            @click="applyBulkTag"
            class="px-2.5 h-7 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold disabled:opacity-40 cursor-pointer transition-colors whitespace-nowrap shrink-0"
          >
            {{ t("memory.applyTag") }}
          </button>
        </div>

        <button
          type="button"
          :disabled="selectedCount === 0"
          @click="applyBulkPin(true)"
          class="inline-flex items-center gap-1 px-2.5 h-7 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-750 text-xs font-semibold text-gray-700 dark:text-gray-200 disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
        >
          <Pin class="w-3 h-3" />
          <span>{{ t("memory.pin") }}</span>
        </button>

        <button
          type="button"
          :disabled="selectedCount === 0"
          @click="applyBulkPin(false)"
          class="inline-flex items-center gap-1 px-2.5 h-7 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-750 text-xs font-semibold text-gray-700 dark:text-gray-200 disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
        >
          <PinOff class="w-3 h-3" />
          <span>{{ t("memory.unpin") }}</span>
        </button>

        <button
          type="button"
          :disabled="selectedCount === 0"
          @click="applyBulkDelete"
          class="inline-flex items-center gap-1 px-2.5 h-7 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold disabled:opacity-40 cursor-pointer transition-colors whitespace-nowrap shrink-0"
        >
          <Trash2 class="w-3 h-3" />
          <span>{{ t("memory.delete") }}</span>
        </button>
      </div>
    </div>

    <!-- Populated List vs Empty States -->
    <div v-if="isLoading && items.length === 0" class="py-10 space-y-2.5">
      <div
        v-for="n in 3"
        :key="n"
        class="h-14 rounded-xl bg-gray-100 dark:bg-gray-900/60 animate-pulse"
      ></div>
    </div>

    <div
      v-else-if="items.length === 0"
      class="py-10 px-4 text-center rounded-2xl border border-dashed border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/30"
    >
      <Bookmark class="w-8 h-8 mx-auto text-gray-300 dark:text-gray-600 mb-2.5" />
      <p class="text-sm font-semibold text-gray-700 dark:text-gray-200">
        {{ hasActiveFilters ? t("memory.emptyFilteredTitle") : t("memory.emptyTitle") }}
      </p>
      <p class="text-xs text-gray-500 dark:text-gray-400 mt-1 max-w-md mx-auto">
        {{ hasActiveFilters ? t("memory.emptyFilteredDesc") : t("memory.emptyDesc") }}
      </p>
      <button
        v-if="hasActiveFilters"
        type="button"
        @click="resetFilters"
        class="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gray-900 dark:bg-white text-white dark:text-gray-900 text-xs font-semibold cursor-pointer"
      >
        <RotateCcw class="w-3.5 h-3.5" />
        <span>{{ t("memory.resetFilters") }}</span>
      </button>
    </div>

    <!-- Compact List Rows inside Monitor Widget -->
    <div v-else class="divide-y divide-gray-100 dark:divide-gray-700/60 border-t border-b border-gray-100 dark:border-gray-700/60">
      <div
        v-for="item in compactItems"
        :key="item.id"
        class="transition-colors"
        :class="expandedInlineId === item.id ? 'bg-gray-50/70 dark:bg-gray-900/35' : 'hover:bg-gray-50/60 dark:hover:bg-gray-900/25'"
      >
        <!-- Summary Row -->
        <div
          class="flex items-start gap-3 py-3 px-2 cursor-pointer"
          @click="toggleInlineExpand(item.id)"
        >
          <!-- Bulk Checkbox -->
          <button
            v-if="isBulkMode"
            type="button"
            @click.stop="toggleRowSelect(item.id)"
            class="mt-1 text-amber-600 dark:text-amber-400 cursor-pointer shrink-0"
            :aria-label="t('memory.selectRow')"
          >
            <component :is="selectedIds.has(item.id) ? CheckSquare : Square" class="w-4 h-4" />
          </button>

          <!-- Avatar -->
          <div class="w-9 h-9 rounded-xl bg-gray-100 dark:bg-gray-900 border border-gray-200/70 dark:border-gray-700 overflow-hidden shrink-0 mt-0.5">
            <img
              v-if="item.avatarUrl"
              :src="item.avatarUrl"
              alt="Avatar"
              referrerpolicy="no-referrer"
              @error="handleAvatarError"
              class="w-full h-full object-cover"
            />
            <div v-else class="w-full h-full flex items-center justify-center text-amber-600 dark:text-amber-400">
              <component :is="item.type === 'channel' ? Radio : FileText" class="w-4 h-4" />
            </div>
          </div>

          <!-- Main Text & Unboxed Metadata -->
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2 min-w-0">
              <Pin
                v-if="item.pinned === 1"
                class="w-3.5 h-3.5 text-amber-500 fill-amber-500/30 shrink-0"
              />
              <span class="text-xs sm:text-sm font-bold text-gray-900 dark:text-white truncate">
                <template v-for="(seg, sIdx) in highlightText(getRowTitle(item))" :key="sIdx">
                  <mark v-if="seg.match" class="rounded px-0.5 bg-amber-200/80 dark:bg-amber-700/60 text-inherit">{{ seg.text }}</mark>
                  <template v-else>{{ seg.text }}</template>
                </template>
              </span>
              <span class="text-[11px] font-medium shrink-0" :class="item.type === 'channel' ? 'text-teal-600 dark:text-teal-400' : 'text-amber-600 dark:text-amber-400'">
                {{ item.type === "channel" ? t("memory.typeChannel") : t("memory.typePost") }}
              </span>
            </div>

            <p v-if="getRowSnippet(item)" class="mt-0.5 text-xs text-gray-600 dark:text-gray-300 line-clamp-2 leading-relaxed">
              <template v-for="(seg, sIdx) in highlightText(getRowSnippet(item))" :key="sIdx">
                <mark v-if="seg.match" class="rounded px-0.5 bg-amber-200/80 dark:bg-amber-700/60 text-inherit">{{ seg.text }}</mark>
                <template v-else>{{ seg.text }}</template>
              </template>
            </p>

            <!-- Quiet unboxed metadata line -->
            <div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-gray-500 dark:text-gray-400">
              <span v-if="getRowChannelHandle(item)" class="font-mono">@{{ getRowChannelHandle(item) }}</span>
              <span v-if="getRowChannelHandle(item)" aria-hidden="true">·</span>
              <span class="font-mono tabular-nums">
                {{ dateBasis === "publishedAt" && item.hasPublishDate ? t("memory.publishedShort") : t("memory.savedShort") }}
                {{ formatShortDate(dateBasis === "publishedAt" ? item.publishedAt : item.savedAt) }}
              </span>
              <template v-if="item.note">
                <span aria-hidden="true">·</span>
                <span class="text-amber-700 dark:text-amber-300 truncate max-w-[220px]">
                  {{ t("memory.notePrefix") }}: {{ item.note }}
                </span>
              </template>
              <template v-if="item.tags && item.tags.length > 0">
                <span aria-hidden="true">·</span>
                <span class="font-mono text-gray-600 dark:text-gray-300 truncate max-w-[260px]">
                  {{ item.tags.map((tag) => `#${tag}`).join(" ") }}
                </span>
              </template>
            </div>
          </div>

          <!-- Row Quick Actions -->
          <div class="flex items-center gap-1 shrink-0" @click.stop>
            <button
              type="button"
              @click="quickTogglePin(item)"
              class="p-1.5 rounded-lg text-gray-400 hover:text-amber-600 dark:hover:text-amber-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer"
              :title="item.pinned === 1 ? t('memory.unpin') : t('memory.pin')"
            >
              <Pin class="w-3.5 h-3.5" :class="item.pinned === 1 ? 'text-amber-500 fill-amber-500/30' : ''" />
            </button>
            <button
              v-if="getRowChannelHandle(item)"
              type="button"
              @click="handleJumpToExplorer(item)"
              class="p-1.5 rounded-lg text-gray-400 hover:text-teal-600 dark:hover:text-teal-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer"
              :title="t('memory.openInExplorer')"
            >
              <Compass class="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              @click="toggleInlineExpand(item.id)"
              class="p-1.5 rounded-lg text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer"
              :title="t('memory.editItem')"
            >
              <component :is="expandedInlineId === item.id ? ChevronUp : Edit3" class="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              @click="quickDelete(item)"
              class="p-1.5 rounded-lg text-gray-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors cursor-pointer"
              :title="t('memory.deleteItem')"
            >
              <Trash2 class="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <!-- Inline Expanded Detail & Editor -->
        <div
          v-if="expandedInlineId === item.id"
          class="px-4 pb-4 pt-2 border-t border-gray-100 dark:border-gray-700/50"
        >
          <MemoryEditorPanel
            :item="item"
            :highlight-regex="activeHighlightRegex"
            :highlight-terms="activeHighlightTerms"
            compact
            @jump-to-explorer="handleJumpToExplorer"
            @deleted="expandedInlineId = null"
          />
        </div>
      </div>
    </div>

    <!-- Pagination / Expand Footer -->
    <div
      v-if="items.length > compactDisplayLimit"
      class="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs"
    >
      <span class="text-gray-500 dark:text-gray-400 font-mono tabular-nums">
        {{ t("memory.showingSubset", { shown: compactItems.length, total: items.length }) }}
      </span>
      <div class="flex items-center gap-2">
        <button
          type="button"
          @click="compactDisplayLimit += 12"
          class="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 hover:bg-gray-100 dark:hover:bg-gray-750 text-gray-700 dark:text-gray-200 font-semibold cursor-pointer whitespace-nowrap shrink-0"
        >
          <ChevronDown class="w-3.5 h-3.5" />
          <span>{{ t("memory.showMore") }}</span>
        </button>
        <button
          type="button"
          @click="openFullModal()"
          class="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-semibold cursor-pointer whitespace-nowrap shrink-0"
        >
          <Maximize2 class="w-3.5 h-3.5" />
          <span>{{ t("memory.openFullDirectory") }}</span>
        </button>
      </div>
    </div>

    <!-- Full-Screen Split-Pane Memory Directory Modal -->
    <Teleport to="body">
      <div
        v-if="isFullModalOpen"
        class="fixed inset-0 z-[100] bg-gray-950/65 backdrop-blur-xs flex items-center justify-center p-2 sm:p-5"
        @click.self="isFullModalOpen = false"
      >
        <div class="w-full max-w-[1380px] h-[92vh] bg-white dark:bg-gray-800 rounded-3xl border border-gray-200 dark:border-gray-700 shadow-2xl flex flex-col overflow-hidden">
          <!-- Modal Header -->
          <div class="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex flex-wrap items-center justify-between gap-3 shrink-0">
            <div class="flex items-center gap-3 min-w-0">
              <div class="w-9 h-9 rounded-xl bg-amber-50 dark:bg-amber-950/50 border border-amber-200/70 dark:border-amber-800/60 flex items-center justify-center text-amber-600 dark:text-amber-400 shrink-0">
                <Bookmark class="w-4 h-4 fill-amber-500/20" />
              </div>
              <div class="min-w-0">
                <h2 class="text-base font-black text-gray-900 dark:text-white leading-tight">
                  {{ t("memory.title") }}
                </h2>
                <div class="flex items-center gap-1.5 text-xs font-mono tabular-nums text-gray-500 dark:text-gray-400">
                  <span>{{ t("memory.matchedCount", { count: totalMatched }) }}</span>
                  <span aria-hidden="true">·</span>
                  <span>{{ t("memory.countTotal", { count: memoryStats.total }) }}</span>
                </div>
              </div>
            </div>

            <div class="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                @click="toggleBulkMode"
                class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
                :class="
                  isBulkMode
                    ? 'bg-amber-50 dark:bg-amber-950/50 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300'
                    : 'bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300'
                "
              >
                <CheckSquare class="w-3.5 h-3.5" />
                <span>{{ isBulkMode ? t("memory.doneSelecting") : t("memory.bulkSelect") }}</span>
              </button>
              <button
                type="button"
                @click="triggerImportFile"
                class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-gray-700 dark:text-gray-300 text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
              >
                <Upload class="w-3.5 h-3.5" />
                <span>{{ t("memory.importJson") }}</span>
              </button>
              <button
                type="button"
                @click="handleExportJson"
                :disabled="memoryStats.total === 0"
                class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-gray-700 dark:text-gray-300 text-xs font-semibold cursor-pointer disabled:opacity-40 whitespace-nowrap shrink-0"
              >
                <Download class="w-3.5 h-3.5" />
                <span>{{ t("memory.exportJson") }}</span>
              </button>
              <button
                type="button"
                @click="isFullModalOpen = false"
                class="p-2 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-500 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-750 cursor-pointer"
                :aria-label="t('common.close') || 'Close'"
              >
                <X class="w-4 h-4" />
              </button>
            </div>
          </div>

          <!-- Modal Filter Strip -->
          <div class="px-5 py-3 border-b border-gray-150 dark:border-gray-700/80 bg-gray-50/50 dark:bg-gray-900/30 space-y-2.5 shrink-0">
            <div class="flex flex-wrap items-center gap-2">
              <div class="inline-flex items-center p-0.5 rounded-xl bg-gray-100 dark:bg-gray-900 border border-gray-200/70 dark:border-gray-700">
                <button
                  v-for="opt in [
                    { id: 'all', label: t('memory.filterAll') },
                    { id: 'post', label: t('memory.filterPosts') },
                    { id: 'channel', label: t('memory.filterChannels') },
                  ]"
                  :key="opt.id"
                  type="button"
                  @click="typeFilter = opt.id as 'all' | 'post' | 'channel'"
                  class="px-3 py-1 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
                  :class="
                    typeFilter === opt.id
                      ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-xs'
                      : 'text-gray-600 dark:text-gray-400'
                  "
                >
                  {{ opt.label }}
                </button>
              </div>

              <select
                v-model="dateRange"
                class="h-8 px-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-xs font-semibold text-gray-700 dark:text-gray-200 cursor-pointer"
              >
                <option v-for="opt in dateRangeOptions" :key="opt.value" :value="opt.value">
                  {{ opt.label }}
                </option>
              </select>

              <div class="inline-flex items-center p-0.5 rounded-xl bg-gray-100 dark:bg-gray-900 border border-gray-200/70 dark:border-gray-700">
                <button
                  type="button"
                  @click="dateBasis = 'savedAt'"
                  class="px-2.5 py-1 rounded-lg text-[11px] font-semibold cursor-pointer whitespace-nowrap shrink-0"
                  :class="dateBasis === 'savedAt' ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-xs' : 'text-gray-500'"
                >
                  {{ t("memory.basisSaved") }}
                </button>
                <button
                  type="button"
                  @click="dateBasis = 'publishedAt'"
                  class="px-2.5 py-1 rounded-lg text-[11px] font-semibold cursor-pointer whitespace-nowrap shrink-0"
                  :class="dateBasis === 'publishedAt' ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-xs' : 'text-gray-500'"
                >
                  {{ t("memory.basisPublished") }}
                </button>
              </div>

              <button
                type="button"
                @click="pinnedOnly = !pinnedOnly"
                class="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl border text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
                :class="
                  pinnedOnly
                    ? 'bg-amber-50 dark:bg-amber-950/50 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300'
                    : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400'
                "
              >
                <Pin class="w-3.5 h-3.5" />
                <span>{{ t("memory.pinnedOnly") }}</span>
              </button>

              <div class="relative flex-1 min-w-[200px] flex items-center">
                <Search class="w-3.5 h-3.5 text-gray-400 absolute left-3 pointer-events-none" />
                <input
                  v-model="searchQuery"
                  type="text"
                  :placeholder="searchMode === 'regex' ? t('memory.searchRegexPlaceholder') : t('memory.searchPlaceholder')"
                  class="w-full h-8 pl-8 pr-16 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-xs text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-amber-500/35"
                />
                <button
                  type="button"
                  @click="searchMode = searchMode === 'regex' ? 'fulltext' : 'regex'"
                  class="absolute right-1.5 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[11px] font-mono font-bold border cursor-pointer"
                  :class="
                    searchMode === 'regex'
                      ? 'bg-amber-500 text-white border-amber-500'
                      : 'bg-gray-50 dark:bg-gray-800 text-gray-500 border-gray-200 dark:border-gray-700'
                  "
                >
                  <span>.*</span>
                </button>
              </div>
            </div>

            <!-- Modal Bulk Bar -->
            <div
              v-if="isBulkMode"
              class="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-gray-200/70 dark:border-gray-700/60 text-xs"
            >
              <div class="flex items-center gap-3">
                <button
                  type="button"
                  @click="toggleSelectAllVisible"
                  class="inline-flex items-center gap-1.5 font-semibold text-gray-800 dark:text-gray-200 cursor-pointer"
                >
                  <component :is="allVisibleSelected ? CheckSquare : Square" class="w-4 h-4 text-amber-600" />
                  <span>{{ allVisibleSelected ? t("memory.deselectAll") : t("memory.selectAllVisible") }}</span>
                </button>
                <span class="font-mono tabular-nums text-gray-500">{{ t("memory.selectedCount", { count: selectedCount }) }}</span>
              </div>
              <div class="flex flex-wrap items-center gap-1.5">
                <input
                  v-model="bulkTagInput"
                  type="text"
                  @keydown.enter.prevent="applyBulkTag"
                  :placeholder="t('memory.bulkTagPlaceholder')"
                  class="w-36 h-7 px-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-xs"
                />
                <button
                  type="button"
                  :disabled="selectedCount === 0 || !bulkTagInput.trim()"
                  @click="applyBulkTag"
                  class="px-2.5 h-7 rounded-lg bg-amber-600 text-white font-semibold disabled:opacity-40 cursor-pointer"
                >
                  {{ t("memory.applyTag") }}
                </button>
                <button
                  type="button"
                  :disabled="selectedCount === 0"
                  @click="applyBulkPin(true)"
                  class="px-2.5 h-7 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 font-semibold disabled:opacity-40 cursor-pointer"
                >
                  {{ t("memory.pin") }}
                </button>
                <button
                  type="button"
                  :disabled="selectedCount === 0"
                  @click="applyBulkDelete"
                  class="px-2.5 h-7 rounded-lg bg-rose-600 text-white font-semibold disabled:opacity-40 cursor-pointer"
                >
                  {{ t("memory.delete") }}
                </button>
              </div>
            </div>
          </div>

          <!-- Split Pane Body -->
          <div class="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-gray-200 dark:divide-gray-700">
            <!-- Left Master List -->
            <div class="lg:col-span-5 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-700/60">
              <div
                v-if="items.length === 0"
                class="p-10 text-center text-xs text-gray-500 dark:text-gray-400"
              >
                {{ hasActiveFilters ? t("memory.emptyFilteredTitle") : t("memory.emptyTitle") }}
              </div>
              <div
                v-for="item in items"
                :key="item.id"
                @click="modalSelectedId = item.id"
                class="flex items-start gap-2.5 px-4 py-3 cursor-pointer transition-colors"
                :class="
                  modalSelectedItem?.id === item.id
                    ? 'bg-amber-50/70 dark:bg-amber-950/30'
                    : 'hover:bg-gray-50 dark:hover:bg-gray-900/40'
                "
              >
                <button
                  v-if="isBulkMode"
                  type="button"
                  @click.stop="toggleRowSelect(item.id)"
                  class="mt-1 text-amber-600 dark:text-amber-400 cursor-pointer shrink-0"
                >
                  <component :is="selectedIds.has(item.id) ? CheckSquare : Square" class="w-4 h-4" />
                </button>

                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-1.5">
                    <Pin v-if="item.pinned === 1" class="w-3 h-3 text-amber-500 fill-amber-500/30 shrink-0" />
                    <span class="text-xs font-bold text-gray-900 dark:text-white truncate">
                      {{ getRowTitle(item) }}
                    </span>
                    <span class="text-[10px] font-medium shrink-0" :class="item.type === 'channel' ? 'text-teal-600 dark:text-teal-400' : 'text-amber-600 dark:text-amber-400'">
                      {{ item.type === "channel" ? t("memory.typeChannel") : t("memory.typePost") }}
                    </span>
                  </div>
                  <p v-if="getRowSnippet(item)" class="mt-0.5 text-xs text-gray-600 dark:text-gray-300 line-clamp-2">
                    {{ getRowSnippet(item) }}
                  </p>
                  <div class="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] font-mono tabular-nums text-gray-400">
                    <span v-if="getRowChannelHandle(item)">@{{ getRowChannelHandle(item) }}</span>
                    <span v-if="getRowChannelHandle(item)">·</span>
                    <span>{{ formatShortDate(dateBasis === "publishedAt" ? item.publishedAt : item.savedAt) }}</span>
                    <template v-if="item.tags?.length">
                      <span>·</span>
                      <span class="text-amber-600 dark:text-amber-400 truncate max-w-[140px]">
                        {{ item.tags.map((x) => `#${x}`).join(" ") }}
                      </span>
                    </template>
                  </div>
                </div>
              </div>
            </div>

            <!-- Right Detail & Editor Pane -->
            <div class="lg:col-span-7 overflow-y-auto p-5">
              <MemoryEditorPanel
                v-if="modalSelectedItem"
                :item="modalSelectedItem"
                :highlight-regex="activeHighlightRegex"
                :highlight-terms="activeHighlightTerms"
                @jump-to-explorer="handleJumpToExplorer"
              />
              <div v-else class="h-full flex flex-col items-center justify-center text-center text-gray-400">
                <Bookmark class="w-10 h-10 mb-2 opacity-40" />
                <p class="text-sm font-medium">{{ t("memory.selectItemToInspect") }}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </section>
</template>
