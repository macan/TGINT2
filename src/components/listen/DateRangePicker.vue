<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import { Calendar, Check, ChevronDown, Clock, X } from "lucide-vue-next";
import { useI18n } from "../../i18n";
import {
  type ListenDatePreset,
  type ListenDateRangeValue,
  isListenDateRangeActive,
} from "../../utils/listenDateRange";

const props = withDefaults(
  defineProps<{
    modelValue: ListenDateRangeValue;
    compact?: boolean;
    align?: "left" | "right";
  }>(),
  {
    compact: false,
    align: "right",
  }
);

const emit = defineEmits<{
  (e: "update:modelValue", value: ListenDateRangeValue): void;
}>();

const { t } = useI18n();

const isOpen = ref(false);
const rootRef = ref<HTMLElement | null>(null);
const draftStart = ref(props.modelValue.customStart || "");
const draftEnd = ref(props.modelValue.customEnd || "");

watch(
  () => props.modelValue,
  (val) => {
    draftStart.value = val.customStart || "";
    draftEnd.value = val.customEnd || "";
  },
  { deep: true }
);

const isActive = computed(() => isListenDateRangeActive(props.modelValue));

const todayInputStr = computed(() => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
});

const presetOptions = computed<{ key: ListenDatePreset; label: string }[]>(() => [
  { key: "all", label: t("listen.dateRange.allTime") || "All Time" },
  { key: "1h", label: t("listen.dateRange.last1h") || "Last 1h" },
  { key: "24h", label: t("listen.dateRange.last24h") || "Last 24h" },
  { key: "3d", label: t("listen.dateRange.last3d") || "Last 3d" },
  { key: "7d", label: t("listen.dateRange.last7d") || "Last 7d" },
  { key: "30d", label: t("listen.dateRange.last30d") || "Last 30d" },
]);

const activeLabel = computed(() => {
  const p = props.modelValue.preset;
  if (p === "custom") {
    const s = props.modelValue.customStart;
    const e = props.modelValue.customEnd;
    if (s && e) return `${s.slice(5)} ~ ${e.slice(5)}`;
    if (s) return `≥ ${s.slice(5)}`;
    if (e) return `≤ ${e.slice(5)}`;
    return t("listen.dateRange.custom") || "Custom Range";
  }
  const match = presetOptions.value.find((opt) => opt.key === p);
  return match ? match.label : t("listen.dateRange.allTime") || "All Time";
});

const selectPreset = (preset: ListenDatePreset) => {
  emit("update:modelValue", {
    preset,
    customStart: preset === "custom" ? draftStart.value : "",
    customEnd: preset === "custom" ? draftEnd.value : "",
  });
  isOpen.value = false;
};

const applyCustomRange = () => {
  let s = draftStart.value.trim();
  let e = draftEnd.value.trim();
  if (!s && !e) {
    resetRange();
    return;
  }
  if (s && e && s > e) {
    const tmp = s;
    s = e;
    e = tmp;
  }
  emit("update:modelValue", {
    preset: "custom",
    customStart: s,
    customEnd: e,
  });
  isOpen.value = false;
};

const resetRange = () => {
  draftStart.value = "";
  draftEnd.value = "";
  emit("update:modelValue", {
    preset: "all",
    customStart: "",
    customEnd: "",
  });
  isOpen.value = false;
};

const onDocumentClick = (evt: MouseEvent) => {
  if (!isOpen.value) return;
  const target = evt.target as Node | null;
  if (rootRef.value && target && !rootRef.value.contains(target)) {
    isOpen.value = false;
  }
};

const onDocumentKeyDown = (evt: KeyboardEvent) => {
  if (evt.key === "Escape" && isOpen.value) {
    isOpen.value = false;
  }
};

onMounted(() => {
  document.addEventListener("click", onDocumentClick);
  document.addEventListener("keydown", onDocumentKeyDown);
});

onUnmounted(() => {
  document.removeEventListener("click", onDocumentClick);
  document.removeEventListener("keydown", onDocumentKeyDown);
});
</script>

