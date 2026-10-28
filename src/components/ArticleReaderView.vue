<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from "vue";
import {
  BookOpen,
  Type,
  Sliders,
  AlignLeft,
  Sun,
  Moon,
  Palette,
  Image as ImageIcon,
  Video as VideoIcon,
  Copy,
  Check,
  Languages,
  Search,
  ExternalLink,
  Layers,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  Clock,
  FileText,
  Filter,
  Eye,
  Sparkles,
  ArrowDown,
  ArrowUp,
  ListOrdered,
  CheckCircle2,
  RefreshCw,
  X,
  ChevronRight
} from "lucide-vue-next";

export interface ArticleReaderPrefs {
  fontFamily: "serif" | "sans" | "mono";
  fontSize: "sm" | "base" | "lg" | "xl";
  lineHeight: "relaxed" | "loose";
  maxWidth: "narrow" | "standard" | "wide";
  theme: "sepia" | "white" | "slate" | "oled";
  autoCollapseMedia: boolean;
  minWordFilter: number; // 0 for all, 50 for longform, 150 for essays
  enableDropCap: boolean;
}

const props = defineProps<{
  posts: any[];
  channelName: string;
  channelTitle?: string;
  channelAvatar?: string;
  metadata?: any;
  getSafePostContent: (post: any) => string;
  getVideoUrl: (post: any) => string;
  formatDate: (date: any) => string;
  isTranslating?: Record<string, boolean>;
  hasMore?: boolean;
  isLoadingMore?: boolean;
}>();

const emit = defineEmits<{
  (e: "translate", post: any): void;
  (e: "search-google", text: string): void;
  (e: "add-to-workspace", post: any): void;
  (e: "open-post-modal", post: any): void;
  (e: "load-more"): void;
}>();

// Persistent User Preferences
const PREFS_STORAGE_KEY = "telegram_article_reader_prefs_v1";

const defaultPrefs: ArticleReaderPrefs = {
  fontFamily: "serif",
  fontSize: "base",
  lineHeight: "relaxed",
  maxWidth: "standard",
  theme: "sepia",
  autoCollapseMedia: true,
  minWordFilter: 0,
  enableDropCap: true
};

const prefs = ref<ArticleReaderPrefs>({ ...defaultPrefs });
const isToolbarOpen = ref(true);
const copiedPostKey = ref<string | null>(null);

// DOM ref for the reading stream container
const readerContainerRef = ref<HTMLElement | null>(null);

// Scroll Reading Progress State
const scrollProgress = ref<number>(0);
const currentArticleIndex = ref<number>(0);
const isArticlePickerOpen = ref<boolean>(false);

// Relocation State for reloading / appending next posts
const isRelocating = ref<boolean>(false);
const showRelocationBanner = ref<boolean>(false);
const relocationBannerMessage = ref<string>("");
const lastLoadedBatchStartKey = ref<string | null>(null);
const lastLoadedBatchStartIndex = ref<number>(0);
const prevPostsCount = ref<number>(props.posts ? props.posts.length : 0);
let relocationTimer: ReturnType<typeof setTimeout> | null = null;
let scrollTicking = false;

// Measured height of the original sticky navigation header to prevent any overlapping
const navHeaderOffset = ref<number>(68);

const updateNavHeaderOffset = () => {
  const navHeader = document.querySelector("header.sticky");
  if (navHeader) {
    const h = (navHeader as HTMLElement).offsetHeight;
    navHeaderOffset.value = h + 8; // 8px buffer below the nav bar
  } else {
    navHeaderOffset.value = 68;
  }
};

const onWindowResize = () => {
  updateNavHeaderOffset();
  handleScroll();
};

// Per-post media expansion state overrides
const expandedMediaMap = ref<Record<string, boolean>>({});

// Load saved preferences & initialize scroll listener
onMounted(() => {
  try {
    const raw = localStorage.getItem(PREFS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      prefs.value = { ...defaultPrefs, ...parsed };
    }
  } catch (e) {
    console.error("Failed to load reader preferences", e);
  }

  updateNavHeaderOffset();
  window.addEventListener("scroll", handleScroll, { passive: true });
  window.addEventListener("resize", onWindowResize, { passive: true });
  nextTick(() => {
    updateNavHeaderOffset();
    calculateProgressAndActiveArticle();
  });
});

onUnmounted(() => {
  window.removeEventListener("scroll", handleScroll);
  window.removeEventListener("resize", onWindowResize);
  if (relocationTimer) clearTimeout(relocationTimer);
});

// Watch and persist preferences
watch(
  prefs,
  (newPrefs) => {
    try {
      localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(newPrefs));
    } catch (e) {
      console.error("Failed to save reader preferences", e);
    }
  },
  { deep: true }
);

const resetPreferences = () => {
  prefs.value = { ...defaultPrefs };
};

// Word Count & Reading Time Estimation
const getPostReadingStats = (post: any) => {
  const rawText = post.data?.content || post.data?.rawcontent || "";
  // Strip simple HTML tags for word counting
  const cleanText = rawText.replace(/<[^>]*>/g, " ").trim();
  const words = cleanText ? cleanText.split(/\s+/).filter(Boolean).length : 0;
  const minutes = Math.max(1, Math.ceil(words / 200));
  return { words, minutes };
};

// Filtered Posts based on reader constraints (e.g. minimum word filter)
const readerPosts = computed(() => {
  if (!props.posts || props.posts.length === 0) return [];
  if (prefs.value.minWordFilter <= 0) return props.posts;

  return props.posts.filter((post) => {
    const { words } = getPostReadingStats(post);
    return words >= prefs.value.minWordFilter;
  });
});

// Aggregate reading duration for filtered stream
const totalReadingTime = computed(() => {
  let totalMin = 0;
  for (const post of readerPosts.value) {
    const { minutes } = getPostReadingStats(post);
    totalMin += minutes;
  }
  return totalMin;
});

