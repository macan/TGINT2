<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from "vue";
import {
  Globe2,
  CheckCircle2,
  Layers
} from "lucide-vue-next";
import { useI18n } from "../../i18n";

export interface TopicItemMeta {
  key: string;
  label: string;
  color: string;
  bg: string;
  border: string;
  icon?: string;
}

export interface CountryItemMeta {
  key: string;
  label: string;
  flag: string;
  isNew?: boolean;
}

export interface TreemapNode<T = any> {
  id: string;
  key: string;
  label: string;
  count: number;
  sharePercent: number;
  x: number;
  y: number;
  w: number;
  h: number;
  meta: T;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const props = defineProps<{
  topicCounts: Record<string, number>;
  countryCounts: Record<string, number>;
  selectedTopic: string;
  selectedCountry: string;
  totalChannels: number;
  topicConfig: Record<string, { label: string; color: string; bg: string; border: string }>;
  countryConfig: Record<string, { label: string; flag: string; isNew?: boolean }>;
}>();

const emit = defineEmits<{
  (e: "update:selectedTopic", topic: string): void;
  (e: "update:selectedCountry", country: string): void;
}>();

const { t } = useI18n();

// Container elements and dimensions
const topicContainerRef = ref<HTMLDivElement | null>(null);
const countryContainerRef = ref<HTMLDivElement | null>(null);
const topicWidth = ref<number>(900);
const topicHeight = ref<number>(200);
const countryWidth = ref<number>(900);
const countryHeight = ref<number>(230);

let topicObserver: ResizeObserver | null = null;
let countryObserver: ResizeObserver | null = null;

// Hover state for interactive inspection
const hoveredTopicKey = ref<string | null>(null);
const hoveredCountryKey = ref<string | null>(null);

// Topic icon map
const TOPIC_ICONS: Record<string, string> = {
  technology: "💻",
  general_news: "📰",
  blog: "✍️",
  financial: "📈",
  military: "⚔️",
  university: "🎓",
  political: "🏛️",
  game: "🎮",
  social_movements: "📢",
  spam: "⚠️"
};

/**
 * Robust Iterative Squarified Treemap Layout Engine
 * Divides the rectangle space with respect to the channel count ratio of each category.
 * Guarantees every single category is included inside [0, 0, width, height] with positive coordinates.
 */
const computeSquarifiedNodes = <T extends { key: string; label: string }>(
  items: Array<{ key: string; label: string; count: number; meta: T }>,
  width: number,
  height: number
): TreemapNode<T>[] => {
  if (!items || items.length === 0 || width <= 0 || height <= 0) return [];

  const totalRawCount = items.reduce((sum, item) => sum + item.count, 0);

  // Baseline floor (~1.5% of total volume or 1) so zero-count or tiny categories
  // remain visibly partitioned in the rectangle space and clickable.
  const floorWeight = totalRawCount > 0 ? Math.max(1, totalRawCount * 0.018) : 1;

  const rawNodes = items.map((item) => {
    const count = item.count || 0;
    const weight = count > 0 ? count + floorWeight : floorWeight;
    const sharePercent = totalRawCount > 0
      ? Math.round((count / totalRawCount) * 1000) / 10
      : Math.round((1 / items.length) * 1000) / 10;

    return {
      id: item.key,
      key: item.key,
      label: item.label,
      count,
      weight,
      sharePercent,
      meta: item.meta,
      x: 0,
      y: 0,
      w: 0,
      h: 0
    };
  });

  // Sort descending by weight for optimal squarified aspect ratio packing
  rawNodes.sort((a, b) => b.weight - a.weight);

  const totalWeight = rawNodes.reduce((sum, n) => sum + n.weight, 0);
  if (totalWeight <= 0) return [];

  const totalArea = width * height;
  const normalizedNodes = rawNodes.map((n) => ({
    ...n,
    area: (n.weight / totalWeight) * totalArea
  }));

  const worstAspect = (row: typeof normalizedNodes, sideLength: number) => {
    if (row.length === 0) return Infinity;
    const rowArea = row.reduce((sum, n) => sum + n.area, 0);
    const side2 = sideLength * sideLength;
    const area2 = rowArea * rowArea;
    let max = -Infinity;
    for (const node of row) {
      const a = node.area;
      const ratio = Math.max((side2 * a) / area2, area2 / (side2 * a));
      if (ratio > max) max = ratio;
    }
    return max;
  };

  const result: TreemapNode<T>[] = [];

  const layoutRow = (
    row: typeof normalizedNodes,
    container: Rect,
    sideLength: number,
    isVertical: boolean
  ): Rect => {
    const rowArea = row.reduce((sum, n) => sum + n.area, 0);
    const rowThickness = rowArea / sideLength;

    let offset = 0;
    for (const node of row) {
      const nodeLength = node.area / rowThickness;
      if (isVertical) {
        result.push({
          id: node.id,
          key: node.key,
          label: node.label,
          count: node.count,
          sharePercent: node.sharePercent,
          meta: node.meta,
          x: container.x + offset,
          y: container.y,
          w: nodeLength,
          h: rowThickness
        });
      } else {
        result.push({
          id: node.id,
          key: node.key,
          label: node.label,
          count: node.count,
          sharePercent: node.sharePercent,
          meta: node.meta,
          x: container.x,
          y: container.y + offset,
          w: rowThickness,
          h: nodeLength
        });
      }
      offset += nodeLength;
    }

    if (isVertical) {
      return {
        x: container.x,
        y: container.y + rowThickness,
        w: container.w,
        h: Math.max(0, container.h - rowThickness)
      };
    } else {
      return {
        x: container.x + rowThickness,
        y: container.y,
        w: Math.max(0, container.w - rowThickness),
        h: container.h
      };
    }
  };

  let remainingNodes = [...normalizedNodes];
  let currentRect: Rect = { x: 0, y: 0, w: width, h: height };

  while (remainingNodes.length > 0) {
    const isVertical = currentRect.w < currentRect.h;
    const sideLength = isVertical ? currentRect.w : currentRect.h;
    if (sideLength <= 0.01) {
      // Emergency allocation for any remaining items in the remaining rect
      for (const node of remainingNodes) {
        result.push({
          id: node.id,
          key: node.key,
          label: node.label,
          count: node.count,
          sharePercent: node.sharePercent,
          meta: node.meta,
          x: currentRect.x,
          y: currentRect.y,
          w: Math.max(2, currentRect.w),
          h: Math.max(2, currentRect.h)
        });
      }
      break;
    }

    const row: typeof normalizedNodes = [];
    row.push(remainingNodes[0]);
    remainingNodes.shift();

    while (remainingNodes.length > 0) {
      const nextNode = remainingNodes[0];
      const currentWorst = worstAspect(row, sideLength);
      const testWorst = worstAspect([...row, nextNode], sideLength);

      if (testWorst <= currentWorst) {
        row.push(nextNode);
        remainingNodes.shift();
      } else {
        break;
      }
    }

    currentRect = layoutRow(row, currentRect, sideLength, isVertical);
  }

  return result;
};

// Formatted Items for Topic Treemap (All configured topics)
const topicItems = computed(() => {
  return Object.entries(props.topicConfig).map(([key, cfg]) => {
    const translated = t(`types.topics.${key}`);
    const label = translated && translated !== `types.topics.${key}` ? translated : cfg.label;
    const count = props.topicCounts[key] || 0;
    return {
      key,
      label,
      count,
      meta: {
        key,
        label,
        color: cfg.color,
        bg: cfg.bg,
        border: cfg.border,
        icon: TOPIC_ICONS[key] || "🏷️"
      }
    };
  });
});

// Computed Topic Nodes (All topics guaranteed rendered)
const topicTreemapNodes = computed(() => {
  return computeSquarifiedNodes(topicItems.value, topicWidth.value, topicHeight.value);
});

// Formatted Items for Country Treemap (All 12 geopolitical regions)
const countryItems = computed(() => {
  return Object.entries(props.countryConfig).map(([key, cfg]) => {
    const translated = t(`types.countries.${key}`);
    const label = translated && translated !== `types.countries.${key}` ? translated : cfg.label;
    const count = props.countryCounts[key] || 0;
    return {
      key,
      label,
      count,
      meta: {
        key,
        label,
        flag: cfg.flag || "🌐",
        isNew: cfg.isNew
      }
    };
  });
});

// Computed Country Nodes (All regions guaranteed rendered)
const countryTreemapNodes = computed(() => {
  return computeSquarifiedNodes(countryItems.value, countryWidth.value, countryHeight.value);
});

// Toggle Topic Selection
const handleTopicClick = (key: string) => {
  if (props.selectedTopic === key) {
    emit("update:selectedTopic", "all");
  } else {
    emit("update:selectedTopic", key);
  }
};

// Toggle Country Selection
const handleCountryClick = (key: string) => {
  if (props.selectedCountry === key) {
    emit("update:selectedCountry", "all");
  } else {
    emit("update:selectedCountry", key);
  }
};

// Resize observers
const updateDimensions = () => {
  if (topicContainerRef.value) {
    const rect = topicContainerRef.value.getBoundingClientRect();
    if (rect.width > 0) {
      topicWidth.value = Math.floor(rect.width);
      topicHeight.value = rect.width < 640 ? 250 : 200;
    }
  }
  if (countryContainerRef.value) {
    const rect = countryContainerRef.value.getBoundingClientRect();
    if (rect.width > 0) {
      countryWidth.value = Math.floor(rect.width);
      countryHeight.value = rect.width < 640 ? 280 : 230;
    }
  }
};

onMounted(() => {
  nextTick(() => {
    updateDimensions();

    if (topicContainerRef.value && typeof ResizeObserver !== "undefined") {
      topicObserver = new ResizeObserver(() => updateDimensions());
      topicObserver.observe(topicContainerRef.value);
    }

    if (countryContainerRef.value && typeof ResizeObserver !== "undefined") {
      countryObserver = new ResizeObserver(() => updateDimensions());
      countryObserver.observe(countryContainerRef.value);
    }
  });
});

onUnmounted(() => {
  topicObserver?.disconnect();
  countryObserver?.disconnect();
});
</script>

<template>
  <div class="space-y-4 pt-1">
    <!-- SECTION 1: TOPIC DISTRIBUTION TREEMAP -->
    <div class="space-y-2">
      <!-- Section Header with Title & All-Topics Reset Anchor -->
      <div class="flex items-center justify-between flex-wrap gap-2 px-0.5">
        <div class="flex items-center gap-2">
          <span class="text-[10px] font-black uppercase tracking-wider text-indigo-700 dark:text-indigo-300 flex items-center gap-1.5">
            <Layers class="w-3.5 h-3.5 text-indigo-500" />
            <span>{{ t('types.topicDistribution') }}</span>
          </span>
          <span class="text-[11px] font-mono text-gray-400 dark:text-gray-500">
            {{ topicTreemapNodes.length }} {{ t('types.categories') || 'categories' }}
          </span>
        </div>

