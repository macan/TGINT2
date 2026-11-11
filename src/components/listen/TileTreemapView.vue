<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from "vue";
import {
  Folder,
  FolderOpen,
  Radio,
  Tag,
  ChevronRight,
  ArrowLeft,
  LayoutGrid,
  Layers,
  Sparkles,
  Search,
  X,
  Clock,
  Compass,
  CornerDownRight,
  RefreshCw,
  ExternalLink,
  Flame,
  CheckCircle2,
  SlidersHorizontal,
  ChevronDown,
} from "lucide-vue-next";
import { useI18n } from "../../i18n";

export interface ListenItem {
  id: string;
  name: string;
  isFolder: boolean;
  create_time: string;
  type?: "channel" | "keyword";
  argument?: string;
  description?: string;
  tags?: string[];
  auto_class?: {
    class: string;
    confidence: number;
  };
  enableHotTopics?: boolean;
  children?: ListenItem[];
  [key: string]: any;
}

export interface TreemapNode {
  item: ListenItem;
  id: string;
  name: string;
  isFolder: boolean;
  type?: "channel" | "keyword";
  leafCount: number;
  sharePercent: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

const props = defineProps<{
  directory: ListenItem[];
  selectedItem: ListenItem | null;
  freshnessMap?: Record<string, { label: string; tier: string; relativeTime: string; timestamp: number }>;
  channelMetadataCache?: Record<string, any>;
  isDark?: boolean;
}>();

const emit = defineEmits<{
  (e: "select-item", item: ListenItem): void;
  (e: "drill-down", folder: ListenItem): void;
}>();

const { t } = useI18n();

// Navigation drilldown stack: array of folder nodes from root to current parent
// root level = empty stack []
const folderPathStack = ref<ListenItem[]>([]);
const treemapContainerRef = ref<HTMLDivElement | null>(null);
const containerWidth = ref<number>(900);
const containerHeight = ref<number>(640);
const searchQuery = ref<string>("");
const hoveredTileId = ref<string | null>(null);

// Get items at current level
const currentLevelItems = computed<ListenItem[]>(() => {
  if (folderPathStack.value.length === 0) {
    return props.directory || [];
  }
  const currentFolder = folderPathStack.value[folderPathStack.value.length - 1];
  return currentFolder.children || [];
});

// Recursive leaf item count calculation
const countLeafItems = (node: ListenItem): number => {
  if (!node.isFolder) return 1;
  if (!node.children || node.children.length === 0) return 0;
  return node.children.reduce((acc, child) => acc + countLeafItems(child), 0);
};

// Total items count at current level (using countLeafItems for folders)
const currentLevelTotalLeaves = computed<number>(() => {
  return currentLevelItems.value.reduce((acc, item) => {
    const count = countLeafItems(item);
    return acc + (count > 0 ? count : 1);
  }, 0);
});

// Filtered items if user uses the quick search input in Tile mode
const displayItems = computed<ListenItem[]>(() => {
  const query = searchQuery.value.trim().toLowerCase();
  if (!query) return currentLevelItems.value;
  return currentLevelItems.value.filter((item) => {
    const matchName = item.name.toLowerCase().includes(query);
    const matchArg = (item.argument || "").toLowerCase().includes(query);
    const matchTag = item.tags?.some((tag) => tag.toLowerCase().includes(query));
    return matchName || matchArg || matchTag;
  });
});

/**
 * High-performance Squarified Treemap Algorithm
 * Produces aspect-ratio optimized rectangles for visually intuitive area representation.
 */
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const computeSquarifiedTreemap = (
  items: ListenItem[],
  width: number,
  height: number
): TreemapNode[] => {
  if (!items || items.length === 0 || width <= 0 || height <= 0) return [];

  // Calculate weights: folders use leaf count (min 1 so empty folders remain visible), items = 1
  const rawNodes = items.map((item) => {
    const leaves = countLeafItems(item);
    const weight = leaves > 0 ? leaves : 1;
    return {
      item,
      id: item.id,
      name: item.name || "Untitled",
      isFolder: !!item.isFolder,
      type: item.type,
      leafCount: leaves,
      weight,
      sharePercent: 0,
      x: 0,
      y: 0,
      w: 0,
      h: 0,
    };
  });

  // Sort descending by weight for optimal squarified packing
  rawNodes.sort((a, b) => b.weight - a.weight);

  const totalWeight = rawNodes.reduce((sum, n) => sum + n.weight, 0);
  if (totalWeight <= 0) return [];

  rawNodes.forEach((n) => {
    n.sharePercent = Math.round((n.weight / totalWeight) * 1000) / 10;
  });

  const totalArea = width * height;
  const normalizedNodes = rawNodes.map((n) => ({
    ...n,
    area: (n.weight / totalWeight) * totalArea,
  }));

  const result: TreemapNode[] = [];

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

  const layoutRow = (
    row: typeof normalizedNodes,
    container: Rect,
    sideLength: number,
    isVertical: boolean
  ) => {
    const rowArea = row.reduce((sum, n) => sum + n.area, 0);
    const rowThickness = rowArea / sideLength;

    let offset = 0;
    for (const node of row) {
      const nodeLength = node.area / rowThickness;
      if (isVertical) {
        result.push({
          item: node.item,
          id: node.id,
          name: node.name,
          isFolder: node.isFolder,
          type: node.type,
          leafCount: node.leafCount,
          sharePercent: node.sharePercent,
          x: container.x + offset,
          y: container.y,
          w: nodeLength,
          h: rowThickness,
        });
      } else {
        result.push({
          item: node.item,
          id: node.id,
          name: node.name,
          isFolder: node.isFolder,
          type: node.type,
          leafCount: node.leafCount,
          sharePercent: node.sharePercent,
          x: container.x,
          y: container.y + offset,
          w: rowThickness,
          h: nodeLength,
        });
      }
      offset += nodeLength;
    }

    if (isVertical) {
      return {
        x: container.x,
        y: container.y + rowThickness,
        w: container.w,
        h: Math.max(0, container.h - rowThickness),
      };
    } else {
      return {
        x: container.x + rowThickness,
        y: container.y,
        w: Math.max(0, container.w - rowThickness),
        h: container.h,
      };
    }
  };

  let remainingNodes = [...normalizedNodes];
  let currentRect: Rect = { x: 0, y: 0, w: width, h: height };

  while (remainingNodes.length > 0) {
    const isVertical = currentRect.w < currentRect.h;
    const sideLength = isVertical ? currentRect.w : currentRect.h;
    if (sideLength <= 0) break;

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

const treemapNodes = computed<TreemapNode[]>(() => {
  return computeSquarifiedTreemap(
    displayItems.value,
    containerWidth.value,
    containerHeight.value
  );
});

// Resize observer to update treemap geometry dynamically
let resizeObserver: ResizeObserver | null = null;
const updateContainerDimensions = () => {
  if (treemapContainerRef.value) {
    const rect = treemapContainerRef.value.getBoundingClientRect();
    if (rect.width > 0) containerWidth.value = Math.floor(rect.width);
    if (rect.height > 0) containerHeight.value = Math.floor(rect.height);
  }
};

onMounted(() => {
  updateContainerDimensions();
  if (typeof ResizeObserver !== "undefined" && treemapContainerRef.value) {
    resizeObserver = new ResizeObserver(() => {
      updateContainerDimensions();
    });
    resizeObserver.observe(treemapContainerRef.value);
  }
  window.addEventListener("resize", updateContainerDimensions);
});

onUnmounted(() => {
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
  window.removeEventListener("resize", updateContainerDimensions);
});

// Navigation actions
const drillIntoFolder = (folder: ListenItem) => {
  folderPathStack.value.push(folder);
  searchQuery.value = "";
  emit("drill-down", folder);
};

const navigateToBreadcrumb = (index: number) => {
  if (index < 0) {
    folderPathStack.value = [];
  } else {
    folderPathStack.value = folderPathStack.value.slice(0, index + 1);
  }
  searchQuery.value = "";
};

const goBackOneLevel = () => {
  if (folderPathStack.value.length > 0) {
    folderPathStack.value.pop();
    searchQuery.value = "";
  }
};

const handleTileClick = (node: TreemapNode) => {
  if (node.isFolder) {
    drillIntoFolder(node.item);
  } else {
    emit("select-item", node.item);
  }
};

const getItemFreshness = (node: TreemapNode) => {
  if (props.freshnessMap && props.freshnessMap[node.id]) {
    return props.freshnessMap[node.id];
  }
  return null;
};
</script>

<template>
  <div class="flex flex-col gap-4 w-full select-none">
    <!-- Header Controls & Breadcrumbs Bar -->
    <div
      class="bg-white dark:bg-gray-800 rounded-3xl border border-gray-200/80 dark:border-gray-700/80 shadow-sm p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-3.5 transition-all"
    >
      <!-- Breadcrumbs Path & Level Title -->
      <div class="flex items-center gap-2 flex-wrap min-w-0">
        <button
          v-if="folderPathStack.length > 0"
          type="button"
          @click="goBackOneLevel"
          class="p-1.5 rounded-xl bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 transition-colors cursor-pointer mr-1 shrink-0"
          title="Back to parent directory"
        >
          <ArrowLeft class="h-4 w-4" />
        </button>

        <div class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gray-50 dark:bg-gray-900/60 border border-gray-200/70 dark:border-gray-700/60 text-xs font-semibold text-gray-700 dark:text-gray-200">
          <Layers class="h-4 w-4 text-teal-600 dark:text-teal-400 shrink-0" />
          <nav class="inline-flex items-center gap-1.5 flex-wrap" aria-label="Directory Breadcrumb">
            <!-- Root Button -->
            <button
              type="button"
              @click="navigateToBreadcrumb(-1)"
              class="inline-flex items-center gap-1 hover:text-teal-600 dark:hover:text-teal-400 transition-colors cursor-pointer font-bold"
              :class="folderPathStack.length === 0 ? 'text-teal-600 dark:text-teal-400' : 'text-gray-500 dark:text-gray-400'"
            >
              <span>{{ t('listen.listenDirectory') || 'Root Directory' }}</span>
            </button>

            <!-- Folder steps -->
            <template v-for="(folder, idx) in folderPathStack" :key="folder.id">
              <ChevronRight class="h-3 w-3 text-gray-300 dark:text-gray-600 shrink-0" />
              <button
                type="button"
                @click="navigateToBreadcrumb(idx)"
                class="inline-flex items-center gap-1 hover:text-teal-600 dark:hover:text-teal-400 transition-colors cursor-pointer font-bold truncate max-w-[140px]"
                :class="idx === folderPathStack.length - 1 ? 'text-teal-600 dark:text-teal-400' : 'text-gray-500 dark:text-gray-400'"
                :title="folder.name"
              >
                <FolderOpen class="h-3.5 w-3.5 text-yellow-500 shrink-0" />
                <span class="truncate">{{ folder.name }}</span>
              </button>
            </template>
          </nav>
        </div>

        <!-- Level Stats Badge -->
        <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs font-bold bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300 border border-teal-200/60 dark:border-teal-800/60 tabular-nums">
          <span>{{ currentLevelItems.length }}</span>
          <span class="font-normal opacity-80">{{ currentLevelItems.length === 1 ? 'tile' : 'tiles' }}</span>
          <span class="text-gray-300 dark:text-gray-600 mx-0.5">·</span>
          <span>{{ currentLevelTotalLeaves }}</span>
          <span class="font-normal opacity-80">items</span>
        </span>
      </div>

      <!-- Quick Filter in Current Level & Legend -->
      <div class="flex items-center gap-2.5 shrink-0">
        <div class="relative w-48 sm:w-56">
          <Search class="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            v-model="searchQuery"
            type="text"
            :placeholder="t('listen.searchDirectory') || 'Filter tiles...'"
            class="w-full pl-8 pr-7 py-1.5 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl text-xs font-medium text-gray-800 dark:text-gray-200 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-teal-500"
          />
          <button
            v-if="searchQuery"
            @click="searchQuery = ''"
            class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-0.5 cursor-pointer"
          >
            <X class="h-3 w-3" />
          </button>
        </div>

        <!-- Mini Legend -->
        <div class="hidden lg:flex items-center gap-2 text-[10px] text-gray-400 dark:text-gray-500 font-semibold px-2">
          <span class="flex items-center gap-1">
            <span class="h-2 w-2 rounded-xs bg-amber-400/80"></span>
            <span>Directory</span>
          </span>
          <span class="flex items-center gap-1">
            <span class="h-2 w-2 rounded-xs bg-teal-500/80"></span>
            <span>Channel</span>
          </span>
          <span class="flex items-center gap-1">
            <span class="h-2 w-2 rounded-xs bg-indigo-500/80"></span>
            <span>Keyword</span>
          </span>
        </div>
      </div>
    </div>

    <!-- Treemap Canvas Rectangle -->
    <div
      ref="treemapContainerRef"
      class="relative w-full h-[620px] sm:h-[680px] lg:h-[740px] xl:h-[780px] bg-gray-900/5 dark:bg-gray-950/60 rounded-3xl border border-gray-200/80 dark:border-gray-800 shadow-inner overflow-hidden p-1.5 transition-all"
    >
      <!-- Empty State -->
      <div
        v-if="treemapNodes.length === 0"
        class="absolute inset-0 flex flex-col items-center justify-center p-6 text-center"
      >
        <LayoutGrid class="h-10 w-10 text-gray-400 dark:text-gray-600 mb-2 stroke-[1.5]" />
        <h4 class="text-sm font-bold text-gray-700 dark:text-gray-300">
          {{ searchQuery ? 'No matching tiles found' : 'Directory is empty' }}
        </h4>
        <p class="text-xs text-gray-400 mt-1 max-w-xs">
          {{ searchQuery ? 'Try adjusting your search filter term.' : 'This directory level contains no sub-folders or listen stream items.' }}
        </p>
      </div>

      <!-- Treemap Tiles -->
      <div
        v-for="node in treemapNodes"
        :key="node.id"
        @click="handleTileClick(node)"
        @mouseenter="hoveredTileId = node.id"
        @mouseleave="hoveredTileId = null"
        :style="{
          left: `${node.x}px`,
          top: `${node.y}px`,
          width: `${node.w}px`,
          height: `${node.h}px`,
        }"
        class="absolute p-1 box-border transition-all duration-200 ease-out group/tile cursor-pointer"
        :title="`${node.name} (${node.isFolder ? node.leafCount + ' items' : (node.type === 'channel' ? 'Telegram Channel' : 'Keyword Stream')}) - Click to ${node.isFolder ? 'drill down' : 'inspect posts'}`"
      >
        <div
          class="w-full h-full rounded-2xl border transition-all duration-200 p-2.5 sm:p-3 flex flex-col justify-between overflow-hidden relative shadow-2xs group-hover/tile:shadow-md"
          :class="[
            // Folder styling
            node.isFolder
              ? 'bg-gradient-to-br from-amber-500/10 via-amber-400/5 to-amber-500/15 dark:from-amber-950/40 dark:via-amber-900/20 dark:to-gray-900 border-amber-300/60 dark:border-amber-700/50 hover:border-amber-400 dark:hover:border-amber-500'
              // Channel stream styling
              : node.type === 'channel'
                ? 'bg-gradient-to-br from-teal-500/10 via-emerald-500/5 to-teal-500/15 dark:from-teal-950/40 dark:via-teal-900/20 dark:to-gray-900 border-teal-300/60 dark:border-teal-700/50 hover:border-teal-400 dark:hover:border-teal-500'
                // Keyword stream styling
                : 'bg-gradient-to-br from-indigo-500/10 via-purple-500/5 to-indigo-500/15 dark:from-indigo-950/40 dark:via-indigo-900/20 dark:to-gray-900 border-indigo-300/60 dark:border-indigo-700/50 hover:border-indigo-400 dark:hover:border-indigo-500',
            // Active selection ring
            props.selectedItem?.id === node.id
              ? 'ring-2 ring-teal-500 dark:ring-teal-400 ring-offset-2 ring-offset-white dark:ring-offset-gray-900 border-teal-500 dark:border-teal-400 z-20'
              : 'z-10',
            // Hover scale micro-interaction
            hoveredTileId === node.id ? 'scale-[1.015] z-30' : ''
          ]"
        >
          <!-- Top Row: Icon + Type Badge + Percentage -->
          <div class="flex items-center justify-between gap-1.5 w-full">
            <div class="flex items-center gap-1.5 min-w-0">
              <!-- Folder Icon -->
              <div
                v-if="node.isFolder"
                class="w-6 h-6 rounded-lg bg-amber-500/20 dark:bg-amber-400/20 flex items-center justify-center text-amber-600 dark:text-amber-400 shrink-0"
              >
                <Folder class="h-3.5 w-3.5 fill-amber-500/30 text-amber-600 dark:text-amber-400" />
              </div>
              <!-- Channel Icon -->
              <div
                v-else-if="node.type === 'channel'"
                class="w-6 h-6 rounded-lg bg-teal-500/20 dark:bg-teal-400/20 flex items-center justify-center text-teal-600 dark:text-teal-400 shrink-0"
              >
                <Radio class="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" />
              </div>
              <!-- Keyword Icon -->
              <div
                v-else
                class="w-6 h-6 rounded-lg bg-indigo-500/20 dark:bg-indigo-400/20 flex items-center justify-center text-indigo-600 dark:text-indigo-400 shrink-0"
              >
                <Tag class="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
              </div>

