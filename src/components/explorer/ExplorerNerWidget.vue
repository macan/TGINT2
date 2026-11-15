<template>
  <div
    class="mt-6 bg-white dark:bg-gray-800 rounded-3xl border border-gray-200/60 dark:border-gray-700/60 p-6 shadow-sm"
  >
    <!-- Widget Header -->
    <div class="flex items-start justify-between gap-2 mb-3">
      <div class="min-w-0">
        <h3
          class="text-xs font-black text-gray-400 dark:text-gray-500 uppercase tracking-wider truncate"
        >
          {{ t('explorer.ner.title') }}
        </h3>
        <div
          class="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-gray-500 dark:text-gray-400 font-mono tabular-nums"
        >
          <span>{{ index.entities.length }} {{ t('explorer.ner.entitiesShort') }}</span>
          <span aria-hidden="true">·</span>
          <span>{{ index.relations.length }} {{ t('explorer.ner.relationsShort') }}</span>
          <span aria-hidden="true">·</span>
          <span>{{ index.postsAnalyzed }}/{{ totalPostsCount }} {{ t('explorer.ner.postsShort') }}</span>
        </div>
      </div>

      <div class="flex items-center gap-1 shrink-0">
        <button
          v-if="!isExtracting"
          type="button"
          @click="$emit('extract', false)"
          :disabled="totalPostsCount === 0"
          class="px-2.5 py-1.5 rounded-xl text-[11px] font-bold bg-teal-600 hover:bg-teal-700 text-white transition-colors disabled:opacity-45 disabled:cursor-not-allowed whitespace-nowrap shrink-0 cursor-pointer flex items-center gap-1"
          :title="index.postsAnalyzed >= totalPostsCount && index.postsAnalyzed > 0 ? t('explorer.ner.upToDateHint') : t('explorer.ner.extractHint')"
        >
          <ScanSearch class="w-3.5 h-3.5 shrink-0" />
          <span>{{
            index.postsAnalyzed > 0 && uncachedCount > 0
              ? t('explorer.ner.extractNew', { count: uncachedCount })
              : index.postsAnalyzed > 0
                ? t('explorer.ner.reExtract')
                : t('explorer.ner.extract')
          }}</span>
        </button>
        <button
          v-else
          type="button"
          @click="$emit('cancel')"
          class="px-2.5 py-1.5 rounded-xl text-[11px] font-bold bg-rose-600 hover:bg-rose-700 text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer flex items-center gap-1"
        >
          <Square class="w-3 h-3 shrink-0" />
          <span>{{ t('explorer.ner.cancel') }}</span>
        </button>

        <button
          v-if="index.postsAnalyzed > 0 && !isExtracting"
          type="button"
          @click="$emit('extract', true)"
          class="p-1.5 rounded-lg text-gray-400 hover:text-teal-600 dark:hover:text-teal-400 hover:bg-teal-50 dark:hover:bg-teal-950/40 transition-colors cursor-pointer shrink-0"
          :title="t('explorer.ner.reExtractAll')"
        >
          <RefreshCw class="w-3.5 h-3.5" />
        </button>

        <button
          type="button"
          @click="$emit('expand')"
          :disabled="index.entities.length === 0 && index.relations.length === 0"
          class="p-1.5 rounded-lg text-teal-600 dark:text-teal-400 hover:bg-teal-50 dark:hover:bg-teal-950/35 disabled:opacity-35 disabled:cursor-not-allowed transition-colors cursor-pointer shrink-0"
          :title="t('explorer.ner.expandView')"
        >
          <Maximize2 class="w-3.5 h-3.5" />
        </button>
      </div>
    </div>

    <!-- Auto-run toggle & engine status line -->
    <div class="flex items-center justify-between gap-2 pb-3 mb-3 border-b border-gray-100 dark:border-gray-700/60">
      <label class="inline-flex items-center gap-1.5 text-[11px] font-medium text-gray-600 dark:text-gray-300 cursor-pointer select-none">
        <input
          type="checkbox"
          :checked="autoExtract"
          @change="$emit('toggle-auto', ($event.target as HTMLInputElement).checked)"
          class="rounded border-gray-300 dark:border-gray-600 text-teal-600 focus:ring-teal-500/30 cursor-pointer"
        />
        <span>{{ t('explorer.ner.autoRunLabel') }}</span>
      </label>

      <div class="flex items-center gap-2 text-[10px] text-gray-400 dark:text-gray-500">
        <span v-if="index.enginesUsed.size > 0" class="font-mono">
          {{ index.enginesUsed.has('gemini') ? t('explorer.ner.engineAi') : t('explorer.ner.engineStructured') }}
        </span>
        <button
          v-if="index.postsAnalyzed > 0 && !isExtracting"
          type="button"
          @click="$emit('clear-cache')"
          class="hover:text-rose-600 dark:hover:text-rose-400 transition-colors cursor-pointer whitespace-nowrap"
          :title="t('explorer.ner.clearCache')"
        >
          {{ t('explorer.ner.clear') }}
        </button>
      </div>
    </div>

    <!-- Extraction Progress Bar -->
    <div v-if="isExtracting && progress" class="mb-3 space-y-1.5">
      <div class="flex items-center justify-between text-[11px] font-medium text-teal-700 dark:text-teal-300">
        <span class="flex items-center gap-1.5">
          <Loader2 class="w-3.5 h-3.5 animate-spin shrink-0" />
          <span>{{ t('explorer.ner.extractingProgress') }}</span>
        </span>
        <span class="font-mono tabular-nums">
          {{ progress.done }}/{{ progress.total }}
        </span>
      </div>
      <div class="w-full h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
        <div
          class="h-full bg-teal-600 dark:bg-teal-400 transition-all duration-200"
          :style="{ width: `${progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0}%` }"
        ></div>
      </div>
    </div>

    <!-- Error Notice with Retry -->
    <div
      v-if="errorMessage"
      class="mb-3 p-2.5 rounded-xl border border-rose-200 dark:border-rose-900/40 bg-rose-50/70 dark:bg-rose-950/20 text-[11px] text-rose-700 dark:text-rose-300 flex items-center justify-between gap-2"
    >
      <span class="truncate">{{ errorMessage }}</span>
      <button
        type="button"
        @click="$emit('extract', false)"
        class="px-2 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-semibold text-[10px] shrink-0 whitespace-nowrap cursor-pointer"
      >
        {{ t('explorer.ner.retry') }}
      </button>
    </div>

    <!-- Empty State -->
    <div
      v-if="index.entities.length === 0 && index.relations.length === 0 && !isExtracting"
      class="py-4 text-center space-y-1.5"
    >
      <p class="text-xs text-gray-500 dark:text-gray-400">
        {{
          totalPostsCount === 0
            ? t('explorer.ner.emptyNoPosts')
            : index.postsAnalyzed > 0
              ? t('explorer.ner.emptyNoMatchesFound')
              : t('explorer.ner.emptyReady', { count: totalPostsCount })
        }}
      </p>
    </div>

    <!-- Populated Content -->
    <div v-else-if="index.entities.length > 0 || index.relations.length > 0" class="space-y-3">
      <!-- View Sub-Tabs: Entities vs Relations -->
      <div class="flex items-center gap-1 p-1 bg-gray-100 dark:bg-gray-900/60 rounded-xl">
        <button
          type="button"
          @click="compactSubTab = 'entities'"
          :class="[
            'flex-1 px-2.5 py-1.5 text-[11px] font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer',
            compactSubTab === 'entities'
              ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-xs'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200',
          ]"
        >
          {{ t('explorer.ner.tabEntities') }} ({{ filteredEntities.length }})
        </button>
        <button
          type="button"
          @click="compactSubTab = 'relations'"
          :class="[
            'flex-1 px-2.5 py-1.5 text-[11px] font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer',
            compactSubTab === 'relations'
              ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-xs'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200',
          ]"
        >
          {{ t('explorer.ner.tabRelations') }} ({{ filteredRelations.length }})
        </button>
      </div>

      <!-- Search Box -->
      <div class="relative flex items-center">
        <Search class="w-3.5 h-3.5 text-gray-400 absolute left-2.5 pointer-events-none" />
        <input
          v-model="searchQuery"
          type="text"
          :placeholder="t('explorer.ner.searchPlaceholder')"
          class="w-full pl-8 pr-7 py-1.5 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200/80 dark:border-gray-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 text-gray-900 dark:text-gray-100 placeholder:text-gray-400"
        />
        <button
          v-if="searchQuery"
          type="button"
          @click="searchQuery = ''"
          class="absolute right-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 cursor-pointer"
          :title="t('channels.clearSearch')"
        >
          <X class="w-3.5 h-3.5" />
        </button>
      </div>

      <!-- Interactive Class Filter Tabs (Entities mode) -->
      <div
        v-if="compactSubTab === 'entities'"
        class="flex items-center gap-1 overflow-x-auto pb-1 custom-scrollbar"
      >
        <button
          type="button"
          @click="selectedNerClass = 'all'"
          :class="[
            'px-2 py-1 rounded-lg text-[10px] font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer',
            selectedNerClass === 'all'
              ? 'bg-teal-600 text-white'
              : 'bg-gray-100 dark:bg-gray-900/60 text-gray-600 dark:text-gray-300 hover:bg-gray-200/70 dark:hover:bg-gray-700',
          ]"
        >
          {{ t('explorer.ner.allClasses') }}
        </button>
        <button
          v-for="cls in activePresentNerClasses"
          :key="cls.id"
          type="button"
          @click="selectedNerClass = cls.id"
          :class="[
            'px-2 py-1 rounded-lg text-[10px] font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer font-mono tabular-nums',
            selectedNerClass === cls.id
              ? cls.activeTabClass
              : 'bg-gray-100 dark:bg-gray-900/60 text-gray-600 dark:text-gray-300 hover:bg-gray-200/70 dark:hover:bg-gray-700',
          ]"
        >
          {{ t(`explorer.ner.classes.${cls.id}`) }} · {{ index.classCounts[cls.id] }}
        </button>
      </div>

      <!-- Interactive Relation Class Filter Tabs (Relations mode) -->
      <div
        v-else
        class="flex items-center gap-1 overflow-x-auto pb-1 custom-scrollbar"
      >
        <button
          type="button"
          @click="selectedRelClass = 'all'"
          :class="[
            'px-2 py-1 rounded-lg text-[10px] font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer',
            selectedRelClass === 'all'
              ? 'bg-teal-600 text-white'
              : 'bg-gray-100 dark:bg-gray-900/60 text-gray-600 dark:text-gray-300 hover:bg-gray-200/70 dark:hover:bg-gray-700',
          ]"
        >
          {{ t('explorer.ner.allRelations') }}
        </button>
        <button
          v-for="relCls in activePresentRelClasses"
          :key="relCls.id"
          type="button"
          @click="selectedRelClass = relCls.id"
          :class="[
            'px-2 py-1 rounded-lg text-[10px] font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer font-mono tabular-nums',
            selectedRelClass === relCls.id
              ? 'bg-teal-600 text-white'
              : 'bg-gray-100 dark:bg-gray-900/60 text-gray-600 dark:text-gray-300 hover:bg-gray-200/70 dark:hover:bg-gray-700',
          ]"
        >
          {{ t(`explorer.ner.relations.${relCls.id}`) }} · {{ index.relationClassCounts[relCls.id] }}
        </button>
      </div>

      <!-- Entities List -->
      <div
        v-if="compactSubTab === 'entities'"
        class="divide-y divide-gray-100 dark:divide-gray-700/60 max-h-[290px] overflow-y-auto pr-1 custom-scrollbar"
      >
        <button
          v-for="ent in filteredEntities.slice(0, 24)"
          :key="ent.id"
          type="button"
          @click="selectEntity(ent)"
          :class="[
            'w-full text-left py-2 px-2 rounded-lg transition-colors cursor-pointer group flex items-start justify-between gap-2',
            activeFilter?.id === ent.id
              ? 'bg-teal-50/90 dark:bg-teal-950/35'
              : 'hover:bg-gray-50 dark:hover:bg-gray-900/50',
          ]"
        >
          <div class="min-w-0 flex-1">
            <div class="text-xs font-semibold text-gray-900 dark:text-gray-100 truncate group-hover:text-teal-700 dark:group-hover:text-teal-300">
              {{ ent.canonicalName }}
            </div>
            <div class="mt-0.5 flex items-center gap-1.5 text-[10px] text-gray-500 dark:text-gray-400 truncate">
              <span :class="['font-semibold', getNerClassMeta(ent.nerClass)?.textClass]">
                {{ t(`explorer.ner.classes.${ent.nerClass}`) }}
              </span>
              <span aria-hidden="true">·</span>
              <span class="font-mono tabular-nums">{{ formatShortDate(ent.lastSeenMs) }}</span>
            </div>
          </div>
          <span class="text-[11px] font-mono tabular-nums font-bold text-gray-500 dark:text-gray-400 shrink-0 pt-0.5">
            ×{{ ent.mentionCount }}
          </span>
        </button>

        <div
          v-if="filteredEntities.length === 0"
          class="py-4 text-center text-xs text-gray-400 dark:text-gray-500"
        >
          {{ t('explorer.ner.noFilterMatches') }}
        </div>
      </div>

      <!-- Relations List (with Timestamp) -->
      <div
        v-else
        class="divide-y divide-gray-100 dark:divide-gray-700/60 max-h-[290px] overflow-y-auto pr-1 custom-scrollbar"
      >
        <button
          v-for="rel in filteredRelations.slice(0, 20)"
          :key="rel.id"
          type="button"
          @click="selectRelation(rel)"
          :class="[
            'w-full text-left py-2.5 px-2 rounded-lg transition-colors cursor-pointer group space-y-1',
            activeFilter?.id === rel.id
              ? 'bg-teal-50/90 dark:bg-teal-950/35'
              : 'hover:bg-gray-50 dark:hover:bg-gray-900/50',
          ]"
        >
          <div class="text-xs font-semibold text-gray-900 dark:text-gray-100 leading-snug">
            <span class="group-hover:text-teal-700 dark:group-hover:text-teal-300">{{ rel.subjectName }}</span>
            <span class="mx-1 text-[10px] font-medium text-gray-500 dark:text-gray-400">
              → {{ t(`explorer.ner.relations.${rel.relationClass}`) }} →
            </span>
            <span>{{ rel.objectName }}</span>
          </div>
          <div class="flex items-center gap-1.5 text-[10px] text-gray-500 dark:text-gray-400 font-mono tabular-nums">
            <span>{{ formatNerTimestamp(rel.latestTimestampMs) }}</span>
            <span aria-hidden="true">·</span>
            <span>{{ rel.occurrences.length }} {{ rel.occurrences.length === 1 ? t('explorer.ner.mentionSingle') : t('explorer.ner.mentionPlural') }}</span>
          </div>
        </button>

        <div
          v-if="filteredRelations.length === 0"
          class="py-4 text-center text-xs text-gray-400 dark:text-gray-500"
        >
          {{ t('explorer.ner.noFilterMatches') }}
        </div>
      </div>

      <!-- Footer Expand Link -->
      <div class="pt-2 border-t border-gray-100 dark:border-gray-700/60 flex items-center justify-between">
        <button
          v-if="activeFilter"
          type="button"
          @click="$emit('clear-filter')"
          class="text-[11px] font-semibold text-rose-600 dark:text-rose-400 hover:underline cursor-pointer whitespace-nowrap"
        >
          {{ t('explorer.ner.clearActiveFilter') }}
        </button>
        <span v-else class="text-[10px] text-gray-400 dark:text-gray-500 truncate">
          {{ t('explorer.ner.clickToFilterHint') }}
        </span>

        <button
          type="button"
          @click="$emit('expand')"
          class="text-[11px] font-bold text-teal-600 dark:text-teal-400 hover:underline inline-flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
        >
          <span>{{ t('explorer.ner.openExpandModal') }}</span>
          <Maximize2 class="w-3 h-3" />
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { useI18n } from "../../i18n";
import {
  Loader2,
  Maximize2,
  RefreshCw,
  ScanSearch,
  Search,
  Square,
  X,
} from "lucide-vue-next";
import {
  NER_CLASSES,
  NER_CLASS_MAP,
  RELATION_CLASSES,
  formatNerTimestamp,
  type ActiveNerFeedFilter,
  type AggregatedNerEntity,
  type AggregatedNerIndex,
  type AggregatedNerRelation,
  type NerBatchProgress,
  type NerClassId,
  type RelationClassId,
} from "../../utils/explorerNer";

