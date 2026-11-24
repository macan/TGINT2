<script setup lang="ts">
import { computed } from "vue";
import { Bookmark } from "lucide-vue-next";
import { useMemory } from "../../composables/useMemory";
import { useI18n } from "../../i18n";
import type { MemorySourceTab } from "../../utils/indexedDbMemory";

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

const isSaved = computed(() => {
  if (props.itemType === "post") {
    return isPostSaved(props.post, props.fallbackChannel || "");
  }
  return isChannelSaved(props.channel, props.metadata);
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
}
</script>

<template>
  <button
    type="button"
    @click.stop.prevent="handleToggle"
    :title="tooltipLabel"
    :aria-label="tooltipLabel"
    :aria-pressed="isSaved"
    class="inline-flex items-center justify-center rounded-full border cursor-pointer transition-[opacity,transform,background-color,border-color,color] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/70 focus-visible:opacity-100"
    :class="[
      placementClasses,
      sizeClasses,
      isSaved
        ? 'opacity-100 scale-100 bg-amber-500 hover:bg-amber-600 text-white border-amber-400/80 shadow-sm shadow-amber-500/25 dark:bg-amber-500 dark:hover:bg-amber-400 dark:text-gray-950 dark:border-amber-300/60'
        : placement === 'inline'
          ? 'opacity-70 hover:opacity-100 bg-white/90 dark:bg-gray-800/90 text-gray-500 dark:text-gray-400 hover:text-amber-600 dark:hover:text-amber-400 border-gray-200/80 dark:border-gray-700/80 hover:border-amber-300 dark:hover:border-amber-600/70 shadow-xs'
          : 'opacity-0 scale-95 group-hover:opacity-100 group-hover:scale-100 group-focus-within:opacity-100 group-focus-within:scale-100 bg-white/95 dark:bg-gray-800/95 backdrop-blur-sm text-gray-500 dark:text-gray-400 hover:text-amber-600 dark:hover:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/60 border-gray-200/90 dark:border-gray-600/80 hover:border-amber-300 dark:hover:border-amber-500/60 shadow-sm'
    ]"
  >
    <Bookmark
      :class="[iconSizeClasses, isSaved ? 'fill-current' : '']"
      :stroke-width="isSaved ? 2.25 : 2"
    />
  </button>
</template>
