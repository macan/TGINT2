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
  AlertCircle,
  ArrowUpDown,
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
} from "lucide-vue-next";
import { useI18n } from "../../i18n";
import DateRangePicker from "./DateRangePicker.vue";
import {
  type ListenDateRangeValue,
  DEFAULT_LISTEN_DATE_RANGE,
  loadSavedListenDateRange,
  isListenDateRangeActive,
  getListenDateRangeBounds,
  isTimestampInListenDateRange,
} from "../../utils/listenDateRange";

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
  orderIndex?: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TileFreshnessEntry {
  label?: string;
  tier?: string;
  level?: string;
  relativeTime: string;
  timestamp: number;
  formattedDate?: string;
}

const props = defineProps<{
  directory: ListenItem[];
  selectedItem: ListenItem | null;
  freshnessMap?: Record<string, TileFreshnessEntry>;
  folderFreshnessMap?: Record<string, TileFreshnessEntry>;
  channelMetadataCache?: Record<string, any>;
  isDark?: boolean;
  newPostsCountMap?: Record<string, number>;
  folderNewPostsMap?: Record<string, number>;
  activeSyncItemIds?: Record<string, boolean>;
  activeSyncItemId?: string | null;
  totalNewlyFetchedCount?: number;
  itemErrorsMap?: Record<string, { title: string; message: string; category: string; httpStatus?: number }>;
  folderErrorsMap?: Record<string, number>;
  dateRange?: ListenDateRangeValue;
}>();

const emit = defineEmits<{
  (e: "select-item", item: ListenItem): void;
  (e: "drill-down", folder: ListenItem): void;
  (e: "clear-all-new-badges"): void;
  (e: "update:date-range", value: ListenDateRangeValue): void;
}>();

const { t } = useI18n();

const getNodeNewPostsCount = (node: TreemapNode): number => {
  if (node.isFolder) {
    return props.folderNewPostsMap?.[node.id] ?? props.newPostsCountMap?.[node.id] ?? 0;
  }
  return props.newPostsCountMap?.[node.id] ?? 0;
};

const getNodeFetchError = (node: TreemapNode) => {
  if (node.isFolder) return null;
  return props.itemErrorsMap?.[node.id] || null;
};

const getFolderErrorCount = (node: TreemapNode): number => {
  if (!node.isFolder) return 0;
  return props.folderErrorsMap?.[node.id] ?? 0;
};

const isNodeSyncing = (node: TreemapNode): boolean => {
  return (
    props.activeSyncItemId === node.id ||
    !!props.activeSyncItemIds?.[node.id]
  );
};

const getRecursiveFolderFreshness = (item: ListenItem): TileFreshnessEntry | null => {
  if (!item.isFolder) {
    return props.freshnessMap?.[item.id] || null;
  }
  if (props.folderFreshnessMap?.[item.id]) {
    return props.folderFreshnessMap[item.id];
  }
  if (!item.children || item.children.length === 0) return null;
  let newest: TileFreshnessEntry | null = null;
  for (const child of item.children) {
    const childFreshness = getRecursiveFolderFreshness(child);
    if (childFreshness && childFreshness.timestamp > 0) {
      if (!newest || childFreshness.timestamp > newest.timestamp) {
        newest = childFreshness;
      }
    }
  }
  return newest;
};

const getEffectiveFreshnessForItem = (item: ListenItem): TileFreshnessEntry | null => {
  if (item.isFolder) {
    return getRecursiveFolderFreshness(item);
  }
  return props.freshnessMap?.[item.id] || null;
};

const getTileTitle = (node: TreemapNode): string => {
  const newCount = getNodeNewPostsCount(node);
  const newCountNotice = newCount > 0 ? `\n🔥 ${t('listen.hasNewPostsTip', { count: newCount })}` : '';
  const itemErr = getNodeFetchError(node);
  const folderErrCount = getFolderErrorCount(node);
  const errorNotice = itemErr
    ? `\n⚠ ${itemErr.title}: ${itemErr.message}`
    : (folderErrCount > 0 ? `\n⚠ ${t('listen.fetchErrors.folderErrorsTip', { count: folderErrCount })}` : '');
  const freshness = getEffectiveFreshnessForItem(node.item);
  const freshnessNotice = freshness
    ? `\n🕒 ${t('listen.newestPost') || 'Latest post'}: ${freshness.formattedDate || freshness.relativeTime}`
    : '';
  const typeLabel = node.isFolder ? `${node.leafCount} items` : (node.type === 'channel' ? 'Telegram Channel' : 'Keyword Stream');
  const actionLabel = node.isFolder ? 'Click to drill down' : 'Click to inspect posts';
  return `${node.name} (${typeLabel})${freshnessNotice}${newCountNotice}${errorNotice}\n${actionLabel}`;
};

