<script setup lang="ts">
import { computed, ref } from "vue";
import {
  PieChart,
  BarChart2,
  Cpu,
  DollarSign,
  Gamepad2,
  Landmark,
  Shield,
  GraduationCap,
  BookOpen,
  Newspaper,
  Sparkles,
  ChevronDown,
  ChevronUp,
  X,
  Layers,
  Radio,
  Tag,
  Check,
  HelpCircle,
  TrendingUp,
  Filter
} from "lucide-vue-next";
import { ListenItem } from "../types";
import { useI18n } from "../i18n";

const { t } = useI18n();

const props = withDefaults(
  defineProps<{
    items: ListenItem[];
    activeCategory?: string | null;
    collapsible?: boolean;
    defaultExpanded?: boolean;
    compact?: boolean;
  }>(),
  {
    activeCategory: null,
    collapsible: true,
    defaultExpanded: false,
    compact: false
  }
);

const emit = defineEmits<{
  (e: "select-category", category: string | null): void;
}>();

// Persistent collapse state
const STORAGE_KEY = "listen_autoclass_chart_expanded";
const isExpanded = ref<boolean>(
  props.defaultExpanded || localStorage.getItem(STORAGE_KEY) === "true"
);

const toggleExpand = () => {
  isExpanded.value = !isExpanded.value;
  localStorage.setItem(STORAGE_KEY, String(isExpanded.value));
};

// Hovered category for interactive donut chart center preview
const hoveredCategory = ref<string | null>(null);

// Category metadata mapping
export interface CategoryMeta {
  key: string;
  label: string;
  icon: any;
  colorClass: string;
  hex: string;
  bgHex: string;
  borderHex: string;
}

const CATEGORY_META_MAP: Record<string, CategoryMeta> = {
  technology: {
    key: "technology",
    label: "Technology",
    icon: Cpu,
    colorClass: "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/50 border-blue-200 dark:border-blue-800/60",
    hex: "#3b82f6",
    bgHex: "rgba(59, 130, 246, 0.15)",
    borderHex: "rgba(59, 130, 246, 0.4)"
  },
  financial: {
    key: "financial",
    label: "Financial",
    icon: DollarSign,
    colorClass: "text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800/60",
    hex: "#10b981",
    bgHex: "rgba(16, 185, 129, 0.15)",
    borderHex: "rgba(16, 185, 129, 0.4)"
  },
  game: {
    key: "game",
    label: "Gaming",
    icon: Gamepad2,
    colorClass: "text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-950/50 border-purple-200 dark:border-purple-800/60",
    hex: "#a855f7",
    bgHex: "rgba(168, 85, 247, 0.15)",
    borderHex: "rgba(168, 85, 247, 0.4)"
  },
  political: {
    key: "political",
    label: "Politics",
    icon: Landmark,
    colorClass: "text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/50 border-rose-200 dark:border-rose-800/60",
    hex: "#f43f5e",
    bgHex: "rgba(244, 63, 94, 0.15)",
    borderHex: "rgba(244, 63, 94, 0.4)"
  },
  military: {
    key: "military",
    label: "Military",
    icon: Shield,
    colorClass: "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/50 border-amber-200 dark:border-amber-800/60",
    hex: "#f59e0b",
    bgHex: "rgba(245, 158, 11, 0.15)",
    borderHex: "rgba(245, 158, 11, 0.4)"
  },
  university: {
    key: "university",
    label: "University",
    icon: GraduationCap,
    colorClass: "text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/50 border-indigo-200 dark:border-indigo-800/60",
    hex: "#6366f1",
    bgHex: "rgba(99, 102, 241, 0.15)",
    borderHex: "rgba(99, 102, 241, 0.4)"
  },
  blog: {
    key: "blog",
    label: "Blog",
    icon: BookOpen,
    colorClass: "text-pink-600 dark:text-pink-400 bg-pink-50 dark:bg-pink-950/50 border-pink-200 dark:border-pink-800/60",
    hex: "#ec4899",
    bgHex: "rgba(236, 72, 153, 0.15)",
    borderHex: "rgba(236, 72, 153, 0.4)"
  },
  general_news: {
    key: "general_news",
    label: "General News",
    icon: Newspaper,
    colorClass: "text-cyan-600 dark:text-cyan-400 bg-cyan-50 dark:bg-cyan-950/50 border-cyan-200 dark:border-cyan-800/60",
    hex: "#06b6d4",
    bgHex: "rgba(6, 182, 212, 0.15)",
    borderHex: "rgba(6, 182, 212, 0.4)"
  }
};