// Media existence helper
const hasMedia = (post: any) => {
  return Boolean(
    (post.data?.photos && post.data.photos.length > 0) ||
    (post.data?.videos && post.data.videos.length > 0) ||
    (post.data?.linkPreview && (post.data.linkPreview.image || post.data.linkPreview.title)) ||
    (post.data?.documents && post.data.documents.length > 0)
  );
};

// Check if media is currently expanded for a post
const isMediaExpanded = (post: any) => {
  if (post.key in expandedMediaMap.value) {
    return expandedMediaMap.value[post.key];
  }
  // Default to user preference
  return !prefs.value.autoCollapseMedia;
};

const toggleMedia = (post: any) => {
  const current = isMediaExpanded(post);
  expandedMediaMap.value[post.key] = !current;
};

// Copy post plain text
const copyPostText = async (post: any) => {
  const text = post.data?.content || post.data?.rawcontent || "";
  try {
    await navigator.clipboard.writeText(text);
    copiedPostKey.value = post.key;
    setTimeout(() => {
      if (copiedPostKey.value === post.key) {
        copiedPostKey.value = null;
      }
    }, 2000);
  } catch (err) {
    console.error("Failed to copy text", err);
  }
};

// Calculate remaining reading time from current reading position
const remainingReadingTime = computed(() => {
  if (!readerPosts.value || readerPosts.value.length === 0) return 0;
  const start = Math.min(currentArticleIndex.value, readerPosts.value.length - 1);
  let remainingMin = 0;
  for (let i = start; i < readerPosts.value.length; i++) {
    const post = readerPosts.value[i];
    const { minutes } = getPostReadingStats(post);
    remainingMin += minutes;
  }
  return remainingMin;
});

// Calculate active article and scroll percentage
const calculateProgressAndActiveArticle = () => {
  if (!readerContainerRef.value) return;
  const container = readerContainerRef.value;
  const rect = container.getBoundingClientRect();
  const containerHeight = container.offsetHeight;
  const windowHeight = window.innerHeight;

  // Header and sticky controls offset (nav header offset + toolbar height)
  const stickyOffset = navHeaderOffset.value + 60;
  const scrolledPastTop = Math.max(0, -rect.top + stickyOffset);
  const totalScrollableDistance = Math.max(1, containerHeight - windowHeight + stickyOffset);

  const pct = Math.min(100, Math.max(0, Math.round((scrolledPastTop / totalScrollableDistance) * 100)));
  scrollProgress.value = pct;

  // Determine active article in viewport reading zone
  const articles = container.querySelectorAll<HTMLElement>("[data-article-key]");
  let activeIdx = 0;
  for (let i = 0; i < articles.length; i++) {
    const artRect = articles[i].getBoundingClientRect();
    if (artRect.top <= windowHeight * 0.45) {
      activeIdx = i;
    }
  }
  currentArticleIndex.value = activeIdx;
};

// Smooth scroll listener via requestAnimationFrame
const handleScroll = () => {
  if (!scrollTicking) {
    window.requestAnimationFrame(() => {
      calculateProgressAndActiveArticle();
      scrollTicking = false;
    });
    scrollTicking = true;
  }
};

// Relocate Indicator when next posts are reloaded / appended
watch(
  () => props.posts?.length,
  (newLen, oldLen) => {
    const current = newLen || 0;
    const prev = oldLen || 0;

    if (current > prev && prev > 0) {
      // Next batch was loaded!
      const addedCount = current - prev;
      lastLoadedBatchStartIndex.value = prev;
      const firstNewPost = props.posts[prev];
      lastLoadedBatchStartKey.value = firstNewPost?.key || null;

      // Trigger relocation state and informative banner
      isRelocating.value = true;
      showRelocationBanner.value = true;
      relocationBannerMessage.value = `+${addedCount} articles loaded · Progress relocated to Article ${currentArticleIndex.value + 1} of ${current} (${scrollProgress.value}%)`;

      // Recalibrate scroll measurements on next DOM layout
      nextTick(() => {
        calculateProgressAndActiveArticle();
      });

      if (relocationTimer) clearTimeout(relocationTimer);
      relocationTimer = setTimeout(() => {
        showRelocationBanner.value = false;
        isRelocating.value = false;
      }, 7000);
    } else if (current < prev || current === 0) {
      scrollProgress.value = 0;
      currentArticleIndex.value = 0;
      showRelocationBanner.value = false;
      isRelocating.value = false;
    }
    prevPostsCount.value = current;
  }
);

watch(
  () => props.channelName,
  () => {
    scrollProgress.value = 0;
    currentArticleIndex.value = 0;
    showRelocationBanner.value = false;
    isRelocating.value = false;
  }
);

// Jump & Smooth Relocation Handlers
const scrollToArticle = (indexOrKey: number | string) => {
  let targetEl: HTMLElement | null = null;
  if (typeof indexOrKey === "number") {
    const articles = readerContainerRef.value?.querySelectorAll<HTMLElement>("[data-article-key]");
    if (articles && articles[indexOrKey]) {
      targetEl = articles[indexOrKey];
    }
  } else {
    targetEl = document.getElementById(`article-${indexOrKey}`);
  }

  if (targetEl) {
    const rect = targetEl.getBoundingClientRect();
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    const targetY = scrollTop + rect.top - (navHeaderOffset.value + 80);
    window.scrollTo({
      top: Math.max(0, targetY),
      behavior: "smooth"
    });
  }
  isArticlePickerOpen.value = false;
};

const jumpToNextBatch = () => {
  if (lastLoadedBatchStartKey.value) {
    scrollToArticle(lastLoadedBatchStartKey.value);
  } else if (lastLoadedBatchStartIndex.value < readerPosts.value.length) {
    scrollToArticle(lastLoadedBatchStartIndex.value);
  }
  showRelocationBanner.value = false;
};