const props = defineProps<{
  index: AggregatedNerIndex;
  totalPostsCount: number;
  uncachedCount: number;
  isExtracting: boolean;
  autoExtract: boolean;
  progress: NerBatchProgress | null;
  errorMessage: string | null;
  activeFilter: ActiveNerFeedFilter | null;
}>();

const emit = defineEmits<{
  (e: "extract", forceReextract: boolean): void;
  (e: "cancel"): void;
  (e: "toggle-auto", val: boolean): void;
  (e: "clear-cache"): void;
  (e: "expand"): void;
  (e: "select-filter", filter: ActiveNerFeedFilter): void;
  (e: "clear-filter"): void;
}>();

const { t } = useI18n();

const compactSubTab = ref<"entities" | "relations">("entities");
const selectedNerClass = ref<"all" | NerClassId>("all");
const selectedRelClass = ref<"all" | RelationClassId>("all");
const searchQuery = ref("");

const activePresentNerClasses = computed(() =>
  NER_CLASSES.filter((c) => (props.index.classCounts[c.id] || 0) > 0)
);

const activePresentRelClasses = computed(() =>
  RELATION_CLASSES.filter((r) => (props.index.relationClassCounts[r.id] || 0) > 0)
);

const filteredEntities = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  return props.index.entities.filter((e) => {
    if (selectedNerClass.value !== "all" && e.nerClass !== selectedNerClass.value) {
      return false;
    }
    if (q) {
      const hay = `${e.canonicalName} ${e.aliases.join(" ")}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
});

const filteredRelations = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  return props.index.relations.filter((r) => {
    if (selectedRelClass.value !== "all" && r.relationClass !== selectedRelClass.value) {
      return false;
    }
    if (q) {
      const hay = `${r.subjectName} ${r.objectName} ${r.relationClass}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
});

const getNerClassMeta = (id: NerClassId) => NER_CLASS_MAP.get(id);

const formatShortDate = (ms: number): string => {
  if (!ms || ms <= 0) return "—";
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
};

const selectEntity = (ent: AggregatedNerEntity) => {
  emit("select-filter", {
    type: "entity",
    id: ent.id,
    label: ent.canonicalName,
    sublabel: t(`explorer.ner.classes.${ent.nerClass}`),
    postKeys: ent.postKeys,
    quotes: ent.sampleQuotes,
    surfaceTerms: Array.from(new Set([ent.canonicalName, ...ent.aliases])),
  });
};

const selectRelation = (rel: AggregatedNerRelation) => {
  emit("select-filter", {
    type: "relation",
    id: rel.id,
    label: `${rel.subjectName} → ${t(`explorer.ner.relations.${rel.relationClass}`)} → ${rel.objectName}`,
    sublabel: formatNerTimestamp(rel.latestTimestampMs),
    postKeys: rel.postKeys,
    quotes: rel.occurrences.map((o) => ({
      postKey: o.postKey,
      timestampMs: o.timestampMs,
      quote: o.evidenceQuote,
    })),
    surfaceTerms: [rel.subjectName, rel.objectName],
  });
};
</script>
