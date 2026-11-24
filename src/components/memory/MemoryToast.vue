<script setup lang="ts">
import { Bookmark, RotateCcw, X } from "lucide-vue-next";
import { useMemory } from "../../composables/useMemory";
import { useI18n } from "../../i18n";

const { t } = useI18n();
const { memoryToast, undoLastMemoryDelete, dismissMemoryToast } = useMemory();

async function handleUndo() {
  await undoLastMemoryDelete(t("memory.toastRestored"));
}
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]"
      enter-from-class="opacity-0 translate-y-2 scale-95"
      enter-to-class="opacity-100 translate-y-0 scale-100"
      leave-active-class="transition-[opacity,transform] duration-150 ease-in"
      leave-from-class="opacity-100 translate-y-0 scale-100"
      leave-to-class="opacity-0 translate-y-2 scale-95"
    >
      <div
        v-if="memoryToast.visible"
        role="status"
        aria-live="polite"
        class="fixed bottom-5 right-5 z-[110] max-w-sm flex items-center gap-2.5 px-3.5 py-2.5 rounded-2xl border shadow-lg backdrop-blur-md text-xs font-semibold"
        :class="
          memoryToast.tone === 'saved'
            ? 'bg-gray-900/95 dark:bg-gray-800/95 text-white border-amber-500/40'
            : memoryToast.tone === 'error'
              ? 'bg-rose-950/95 text-rose-100 border-rose-500/40'
              : 'bg-gray-900/95 dark:bg-gray-800/95 text-gray-100 border-gray-700'
        "
      >
        <Bookmark
          class="w-3.5 h-3.5 shrink-0"
          :class="
            memoryToast.tone === 'saved'
              ? 'text-amber-400 fill-amber-400'
              : memoryToast.tone === 'error'
                ? 'text-rose-400'
                : 'text-gray-400'
          "
        />
        <span class="leading-snug">{{ memoryToast.message }}</span>
        <button
          v-if="memoryToast.canUndo"
          type="button"
          @click="handleUndo"
          class="ml-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/35 text-amber-300 font-bold transition-colors cursor-pointer whitespace-nowrap shrink-0"
        >
          <RotateCcw class="w-3 h-3" />
          <span>{{ t("memory.undo") }}</span>
        </button>
        <button
          type="button"
          @click="dismissMemoryToast"
          class="ml-0.5 p-0.5 rounded-md text-gray-400 hover:text-white transition-colors cursor-pointer shrink-0"
          :aria-label="t('common.close') || 'Close'"
        >
          <X class="w-3.5 h-3.5" />
        </button>
      </div>
    </Transition>
  </Teleport>
</template>