        <!-- All Topics Reset / Current Active Filter Indicator -->
        <div class="flex items-center gap-1.5">
          <button
            @click="emit('update:selectedTopic', 'all')"
            :class="[
              'px-2.5 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer',
              selectedTopic === 'all'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 border border-gray-200/80 dark:border-gray-700'
            ]"
            :title="t('types.allTopics')"
          >
            <span>{{ t('types.allTopics') }}</span>
            <span
              class="text-[10px] px-1.5 py-0.2 rounded-full font-mono"
              :class="selectedTopic === 'all' ? 'bg-white/20' : 'bg-black/5 dark:bg-white/10'"
            >
              {{ totalChannels.toLocaleString() }}
            </span>
          </button>
        </div>
      </div>

      <!-- Squarified Treemap Surface for Topics -->
      <div
        ref="topicContainerRef"
        class="relative w-full rounded-xl border border-gray-200/90 dark:border-gray-700/80 bg-gray-50/60 dark:bg-gray-900/40 p-1 shadow-inner overflow-hidden select-none"
        :style="{ height: `${topicHeight}px` }"
      >
        <button
          v-for="node in topicTreemapNodes"
          :key="node.id"
          @click="handleTopicClick(node.key)"
          @mouseenter="hoveredTopicKey = node.key"
          @mouseleave="hoveredTopicKey = null"
          :style="{
            left: `${node.x}px`,
            top: `${node.y}px`,
            width: `${Math.max(2, node.w - 2)}px`,
            height: `${Math.max(2, node.h - 2)}px`
          }"
          :class="[
            'absolute m-0.5 rounded-lg border transition-all duration-150 flex flex-col justify-between text-left cursor-pointer overflow-hidden group select-none',
            selectedTopic === node.key
              ? 'bg-indigo-600 text-white border-indigo-700 shadow-md ring-2 ring-indigo-500 ring-offset-1 dark:ring-offset-gray-900 z-10'
              : selectedTopic !== 'all'
                ? `${node.meta.bg} ${node.meta.color} ${node.meta.border} opacity-50 hover:opacity-100 hover:scale-[1.01] hover:z-20`
                : `${node.meta.bg} ${node.meta.color} ${node.meta.border} hover:scale-[1.01] hover:shadow-sm hover:z-20`
          ]"
          :title="`${node.label}: ${node.count.toLocaleString()} channels (${node.sharePercent}%)`"
        >
          <!-- Compact mode for small rectangles -->
          <div v-if="node.h < 55 || node.w < 75" class="p-1 h-full w-full flex flex-col justify-between overflow-hidden">
            <div class="flex items-center justify-between gap-0.5 min-w-0">
              <span class="text-xs shrink-0 leading-none">{{ node.meta.icon }}</span>
              <span
                class="text-[10px] font-bold truncate leading-tight"
                :class="selectedTopic === node.key ? 'text-white' : 'text-gray-900 dark:text-gray-100'"
              >
                {{ node.label }}
              </span>
              <CheckCircle2 v-if="selectedTopic === node.key" class="w-2.5 h-2.5 text-white shrink-0" />
            </div>
            <div class="flex items-baseline justify-between gap-1 text-[10px] font-mono leading-none">
              <span
                class="font-semibold tabular-nums truncate"
                :class="selectedTopic === node.key ? 'text-white/90' : 'text-gray-700 dark:text-gray-300'"
              >
                {{ node.count.toLocaleString() }}
              </span>
              <span class="text-[9px] opacity-75 shrink-0">{{ node.sharePercent }}%</span>
            </div>
          </div>

          <!-- Standard mode for medium/large rectangles -->
          <template v-else>
            <!-- Top Row: Icon + Label + Active Checkmark -->
            <div class="p-2 pb-0 flex items-start justify-between gap-1 w-full min-w-0">
              <div class="flex items-center gap-1.5 min-w-0">
                <span class="text-sm shrink-0 leading-none">{{ node.meta.icon }}</span>
                <span
                  class="font-bold text-xs truncate leading-snug"
                  :class="selectedTopic === node.key ? 'text-white' : 'text-gray-900 dark:text-gray-100'"
                >
                  {{ node.label }}
                </span>
              </div>

              <!-- Active Checkmark Indicator -->
              <CheckCircle2
                v-if="selectedTopic === node.key"
                class="w-3.5 h-3.5 text-white shrink-0 mt-0.5"
              />
            </div>

            <!-- Bottom Row: Count + Percentage Share Badge -->
            <div class="p-2 pt-0 flex items-baseline justify-between gap-1.5 w-full min-w-0">
              <span
                class="font-mono text-xs font-semibold tabular-nums truncate"
                :class="selectedTopic === node.key ? 'text-white/90' : 'text-gray-700 dark:text-gray-300'"
              >
                {{ node.count.toLocaleString() }}
              </span>

              <span
                class="text-[10px] font-mono px-1 py-0.2 rounded font-medium shrink-0"
                :class="selectedTopic === node.key
                  ? 'bg-white/20 text-white'
                  : 'bg-black/5 dark:bg-white/10 text-gray-500 dark:text-gray-400'"
              >
                {{ node.sharePercent }}%
              </span>
            </div>
          </template>
        </button>
      </div>
    </div>

    <!-- SECTION 2: GEOPOLITICAL TARGET REGION DISTRIBUTION TREEMAP -->
    <div class="space-y-2 pt-1 border-t border-gray-100 dark:border-gray-700/60">
      <!-- Section Header with Title & All-Countries Reset Anchor -->
      <div class="flex items-center justify-between flex-wrap gap-2 px-0.5">
        <div class="flex items-center gap-2">
          <span class="text-[10px] font-black uppercase tracking-wider text-cyan-700 dark:text-cyan-300 flex items-center gap-1.5">
            <Globe2 class="w-3.5 h-3.5 text-cyan-500" />
            <span>{{ t('types.regionDistribution') }}</span>
          </span>
          <span class="text-[11px] font-mono text-gray-400 dark:text-gray-500">
            {{ countryTreemapNodes.length }} {{ t('types.regions') || 'spheres' }}
          </span>
        </div>

        <!-- All Regions Reset / Current Active Filter Indicator -->
        <div class="flex items-center gap-1.5">
          <button
            @click="emit('update:selectedCountry', 'all')"
            :class="[
              'px-2.5 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer',
              selectedCountry === 'all'
                ? 'bg-cyan-600 text-white shadow-xs'
                : 'bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 border border-gray-200/80 dark:border-gray-700'
            ]"
            :title="t('types.allCountries')"
          >
            <span>{{ t('types.allCountries') }}</span>
            <span
              class="text-[10px] px-1.5 py-0.2 rounded-full font-mono"
              :class="selectedCountry === 'all' ? 'bg-white/20' : 'bg-black/5 dark:bg-white/10'"
            >
              {{ totalChannels.toLocaleString() }}
            </span>
          </button>
        </div>
      </div>

      <!-- Squarified Treemap Surface for Target Countries -->
      <div
        ref="countryContainerRef"
        class="relative w-full rounded-xl border border-gray-200/90 dark:border-gray-700/80 bg-gray-50/60 dark:bg-gray-900/40 p-1 shadow-inner overflow-hidden select-none"
        :style="{ height: `${countryHeight}px` }"
      >
        <button
          v-for="node in countryTreemapNodes"
          :key="node.id"
          @click="handleCountryClick(node.key)"
          @mouseenter="hoveredCountryKey = node.key"
          @mouseleave="hoveredCountryKey = null"
          :style="{
            left: `${node.x}px`,
            top: `${node.y}px`,
            width: `${Math.max(2, node.w - 2)}px`,
            height: `${Math.max(2, node.h - 2)}px`
          }"
          :class="[
            'absolute m-0.5 rounded-lg border transition-all duration-150 flex flex-col justify-between text-left cursor-pointer overflow-hidden group select-none',
            selectedCountry === node.key
              ? 'bg-cyan-600 text-white border-cyan-700 shadow-md ring-2 ring-cyan-500 ring-offset-1 dark:ring-offset-gray-900 z-10'
              : selectedCountry !== 'all'
                ? 'bg-white/90 dark:bg-gray-800/90 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700/80 opacity-50 hover:opacity-100 hover:scale-[1.01] hover:z-20'
                : node.meta.isNew
                  ? 'bg-cyan-50/90 dark:bg-cyan-950/40 text-cyan-900 dark:text-cyan-200 border-cyan-200 dark:border-cyan-800/70 hover:scale-[1.01] hover:shadow-sm hover:z-20'
                  : 'bg-white/90 dark:bg-gray-800/90 text-gray-800 dark:text-gray-200 border-gray-200 dark:border-gray-700 hover:scale-[1.01] hover:shadow-sm hover:z-20'
          ]"
          :title="`${node.meta.flag} ${node.label}: ${node.count.toLocaleString()} channels (${node.sharePercent}%)`"
        >
          <!-- Compact mode for small rectangles -->
          <div v-if="node.h < 55 || node.w < 75" class="p-1 h-full w-full flex flex-col justify-between overflow-hidden">
            <div class="flex items-center justify-between gap-0.5 min-w-0">
              <span class="text-xs shrink-0 leading-none">{{ node.meta.flag }}</span>
              <span
                class="text-[10px] font-bold truncate leading-tight"
                :class="selectedCountry === node.key ? 'text-white' : 'text-gray-900 dark:text-gray-100'"
              >
                {{ node.label }}
              </span>
              <CheckCircle2 v-if="selectedCountry === node.key" class="w-2.5 h-2.5 text-white shrink-0" />
            </div>
            <div class="flex items-baseline justify-between gap-1 text-[10px] font-mono leading-none">
              <span
                class="font-semibold tabular-nums truncate"
                :class="selectedCountry === node.key ? 'text-white/90' : 'text-gray-700 dark:text-gray-300'"
              >
                {{ node.count.toLocaleString() }}
              </span>
              <span class="text-[9px] opacity-75 shrink-0">{{ node.sharePercent }}%</span>
            </div>
          </div>

          <!-- Standard mode for medium/large rectangles -->
          <template v-else>
            <!-- Top Row: Flag + Label + Badges -->
            <div class="p-2 pb-0 flex items-start justify-between gap-1 w-full min-w-0">
              <div class="flex items-center gap-1.5 min-w-0">
                <span class="text-sm shrink-0 leading-none">{{ node.meta.flag }}</span>
                <span
                  class="font-bold text-xs truncate leading-snug"
                  :class="selectedCountry === node.key ? 'text-white' : 'text-gray-900 dark:text-gray-100'"
                >
                  {{ node.label }}
                </span>
              </div>

              <div class="flex items-center gap-1 shrink-0">
                <!-- New Region Badge -->
                <span
                  v-if="node.meta.isNew && selectedCountry !== node.key"
                  class="text-[9px] uppercase px-1 py-0.2 rounded font-extrabold bg-amber-400/20 text-amber-700 dark:text-amber-300 border border-amber-300/40"
                >
                  {{ t('types.newBadge') }}
                </span>

                <!-- Active Checkmark Indicator -->
                <CheckCircle2
                  v-if="selectedCountry === node.key"
                  class="w-3.5 h-3.5 text-white shrink-0 mt-0.5"
                />
              </div>
            </div>

            <!-- Bottom Row: Count + Percentage Share Badge -->
            <div class="p-2 pt-0 flex items-baseline justify-between gap-1.5 w-full min-w-0">
              <span
                class="font-mono text-xs font-semibold tabular-nums truncate"
                :class="selectedCountry === node.key ? 'text-white/90' : 'text-gray-700 dark:text-gray-300'"
              >
                {{ node.count.toLocaleString() }}
              </span>

              <span
                class="text-[10px] font-mono px-1 py-0.2 rounded font-medium shrink-0"
                :class="selectedCountry === node.key
                  ? 'bg-white/20 text-white'
                  : 'bg-black/5 dark:bg-white/10 text-gray-500 dark:text-gray-400'"
              >
                {{ node.sharePercent }}%
              </span>
            </div>
          </template>
        </button>
      </div>
    </div>
  </div>
</template>