const getCategoryMeta = (cat: string): CategoryMeta => {
  const c = (cat || "").toLowerCase();
  if (CATEGORY_META_MAP[c]) {
    return CATEGORY_META_MAP[c];
  }
  return {
    key: c,
    label: c ? c.charAt(0).toUpperCase() + c.slice(1).replace(/_/g, " ") : "Topic",
    icon: Sparkles,
    colorClass: "text-teal-600 dark:text-teal-400 bg-teal-50 dark:bg-teal-950/50 border-teal-200 dark:border-teal-800/60",
    hex: "#14b8a6",
    bgHex: "rgba(20, 184, 166, 0.15)",
    borderHex: "rgba(20, 184, 166, 0.4)"
  };
};

export interface CategoryStat {
  key: string;
  meta: CategoryMeta;
  count: number;
  percentage: number;
  avgConfidence: number;
  items: ListenItem[];
  // Donut arc SVG coordinates
  dashArray: string;
  dashOffset: number;
}

// Distribution calculations across all items
const stats = computed(() => {
  const all = Array.isArray(props.items) ? props.items.filter(i => !i.isFolder) : [];
  const total = all.length;

  const classifiedItems = all.filter(i => !!i.auto_class?.class);
  const unclassifiedItems = all.filter(i => !i.auto_class?.class);
  const classifiedCount = classifiedItems.length;

  const map = new Map<string, { count: number; totalConf: number; items: ListenItem[] }>();

  for (const item of classifiedItems) {
    const rawCat = (item.auto_class?.class || "other").toLowerCase();
    const conf = typeof item.auto_class?.confidence === "number" ? item.auto_class.confidence : 1;
    const entry = map.get(rawCat) || { count: 0, totalConf: 0, items: [] };
    entry.count += 1;
    entry.totalConf += conf;
    entry.items.push(item);
    map.set(rawCat, entry);
  }

  // Calculate donut circumferences (radius = 70 => circumference ≈ 439.82)
  const CIRCUMFERENCE = 2 * Math.PI * 70;
  let runningOffset = 0;

  const categories: CategoryStat[] = Array.from(map.entries())
    .map(([key, data]) => {
      const percentage = classifiedCount > 0 ? (data.count / classifiedCount) * 100 : 0;
      const avgConfidence = data.count > 0 ? (data.totalConf / data.count) : 0;
      const arcLength = (percentage / 100) * CIRCUMFERENCE;
      const dashArray = `${arcLength} ${CIRCUMFERENCE - arcLength}`;
      const dashOffset = -runningOffset;
      runningOffset += arcLength;

      return {
        key,
        meta: getCategoryMeta(key),
        count: data.count,
        percentage: Math.round(percentage * 10) / 10,
        avgConfidence: Math.round(avgConfidence * 100),
        items: data.items,
        dashArray,
        dashOffset
      };
    })
    .sort((a, b) => b.count - a.count);

  const overallAvgConfidence =
    classifiedCount > 0
      ? Math.round(
          (classifiedItems.reduce((acc, i) => acc + (i.auto_class?.confidence ?? 1), 0) /
            classifiedCount) *
            100
        )
      : 0;

  const coveragePercent = total > 0 ? Math.round((classifiedCount / total) * 100) : 0;

  return {
    total,
    classifiedCount,
    unclassifiedCount: unclassifiedItems.length,
    coveragePercent,
    overallAvgConfidence,
    categories,
    circumference: CIRCUMFERENCE
  };
});

const activeCategoryStat = computed(() => {
  const activeKey = hoveredCategory.value || props.activeCategory;
  if (!activeKey) return null;
  return stats.value.categories.find(c => c.key === activeKey.toLowerCase()) || null;
});

const onCategoryClick = (catKey: string) => {
  if (props.activeCategory === catKey) {
    emit("select-category", null);
  } else {
    emit("select-category", catKey);
  }
};
</script>