              <!-- Type / Action Label -->
              <span
                class="text-[10px] font-bold uppercase tracking-wider truncate"
                :class="[
                  node.isFolder
                    ? 'text-amber-700 dark:text-amber-300'
                    : node.type === 'channel'
                      ? 'text-teal-700 dark:text-teal-300'
                      : 'text-indigo-700 dark:text-indigo-300'
                ]"
              >
                {{ node.isFolder ? 'Folder' : (node.type === 'channel' ? 'Channel' : 'Keyword') }}
              </span>
            </div>

            <!-- Share Percentage Badge -->
            <span
              v-if="node.w > 65 && node.h > 45"
              class="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-white/70 dark:bg-gray-800/70 border border-gray-200/60 dark:border-gray-700/60 text-gray-600 dark:text-gray-300 tabular-nums shrink-0"
            >
              {{ node.sharePercent }}%
            </span>
          </div>

          <!-- Middle: Name & Argument/Preview -->
          <div class="my-auto py-1 min-w-0">
            <h3
              class="font-extrabold leading-tight tracking-tight truncate text-gray-900 dark:text-white"
              :class="[
                node.w > 200 && node.h > 120 ? 'text-base sm:text-lg' :
                node.w > 120 && node.h > 80 ? 'text-sm' : 'text-xs'
              ]"
            >
              {{ node.name }}
            </h3>

            <!-- Secondary argument (channel handle or keywords) if space permits -->
            <p
              v-if="!node.isFolder && node.item.argument && node.w > 130 && node.h > 75"
              class="text-[11px] font-mono text-gray-500 dark:text-gray-400 truncate mt-0.5"
            >
              {{ node.type === 'channel' ? `@${node.item.argument.replace('@', '')}` : node.item.argument }}
            </p>

            <!-- Folder items count headline if space permits -->
            <p
              v-else-if="node.isFolder && node.w > 130 && node.h > 75"
              class="text-[11px] font-medium text-amber-700/80 dark:text-amber-300/80 truncate mt-0.5"
            >
              Contains {{ node.leafCount }} {{ node.leafCount === 1 ? 'stream' : 'streams' }}
            </p>
          </div>

          <!-- Bottom: Action prompt / Freshness / Leaf Count -->
          <div
            v-if="node.h > 60"
            class="flex items-center justify-between text-[10px] font-medium pt-1 border-t border-black/5 dark:border-white/5 w-full"
          >
            <!-- Left: Interaction hint -->
            <span
              class="flex items-center gap-1 truncate font-semibold"
              :class="[
                node.isFolder
                  ? 'text-amber-700 dark:text-amber-300'
                  : 'text-teal-700 dark:text-teal-300'
              ]"
            >
              <CornerDownRight v-if="node.isFolder" class="h-3 w-3 shrink-0" />
              <Radio v-else class="h-3 w-3 shrink-0" />
              <span class="truncate">{{ node.isFolder ? 'Click to open' : 'View posts feed' }}</span>
            </span>

            <!-- Right: Item count or Freshness -->
            <div class="flex items-center gap-1 shrink-0 font-mono">
              <span
                v-if="node.isFolder"
                class="px-1.5 py-0.5 rounded bg-amber-500/15 dark:bg-amber-400/15 font-bold text-amber-800 dark:text-amber-200"
              >
                {{ node.leafCount }} items
              </span>
              <span
                v-else-if="getItemFreshness(node)"
                class="px-1.5 py-0.5 rounded font-bold"
                :class="[
                  getItemFreshness(node)?.tier === '<24h' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300' :
                  getItemFreshness(node)?.tier === '1-3d' ? 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300' :
                  getItemFreshness(node)?.tier === '3-7d' ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300' :
                  'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
                ]"
              >
                {{ getItemFreshness(node)?.relativeTime || getItemFreshness(node)?.label }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
