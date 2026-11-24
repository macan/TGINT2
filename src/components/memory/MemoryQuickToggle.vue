<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { Bookmark } from "lucide-vue-next";
import { useMemory } from "../../composables/useMemory";
import { useI18n } from "../../i18n";
import type { MemorySourceTab } from "../../utils/indexedDbMemory";

const AUTO_HIDE_DELAY_MS = 5000;

const props = withDefaults(
  defineProps<{
    itemType: "post" | "channel";
    post?: any;
    channel?: any;
    metadata?: any;
    fallbackChannel?: string;
    fallbackChannelTitle?: string;
    sourceTab?: MemorySourceTab;
    /** Corner placement relative to a `relative group` parent card */
    placement?: "bottom-right" | "top-right" | "top-left" | "inline";
    size?: "sm" | "md";
    /** Optional extra offset class to avoid colliding with card-specific badges */
    offsetClass?: string;
  }>(),
  {
    sourceTab: "unknown",
    placement: "bottom-right",
    size: "sm",
    offsetClass: "",
  }
);

const { t } = useI18n();
const { isPostSaved, isChannelSaved, togglePostMemory, toggleChannelMemory } = useMemory();

const buttonRef = ref<HTMLButtonElement | null>(null);
const isFloating = computed(() => props.placement !== "inline");
const isRevealed = ref(false);
const isButtonHovered = ref(false);
const isButtonFocused = ref(false);

let hideTimer: ReturnType<typeof setTimeout> | null = null;
let hostEl: HTMLElement | null = null;

const isSaved = computed(() => {
  if (props.itemType === "post") {
    return isPostSaved(props.post, props.fallbackChannel || "");
  }
  return isChannelSaved(props.channel, props.metadata);
});

const isVisible = computed(() => {
  if (!isFloating.value) return true;
  return isRevealed.value || isButtonHovered.value || isButtonFocused.value;
});

function clearHideTimer() {
  if (hideTimer !== null) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
}

function scheduleAutoHide() {
  clearHideTimer();
  if (!isFloating.value) return;
  if (isButtonHovered.value || isButtonFocused.value) return;
  hideTimer = setTimeout(() => {
    hideTimer = null;
    if (!isButtonHovered.value && !isButtonFocused.value) {
      isRevealed.value = false;
    }
  }, AUTO_HIDE_DELAY_MS);
}

function revealWithAutoHide() {
  if (!isFloating.value) return;
  isRevealed.value = true;
  scheduleAutoHide();
}

function handleHostMouseEnter() {
  revealWithAutoHide();
}

function handleHostMouseLeave() {
  clearHideTimer();
  isButtonHovered.value = false;
  if (!isButtonFocused.value) {
    isRevealed.value = false;
  }
}

function handleButtonMouseEnter() {
  if (!isFloating.value) return;
  isButtonHovered.value = true;
  isRevealed.value = true;
  clearHideTimer();
}

function handleButtonMouseLeave() {
  if (!isFloating.value) return;
  isButtonHovered.value = false;
  if (isRevealed.value) {
    scheduleAutoHide();
  }
}

function handleButtonFocus() {
  if (!isFloating.value) return;
  isButtonFocused.value = true;
  isRevealed.value = true;
  clearHideTimer();
}

function handleButtonBlur() {
  if (!isFloating.value) return;
  isButtonFocused.value = false;
  if (isRevealed.value) {
    scheduleAutoHide();
  }
}

onMounted(() => {
  if (!isFloating.value) return;
  const btn = buttonRef.value;
  hostEl = (btn?.parentElement?.closest(".group") as HTMLElement | null) || btn?.parentElement || null;
  if (hostEl) {
    hostEl.addEventListener("mouseenter", handleHostMouseEnter);
    hostEl.addEventListener("mouseleave", handleHostMouseLeave);
    if (isSaved.value || hostEl.matches(":hover")) {
      revealWithAutoHide();
    }
  } else if (isSaved.value) {
    revealWithAutoHide();
  }
});

watch(isSaved, (saved, prevSaved) => {
  if (!isFloating.value) return;
  if (saved && !prevSaved) {
    revealWithAutoHide();
  }
});

