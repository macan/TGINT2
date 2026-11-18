<script setup lang="ts">
import { ref, computed } from "vue";
import {
  Tag,
  Folder,
  FolderPlus,
  Plus,
  Minus,
  Check,
  X
} from "lucide-vue-next";
import { useI18n } from "../../i18n";
import {
  LISTEN_LABEL_COLOR_KEYS,
  LISTEN_LABEL_COLORS,
  cleanLabelName,
  type ListenLabelColorKey,
  type ListenLabelSummary,
  type FolderSelectOption
} from "../../utils/listenLabels";

const props = defineProps<{
  selectedCount: number;
  visibleLeafCount: number;
  labels: ListenLabelSummary[];
  folderOptions: FolderSelectOption[];
}>();

const emit = defineEmits<{
  (e: "select-all-visible"): void;
  (e: "clear-selection"): void;
  (e: "done"): void;
  (e: "batch-apply-labels", payload: { add: string[]; remove: string[] }): void;
  (e: "batch-create-apply-label", payload: { name: string; color: ListenLabelColorKey }): void;
  (e: "batch-move-folder", targetFolderId: string | null): void;
  (e: "batch-create-folder-move", payload: { folderName: string; parentFolderId: string | null }): void;
}>();

const { t } = useI18n();

const openMenu = ref<"labels" | "folder" | null>(null);
const pendingAddKeys = ref<Set<string>>(new Set());
const pendingRemoveKeys = ref<Set<string>>(new Set());
const inlineLabelName = ref("");
const inlineLabelColor = ref<ListenLabelColorKey>("teal");

const selectedFolderTarget = ref<string>("__root__");
const isNewFolderMode = ref(false);
const newFolderInput = ref("");

const toggleMenu = (menu: "labels" | "folder") => {
  if (openMenu.value === menu) {
    openMenu.value = null;
    return;
  }
  openMenu.value = menu;
  if (menu === "labels") {
    pendingAddKeys.value = new Set();
    pendingRemoveKeys.value = new Set();
  } else {
    isNewFolderMode.value = false;
    newFolderInput.value = "";
  }
};

const cycleLabelIntent = (labelName: string) => {
  const nextAdd = new Set(pendingAddKeys.value);
  const nextRem = new Set(pendingRemoveKeys.value);
  if (nextAdd.has(labelName)) {
    nextAdd.delete(labelName);
    nextRem.add(labelName);
  } else if (nextRem.has(labelName)) {
    nextRem.delete(labelName);
  } else {
    nextAdd.add(labelName);
  }
  pendingAddKeys.value = nextAdd;
  pendingRemoveKeys.value = nextRem;
};

const hasPendingLabelChanges = computed(
  () => pendingAddKeys.value.size > 0 || pendingRemoveKeys.value.size > 0
);

const applyBatchLabels = () => {
  if (!hasPendingLabelChanges.value) return;
  emit("batch-apply-labels", {
    add: Array.from(pendingAddKeys.value),
    remove: Array.from(pendingRemoveKeys.value)
  });
  pendingAddKeys.value = new Set();
  pendingRemoveKeys.value = new Set();
  openMenu.value = null;
};

const handleQuickCreateAndApply = () => {
  const clean = cleanLabelName(inlineLabelName.value);
  if (!clean) return;
  emit("batch-create-apply-label", { name: clean, color: inlineLabelColor.value });
  inlineLabelName.value = "";
  openMenu.value = null;
};

const confirmFolderAction = () => {
  const targetId = selectedFolderTarget.value === "__root__" ? null : selectedFolderTarget.value;
  if (isNewFolderMode.value) {
    const clean = newFolderInput.value.trim();
    if (!clean) return;
    emit("batch-create-folder-move", { folderName: clean, parentFolderId: targetId });
    newFolderInput.value = "";
    isNewFolderMode.value = false;
  } else {
    emit("batch-move-folder", targetId);
  }
  openMenu.value = null;
};
</script>

