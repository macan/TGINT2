<script setup lang="ts">
import {
  ref,
  computed,
  watch,
  onMounted,
  onBeforeUnmount,
  nextTick,
  type ComponentPublicInstance
} from 'vue';
import PostItemView from './PostItemView.vue';

const ITEM_GAP = 16;

const props = withDefaults(
  defineProps<{
    posts: any[];
    compact?: boolean;
    isDark?: boolean;
    showRank?: boolean;
    estimatedItemHeight?: number;
    bufferCount?: number;
    scrollContainer?: HTMLElement | null;
  }>(),
  {
    compact: false,
    isDark: false,
    showRank: false,
    estimatedItemHeight: 280,
    bufferCount: 5,
    scrollContainer: null
  }
);

const emit = defineEmits<{
  (e: 'open-lightbox', url: string): void;
  (e: 'add-to-workspace', post: any): void;
  (e: 'share-post', post: any): void;
  (e: 'jump-to-channel', channelUsername: string, postKey?: string): void;
  (e: 'click-post', post: any): void;
}>();

const rootContainerRef = ref<HTMLElement | null>(null);
const scrollTop = ref<number>(0);
const viewportHeight = ref<number>(800);
const isWindowScroll = ref<boolean>(false);

// True rendered outer heights keyed by stable unique item key
const itemHeights = ref<Record<string, number>>({});

// Track mounted DOM wrappers so initial render elements are observed as soon as ResizeObserver exists
const mountedElements = new Map<string, HTMLElement>();
const pendingHeights = new Map<string, number>();

let resizeObserver: ResizeObserver | null = null;
let containerResizeObserver: ResizeObserver | null = null;
let resizeRafId: number | null = null;
let scrollListenerTarget: HTMLElement | Window | null = null;
let rafId: number | null = null;