<template>
  <div ref="rootRef" class="relative inline-flex items-center shrink-0">
    <!-- Trigger Pill / Compact Button -->
    <div
      class="inline-flex items-center border transition-all shadow-2xs overflow-hidden"
      :class="[
        compact ? 'rounded-lg' : 'rounded-xl',
        isActive
          ? 'bg-indigo-50 dark:bg-indigo-950/60 border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300'
          : compact
            ? 'bg-transparent border-transparent hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 hover:text-teal-600 dark:hover:text-teal-400'
            : 'bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300'
      ]"
    >
      <button
        type="button"
        @click.stop="isOpen = !isOpen"
        class="inline-flex items-center gap-1.5 transition-colors cursor-pointer hover:bg-black/5 dark:hover:bg-white/5"
        :class="compact ? 'p-1.5 text-[11px] font-bold' : 'px-2.5 py-1.5 text-xs font-bold'"
        :title="`${t('listen.dateRange.filterTooltip') || 'Filter by time range'}: ${activeLabel}`"
      >
        <Calendar
          class="h-3.5 w-3.5 shrink-0"
          :class="isActive ? 'text-indigo-600 dark:text-indigo-400' : (compact ? '' : 'text-gray-400')"
        />
        <span v-if="!compact || isActive" class="whitespace-nowrap">
          {{ isActive ? activeLabel : (t("listen.dateRange.allTime") || "All Time") }}
        </span>
        <ChevronDown
          v-if="!compact"
          class="h-3 w-3 opacity-60 transition-transform duration-150 shrink-0"
          :class="{ 'rotate-180': isOpen }"
        />
      </button>

      <button
        v-if="isActive"
        type="button"
        @click.stop="resetRange"
        class="border-l border-current/15 hover:bg-black/10 dark:hover:bg-white/10 transition-colors cursor-pointer flex items-center justify-center"
        :class="compact ? 'px-1 py-1.5' : 'px-1.5 py-1.5'"
        :title="t('listen.dateRange.clearTip') || 'Clear date range filter'"
      >
        <X class="h-3 w-3 opacity-75" />
      </button>
    </div>

    <!-- Popover Dropdown -->
    <div
      v-if="isOpen"
      @click.stop
      class="absolute top-full mt-1.5 w-72 bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-200/90 dark:border-gray-700 p-3 z-50 text-xs select-none space-y-3"
      :class="align === 'left' ? 'left-0' : 'right-0'"
    >
      <!-- Header -->
      <div class="flex items-center justify-between border-b border-gray-100 dark:border-gray-700/60 pb-2">
        <div class="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider text-gray-500 dark:text-gray-400">
          <Clock class="h-3.5 w-3.5 text-indigo-500" />
          <span>{{ t("listen.dateRange.buttonLabel") || "Time Range" }}</span>
        </div>
        <button
          v-if="isActive"
          type="button"
          @click="resetRange"
          class="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
        >
          {{ t("listen.dateRange.reset") || "Reset" }}
        </button>
      </div>

      <!-- Quick Presets Grid -->
      <div class="grid grid-cols-2 gap-1.5">
        <button
          v-for="opt in presetOptions"
          :key="opt.key"
          type="button"
          @click="selectPreset(opt.key)"
          class="px-2.5 py-1.5 rounded-xl text-left font-semibold flex items-center justify-between gap-1.5 border transition-all cursor-pointer"
          :class="[
            modelValue.preset === opt.key
              ? 'bg-indigo-50 dark:bg-indigo-950/60 border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300 font-bold shadow-2xs'
              : 'bg-gray-50/70 dark:bg-gray-900/50 border-gray-200/70 dark:border-gray-700/60 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-750'
          ]"
        >
          <span class="truncate">{{ opt.label }}</span>
          <Check
            v-if="modelValue.preset === opt.key"
            class="h-3 w-3 text-indigo-600 dark:text-indigo-400 shrink-0"
          />
        </button>
      </div>

      <!-- Custom Date Range Inputs -->
      <div class="border-t border-gray-100 dark:border-gray-700/60 pt-2.5 space-y-2">
        <div class="text-[10px] font-black uppercase tracking-wider text-gray-400 dark:text-gray-500">
          {{ t("listen.dateRange.custom") || "Custom Range" }}
        </div>
        <div class="grid grid-cols-2 gap-2">
          <label class="space-y-1 block">
            <span class="text-[10px] font-semibold text-gray-500 dark:text-gray-400 block">
              {{ t("listen.dateRange.from") || "From" }}
            </span>
            <input
              v-model="draftStart"
              type="date"
              :max="draftEnd || todayInputStr"
              class="w-full px-2 py-1 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-[11px] font-mono text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </label>
          <label class="space-y-1 block">
            <span class="text-[10px] font-semibold text-gray-500 dark:text-gray-400 block">
              {{ t("listen.dateRange.to") || "To" }}
            </span>
            <input
              v-model="draftEnd"
              type="date"
              :min="draftStart || undefined"
              :max="todayInputStr"
              class="w-full px-2 py-1 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-[11px] font-mono text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </label>
        </div>
        <div class="flex items-center justify-end gap-1.5 pt-1">
          <button
            type="button"
            @click="resetRange"
            class="px-2.5 py-1 rounded-lg text-[11px] font-semibold text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors cursor-pointer"
          >
            {{ t("listen.dateRange.reset") || "Reset" }}
          </button>
          <button
            type="button"
            @click="applyCustomRange"
            class="px-3 py-1 rounded-lg text-[11px] font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-2xs transition-colors cursor-pointer"
          >
            {{ t("listen.dateRange.apply") || "Apply" }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