<template>
  <div class="px-3.5 py-2.5 border-b border-teal-200/80 dark:border-teal-800/70 bg-teal-50/75 dark:bg-teal-950/35 shrink-0 space-y-2">
    <!-- Top Controls Row -->
    <div class="flex items-center justify-between gap-2 flex-wrap">
      <div class="flex items-center gap-2 min-w-0">
        <span class="px-2 py-0.5 rounded-lg bg-teal-600 text-white text-[11px] font-mono tabular-nums font-bold">
          {{ selectedCount }}
        </span>
        <span class="text-xs font-bold text-teal-950 dark:text-teal-100">
          {{ t('listen.batch.selectedCountLabel', { count: selectedCount }) }}
        </span>
        <button
          v-if="visibleLeafCount > 0"
          type="button"
          @click="emit('select-all-visible')"
          class="text-[11px] font-semibold text-teal-700 dark:text-teal-300 hover:underline cursor-pointer"
        >
          {{ t('listen.batch.selectVisible', { count: visibleLeafCount }) }}
        </button>
        <button
          v-if="selectedCount > 0"
          type="button"
          @click="emit('clear-selection')"
          class="text-[11px] font-semibold text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 cursor-pointer"
        >
          {{ t('listen.batch.clear') }}
        </button>
      </div>

      <div class="flex items-center gap-1.5 flex-wrap">
        <button
          type="button"
          :disabled="selectedCount === 0"
          @click="toggleMenu('labels')"
          class="px-2.5 py-1 rounded-lg text-xs font-bold border inline-flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          :class="
            openMenu === 'labels'
              ? 'bg-teal-600 text-white border-teal-700'
              : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 border-gray-200 dark:border-gray-700 hover:border-teal-400'
          "
        >
          <Tag class="h-3.5 w-3.5" />
          <span>{{ t('listen.batch.assignLabels') }}</span>
        </button>

        <button
          type="button"
          :disabled="selectedCount === 0"
          @click="toggleMenu('folder')"
          class="px-2.5 py-1 rounded-lg text-xs font-bold border inline-flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          :class="
            openMenu === 'folder'
              ? 'bg-teal-600 text-white border-teal-700'
              : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 border-gray-200 dark:border-gray-700 hover:border-teal-400'
          "
        >
          <Folder class="h-3.5 w-3.5 text-amber-500" />
          <span>{{ t('listen.batch.moveToFolder') }}</span>
        </button>

        <button
          type="button"
          @click="emit('done')"
          class="px-2.5 py-1 rounded-lg text-xs font-bold bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 hover:opacity-90 transition-opacity cursor-pointer"
        >
          {{ t('common.done') || 'Done' }}
        </button>
      </div>
    </div>

    <!-- Inline Batch Assign Labels Drawer -->
    <div
      v-if="openMenu === 'labels' && selectedCount > 0"
      class="p-3 rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 space-y-2.5"
    >
      <div class="flex items-center justify-between text-[11px] text-gray-500 dark:text-gray-400">
        <span>{{ t('listen.batch.labelCycleHint') }}</span>
        <button type="button" @click="openMenu = null" class="p-0.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 cursor-pointer">
          <X class="h-3.5 w-3.5" />
        </button>
      </div>

      <div v-if="labels.length > 0" class="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
        <button
          v-for="label in labels"
          :key="label.key"
          type="button"
          @click="cycleLabelIntent(label.name)"
          class="px-2 py-1 rounded-lg text-xs font-semibold border inline-flex items-center gap-1.5 transition-all cursor-pointer"
          :class="
            pendingAddKeys.has(label.name)
              ? 'bg-emerald-600 text-white border-emerald-700'
              : pendingRemoveKeys.has(label.name)
                ? 'bg-rose-600 text-white border-rose-700 line-through'
                : LISTEN_LABEL_COLORS[label.color].chipClass
          "
        >
          <Plus v-if="pendingAddKeys.has(label.name)" class="h-3 w-3" />
          <Minus v-else-if="pendingRemoveKeys.has(label.name)" class="h-3 w-3" />
          <span
            v-else
            class="w-2 h-2 rounded-full"
            :class="LISTEN_LABEL_COLORS[label.color].dotClass"
          ></span>
          <span>{{ label.name }}</span>
        </button>
      </div>

      <!-- Quick create & apply new label to selected batch -->
      <div class="flex items-center gap-2 flex-wrap pt-1 border-t border-gray-100 dark:border-gray-800">
        <input
          v-model="inlineLabelName"
          type="text"
          maxlength="40"
          :placeholder="t('listen.labels.newLabelPlaceholder')"
          @keydown.enter.prevent="handleQuickCreateAndApply"
          class="flex-1 min-w-[140px] px-2.5 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-xs text-gray-900 dark:text-gray-100 focus:outline-none focus:border-teal-500"
        />
        <div class="flex items-center gap-1">
          <button
            v-for="colorKey in LISTEN_LABEL_COLOR_KEYS"
            :key="colorKey"
            type="button"
            @click="inlineLabelColor = colorKey"
            class="w-4 h-4 rounded-full cursor-pointer flex items-center justify-center"
            :class="[
              LISTEN_LABEL_COLORS[colorKey].swatchClass,
              inlineLabelColor === colorKey ? 'ring-2 ring-offset-1 ring-teal-500 dark:ring-offset-gray-900' : 'opacity-70 hover:opacity-100'
            ]"
          >
            <Check v-if="inlineLabelColor === colorKey" class="h-2.5 w-2.5 text-white" />
          </button>
        </div>
        <button
          v-if="cleanLabelName(inlineLabelName)"
          type="button"
          @click="handleQuickCreateAndApply"
          class="px-2.5 py-1 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold cursor-pointer"
        >
          {{ t('listen.labels.createAndApply') }}
        </button>
        <button
          v-if="hasPendingLabelChanges"
          type="button"
          @click="applyBatchLabels"
          class="px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold inline-flex items-center gap-1 cursor-pointer ml-auto"
        >
          <Check class="h-3.5 w-3.5" />
          <span>{{ t('listen.batch.applyToSelected', { count: selectedCount }) }}</span>
        </button>
      </div>
    </div>

    <!-- Inline Batch Move / Group to Folder Drawer -->
    <div
      v-if="openMenu === 'folder' && selectedCount > 0"
      class="p-3 rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 space-y-2.5"
    >
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-2 text-xs font-bold text-gray-800 dark:text-gray-200">
          <button
            type="button"
            @click="isNewFolderMode = false"
            class="px-2 py-0.5 rounded-md border text-[11px] cursor-pointer"
            :class="!isNewFolderMode ? 'bg-teal-50 dark:bg-teal-950/60 border-teal-300 dark:border-teal-700 text-teal-700 dark:text-teal-300' : 'border-gray-200 dark:border-gray-700 text-gray-500'"
          >
            {{ t('listen.batch.existingFolder') }}
          </button>
          <button
            type="button"
            @click="isNewFolderMode = true"
            class="px-2 py-0.5 rounded-md border text-[11px] inline-flex items-center gap-1 cursor-pointer"
            :class="isNewFolderMode ? 'bg-teal-50 dark:bg-teal-950/60 border-teal-300 dark:border-teal-700 text-teal-700 dark:text-teal-300' : 'border-gray-200 dark:border-gray-700 text-gray-500'"
          >
            <FolderPlus class="h-3 w-3" />
            <span>{{ t('listen.batch.newFolderFromSelection') }}</span>
          </button>
        </div>
        <button type="button" @click="openMenu = null" class="p-0.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 cursor-pointer">
          <X class="h-3.5 w-3.5" />
        </button>
      </div>

      <div class="flex items-center gap-2 flex-wrap sm:flex-nowrap">
        <select
          v-model="selectedFolderTarget"
          class="flex-1 min-w-[160px] px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-xs text-gray-900 dark:text-gray-100 focus:outline-none focus:border-teal-500"
        >
          <option
            v-for="opt in folderOptions"
            :key="opt.id ?? '__root__'"
            :value="opt.id ?? '__root__'"
          >
            {{ opt.depth > 0 ? `${'— '.repeat(opt.depth)}${opt.name}` : opt.name }}
          </option>
        </select>

        <input
          v-if="isNewFolderMode"
          v-model="newFolderName"
          type="text"
          :placeholder="t('listen.labels.newFolderPlaceholder')"
          @keydown.enter.prevent="confirmFolderAction"
          class="flex-1 min-w-[160px] px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs text-gray-900 dark:text-gray-100 focus:outline-none focus:border-teal-500"
          autofocus
        />

        <button
          type="button"
          @click="confirmFolderAction"
          :disabled="isNewFolderMode && !newFolderName.trim()"
          class="px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 disabled:opacity-40 text-white text-xs font-bold inline-flex items-center gap-1 cursor-pointer shrink-0"
        >
          <Check class="h-3.5 w-3.5" />
          <span>{{ isNewFolderMode ? t('listen.batch.createAndMove') : t('listen.batch.moveNow') }}</span>
        </button>
      </div>
    </div>
  </div>
</template>