// Build collision-free keys while preserving height cache across re-sorts
const itemKeys = computed<string[]>(() => {
  const posts = props.posts || [];
  const seen = new Map<string, number>();
  return posts.map((post, idx) => {
    let base: string;
    if (post?.key != null && String(post.key).trim() !== '') {
      base = String(post.key);
    } else if (post?.channelId != null && post?.id != null) {
      base = `${String(post.channelId)}:${String(post.id)}`;
    } else if (post?.id != null) {
      base = String(post.id);
    } else {
      base = `idx_${idx}`;
    }
    const count = seen.get(base) || 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}__${count}`;
  });
});

// Cumulative item offsets and total virtual height
const positions = computed(() => {
  const posts = props.posts || [];
  const keys = itemKeys.value;
  const heights = itemHeights.value;
  const defaultHeight = props.estimatedItemHeight;
  const pos: { top: number; height: number }[] = new Array(posts.length);

  let currentTop = 0;
  for (let i = 0; i < posts.length; i++) {
    const key = keys[i];
    const h = heights[key] || defaultHeight;
    pos[i] = { top: currentTop, height: h };
    currentTop += h + ITEM_GAP;
  }

  return {
    items: pos,
    totalHeight: posts.length > 0 ? Math.max(0, currentTop - ITEM_GAP) : 0
  };
});

// Binary search for visible start index based on relative scroll offset
const startIndex = computed(() => {
  const items = positions.value.items;
  if (items.length === 0) return 0;

  const targetTop = Math.max(0, scrollTop.value);

  let low = 0;
  let high = items.length - 1;
  let result = 0;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const itemBottom = items[mid].top + items[mid].height + ITEM_GAP;

    if (itemBottom >= targetTop) {
      result = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  return Math.max(0, result - props.bufferCount);
});

// Visible end index based on viewport bottom
const endIndex = computed(() => {
  const items = positions.value.items;
  if (items.length === 0) return 0;

  const targetBottom = Math.max(0, scrollTop.value) + viewportHeight.value;

  let low = startIndex.value;
  let high = items.length - 1;
  let result = items.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (items[mid].top <= targetBottom) {
      result = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return Math.min(items.length - 1, result + props.bufferCount);
});

// Slice visible items with absolute Y offsets
const visibleItems = computed(() => {
  const posts = props.posts || [];
  if (posts.length === 0) return [];

  const start = startIndex.value;
  const end = endIndex.value;
  const itemsPos = positions.value.items;
  const keys = itemKeys.value;
  const result: { post: any; index: number; key: string; top: number }[] = [];

  for (let i = start; i <= end; i++) {
    if (posts[i]) {
      result.push({
        post: posts[i],
        index: i,
        key: keys[i],
        top: itemsPos[i]?.top || 0
      });
    }
  }

  return result;
});

function measureElementHeight(el: HTMLElement): number {
  const rectHeight = el.getBoundingClientRect().height;
  return Math.ceil(rectHeight > 0 ? rectHeight : el.offsetHeight);
}

function flushPendingHeights() {
  if (resizeRafId !== null) {
    cancelAnimationFrame(resizeRafId);
    resizeRafId = null;
  }
  if (pendingHeights.size === 0) return;

  const updates = new Map(pendingHeights);
  pendingHeights.clear();

  let changed = false;
  const nextHeights = { ...itemHeights.value };

  for (const [key, height] of updates.entries()) {
    if (height > 20 && nextHeights[key] !== height) {
      nextHeights[key] = height;
      changed = true;
    }
  }

  if (changed) {
    itemHeights.value = nextHeights;
    handleScroll();
  }
}

function scheduleHeightUpdate(key: string, height: number) {
  if (height <= 20) return;
  if (itemHeights.value[key] === height && !pendingHeights.has(key)) return;
  pendingHeights.set(key, height);
  if (resizeRafId === null) {
    resizeRafId = window.requestAnimationFrame(flushPendingHeights);
  }
}

function remeasureAllMounted() {
  for (const [key, el] of mountedElements.entries()) {
    if (el.isConnected) {
      scheduleHeightUpdate(key, measureElementHeight(el));
    }
  }
}

function syncScrollPosition() {
  if (isWindowScroll.value) {
    if (rootContainerRef.value) {
      const rect = rootContainerRef.value.getBoundingClientRect();
      scrollTop.value = Math.max(0, -rect.top);
      viewportHeight.value = window.innerHeight || 800;
    }
  } else if (scrollListenerTarget && 'scrollTop' in scrollListenerTarget) {
    const container = scrollListenerTarget as HTMLElement;
    const containerRect = container.getBoundingClientRect();
    const listRect = rootContainerRef.value?.getBoundingClientRect();
    // Account for any header/metadata sitting above VirtualPostList inside the scroll container
    const relativeScrollTop = listRect
      ? Math.max(0, containerRect.top - listRect.top)
      : Math.max(0, container.scrollTop);
    scrollTop.value = relativeScrollTop;
    viewportHeight.value = container.clientHeight || 800;
  }
}

function handleScroll() {
  if (rafId !== null) return;
  rafId = window.requestAnimationFrame(() => {
    rafId = null;
    syncScrollPosition();
  });
}

function setRenderedItemRef(el: Element | ComponentPublicInstance | null, key: string) {
  const htmlEl = el instanceof HTMLElement ? el : null;
  const existing = mountedElements.get(key);

  if (!htmlEl) {
    if (existing) {
      resizeObserver?.unobserve(existing);
      mountedElements.delete(key);
    }
    return;
  }

  if (existing && existing !== htmlEl) {
    resizeObserver?.unobserve(existing);
  }

  (htmlEl as any).__virtualKey = key;
  mountedElements.set(key, htmlEl);

  if (resizeObserver) {
    resizeObserver.observe(htmlEl);
  }

  const h = measureElementHeight(htmlEl);
  if (h > 20) {
    scheduleHeightUpdate(key, h);
  }
}

function setupScrollListener() {
  cleanupScrollListener();

  let target: HTMLElement | Window = window;
  let windowMode = true;

  if (props.scrollContainer) {
    target = props.scrollContainer;
    windowMode = false;
  } else {
    let parent = rootContainerRef.value?.parentElement;
    while (parent && parent !== document.body && parent !== document.documentElement) {
      const overflowY = window.getComputedStyle(parent).overflowY;
      if (overflowY === 'auto' || overflowY === 'scroll') {
        target = parent;
        windowMode = false;
        break;
      }
      parent = parent.parentElement;
    }
  }

  scrollListenerTarget = target;
  isWindowScroll.value = windowMode;
  scrollListenerTarget.addEventListener('scroll', handleScroll, { passive: true });
  window.addEventListener('resize', handleScroll, { passive: true });

  if (!windowMode && target instanceof HTMLElement && typeof ResizeObserver !== 'undefined') {
    containerResizeObserver = new ResizeObserver(() => {
      handleScroll();
      remeasureAllMounted();
    });
    containerResizeObserver.observe(target);
  }

  syncScrollPosition();
}

function cleanupScrollListener() {
  if (scrollListenerTarget) {
    scrollListenerTarget.removeEventListener('scroll', handleScroll as any);
    scrollListenerTarget = null;
  }
  window.removeEventListener('resize', handleScroll as any);
  if (containerResizeObserver) {
    containerResizeObserver.disconnect();
    containerResizeObserver = null;
  }
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

onMounted(() => {
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver((entries) => {
      // Accumulate every observed resize entry without canceling pending batches
      for (const entry of entries) {
        const target = entry.target as HTMLElement;
        const key = (target as any)?.__virtualKey as string | undefined;
        if (key != null && target.isConnected) {
          const height = measureElementHeight(target);
          if (height > 20) {
            pendingHeights.set(key, height);
          }
        }
      }
      if (pendingHeights.size > 0 && resizeRafId === null) {
        resizeRafId = window.requestAnimationFrame(flushPendingHeights);
      }
    });

    // Observe and synchronously measure all items rendered before onMounted ran
    for (const [key, el] of mountedElements.entries()) {
      if (el.isConnected) {
        resizeObserver.observe(el);
        const h = measureElementHeight(el);
        if (h > 20) {
          pendingHeights.set(key, h);
        }
      }
    }
    if (pendingHeights.size > 0) {
      flushPendingHeights();
    }
  }

  nextTick(() => {
    setupScrollListener();
    remeasureAllMounted();
  });
});

onBeforeUnmount(() => {
  cleanupScrollListener();
  if (resizeRafId !== null) {
    cancelAnimationFrame(resizeRafId);
    resizeRafId = null;
  }
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
  mountedElements.clear();
  pendingHeights.clear();
});

watch(
  () => props.scrollContainer,
  () => {
    nextTick(() => {
      setupScrollListener();
    });
  }
);

watch(
  () => props.posts,
  () => {
    nextTick(() => {
      syncScrollPosition();
      remeasureAllMounted();
    });
  }
);
</script>

<template>
  <div ref="rootContainerRef" class="relative w-full">
    <!-- Virtual Height Spacer: preserves native scrollbar height and dynamics -->
    <div
      class="w-full pointer-events-none"
      :style="{ height: `${positions.totalHeight}px` }"
      aria-hidden="true"
    ></div>

    <!-- Active Window of Rendered Post Cards -->
    <div class="absolute top-0 left-0 right-0 w-full">
      <div
        v-for="item in visibleItems"
        :key="item.key"
        :ref="(el) => setRenderedItemRef(el, item.key)"
        class="absolute top-0 left-0 right-0 w-full"
        :style="{ transform: `translate3d(0, ${item.top}px, 0)` }"
      >
        <PostItemView
          :post="item.post"
          :compact="compact"
          :is-dark="isDark"
          :rank="showRank ? item.index + 1 : undefined"
          @open-lightbox="url => emit('open-lightbox', url)"
          @add-to-workspace="p => emit('add-to-workspace', p)"
          @share-post="p => emit('share-post', p)"
          @jump-to-channel="(u, k) => emit('jump-to-channel', u, k)"
          @click-post="p => emit('click-post', p)"
        />
      </div>
    </div>
  </div>
</template>
