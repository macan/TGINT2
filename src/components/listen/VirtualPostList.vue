<script setup lang="ts">
import {
  ref,
  computed,
  watch,
  onMounted,
  onBeforeUnmount,
  nextTick
} from 'vue';
import PostItemView from './PostItemView.vue';

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

// Cache true rendered heights measured by ResizeObserver
const itemHeights = ref<Record<string | number, number>>({});
let resizeObserver: ResizeObserver | null = null;
let scrollListenerTarget: HTMLElement | Window | null = null;
let rafId: number | null = null;

function getPostKey(post: any, idx: number): string | number {
  return post?.key || post?.id || idx;
}

// Calculate cumulative item offsets and total height
const positions = computed(() => {
  const posts = props.posts || [];
  const heights = itemHeights.value;
  const defaultHeight = props.estimatedItemHeight;
  const pos: { top: number; height: number }[] = new Array(posts.length);

  let currentTop = 0;
  for (let i = 0; i < posts.length; i++) {
    const key = getPostKey(posts[i], i);
    const h = heights[key] || defaultHeight;
    pos[i] = { top: currentTop, height: h };
    currentTop += h + 16; // 16px vertical gap between cards
  }

  return {
    items: pos,
    totalHeight: Math.max(0, currentTop)
  };
});

// Binary search for visible start index based on scroll offset
const startIndex = computed(() => {
  const posts = props.posts || [];
  if (posts.length === 0) return 0;

  const targetTop = Math.max(0, scrollTop.value);
  const items = positions.value.items;

  let low = 0;
  let high = items.length - 1;
  let mid = 0;

  while (low <= high) {
    mid = Math.floor((low + high) / 2);
    const itemBottom = items[mid].top + items[mid].height;

    if (itemBottom < targetTop) {
      low = mid + 1;
    } else if (items[mid].top > targetTop) {
      high = mid - 1;
    } else {
      break;
    }
  }

  const rawStart = Math.max(0, low - 1);
  return Math.max(0, rawStart - props.bufferCount);
});

// Visible end index based on viewport bottom
const endIndex = computed(() => {
  const posts = props.posts || [];
  if (posts.length === 0) return 0;

  const targetBottom = scrollTop.value + viewportHeight.value;
  const items = positions.value.items;

  let low = startIndex.value;
  let high = items.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (items[mid].top < targetBottom) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  const rawEnd = Math.min(items.length - 1, low);
  return Math.min(items.length - 1, rawEnd + props.bufferCount);
});

// Slice visible items with absolute positioning offsets
const visibleItems = computed(() => {
  const posts = props.posts || [];
  if (posts.length === 0) return [];

  const start = startIndex.value;
  const end = endIndex.value;
  const itemsPos = positions.value.items;
  const result: { post: any; index: number; key: string | number; top: number }[] = [];

  for (let i = start; i <= end; i++) {
    if (posts[i]) {
      result.push({
        post: posts[i],
        index: i,
        key: getPostKey(posts[i], i),
        top: itemsPos[i]?.top || 0
      });
    }
  }

  return result;
});

function handleScroll() {
  if (rafId) return;

  rafId = requestAnimationFrame(() => {
    rafId = null;

    if (isWindowScroll.value) {
      if (rootContainerRef.value) {
        const rect = rootContainerRef.value.getBoundingClientRect();
        scrollTop.value = Math.max(0, -rect.top);
        viewportHeight.value = window.innerHeight;
      }
    } else if (scrollListenerTarget && 'scrollTop' in scrollListenerTarget) {
      const el = scrollListenerTarget as HTMLElement;
      scrollTop.value = el.scrollTop;
      viewportHeight.value = el.clientHeight || 800;
    }
  });
}

function observeRenderedItem(el: Element | null, key: string | number) {
  if (!el || !resizeObserver) return;
  (el as any).__virtualKey = key;
  resizeObserver.observe(el);
}

function unobserveRenderedItem(el: Element | null) {
  if (!el || !resizeObserver) return;
  resizeObserver.unobserve(el);
}

function setupScrollListener() {
  cleanupScrollListener();

  // If explicit container prop is supplied
  if (props.scrollContainer) {
    scrollListenerTarget = props.scrollContainer;
    isWindowScroll.value = false;
    scrollListenerTarget.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    return;
  }

  // Detect closest scrollable parent element
  let parent = rootContainerRef.value?.parentElement;
  while (parent && parent !== document.body && parent !== document.documentElement) {
    const overflowY = window.getComputedStyle(parent).overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll') {
      scrollListenerTarget = parent;
      isWindowScroll.value = false;
      scrollListenerTarget.addEventListener('scroll', handleScroll, { passive: true });
      handleScroll();
      return;
    }
    parent = parent.parentElement;
  }

  // Default to window scrolling
  scrollListenerTarget = window;
  isWindowScroll.value = true;
  window.addEventListener('scroll', handleScroll, { passive: true });
  window.addEventListener('resize', handleScroll, { passive: true });
  handleScroll();
}

function cleanupScrollListener() {
  if (scrollListenerTarget) {
    scrollListenerTarget.removeEventListener('scroll', handleScroll as any);
    if (scrollListenerTarget === window) {
      window.removeEventListener('resize', handleScroll as any);
    }
    scrollListenerTarget = null;
  }
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

onMounted(() => {
  // Initialize ResizeObserver to measure true rendered heights dynamically
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver((entries) => {
      let changed = false;
      for (const entry of entries) {
        const key = (entry.target as any)?.__virtualKey;
        if (key != null) {
          const height = Math.ceil(entry.contentRect.height);
          if (height > 20 && itemHeights.value[key] !== height) {
            itemHeights.value[key] = height;
            changed = true;
          }
        }
      }
      if (changed) {
        handleScroll();
      }
    });
  }

  nextTick(() => {
    setupScrollListener();
  });
});

onBeforeUnmount(() => {
  cleanupScrollListener();
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
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
  () => props.posts.length,
  () => {
    nextTick(() => {
      handleScroll();
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
        :ref="(el) => observeRenderedItem(el as any, item.key)"
        class="absolute left-0 right-0 w-full transition-transform duration-75 ease-out"
        :style="{ transform: `translateY(${item.top}px)` }"
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