// Navigation drilldown stack: array of folder nodes from root to current parent
// root level = empty stack []
const folderPathStack = ref<ListenItem[]>([]);
const treemapContainerRef = ref<HTMLDivElement | null>(null);
const containerWidth = ref<number>(900);
const containerHeight = ref<number>(640);
const searchQuery = ref<string>("");
const hoveredTileId = ref<string | null>(null);

// Sort state for Tile mode: default (size-packed treemap) | date-desc (newest first) | date-asc (oldest first)
type TileSortOrder = "default" | "date-desc" | "date-asc";
const TILE_SORT_STORAGE_KEY = "listen_tile_sort_order";
const getInitialTileSortOrder = (): TileSortOrder => {
  try {
    const saved = localStorage.getItem(TILE_SORT_STORAGE_KEY);
    if (saved === "date-desc" || saved === "date-asc" || saved === "default") {
      return saved;
    }
  } catch {
    // Ignore storage read errors
  }
  return "default";
};
const tileSortOrder = ref<TileSortOrder>(getInitialTileSortOrder());
watch(tileSortOrder, (val) => {
  try {
    localStorage.setItem(TILE_SORT_STORAGE_KEY, val);
  } catch {
    // Ignore storage write errors
  }
});

const toggleTileDateSort = () => {
  if (tileSortOrder.value === "default") {
    tileSortOrder.value = "date-desc";
  } else if (tileSortOrder.value === "date-desc") {
    tileSortOrder.value = "date-asc";
  } else {
    tileSortOrder.value = "date-desc";
  }
};

const resetTileSortOrder = () => {
  tileSortOrder.value = "default";
};

// Item type priority for tie-breaking when timestamps are equal or absent: Directory -> Channel -> Keyword
const getItemTypeRank = (item: ListenItem): number => {
  if (item.isFolder) return 0;
  if (item.type === "channel") return 1;
  return 2;
};

const getEffectivePostTimestamp = (item: ListenItem): number => {
  const f = getEffectiveFreshnessForItem(item);
  return f && typeof f.timestamp === "number" && f.timestamp > 0 ? f.timestamp : 0;
};

const internalDateRange = ref<ListenDateRangeValue>(loadSavedListenDateRange());
const activeDateRange = computed<ListenDateRangeValue>(() => props.dateRange ?? internalDateRange.value);
const isDateRangeActive = computed<boolean>(() => isListenDateRangeActive(activeDateRange.value));

const onUpdateDateRange = (nextVal: ListenDateRangeValue) => {
  internalDateRange.value = nextVal;
  try {
    localStorage.setItem("listen_date_range_filter", JSON.stringify(nextVal));
  } catch {
    // Ignore storage write errors
  }
  emit("update:date-range", nextVal);
};

const clearAllTileFilters = () => {
  searchQuery.value = "";
  onUpdateDateRange({ ...DEFAULT_LISTEN_DATE_RANGE });
};

const activeDateBounds = computed(() => {
  if (!isDateRangeActive.value) return { startMs: null, endMs: null };
  return getListenDateRangeBounds(activeDateRange.value);
});

const itemMatchesDateRange = (item: ListenItem): boolean => {
  if (!isDateRangeActive.value) return true;
  if (!item.isFolder) {
    const ts = props.freshnessMap?.[item.id]?.timestamp || 0;
    return isTimestampInListenDateRange(ts, activeDateBounds.value);
  }
  if (!item.children || item.children.length === 0) return false;
  return item.children.some((child) => itemMatchesDateRange(child));
};

// Get items at current level
const currentLevelItems = computed<ListenItem[]>(() => {
  if (folderPathStack.value.length === 0) {
    return props.directory || [];
  }
  const currentFolder = folderPathStack.value[folderPathStack.value.length - 1];
  return currentFolder.children || [];
});

// Recursive leaf item count calculation (respects active date range filter when enabled)
const countLeafItems = (node: ListenItem): number => {
  if (!node.isFolder) {
    return itemMatchesDateRange(node) ? 1 : 0;
  }
  if (!node.children || node.children.length === 0) return 0;
  return node.children.reduce((acc, child) => acc + countLeafItems(child), 0);
};