onUnmounted(() => {
  clearHideTimer();
  if (hostEl) {
    hostEl.removeEventListener("mouseenter", handleHostMouseEnter);
    hostEl.removeEventListener("mouseleave", handleHostMouseLeave);
    hostEl = null;
  }
});

const tooltipLabel = computed(() => {
  if (isSaved.value) {
    return props.itemType === "post"
      ? t("memory.removePostTooltip")
      : t("memory.removeChannelTooltip");
  }
  return props.itemType === "post"
    ? t("memory.savePostTooltip")
    : t("memory.saveChannelTooltip");
});

const placementClasses = computed(() => {
  if (props.placement === "inline") return "";
  if (props.offsetClass) return `absolute z-30 ${props.offsetClass}`;
  switch (props.placement) {
    case "top-right":
      return "absolute top-3 right-3 z-30";
    case "top-left":
      return "absolute top-3 left-3 z-30";
    case "bottom-right":
    default:
      return "absolute bottom-3 right-3 z-30";
  }
});

const sizeClasses = computed(() => {
  return props.size === "md" ? "w-8 h-8" : "w-7 h-7";
});

const iconSizeClasses = computed(() => {
  return props.size === "md" ? "w-4 h-4" : "w-3.5 h-3.5";
});

const visualStateClasses = computed(() => {
  const toneClasses = isSaved.value
    ? "bg-amber-500 hover:bg-amber-600 text-white border-amber-400/80 shadow-sm shadow-amber-500/25 dark:bg-amber-500 dark:hover:bg-amber-400 dark:text-gray-950 dark:border-amber-300/60"
    : props.placement === "inline"
      ? "bg-white/90 dark:bg-gray-800/90 text-gray-500 dark:text-gray-400 hover:text-amber-600 dark:hover:text-amber-400 border-gray-200/80 dark:border-gray-700/80 hover:border-amber-300 dark:hover:border-amber-600/70 shadow-xs"
      : "bg-white/95 dark:bg-gray-800/95 backdrop-blur-sm text-gray-500 dark:text-gray-400 hover:text-amber-600 dark:hover:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/60 border-gray-200/90 dark:border-gray-600/80 hover:border-amber-300 dark:hover:border-amber-500/60 shadow-sm";

  if (!isFloating.value) {
    return `${toneClasses} ${isSaved.value ? "opacity-100 scale-100" : "opacity-70 hover:opacity-100"}`;
  }

  return isVisible.value
    ? `${toneClasses} opacity-100 scale-100 pointer-events-auto`
    : `${toneClasses} opacity-0 scale-95 pointer-events-none`;
});

async function handleToggle() {
  if (props.itemType === "post" && props.post) {
    await togglePostMemory(props.post, {
      fallbackChannel: props.fallbackChannel,
      fallbackChannelTitle: props.fallbackChannelTitle,
      sourceTab: props.sourceTab,
      savedMessage: t("memory.toastPostSaved"),
      removedMessage: t("memory.toastPostRemoved"),
    });
  } else if (props.itemType === "channel" && (props.metadata || props.channel)) {
    await toggleChannelMemory(props.channel || props.metadata, {
      metadata: props.metadata,
      sourceTab: props.sourceTab,
      savedMessage: t("memory.toastChannelSaved"),
      removedMessage: t("memory.toastChannelRemoved"),
    });
  }
  if (isFloating.value) {
    revealWithAutoHide();
  }
}
</script>

<template>
  <button
    ref="buttonRef"
    type="button"
    @click.stop.prevent="handleToggle"
    @mouseenter="handleButtonMouseEnter"
    @mouseleave="handleButtonMouseLeave"
    @focus="handleButtonFocus"
    @blur="handleButtonBlur"
    :title="tooltipLabel"
    :aria-label="tooltipLabel"
    :aria-pressed="isSaved"
    class="inline-flex items-center justify-center rounded-full border cursor-pointer transition-[opacity,transform,background-color,border-color,color] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/70"
    :class="[placementClasses, sizeClasses, visualStateClasses]"
  >
    <Bookmark
      :class="[iconSizeClasses, isSaved ? 'fill-current' : '']"
      :stroke-width="isSaved ? 2.25 : 2"
    />
  </button>
</template>