const scrollToTop = () => {
  if (readerContainerRef.value) {
    const rect = readerContainerRef.value.getBoundingClientRect();
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    window.scrollTo({
      top: Math.max(0, scrollTop + rect.top - 20),
      behavior: "smooth"
    });
  } else {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
};

const progressBarGradientClass = computed(() => {
  switch (prefs.value.theme) {
    case "sepia":
      return "bg-gradient-to-r from-amber-600 via-amber-500 to-amber-700 shadow-[0_0_8px_rgba(217,119,6,0.6)]";
    case "white":
      return "bg-gradient-to-r from-blue-600 via-indigo-600 to-cyan-500 shadow-[0_0_8px_rgba(37,99,235,0.5)]";
    case "slate":
      return "bg-gradient-to-r from-sky-400 via-blue-400 to-cyan-300 shadow-[0_0_8px_rgba(56,189,248,0.5)]";
    case "oled":
      return "bg-gradient-to-r from-emerald-400 via-teal-400 to-cyan-400 shadow-[0_0_8px_rgba(16,185,129,0.6)]";
    default:
      return "bg-gradient-to-r from-amber-600 via-amber-500 to-amber-700 shadow-[0_0_8px_rgba(217,119,6,0.6)]";
  }
});

// Reading Container Styles based on Preferences
const containerMaxWidthClass = computed(() => {
  switch (prefs.value.maxWidth) {
    case "narrow":
      return "max-w-[620px]";
    case "wide":
      return "max-w-[880px]";
    case "standard":
    default:
      return "max-w-[740px]";
  }
});

const themeClasses = computed(() => {
  switch (prefs.value.theme) {
    case "sepia":
      return "bg-[#FBF9F5] dark:bg-[#181614] text-[#1C1917] dark:text-[#E8E2D7] border-[#E8E2D7] dark:border-[#2C2723]";
    case "white":
      return "bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 border-gray-200 dark:border-gray-800";
    case "slate":
      return "bg-slate-900 text-slate-100 border-slate-800";
    case "oled":
      return "bg-black text-neutral-100 border-neutral-900";
    default:
      return "bg-[#FBF9F5] dark:bg-[#181614] text-[#1C1917] dark:text-[#E8E2D7] border-[#E8E2D7] dark:border-[#2C2723]";
  }
});

const fontClasses = computed(() => {
  switch (prefs.value.fontFamily) {
    case "sans":
      return "font-sans";
    case "mono":
      return "font-mono";
    case "serif":
    default:
      return "font-serif";
  }
});

const fontSizeClass = computed(() => {
  switch (prefs.value.fontSize) {
    case "sm":
      return "text-[15px]";
    case "lg":
      return "text-[19px]";
    case "xl":
      return "text-[22px]";
    case "base":
    default:
      return "text-[17px]";
  }
});

const lineHeightClass = computed(() => {
  return prefs.value.lineHeight === "loose" ? "leading-[2.0]" : "leading-[1.78]";
});
</script>

<template>
  <div ref="readerContainerRef" class="w-full transition-colors duration-300 min-h-[600px] pb-24 relative">
    <!-- Floating / Sticky Reading Controls Bar with Integrated Progress Track -->
    <div
      class="sticky z-30 mb-8 rounded-2xl shadow-lg border backdrop-blur-md px-4 py-3 transition-all duration-200 relative overflow-hidden"
      :style="{ top: `${navHeaderOffset}px` }"
      :class="[
        prefs.theme === 'sepia'
          ? 'bg-[#F7F4EE]/95 dark:bg-[#1C1A17]/95 border-[#E2DDD3] dark:border-[#2F2B26] text-[#292524] dark:text-[#D6D3D1]'
          : prefs.theme === 'white'
            ? 'bg-white/95 dark:bg-gray-850/95 border-gray-200 dark:border-gray-750 text-gray-800 dark:text-gray-200'
            : prefs.theme === 'slate'
              ? 'bg-slate-900/95 border-slate-800 text-slate-200'
              : 'bg-neutral-950/95 border-neutral-850 text-neutral-200'
      ]"
    >
      <!-- Top Edge Reading Progress Line on Sticky Header -->
      <div class="absolute top-0 left-0 right-0 h-1.5 bg-black/5 dark:bg-white/10 overflow-hidden">
        <div
          class="h-full transition-all duration-150 ease-out"
          :class="[
            progressBarGradientClass,
            isRelocating ? 'animate-pulse ring-2 ring-amber-400 dark:ring-amber-300' : ''
          ]"
          :style="{ width: `${scrollProgress}%` }"
        ></div>
      </div>

      <!-- Relocation Notice Strip (Appears when reloading next posts) -->
      <div
        v-if="showRelocationBanner"
        class="mb-3 mt-1 px-3 py-1.5 rounded-xl flex items-center justify-between gap-2 text-xs font-mono transition-all animate-fadeIn"
        :class="[
          prefs.theme === 'sepia'
            ? 'bg-amber-100/95 dark:bg-amber-950/80 border border-amber-300/80 dark:border-amber-800 text-amber-950 dark:text-amber-200'
            : 'bg-blue-50/95 dark:bg-blue-950/80 border border-blue-200/80 dark:border-blue-800 text-blue-950 dark:text-blue-200'
        ]"
      >
        <div class="flex items-center gap-2 truncate">
          <Sparkles class="w-3.5 h-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
          <span class="truncate font-semibold">{{ relocationBannerMessage }}</span>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <button
            @click="jumpToNextBatch"
            class="px-2.5 py-0.5 rounded-lg bg-white dark:bg-stone-900 border border-black/10 dark:border-white/15 text-[11px] font-bold shadow-2xs hover:scale-105 active:scale-95 transition flex items-center gap-1 cursor-pointer"
            title="Relocate viewport to newly loaded batch of articles"
          >
            <span>Jump to new posts</span>
            <ArrowDown class="w-3 h-3 text-amber-600 dark:text-amber-400" />
          </button>
          <button
            @click="showRelocationBanner = false"
            class="p-0.5 rounded-md hover:bg-black/10 dark:hover:bg-white/10 text-stone-500 cursor-pointer"
            title="Dismiss notification"
          >
            <X class="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div class="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        <!-- Left: Reader Indicator & Active Counts & Live Progress Telemetry -->
        <div class="flex items-center gap-3">
          <div class="p-2 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
            <BookOpen class="w-4 h-4" />
          </div>
          <div>
            <div class="flex items-center gap-2">
              <span class="text-xs font-black tracking-tight uppercase">Article</span>
              <span class="text-[11px] text-stone-500 dark:text-stone-400 font-mono">
                @{{ channelName }}
              </span>
            </div>
            <!-- Live Progress Metrics Strip -->
            <div class="text-[10px] text-stone-500 dark:text-stone-400 font-mono flex items-center gap-2 flex-wrap">
              <span
                class="font-extrabold px-1.5 py-0.5 rounded-md bg-black/5 dark:bg-white/10 text-stone-800 dark:text-stone-200 tabular-nums"
                :title="`Current overall reading progress: ${scrollProgress}%`"
              >
                {{ scrollProgress }}% read
              </span>
              <span aria-hidden="true">·</span>
              <button
                @click="isArticlePickerOpen = !isArticlePickerOpen"
                class="hover:underline flex items-center gap-1 font-semibold text-stone-700 dark:text-stone-300 cursor-pointer transition"
                :title="`Reading Article ${currentArticleIndex + 1} of ${readerPosts.length}. Click to open quick jump index.`"
              >
                <span>Article {{ currentArticleIndex + 1 }} / {{ readerPosts.length }}</span>
                <ListOrdered class="w-3 h-3 opacity-70" />
              </button>
              <span aria-hidden="true">·</span>
              <span class="tabular-nums">~{{ remainingReadingTime }}m left</span>
              <span aria-hidden="true">·</span>
              <span>{{ readerPosts.length }} total</span>
            </div>
          </div>
        </div>

        <!-- Right: Typography & Aesthetic Controls Ribbon -->
        <div class="flex flex-wrap items-center gap-2 text-xs">
          <!-- Font Family Selector (Serif vs Sans) -->
          <div class="flex items-center bg-black/5 dark:bg-white/5 p-1 rounded-xl border border-black/5 dark:border-white/10">
            <button
              @click="prefs.fontFamily = 'serif'"
              :class="[
                'px-2.5 py-1 rounded-lg font-serif font-bold transition cursor-pointer text-xs',
                prefs.fontFamily === 'serif'
                  ? 'bg-white dark:bg-neutral-800 text-amber-900 dark:text-amber-200 shadow-xs'
                  : 'text-stone-500 hover:text-stone-900 dark:hover:text-stone-200'
              ]"
              title="Serif Book Typeface (Recommended for long reading)"
            >
              Serif
            </button>
            <button
              @click="prefs.fontFamily = 'sans'"
              :class="[
                'px-2.5 py-1 rounded-lg font-sans font-bold transition cursor-pointer text-xs',
                prefs.fontFamily === 'sans'
                  ? 'bg-white dark:bg-neutral-800 text-amber-900 dark:text-amber-200 shadow-xs'
                  : 'text-stone-500 hover:text-stone-900 dark:hover:text-stone-200'
              ]"
              title="Modern Sans-Serif Typeface"
            >
              Sans
            </button>
          </div>

          <!-- Font Size Stepper -->
          <div class="flex items-center bg-black/5 dark:bg-white/5 p-1 rounded-xl border border-black/5 dark:border-white/10">
            <button
              @click="prefs.fontSize = 'sm'"
              :class="[
                'px-2 py-1 rounded-lg text-xs font-mono font-bold transition cursor-pointer',
                prefs.fontSize === 'sm'
                  ? 'bg-white dark:bg-neutral-800 text-amber-900 dark:text-amber-200 shadow-xs'
                  : 'text-stone-500 hover:text-stone-900 dark:hover:text-stone-200'
              ]"
              title="Small (15px)"
            >
              A-
            </button>
            <button
              @click="prefs.fontSize = 'base'"
              :class="[
                'px-2 py-1 rounded-lg text-xs font-mono font-bold transition cursor-pointer',
                prefs.fontSize === 'base'
                  ? 'bg-white dark:bg-neutral-800 text-amber-900 dark:text-amber-200 shadow-xs'
                  : 'text-stone-500 hover:text-stone-900 dark:hover:text-stone-200'
              ]"
              title="Standard (17px)"
            >
              A
            </button>
            <button
              @click="prefs.fontSize = 'lg'"
              :class="[
                'px-2 py-1 rounded-lg text-xs font-mono font-bold transition cursor-pointer',
                prefs.fontSize === 'lg'
                  ? 'bg-white dark:bg-neutral-800 text-amber-900 dark:text-amber-200 shadow-xs'
                  : 'text-stone-500 hover:text-stone-900 dark:hover:text-stone-200'
              ]"
              title="Large (19px)"
            >
              A+
            </button>
            <button
              @click="prefs.fontSize = 'xl'"
              :class="[
                'px-2 py-1 rounded-lg text-xs font-mono font-bold transition cursor-pointer',
                prefs.fontSize === 'xl'
                  ? 'bg-white dark:bg-neutral-800 text-amber-900 dark:text-amber-200 shadow-xs'
                  : 'text-stone-500 hover:text-stone-900 dark:hover:text-stone-200'
              ]"
              title="Extra Large (22px)"
            >
              A++
            </button>
          </div>

          <!-- Line Height Toggle -->
          <button
            @click="prefs.lineHeight = prefs.lineHeight === 'relaxed' ? 'loose' : 'relaxed'"
            class="px-2.5 py-1.5 bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 rounded-xl border border-black/5 dark:border-white/10 text-xs font-bold transition cursor-pointer flex items-center gap-1"
            :title="`Line Spacing: ${prefs.lineHeight === 'relaxed' ? 'Relaxed (1.78)' : 'Loose (2.0)'}`"
          >
            <AlignLeft class="w-3.5 h-3.5" />
            <span>{{ prefs.lineHeight === 'relaxed' ? '1.8' : '2.0' }}</span>
          </button>

          <!-- Reading Measure Width -->
          <div class="flex items-center bg-black/5 dark:bg-white/5 p-1 rounded-xl border border-black/5 dark:border-white/10">
            <button
              @click="prefs.maxWidth = 'narrow'"
              :class="[
                'px-2 py-1 rounded-lg text-[11px] font-bold transition cursor-pointer',
                prefs.maxWidth === 'narrow'
                  ? 'bg-white dark:bg-neutral-800 text-amber-900 dark:text-amber-200 shadow-xs'
                  : 'text-stone-500 hover:text-stone-900'
              ]"
              title="Narrow Measure (620px)"
            >
              Narrow
            </button>
            <button
              @click="prefs.maxWidth = 'standard'"
              :class="[
                'px-2 py-1 rounded-lg text-[11px] font-bold transition cursor-pointer',
                prefs.maxWidth === 'standard'
                  ? 'bg-white dark:bg-neutral-800 text-amber-900 dark:text-amber-200 shadow-xs'
                  : 'text-stone-500 hover:text-stone-900'
              ]"
              title="Standard Optimal Measure (740px / ~65ch)"
            >
              Optimal
            </button>
            <button
              @click="prefs.maxWidth = 'wide'"
              :class="[
                'px-2 py-1 rounded-lg text-[11px] font-bold transition cursor-pointer',
                prefs.maxWidth === 'wide'
                  ? 'bg-white dark:bg-neutral-800 text-amber-900 dark:text-amber-200 shadow-xs'
                  : 'text-stone-500 hover:text-stone-900'
              ]"
              title="Wide Measure (880px)"
            >
              Wide
            </button>
          </div>

          <!-- Theme Canvas Selector -->
          <div class="flex items-center bg-black/5 dark:bg-white/5 p-1 rounded-xl border border-black/5 dark:border-white/10">
            <button
              @click="prefs.theme = 'sepia'"
              :class="[
                'w-6 h-6 rounded-lg transition border cursor-pointer flex items-center justify-center text-[10px]',
                prefs.theme === 'sepia' ? 'ring-2 ring-amber-500 bg-[#FBF9F5] text-amber-900 border-amber-300 font-bold' : 'bg-[#FBF9F5] border-stone-300'
              ]"
              title="Warm Sepia Parchment Theme"
            >
              📜
            </button>
            <button
              @click="prefs.theme = 'white'"
              :class="[
                'w-6 h-6 rounded-lg transition border cursor-pointer flex items-center justify-center text-[10px] ml-1',
                prefs.theme === 'white' ? 'ring-2 ring-blue-500 bg-white text-gray-900 border-gray-400 font-bold' : 'bg-white border-gray-300'
              ]"
              title="Pure White Theme"
            >
              ⚪
            </button>
            <button
              @click="prefs.theme = 'slate'"
              :class="[
                'w-6 h-6 rounded-lg transition border cursor-pointer flex items-center justify-center text-[10px] ml-1',
                prefs.theme === 'slate' ? 'ring-2 ring-indigo-500 bg-slate-900 text-slate-100 border-slate-700 font-bold' : 'bg-slate-900 border-slate-700'
              ]"
              title="Muted Slate Theme"
            >
              🌫️
            </button>
            <button
              @click="prefs.theme = 'oled'"
              :class="[
                'w-6 h-6 rounded-lg transition border cursor-pointer flex items-center justify-center text-[10px] ml-1',
                prefs.theme === 'oled' ? 'ring-2 ring-rose-500 bg-black text-neutral-100 border-neutral-700 font-bold' : 'bg-black border-neutral-800'
              ]"
              title="OLED Pure Black Theme"
            >
              🌙
            </button>
          </div>

          <!-- Long-Form Filter Stepper -->
          <div class="flex items-center gap-1 bg-black/5 dark:bg-white/5 p-1 rounded-xl border border-black/5 dark:border-white/10">
            <Filter class="w-3 h-3 text-stone-400 ml-1" />
            <select
              v-model.number="prefs.minWordFilter"
              class="bg-transparent font-bold text-[11px] outline-none cursor-pointer pr-1"
            >
              <option :value="0" class="dark:bg-stone-900">All Posts</option>
              <option :value="50" class="dark:bg-stone-900">&gt; 50 words (Long-form)</option>
              <option :value="150" class="dark:bg-stone-900">&gt; 150 words (Essays)</option>
            </select>
          </div>

          <!-- Drop Cap Switch -->
          <button
            @click="prefs.enableDropCap = !prefs.enableDropCap"
            :class="[
              'px-2.5 py-1.5 rounded-xl border text-xs font-bold transition cursor-pointer',
              prefs.enableDropCap
                ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30'
                : 'bg-black/5 dark:bg-white/5 text-stone-400 border-black/5 dark:border-white/10'
            ]"
            title="Toggle opening initial drop caps"
          >
            Drop Cap
          </button>

          <!-- Auto Collapse Media Switch -->
          <button
            @click="prefs.autoCollapseMedia = !prefs.autoCollapseMedia"
            :class="[
              'px-2.5 py-1.5 rounded-xl border text-xs font-bold transition cursor-pointer flex items-center gap-1',
              prefs.autoCollapseMedia
                ? 'bg-teal-500/10 text-teal-700 dark:text-teal-300 border-teal-500/30'
                : 'bg-black/5 dark:bg-white/5 text-stone-400 border-black/5 dark:border-white/10'
            ]"
            title="When active, media attachments are collapsed by default into clean inline drawers"
          >
            <ImageIcon class="w-3.5 h-3.5" />
            <span>{{ prefs.autoCollapseMedia ? 'Media Collapsed' : 'Media Inline' }}</span>
          </button>

          <!-- Reset Button -->
          <button
            @click="resetPreferences"
            class="p-1.5 rounded-xl text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 transition cursor-pointer"
            title="Reset typography and layout to defaults"
          >
            <RotateCcw class="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <!-- Article Quick Navigation Dropdown / Drawer -->
      <div
        v-if="isArticlePickerOpen"
        class="mt-3 pt-3 border-t border-black/10 dark:border-white/10 animate-fadeIn"
      >
        <div class="flex items-center justify-between mb-2">
          <span class="text-xs font-black uppercase tracking-wider text-stone-600 dark:text-stone-300 flex items-center gap-1.5">
            <ListOrdered class="w-3.5 h-3.5" />
            <span>Articles Navigator ({{ readerPosts.length }} articles)</span>
          </span>
          <div class="flex items-center gap-3">
            <button
              @click="scrollToTop"
              class="text-[11px] font-bold text-stone-500 hover:text-stone-900 dark:hover:text-stone-200 flex items-center gap-1 cursor-pointer"
            >
              <ArrowUp class="w-3 h-3" />
              <span>Scroll to Top</span>
            </button>
            <button
              @click="isArticlePickerOpen = false"
              class="p-1 rounded-md hover:bg-black/10 dark:hover:bg-white/10 text-stone-500 cursor-pointer"
              title="Close index"
            >
              <X class="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div class="max-h-56 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
          <button
            v-for="(post, idx) in readerPosts"
            :key="post.key || idx"
            @click="scrollToArticle(idx)"
            class="w-full text-left px-3 py-1.5 rounded-xl text-xs font-mono transition flex items-center justify-between gap-3 cursor-pointer"
            :class="[
              idx === currentArticleIndex
                ? 'bg-amber-500/15 text-amber-900 dark:text-amber-200 font-bold border border-amber-500/30'
                : 'hover:bg-black/5 dark:hover:bg-white/5 text-stone-600 dark:text-stone-300'
            ]"
          >
            <div class="flex items-center gap-2 truncate">
              <span class="w-6 text-[10px] text-stone-400 font-mono shrink-0">#{{ idx + 1 }}</span>
              <span class="truncate">{{ (post.data?.content || post.data?.rawcontent || 'Post content').replace(/<[^>]*>/g, ' ').slice(0, 55) }}...</span>
            </div>
            <div class="flex items-center gap-2 text-[10px] text-stone-400 shrink-0">
              <span>{{ getPostReadingStats(post).minutes }}m</span>
              <ChevronRight class="w-3 h-3 opacity-60" />
            </div>
          </button>
        </div>
      </div>
    </div>

    <!-- Empty State -->
    <div
      v-if="readerPosts.length === 0"
      class="max-w-xl mx-auto p-12 text-center rounded-3xl border border-stone-200/80 dark:border-stone-800 space-y-3 bg-white/50 dark:bg-stone-900/40"
    >
      <div class="w-12 h-12 rounded-2xl bg-amber-500/10 text-amber-600 mx-auto flex items-center justify-center">
        <FileText class="w-6 h-6" />
      </div>
      <h3 class="text-base font-serif font-bold text-stone-900 dark:text-stone-100">
        No long-form posts match your word filter
      </h3>
      <p class="text-xs text-stone-500 dark:text-stone-400">
        This channel might have short updates or chatter below {{ prefs.minWordFilter }} words. Try lowering the word filter to view all channel updates.
      </p>
      <button
        @click="prefs.minWordFilter = 0"
        class="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold transition cursor-pointer"
      >
        Show All Channel Posts
      </button>
    </div>

    <!-- Article Reader Reading Stream -->
    <div
      v-else
      :class="['mx-auto rounded-3xl p-6 sm:p-12 shadow-sm border transition-all duration-300 space-y-16', containerMaxWidthClass, themeClasses]"
    >
      <!-- Channel Editorial Masthead -->
      <header class="pb-10 border-b border-stone-200/80 dark:border-stone-800 text-center space-y-3">
        <div class="inline-flex items-center justify-center w-14 h-14 rounded-full overflow-hidden border-2 border-stone-300 dark:border-stone-700 bg-stone-100 shadow-sm mx-auto">
          <img
            :src="(channelAvatar && channelAvatar.startsWith('data:')) ? channelAvatar : (channelAvatar || `https://i.gogingko.net/api/v1/v/telegram-profile/${channelName}`)"
            @error="($event.target as HTMLElement).style.display = 'none'"
            class="w-full h-full object-cover"
            alt=""
          />
        </div>
        <div>
          <h1 class="text-2xl sm:text-3xl font-serif font-bold tracking-tight">
            {{ channelTitle || `@${channelName}` }}
          </h1>
          <p class="text-xs font-mono text-stone-500 dark:text-stone-400 mt-1">
            Chronological Long-Form Editorial Stream · {{ readerPosts.length }} articles loaded
          </p>
        </div>
        <p
          v-if="metadata?.description || metadata?.about"
          class="text-xs italic text-stone-600 dark:text-stone-400 max-w-lg mx-auto leading-relaxed pt-1"
        >
          "{{ (metadata?.description || metadata?.about).slice(0, 180) }}{{ (metadata?.description || metadata?.about).length > 180 ? '...' : '' }}"
        </p>
      </header>

      <!-- Articles Flow -->
      <article
        v-for="(post, index) in readerPosts"
        :key="post.key || index"
        :id="`article-${post.key}`"
        :data-article-key="post.key"
        :data-article-index="index"
        class="space-y-4 pt-4 first:pt-0 scroll-mt-36 sm:scroll-mt-40"
      >
        <!-- Article Metadata Strip (Unboxed Editorial Typography) -->
        <div class="flex flex-wrap items-center justify-between gap-2 text-xs text-stone-500 dark:text-stone-400 font-mono pb-2 border-b border-stone-200/60 dark:border-stone-800/60">
          <div class="flex items-center gap-2">
            <span class="font-bold text-stone-700 dark:text-stone-300">
              #{{ index + 1 }}
            </span>
            <span aria-hidden="true">·</span>
            <span>{{ formatDate(post.data?.date) }}</span>
            <span aria-hidden="true">·</span>
            <span class="text-amber-700 dark:text-amber-400 font-bold">
              {{ getPostReadingStats(post).minutes }} min read
            </span>
            <span aria-hidden="true">·</span>
            <span>{{ getPostReadingStats(post).words }} words</span>
          </div>

          <!-- Quick Top Actions -->
          <div class="flex items-center gap-2 text-[11px]">
            <span v-if="post.data?.views" class="flex items-center gap-1 text-stone-400">
              <Eye class="w-3 h-3" />
              <span>{{ typeof post.data.views === 'number' ? post.data.views.toLocaleString() : post.data.views }}</span>
            </span>
            <span v-if="post.key" class="text-stone-400 font-mono">
              ID: {{ post.key.split('.').pop() }}
            </span>
          </div>
        </div>

        <!-- Quoted / Reply Context if present -->
        <blockquote
          v-if="post.data?.reply && Array.isArray(post.data.reply) && post.data.reply[1]"
          class="border-l-2 border-amber-600/60 dark:border-amber-500/40 pl-4 py-1 italic text-xs text-stone-600 dark:text-stone-400 bg-stone-500/5 rounded-r-xl"
        >
          <div class="text-[10px] font-mono not-italic uppercase text-amber-700 dark:text-amber-300 font-bold mb-0.5">
            Replying to ID: {{ post.data.reply[0] }}
          </div>
          <p class="whitespace-pre-wrap">{{ post.data.reply[1] }}</p>
        </blockquote>

        <!-- Forwarded Context if present -->
        <blockquote
          v-if="post.data?.forward_url"
          class="border-l-2 border-indigo-600/60 dark:border-indigo-500/40 pl-4 py-1 italic text-xs text-stone-600 dark:text-stone-400 bg-stone-500/5 rounded-r-xl"
        >
          <div class="text-[10px] font-mono not-italic uppercase text-indigo-700 dark:text-indigo-300 font-bold mb-0.5">
            Forwarded message from {{ post.data?.forward_title || 'channel' }}
          </div>
        </blockquote>

        <!-- Article Prose Body -->
        <div
          :class="[
            'prose-article whitespace-pre-wrap break-words transition-all duration-200',
            fontClasses,
            fontSizeClass,
            lineHeightClass,
            prefs.enableDropCap && getPostReadingStats(post).words > 40
              ? 'first-letter:text-4xl first-letter:font-serif first-letter:font-bold first-letter:float-left first-letter:mr-2.5 first-letter:leading-none first-letter:text-stone-900 dark:first-letter:text-stone-100'
              : ''
          ]"
          v-html="getSafePostContent(post)"
        ></div>

        <!-- Collapsible Media Drawer (Photos / Videos / Attachments) -->
        <div v-if="hasMedia(post)" class="pt-2">
          <!-- Media Toggle Drawer Button -->
          <button
            @click="toggleMedia(post)"
            class="w-full py-2 px-3 rounded-xl border border-stone-200 dark:border-stone-800 bg-black/3 dark:bg-white/3 hover:bg-black/6 dark:hover:bg-white/6 transition flex items-center justify-between text-xs font-mono cursor-pointer"
          >
            <div class="flex items-center gap-2">
              <span v-if="post.data?.photos?.length" class="flex items-center gap-1 text-teal-600 dark:text-teal-400 font-bold">
                <ImageIcon class="w-3.5 h-3.5" />
                <span>{{ post.data.photos.length }} Photo{{ post.data.photos.length > 1 ? 's' : '' }}</span>
              </span>
              <span v-if="post.data?.videos?.length" class="flex items-center gap-1 text-blue-600 dark:text-blue-400 font-bold">
                <VideoIcon class="w-3.5 h-3.5" />
                <span>Video Attached</span>
              </span>
              <span v-if="post.data?.linkPreview?.title" class="text-stone-500 truncate max-w-xs">
                Link: {{ post.data.linkPreview.title }}
              </span>
            </div>
            <div class="flex items-center gap-1 text-stone-500 text-[11px] font-bold">
              <span>{{ isMediaExpanded(post) ? 'Hide Media' : 'Show Media' }}</span>
              <ChevronUp v-if="isMediaExpanded(post)" class="w-3.5 h-3.5" />
              <ChevronDown v-else class="w-3.5 h-3.5" />
            </div>
          </button>

          <!-- Expanded Media Gallery Content -->
          <div
            v-if="isMediaExpanded(post)"
            class="mt-3 p-4 rounded-2xl border border-stone-200/80 dark:border-stone-800 bg-stone-500/5 space-y-4"
          >
            <!-- Photos Grid -->
            <div
              v-if="post.data?.photos && post.data.photos.length > 0"
              class="grid gap-3"
              :class="post.data.photos.length === 1 ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2'"
            >
              <div
                v-for="(photo, pIdx) in post.data.photos"
                :key="pIdx"
                class="rounded-xl overflow-hidden border border-stone-200 dark:border-stone-800 bg-black/10 group relative"
              >
                <img
                  :src="`https://i.gogingko.net/api/v1/v/telegram-photo/${post.key}_${pIdx}`"
                  class="w-full h-auto object-cover max-h-[500px]"
                  loading="lazy"
                  referrerpolicy="no-referrer"
                  alt="Post photo attachment"
                />
              </div>
            </div>

            <!-- Video Player -->
            <div
              v-if="post.data?.videos && post.data.videos.length > 0"
              class="rounded-xl overflow-hidden bg-black border border-stone-800"
            >
              <video
                controls
                preload="metadata"
                playsinline
                class="w-full max-h-[500px] object-contain mx-auto"
              >
                <source :src="getVideoUrl(post)" type="video/mp4" />
              </video>
            </div>

            <!-- Link Preview Box -->
            <div
              v-if="post.data?.linkPreview && (post.data.linkPreview.title || post.data.linkPreview.description)"
              class="p-3.5 rounded-xl border border-stone-200 dark:border-stone-800 bg-white/40 dark:bg-black/20 flex flex-col sm:flex-row gap-3 items-start"
            >
              <img
                v-if="post.data.linkPreview.image"
                :src="`https://i.gogingko.net/api/v1/v/telegram-photo/${post.key}_l_0`"
                class="w-24 h-24 rounded-lg object-cover shrink-0 border border-stone-200 dark:border-stone-800"
                alt=""
              />
              <div class="space-y-1 min-w-0 flex-1">
                <a
                  :href="post.data.linkPreview.url"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-xs font-bold hover:underline flex items-center gap-1 text-blue-600 dark:text-blue-400"
                >
                  <span>{{ post.data.linkPreview.title || 'Referenced Article' }}</span>
                  <ExternalLink class="w-3 h-3 shrink-0" />
                </a>
                <p v-if="post.data.linkPreview.description" class="text-xs text-stone-600 dark:text-stone-400 line-clamp-2">
                  {{ post.data.linkPreview.description }}
                </p>
              </div>
            </div>
          </div>
        </div>

        <!-- Article Footnote Actions Ribbon -->
        <footer class="pt-4 border-t border-stone-200/60 dark:border-stone-800/60 flex flex-wrap items-center justify-between gap-3 text-xs text-stone-500 font-mono">
          <div class="flex items-center gap-2">
            <button
              @click="copyPostText(post)"
              class="px-2.5 py-1 rounded-lg border border-stone-200 dark:border-stone-800 hover:bg-black/5 dark:hover:bg-white/5 transition flex items-center gap-1 cursor-pointer"
              title="Copy plain text"
            >
              <Check v-if="copiedPostKey === post.key" class="w-3 h-3 text-emerald-500" />
              <Copy v-else class="w-3 h-3" />
              <span>{{ copiedPostKey === post.key ? 'Copied' : 'Copy' }}</span>
            </button>

            <button
              @click="emit('translate', post)"
              class="px-2.5 py-1 rounded-lg border border-stone-200 dark:border-stone-800 hover:bg-black/5 dark:hover:bg-white/5 transition flex items-center gap-1 cursor-pointer"
              title="Translate with Gemini"
            >
              <Languages class="w-3 h-3 text-blue-500" />
              <span>Translate</span>
            </button>

            <button
              @click="emit('search-google', post.data?.content || post.data?.rawcontent || '')"
              class="px-2.5 py-1 rounded-lg border border-stone-200 dark:border-stone-800 hover:bg-black/5 dark:hover:bg-white/5 transition flex items-center gap-1 cursor-pointer"
              title="Search excerpt on Google"
            >
              <Search class="w-3 h-3 text-purple-500" />
              <span>Google</span>
            </button>

            <button
              @click="emit('add-to-workspace', post)"
              class="px-2.5 py-1 rounded-lg border border-stone-200 dark:border-stone-800 hover:bg-black/5 dark:hover:bg-white/5 transition flex items-center gap-1 cursor-pointer"
              title="Add post to research workspace graph"
            >
              <Layers class="w-3 h-3 text-teal-500" />
              <span>Workspace</span>
            </button>
          </div>

          <div>
            <a
              v-if="post.url || post.link"
              :href="post.url || post.link"
              target="_blank"
              rel="noopener noreferrer"
              class="text-stone-500 hover:text-stone-900 dark:hover:text-stone-200 transition flex items-center gap-1"
            >
              <span>Telegram Post</span>
              <ExternalLink class="w-3 h-3" />
            </a>
          </div>
        </footer>

        <!-- Section Hairline Divider Between Articles -->
        <div class="pt-8">
          <div class="w-full border-b border-stone-200/80 dark:border-stone-800/80"></div>
        </div>
      </article>

      <!-- Batch Milestone & Relocation Junction -->
      <div class="pt-12 pb-6 text-center space-y-4">
        <div class="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-mono bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 text-stone-600 dark:text-stone-400">
          <CheckCircle2 class="w-3.5 h-3.5 text-emerald-500" />
          <span>Articles 1–{{ readerPosts.length }} displayed · {{ scrollProgress }}% read</span>
        </div>

        <div v-if="hasMore" class="flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            @click="emit('load-more')"
            :disabled="isLoadingMore"
            class="px-5 py-2.5 rounded-xl text-xs font-bold transition flex items-center gap-2 shadow-sm cursor-pointer disabled:opacity-50"
            :class="[
              prefs.theme === 'sepia'
                ? 'bg-amber-800 hover:bg-amber-900 text-white active:scale-98'
                : 'bg-blue-600 hover:bg-blue-700 text-white active:scale-98'
            ]"
            title="Load next batch of articles"
          >
            <RefreshCw v-if="isLoadingMore" class="w-4 h-4 animate-spin" />
            <ArrowDown v-else class="w-4 h-4" />
            <span>{{ isLoadingMore ? 'Loading next articles...' : 'Load Next Articles' }}</span>
          </button>

          <button
            @click="scrollToTop"
            class="px-4 py-2.5 rounded-xl text-xs font-bold border border-stone-300 dark:border-stone-700 hover:bg-black/5 dark:hover:bg-white/5 text-stone-600 dark:text-stone-300 transition flex items-center gap-1.5 cursor-pointer"
          >
            <ArrowUp class="w-4 h-4" />
            <span>Return to Top</span>
          </button>
        </div>

        <div v-else-if="readerPosts.length > 0" class="text-xs text-stone-400 italic">
          ✓ All available articles for this channel have been loaded.
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* High-legibility anchor link styling inside article content */
:deep(a) {
  text-decoration-line: underline;
  text-underline-offset: 3px;
  transition: opacity 0.2s;
}
:deep(a:hover) {
  opacity: 0.8;
}
</style>