// Total items count at current level (using countLeafItems for folders)
const currentLevelTotalLeaves = computed<number>(() => {
  return displayItems.value.reduce((acc, item) => {
    const count = countLeafItems(item);
    return acc + (count > 0 ? count : 1);
  }, 0);
});

// Filtered (by search query + date range) & optionally date-sorted items for Tile mode
const displayItems = computed<ListenItem[]>(() => {
  const query = searchQuery.value.trim().toLowerCase();
  const filtered = currentLevelItems.value.filter((item) => {
    if (isDateRangeActive.value && !itemMatchesDateRange(item)) {
      return false;
    }
    if (!query) return true;
    const matchName = item.name.toLowerCase().includes(query);
    const matchArg = (item.argument || "").toLowerCase().includes(query);
    const matchTag = item.tags?.some((tag) => tag.toLowerCase().includes(query));
    return matchName || matchArg || matchTag;
  });

  if (tileSortOrder.value === "default" || filtered.length <= 1) {
    return filtered;
  }

  const order = tileSortOrder.value;
  return filtered.sort((a, b) => {
    const tsA = getEffectivePostTimestamp(a);
    const tsB = getEffectivePostTimestamp(b);
    const hasA = tsA > 0;
    const hasB = tsB > 0;

    // Items with known post timestamps always appear ahead of uncached/empty items
    if (hasA !== hasB) {
      return hasA ? -1 : 1;
    }

    if (hasA && hasB && tsA !== tsB) {
      return order === "date-desc" ? tsB - tsA : tsA - tsB;
    }

    // Tie-break across item types: Directory -> Channel -> Keyword
    const rankDiff = getItemTypeRank(a) - getItemTypeRank(b);
    if (rankDiff !== 0) {
      return rankDiff;
    }

    // Secondary tie-break by item create_time in the requested direction
    const createdA = a.create_time ? new Date(a.create_time).getTime() || 0 : 0;
    const createdB = b.create_time ? new Date(b.create_time).getTime() || 0 : 0;
    if (createdA !== createdB) {
      return order === "date-desc" ? createdB - createdA : createdA - createdB;
    }

    return (a.name || "").localeCompare(b.name || "");
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

/**
 * Ordered Proportional Treemap Algorithm
 * Preserves exact chronological item ordering (left-to-right, top-to-bottom)
 * while maintaining proportional tile area via weight-balanced binary space partitioning.
 */
const computeOrderedTreemap = (
  items: ListenItem[],
  width: number,
  height: number
): TreemapNode[] => {
  if (!items || items.length === 0 || width <= 0 || height <= 0) return [];

  const rawNodes = items.map((item, idx) => {
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
      orderIndex: idx + 1,
    };
  });

  const totalWeight = rawNodes.reduce((sum, n) => sum + n.weight, 0);
  if (totalWeight <= 0) return [];

  rawNodes.forEach((n) => {
    n.sharePercent = Math.round((n.weight / totalWeight) * 1000) / 10;
  });

  const result: TreemapNode[] = [];

  const partition = (slice: typeof rawNodes, rect: Rect, sliceWeight: number) => {
    if (slice.length === 0 || rect.w <= 0 || rect.h <= 0 || sliceWeight <= 0) return;

    if (slice.length === 1) {
      const n = slice[0];
      result.push({
        item: n.item,
        id: n.id,
        name: n.name,
        isFolder: n.isFolder,
        type: n.type,
        leafCount: n.leafCount,
        sharePercent: n.sharePercent,
        orderIndex: n.orderIndex,
        x: rect.x,
        y: rect.y,
        w: rect.w,
        h: rect.h,
      });
      return;
    }

    if (slice.length <= 3) {
      const horizontal = rect.w >= rect.h;
      let offset = 0;
      for (const n of slice) {
        const frac = n.weight / sliceWeight;
        if (horizontal) {
          const nw = rect.w * frac;
          result.push({
            item: n.item,
            id: n.id,
            name: n.name,
            isFolder: n.isFolder,
            type: n.type,
            leafCount: n.leafCount,
            sharePercent: n.sharePercent,
            orderIndex: n.orderIndex,
            x: rect.x + offset,
            y: rect.y,
            w: nw,
            h: rect.h,
          });
          offset += nw;
        } else {
          const nh = rect.h * frac;
          result.push({
            item: n.item,
            id: n.id,
            name: n.name,
            isFolder: n.isFolder,
            type: n.type,
            leafCount: n.leafCount,
            sharePercent: n.sharePercent,
            orderIndex: n.orderIndex,
            x: rect.x,
            y: rect.y + offset,
            w: rect.w,
            h: nh,
          });
          offset += nh;
        }
      }
      return;
    }

    // Choose split index k (1..n-1) that best balances weight between first & second halves
    const halfWeight = sliceWeight / 2;
    let bestSplit = 1;
    let bestDiff = Infinity;
    let runningWeight = 0;
    let bestLeftWeight = slice[0].weight;

    for (let i = 0; i < slice.length - 1; i++) {
      runningWeight += slice[i].weight;
      const diff = Math.abs(runningWeight - halfWeight);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestSplit = i + 1;
        bestLeftWeight = runningWeight;
      }
    }

    const leftSlice = slice.slice(0, bestSplit);
    const rightSlice = slice.slice(bestSplit);
    const rightWeight = sliceWeight - bestLeftWeight;
    const leftRatio = bestLeftWeight / sliceWeight;

    if (rect.w >= rect.h) {
      const leftW = rect.w * leftRatio;
      partition(leftSlice, { x: rect.x, y: rect.y, w: leftW, h: rect.h }, bestLeftWeight);
      partition(rightSlice, { x: rect.x + leftW, y: rect.y, w: Math.max(0, rect.w - leftW), h: rect.h }, rightWeight);
    } else {
      const topH = rect.h * leftRatio;
      partition(leftSlice, { x: rect.x, y: rect.y, w: rect.w, h: topH }, bestLeftWeight);
      partition(rightSlice, { x: rect.x, y: rect.y + topH, w: rect.w, h: Math.max(0, rect.h - topH) }, rightWeight);
    }
  };

  partition(rawNodes, { x: 0, y: 0, w: width, h: height }, totalWeight);
  return result;
};

const treemapNodes = computed<TreemapNode[]>(() => {
  if (tileSortOrder.value !== "default") {
    return computeOrderedTreemap(
      displayItems.value,
      containerWidth.value,
      containerHeight.value
    );
  }
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
  return getEffectiveFreshnessForItem(node.item);
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
          <span>{{ displayItems.length }}</span>
          <span class="font-normal opacity-80">{{ displayItems.length === 1 ? 'tile' : 'tiles' }}</span>
          <span class="text-gray-300 dark:text-gray-600 mx-0.5">·</span>
          <span>{{ currentLevelTotalLeaves }}</span>
          <span class="font-normal opacity-80">items</span>
        </span>
      </div>

      <!-- Quick Sort, Filter in Current Level & Legend -->
      <div class="flex items-center gap-2.5 shrink-0 flex-wrap">
        <!-- Clear unread new badges button if any new posts are highlighted (matches View Mode) -->
        <button
          v-if="(props.totalNewlyFetchedCount || 0) > 0"
          type="button"
          @click="emit('clear-all-new-badges')"
          class="px-2.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:hover:bg-emerald-900/40 border border-emerald-300/80 dark:border-emerald-700/60 rounded-xl text-xs font-bold text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5 transition-all shadow-2xs cursor-pointer select-none shrink-0"
          :title="t('listen.clearNewBadges')"
        >
          <Sparkles class="h-3 w-3 text-emerald-500 animate-pulse" />
          <span class="font-mono tabular-nums">+{{ props.totalNewlyFetchedCount }}</span>
          <span class="text-[10px] uppercase font-bold hidden sm:inline">{{ t('listen.clearNewBadges') || 'Clear' }}</span>
          <X class="h-3 w-3 opacity-60 hover:opacity-100" />
        </button>

        <!-- Date ASC / DESC Sort Button (directly before Search input) -->
        <div
          class="inline-flex items-center rounded-xl border transition-all shadow-2xs shrink-0 overflow-hidden"
          :class="[
            tileSortOrder === 'date-desc'
              ? 'bg-teal-50 dark:bg-teal-950/60 border-teal-300 dark:border-teal-700 text-teal-700 dark:text-teal-300'
              : tileSortOrder === 'date-asc'
                ? 'bg-amber-50 dark:bg-amber-950/60 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300'
                : 'bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300'
          ]"
        >
          <button
            type="button"
            @click="toggleTileDateSort"
            class="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-bold transition-colors cursor-pointer hover:bg-black/5 dark:hover:bg-white/5"
            :title="
              tileSortOrder === 'date-desc'
                ? (t('listen.tileSortTooltipDesc') || 'Sorted by latest post date (newest first). Click for oldest first.')
                : tileSortOrder === 'date-asc'
                  ? (t('listen.tileSortTooltipAsc') || 'Sorted by latest post date (oldest first). Click for newest first.')
                  : (t('listen.tileSortTooltipDefault') || 'Sort tiles by latest post date (click for newest first)')
            "
          >
            <ArrowDownWideNarrow v-if="tileSortOrder === 'date-desc'" class="h-3.5 w-3.5 shrink-0" />
            <ArrowUpNarrowWide v-else-if="tileSortOrder === 'date-asc'" class="h-3.5 w-3.5 shrink-0" />
            <ArrowUpDown v-else class="h-3.5 w-3.5 shrink-0 text-gray-400" />
            <span class="whitespace-nowrap">
              {{
                tileSortOrder === 'date-desc'
                  ? (t('listen.tileSortDateDesc') || 'Date DSC')
                  : tileSortOrder === 'date-asc'
                    ? (t('listen.tileSortDateAsc') || 'Date ASC')
                    : (t('listen.tileSortDefault') || 'Date Sort')
              }}
            </span>
          </button>
          <button
            v-if="tileSortOrder !== 'default'"
            type="button"
            @click.stop="resetTileSortOrder"
            class="px-1.5 py-1.5 border-l border-current/15 hover:bg-black/10 dark:hover:bg-white/10 transition-colors cursor-pointer flex items-center justify-center"
            :title="t('listen.tileSortReset') || 'Reset to default size layout'"
          >
            <X class="h-3 w-3 opacity-75" />
          </button>
        </div>

        <!-- Date Range Picker Component (directly next to Sort button) -->
        <DateRangePicker
          :model-value="activeDateRange"
          @update:model-value="onUpdateDateRange"
          align="right"
        />

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
          {{ (searchQuery || isDateRangeActive) ? 'No matching tiles found' : 'Directory is empty' }}
        </h4>
        <p class="text-xs text-gray-400 mt-1 max-w-xs">
          {{ (searchQuery || isDateRangeActive) ? 'Try adjusting your search filter or selected time range.' : 'This directory level contains no sub-folders or listen stream items.' }}
        </p>
        <button
          v-if="searchQuery || isDateRangeActive"
          type="button"
          @click="clearAllTileFilters"
          class="mt-3 px-3 py-1.5 rounded-xl text-xs font-bold bg-indigo-50 dark:bg-indigo-950/50 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/60 transition-colors cursor-pointer"
        >
          {{ t('listen.dateRange.reset') || 'Reset' }}
        </button>
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
        :title="getTileTitle(node)"
      >
        <div
          class="w-full h-full rounded-2xl border transition-all duration-200 p-2.5 sm:p-3 flex flex-col justify-between overflow-hidden relative shadow-2xs group-hover/tile:shadow-md"
          :class="[
            // Has newly fetched posts: prominent emerald glow highlight matching View mode
            getNodeNewPostsCount(node) > 0
              ? 'ring-2 ring-emerald-500/80 border-emerald-400 dark:border-emerald-500 bg-gradient-to-br from-emerald-500/20 via-teal-500/10 to-emerald-500/15 dark:from-emerald-950/50 dark:via-emerald-900/30 dark:to-gray-900 text-emerald-950 dark:text-emerald-100 shadow-sm shadow-emerald-500/20'
              // Folder styling
              : node.isFolder
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
          <!-- Top Row: Icon + Type Badge + Badges & Percentage -->
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

              <!-- Chronological sequence rank badge when Date Sort is active -->
              <span
                v-if="tileSortOrder !== 'default' && node.orderIndex && node.w > 70 && node.h > 42"
                class="font-mono text-[9px] font-black px-1 py-0.2 rounded bg-black/5 dark:bg-white/10 text-gray-600 dark:text-gray-300 tabular-nums shrink-0"
              >
                #{{ node.orderIndex }}
              </span>
            </div>

            <!-- Top Right Badges: Active Syncing Indicator & Newly Fetched Posts Badge & Share Percent -->
            <div class="flex items-center gap-1 shrink-0">
              <!-- Active Background Syncing Indicator on Tile -->
              <span
                v-if="isNodeSyncing(node)"
                class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-teal-50 dark:bg-teal-950/80 text-teal-700 dark:text-teal-300 border border-teal-300/90 dark:border-teal-700/80 shrink-0 select-none animate-pulse shadow-2xs"
                title="Syncing latest posts in background..."
              >
                <RefreshCw class="h-2.5 w-2.5 animate-spin text-teal-600 dark:text-teal-400" />
                <span v-if="node.w > 130" class="font-mono uppercase text-[8px] tracking-wider">Sync</span>
              </span>

              <!-- Granular Fetch Error Indicator on Tile -->
              <span
                v-if="!isNodeSyncing(node) && (getNodeFetchError(node) || getFolderErrorCount(node) > 0)"
                class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-rose-500/15 dark:bg-rose-950/80 text-rose-700 dark:text-rose-300 border border-rose-400/70 dark:border-rose-700/80 shrink-0 select-none shadow-2xs"
                :title="getNodeFetchError(node) ? `${getNodeFetchError(node)!.title}: ${getNodeFetchError(node)!.message}` : t('listen.fetchErrors.folderErrorsTip', { count: getFolderErrorCount(node) })"
              >
                <AlertCircle class="h-2.5 w-2.5 text-rose-600 dark:text-rose-400 shrink-0" />
                <span v-if="node.isFolder" class="font-mono tabular-nums">{{ getFolderErrorCount(node) }}</span>
                <span v-else-if="node.w > 130 && getNodeFetchError(node)?.httpStatus" class="font-mono text-[8px]">{{ getNodeFetchError(node)!.httpStatus }}</span>
              </span>

              <!-- Newly Fetched Posts Visual Indicator Badge (Identical to View Mode Sparkles Badge) -->
              <span
                v-if="getNodeNewPostsCount(node) > 0"
                class="px-1.5 py-0.5 rounded-full text-[9px] sm:text-[10px] font-black tracking-tight bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-xs shadow-emerald-500/50 flex items-center gap-1 shrink-0 select-none animate-bounce border border-emerald-300/40 z-20"
                :title="t('listen.hasNewPostsTip', { count: getNodeNewPostsCount(node) })"
              >
                <Sparkles class="h-2.5 w-2.5 sm:h-3 sm:w-3 text-emerald-100 shrink-0" />
                <span class="whitespace-nowrap font-mono tabular-nums">+{{ getNodeNewPostsCount(node) }}</span>
              </span>

              <!-- Share Percentage Badge -->
              <span
                v-if="node.w > 65 && node.h > 45"
                class="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-white/70 dark:bg-gray-800/70 border border-gray-200/60 dark:border-gray-700/60 text-gray-600 dark:text-gray-300 tabular-nums shrink-0"
              >
                {{ node.sharePercent }}%
              </span>
            </div>
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
            <!-- Left: Interaction hint, New posts notification, or Fetch Error -->
            <span
              v-if="getNodeNewPostsCount(node) > 0"
              class="flex items-center gap-1 truncate font-bold text-emerald-700 dark:text-emerald-300"
            >
              <Sparkles class="h-3 w-3 shrink-0 text-emerald-500 animate-pulse" />
              <span class="truncate">{{ t('listen.hasNewPostsTip', { count: getNodeNewPostsCount(node) }) }}</span>
            </span>
            <span
              v-else-if="getNodeFetchError(node)"
              class="flex items-center gap-1 truncate font-bold text-rose-700 dark:text-rose-300"
              :title="getNodeFetchError(node)!.message"
            >
              <AlertCircle class="h-3 w-3 shrink-0 text-rose-500" />
              <span class="truncate">{{ getNodeFetchError(node)!.title }}</span>
            </span>
            <span
              v-else
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

            <!-- Right: Item count & Folder/Item Freshness -->
            <div class="flex items-center gap-1 shrink-0 font-mono">
              <span
                v-if="node.isFolder"
                class="px-1.5 py-0.5 rounded bg-amber-500/15 dark:bg-amber-400/15 font-bold text-amber-800 dark:text-amber-200"
              >
                {{ node.leafCount }} items
              </span>
              <span
                v-if="getItemFreshness(node) && (!node.isFolder || node.w > 110)"
                class="px-1.5 py-0.5 rounded font-bold"
                :class="[
                  (getItemFreshness(node) as any)?.level === 'today' || getItemFreshness(node)?.tier === '<24h' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300' :
                  (getItemFreshness(node) as any)?.level === 'recent' || getItemFreshness(node)?.tier === '1-3d' ? 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300' :
                  (getItemFreshness(node) as any)?.level === 'week' || getItemFreshness(node)?.tier === '3-7d' ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300' :
                  'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
                ]"
                :title="getItemFreshness(node)?.formattedDate || getItemFreshness(node)?.relativeTime"
              >
                {{ getItemFreshness(node)?.relativeTime || (getItemFreshness(node) as any)?.label }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