<template>
  <div
    class="bg-white dark:bg-gray-800 rounded-3xl border border-gray-200/80 dark:border-gray-700/80 shadow-xs transition-all overflow-hidden"
    :class="[compact ? 'p-3.5 sm:p-4' : 'p-4 sm:p-5']"
  >
    <!-- Header Row -->
    <div class="flex items-center justify-between gap-3">
      <!-- Title & Summary Metrics -->
      <div class="flex items-center gap-2.5 min-w-0 flex-wrap">
        <div class="p-2 rounded-xl bg-teal-50 dark:bg-teal-950/50 text-teal-600 dark:text-teal-400 border border-teal-200/60 dark:border-teal-800/60 shrink-0">
          <PieChart class="h-4 w-4" />
        </div>
        
        <div class="min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <h3 class="text-xs sm:text-sm font-bold text-gray-900 dark:text-white tracking-tight">
              {{ t('listen.topicDistribution') || 'Category Distribution' }}
            </h3>
            
            <!-- Clean unboxed metadata separator -->
            <span class="text-gray-300 dark:text-gray-600 select-none">·</span>
            
            <span class="text-xs font-semibold text-gray-600 dark:text-gray-300 tabular-nums">
              {{ stats.classifiedCount }} / {{ stats.total }} {{ t('listen.classified') || 'Classified' }}
            </span>
            
            <span class="text-gray-300 dark:text-gray-600 select-none">·</span>

            <span class="text-xs font-medium text-teal-600 dark:text-teal-400 font-mono tabular-nums">
              {{ stats.coveragePercent }}% {{ t('listen.coverage') || 'coverage' }}
            </span>

            <template v-if="stats.overallAvgConfidence > 0">
              <span class="text-gray-300 dark:text-gray-600 select-none">·</span>
              <span class="text-[11px] font-mono text-gray-500 dark:text-gray-400">
                Avg. {{ stats.overallAvgConfidence }}% confidence
              </span>
            </template>
          </div>
        </div>
      </div>

      <!-- Action buttons: Filter Reset & Expand Toggle -->
      <div class="flex items-center gap-2 shrink-0">
        <!-- Active Filter Indicator & Reset Button -->
        <button
          v-if="activeCategory"
          type="button"
          @click="emit('select-category', null)"
          class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-bold bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800 hover:bg-teal-100 transition-colors cursor-pointer select-none"
          :title="t('listen.clearFilter') || 'Clear topic filter'"
        >
          <Filter class="h-3 w-3 text-teal-500" />
          <span class="capitalize">{{ activeCategory }}</span>
          <X class="h-3 w-3 ml-0.5 opacity-60 hover:opacity-100" />
        </button>

        <!-- Expand / Collapse Button -->
        <button
          v-if="collapsible"
          type="button"
          @click="toggleExpand"
          class="p-1.5 rounded-xl text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700/60 transition-colors cursor-pointer"
          :title="isExpanded ? (t('common.collapse') || 'Collapse details') : (t('common.expand') || 'Expand details')"
        >
          <component :is="isExpanded ? ChevronUp : ChevronDown" class="h-4 w-4" />
        </button>
      </div>
    </div>

    <!-- Proportional Distribution Segmented Bar (Always Visible as a Quick Visual Bar) -->
    <div class="mt-3.5 space-y-1.5">
      <div class="h-3 w-full bg-gray-100 dark:bg-gray-700/60 rounded-full overflow-hidden flex shadow-inner">
        <template v-if="stats.classifiedCount > 0">
          <div
            v-for="cat in stats.categories"
            :key="'bar-' + cat.key"
            @click="onCategoryClick(cat.key)"
            @mouseenter="hoveredCategory = cat.key"
            @mouseleave="hoveredCategory = null"
            class="h-full transition-all duration-300 cursor-pointer relative group/bar hover:opacity-90 active:scale-95"
            :style="{
              width: `${cat.percentage}%`,
              backgroundColor: cat.meta.hex
            }"
            :class="[
              activeCategory === cat.key ? 'ring-2 ring-white dark:ring-gray-900 z-10' : ''
            ]"
            :title="`${cat.meta.label}: ${cat.count} (${cat.percentage}%)`"
          ></div>
        </template>
        <!-- Unclassified Gray Segment -->
        <div
          v-if="stats.unclassifiedCount > 0"
          class="h-full bg-gray-300 dark:bg-gray-600/70 transition-all duration-300"
          :style="{ width: `${stats.total > 0 ? (stats.unclassifiedCount / stats.total) * 100 : 100}%` }"
          :title="`Unclassified: ${stats.unclassifiedCount}`"
        ></div>
      </div>

      <!-- Quick Category Pills Strip (Compact Navigation) -->
      <div class="flex items-center gap-1.5 overflow-x-auto py-1 scrollbar-none select-none text-[11px]">
        <button
          v-for="cat in stats.categories"
          :key="'pill-' + cat.key"
          type="button"
          @click="onCategoryClick(cat.key)"
          @mouseenter="hoveredCategory = cat.key"
          @mouseleave="hoveredCategory = null"
          class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl font-medium transition-all shrink-0 cursor-pointer border"
          :class="[
            activeCategory === cat.key
              ? 'ring-2 ring-teal-500/50 font-bold ' + cat.meta.colorClass
              : 'bg-gray-50 dark:bg-gray-900/40 text-gray-700 dark:text-gray-300 border-gray-200/60 dark:border-gray-700/60 hover:bg-gray-100 dark:hover:bg-gray-750'
          ]"
        >
          <span
            class="w-2 h-2 rounded-full shrink-0"
            :style="{ backgroundColor: cat.meta.hex }"
          ></span>
          <span>{{ cat.meta.label }}</span>
          <span class="font-mono text-[10px] opacity-75 font-bold tabular-nums">
            {{ cat.count }}
          </span>
        </button>

        <div
          v-if="stats.unclassifiedCount > 0"
          class="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-gray-400 dark:text-gray-500 text-[10px] font-mono shrink-0"
        >
          <HelpCircle class="h-3 w-3 opacity-60" />
          <span>{{ stats.unclassifiedCount }} unclassified</span>
        </div>
      </div>
    </div>

    <!-- Expanded Detailed Interactive Visualization -->
    <div
      v-if="isExpanded && stats.classifiedCount > 0"
      class="mt-5 pt-5 border-t border-gray-100 dark:border-gray-700/60 grid grid-cols-1 lg:grid-cols-12 gap-6 items-center"
    >
      <!-- Left: SVG Donut Chart with Interactive Center Metrics -->
      <div class="lg:col-span-4 flex flex-col items-center justify-center p-3 relative">
        <div class="relative w-44 h-44 sm:w-48 sm:h-48 flex items-center justify-center">
          <svg class="w-full h-full transform -rotate-90" viewBox="0 0 180 180" @mouseleave="hoveredCategory = null">
            <!-- Background base circle -->
            <circle
              cx="90"
              cy="90"
              r="70"
              fill="none"
              class="stroke-gray-100 dark:stroke-gray-700/50"
              stroke-width="16"
              style="pointer-events: none;"
            />
            
            <!-- Category Arc Segments -->
            <circle
              v-for="cat in stats.categories"
              :key="'arc-' + cat.key"
              cx="90"
              cy="90"
              r="70"
              fill="none"
              :stroke="cat.meta.hex"
              :stroke-width="hoveredCategory === cat.key || activeCategory === cat.key ? 20 : 16"
              :stroke-dasharray="cat.dashArray"
              :stroke-dashoffset="cat.dashOffset"
              stroke-linecap="butt"
              class="transition-all duration-300 cursor-pointer origin-center hover:opacity-90"
              style="pointer-events: stroke;"
              @mouseenter="hoveredCategory = cat.key"
              @mouseleave="hoveredCategory = null"
              @click="onCategoryClick(cat.key)"
            />

            <!-- Center hole transparent area to explicitly reset hover when cursor is in the center -->
            <circle
              cx="90"
              cy="90"
              r="60"
              fill="transparent"
              style="pointer-events: fill; cursor: default;"
              @mouseenter="hoveredCategory = null"
            />
          </svg>

          <!-- Center Content of Donut -->
          <div class="absolute inset-0 flex flex-col items-center justify-center text-center p-4 pointer-events-none select-none">
            <template v-if="activeCategoryStat">
              <component
                :is="activeCategoryStat.meta.icon"
                class="h-5 w-5 mb-0.5"
                :style="{ color: activeCategoryStat.meta.hex }"
              />
              <span class="text-xs font-bold text-gray-900 dark:text-white truncate max-w-[100px]">
                {{ activeCategoryStat.meta.label }}
              </span>
              <span class="text-lg font-black text-gray-900 dark:text-white font-mono tabular-nums leading-none mt-0.5">
                {{ activeCategoryStat.count }}
              </span>
              <span class="text-[10px] text-gray-400 font-mono mt-0.5">
                {{ activeCategoryStat.percentage }}% · {{ activeCategoryStat.avgConfidence }}% conf
              </span>
            </template>
            <template v-else>
              <PieChart class="h-5 w-5 text-teal-500 mb-0.5 opacity-80" />
              <span class="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                {{ t('listen.totalTracked') || 'Tracked' }}
              </span>
              <span class="text-xl font-black text-gray-900 dark:text-white font-mono tabular-nums leading-none mt-0.5">
                {{ stats.classifiedCount }}
              </span>
              <span class="text-[10px] text-gray-400 font-mono mt-0.5">
                {{ stats.categories.length }} {{ t('listen.categoriesCount') || 'topics' }}
              </span>
            </template>
          </div>
        </div>

        <p class="text-[11px] text-gray-400 dark:text-gray-500 text-center mt-3">
          {{ t('listen.clickSliceToFilter') || 'Click on any topic segment or card to filter directory items' }}
        </p>
      </div>

      <!-- Right: Category Grid Cards with Details & Sample Channels -->
      <div class="lg:col-span-8 grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-80 overflow-y-auto pr-1 scrollbar-thin">
        <div
          v-for="cat in stats.categories"
          :key="'card-' + cat.key"
          @click="onCategoryClick(cat.key)"
          @mouseenter="hoveredCategory = cat.key"
          @mouseleave="hoveredCategory = null"
          class="p-3 rounded-2xl border transition-all cursor-pointer select-none group flex flex-col justify-between gap-2"
          :class="[
            activeCategory === cat.key
              ? 'border-teal-500 bg-teal-50/50 dark:bg-teal-950/30 shadow-xs ring-1 ring-teal-500'
              : 'border-gray-200/70 dark:border-gray-700/60 bg-gray-50/40 dark:bg-gray-900/30 hover:border-gray-300 dark:hover:border-gray-600'
          ]"
        >
          <!-- Top Row: Icon, Title, Count & Percent -->
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2 min-w-0">
              <div
                class="w-7 h-7 rounded-xl flex items-center justify-center shrink-0 border"
                :class="cat.meta.colorClass"
              >
                <component :is="cat.meta.icon" class="h-3.5 w-3.5" />
              </div>
              <div class="min-w-0">
                <h4 class="text-xs font-bold text-gray-900 dark:text-white truncate">
                  {{ cat.meta.label }}
                </h4>
                <div class="text-[10px] text-gray-400 font-mono">
                  {{ cat.avgConfidence }}% avg. confidence
                </div>
              </div>
            </div>

            <!-- Count & % Share -->
            <div class="text-right shrink-0">
              <span class="text-sm font-black text-gray-900 dark:text-white font-mono tabular-nums">
                {{ cat.count }}
              </span>
              <span class="text-[10px] text-gray-400 font-mono block">
                {{ cat.percentage }}%
              </span>
            </div>
          </div>

          <!-- Progress Share Bar -->
          <div class="w-full bg-gray-200/60 dark:bg-gray-700/60 rounded-full h-1.5 overflow-hidden">
            <div
              class="h-full rounded-full transition-all duration-500"
              :style="{
                width: `${cat.percentage}%`,
                backgroundColor: cat.meta.hex
              }"
            ></div>
          </div>

          <!-- Channel sample names preview -->
          <div class="flex items-center gap-1 overflow-hidden text-[10px] text-gray-500 dark:text-gray-400 pt-0.5">
            <span class="truncate">
              {{ cat.items.map(i => i.name).slice(0, 3).join(', ') }}
              <template v-if="cat.items.length > 3">
                +{{ cat.items.length - 3 }} more
              </template>
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
