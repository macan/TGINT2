<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import {
  Tag,
  Folder,
  FolderPlus,
  Plus,
  Check,
  X,
  Search
} from "lucide-vue-next";
import type { ListenItem } from "../../types";
import { useI18n } from "../../i18n";
import {
  LISTEN_LABEL_COLOR_KEYS,
  LISTEN_LABEL_COLORS,
  cleanLabelName,
  normalizeLabelKey,
  type ListenLabelColorKey,
  type ListenLabelSummary,
  type FolderSelectOption
} from "../../utils/listenLabels";

export interface PopoverAnchorRect {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

const props = defineProps<{
  isOpen: boolean;
  item: ListenItem | null;
  anchorRect: PopoverAnchorRect | null;
  labels: ListenLabelSummary[];
  folderOptions: FolderSelectOption[];
  currentParentFolderId: string | null;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "toggle-label", payload: { itemId: string; labelName: string }): void;
  (e: "create-and-apply-label", payload: { itemId: string; name: string; color: ListenLabelColorKey }): void;
  (e: "move-to-folder", payload: { itemId: string; targetFolderId: string | null }): void;
  (e: "create-folder-and-move", payload: { itemId: string; folderName: string }): void;
  (e: "open-label-manager"): void;
}>();

const { t } = useI18n();

const popoverRef = ref<HTMLElement | null>(null);
const labelQuery = ref("");
const selectedNewColor = ref<ListenLabelColorKey>("teal");
const isCreatingFolder = ref(false);
const newFolderName = ref("");

watch(
  () => props.isOpen,
  (open) => {
    if (!open) {
      labelQuery.value = "";
      isCreatingFolder.value = false;
      newFolderName.value = "";
    }
  }
);

const itemLabelKeys = computed(() => {
  const tags = props.item?.tags;
  if (!Array.isArray(tags)) return new Set<string>();
  return new Set(tags.map((tag) => normalizeLabelKey(tag)).filter(Boolean));
});

const filteredLabels = computed(() => {
  const q = cleanLabelName(labelQuery.value).toLowerCase();
  if (!q) return props.labels;
  return props.labels.filter((l) => l.name.toLowerCase().includes(q));
});

const canCreateInline = computed(() => {
  const clean = cleanLabelName(labelQuery.value);
  if (!clean) return false;
  const key = clean.toLowerCase();
  return !props.labels.some((l) => l.key === key);
});

const popoverStyle = computed(() => {
  const rect = props.anchorRect;
  const width = 296;
  const estimatedHeight = 410;
  if (!rect || typeof window === "undefined") {
    return { top: "80px", left: "24px", width: `${width}px` };
  }
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let left = rect.right - width;
  if (left < 12) left = rect.left;
  if (left + width > vw - 12) left = Math.max(12, vw - width - 12);

  let top = rect.bottom + 6;
  if (top + estimatedHeight > vh - 12) {
    const aboveTop = rect.top - estimatedHeight - 6;
    if (aboveTop >= 12) {
      top = aboveTop;
    } else {
      top = Math.max(12, vh - estimatedHeight - 12);
    }
  }

  return {
    top: `${Math.round(top)}px`,
    left: `${Math.round(left)}px`,
    width: `${width}px`
  };
});

const handleToggleLabel = (labelName: string) => {
  if (!props.item) return;
  emit("toggle-label", { itemId: props.item.id, labelName });
};

const handleCreateInlineLabel = () => {
  if (!props.item) return;
  const clean = cleanLabelName(labelQuery.value);
  if (!clean) return;
  if (canCreateInline.value) {
    emit("create-and-apply-label", {
      itemId: props.item.id,
      name: clean,
      color: selectedNewColor.value
    });
  } else {
    const existing = props.labels.find((l) => l.key === clean.toLowerCase());
    if (existing && !itemLabelKeys.value.has(existing.key)) {
      emit("toggle-label", { itemId: props.item.id, labelName: existing.name });
    }
  }
  labelQuery.value = "";
};

const handleFolderChange = (event: Event) => {
  if (!props.item) return;
  const val = (event.target as HTMLSelectElement).value;
  const targetFolderId = val === "__root__" ? null : val;
  if (targetFolderId === props.currentParentFolderId) return;
  emit("move-to-folder", { itemId: props.item.id, targetFolderId });
};

const handleCreateFolderMove = () => {
  if (!props.item) return;
  const clean = newFolderName.value.trim();
  if (!clean) return;
  emit("create-folder-and-move", { itemId: props.item.id, folderName: clean });
  newFolderName.value = "";
  isCreatingFolder.value = false;
};

const handleOutsidePointerDown = (e: MouseEvent) => {
  if (!props.isOpen) return;
  const target = e.target as Node | null;
  if (popoverRef.value && target && !popoverRef.value.contains(target)) {
    emit("close");
  }
};

const handleKeydown = (e: KeyboardEvent) => {
  if (props.isOpen && e.key === "Escape") {
    e.stopPropagation();
    emit("close");
  }
};

onMounted(() => {
  document.addEventListener("mousedown", handleOutsidePointerDown);
  document.addEventListener("keydown", handleKeydown);
});

onUnmounted(() => {
  document.removeEventListener("mousedown", handleOutsidePointerDown);
  document.removeEventListener("keydown", handleKeydown);
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="isOpen && item"
      ref="popoverRef"
      :style="popoverStyle"
      @click.stop
      class="fixed z-[95] bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-xl overflow-hidden flex flex-col"
    >
      <!-- Header -->
      <div class="px-3.5 py-2.5 border-b border-gray-100 dark:border-gray-800 bg-gray-50/70 dark:bg-gray-800/50 flex items-center justify-between gap-2">
        <div class="flex items-center gap-1.5 min-w-0">
          <Tag class="h-3.5 w-3.5 text-teal-600 dark:text-teal-400 shrink-0" />
          <span class="text-xs font-bold text-gray-800 dark:text-gray-100 truncate">
            {{ item.name }}
          </span>
        </div>
        <button
          type="button"
          @click="emit('close')"
          class="p-1 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer shrink-0"
          :title="t('common.close')"
        >
          <X class="h-3.5 w-3.5" />
        </button>
      </div>

      <!-- Folder Assignment Section -->
      <div class="px-3.5 py-2.5 border-b border-gray-100 dark:border-gray-800 space-y-2">
        <div class="flex items-center justify-between gap-2">
          <span class="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 flex items-center gap-1">
            <Folder class="h-3 w-3 text-amber-500" />
            <span>{{ t('listen.labels.folderGroup') }}</span>
          </span>
          <button
            type="button"
            @click="isCreatingFolder = !isCreatingFolder"
            class="text-[10px] font-semibold text-teal-600 dark:text-teal-400 hover:underline inline-flex items-center gap-0.5 cursor-pointer"
          >
            <FolderPlus class="h-3 w-3" />
            <span>{{ isCreatingFolder ? t('common.cancel') : t('listen.labels.newFolder') }}</span>
          </button>
        </div>

        <div v-if="isCreatingFolder" class="flex items-center gap-1.5">
          <input
            v-model="newFolderName"
            type="text"
            :placeholder="t('listen.labels.newFolderPlaceholder')"
            @keydown.enter.prevent="handleCreateFolderMove"
            class="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-xs text-gray-900 dark:text-gray-100 focus:outline-none focus:border-teal-500"
            autofocus
          />
          <button
            type="button"
            @click="handleCreateFolderMove"
            :disabled="!newFolderName.trim()"
            class="px-2.5 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 disabled:opacity-40 text-white text-[11px] font-bold cursor-pointer shrink-0"
          >
            {{ t('common.confirm') }}
          </button>
        </div>

        <select
          v-else
          :value="currentParentFolderId === null ? '__root__' : currentParentFolderId"
          @change="handleFolderChange"
          class="w-full px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs font-medium text-gray-800 dark:text-gray-200 focus:outline-none focus:border-teal-500 cursor-pointer"
        >
          <option
            v-for="opt in folderOptions"
            :key="opt.id ?? '__root__'"
            :value="opt.id ?? '__root__'"
          >
            {{ opt.depth > 0 ? `${'— '.repeat(opt.depth)}${opt.name}` : opt.name }}
          </option>
        </select>
      </div>

      <!-- Labels Search / Quick Create (only for non-folders) -->
      <div v-if="!item.isFolder" class="p-3 space-y-2.5">
        <div class="relative flex items-center">
          <Search class="h-3.5 w-3.5 text-gray-400 absolute left-2.5 pointer-events-none" />
          <input
            v-model="labelQuery"
            type="text"
            maxlength="40"
            :placeholder="t('listen.labels.searchOrCreateLabel')"
            @keydown.enter.prevent="handleCreateInlineLabel"
            class="w-full pl-8 pr-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50/80 dark:bg-gray-800/80 text-xs text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:border-teal-500"
          />
        </div>

        <!-- Inline Quick Create Banner when typed label doesn't exist -->
        <div
          v-if="canCreateInline"
          class="p-2 rounded-xl border border-teal-200/80 dark:border-teal-800/70 bg-teal-50/70 dark:bg-teal-950/40 space-y-2"
        >
          <div class="flex items-center justify-between gap-2">
            <span class="text-[11px] font-semibold text-teal-800 dark:text-teal-200 truncate">
              + #{{ cleanLabelName(labelQuery) }}
            </span>
            <button
              type="button"
              @click="handleCreateInlineLabel"
              class="px-2 py-0.5 rounded-md bg-teal-600 hover:bg-teal-700 text-white text-[10px] font-bold inline-flex items-center gap-1 cursor-pointer shrink-0"
            >
              <Plus class="h-3 w-3" />
              <span>{{ t('listen.labels.createAndApply') }}</span>
            </button>
          </div>
          <div class="flex items-center gap-1">
            <button
              v-for="colorKey in LISTEN_LABEL_COLOR_KEYS"
              :key="colorKey"
              type="button"
              @click="selectedNewColor = colorKey"
              class="w-4 h-4 rounded-full cursor-pointer transition-transform flex items-center justify-center"
              :class="[
                LISTEN_LABEL_COLORS[colorKey].swatchClass,
                selectedNewColor === colorKey ? 'ring-2 ring-offset-1 ring-teal-500 dark:ring-offset-gray-900 scale-110' : 'opacity-70 hover:opacity-100'
              ]"
            >
              <Check v-if="selectedNewColor === colorKey" class="h-2.5 w-2.5 text-white" />
            </button>
          </div>
        </div>

        <!-- Checklist of Labels -->
        <div class="max-h-48 overflow-y-auto space-y-1 pr-0.5">
          <div
            v-if="filteredLabels.length === 0 && !canCreateInline"
            class="py-4 text-center text-[11px] text-gray-400 dark:text-gray-500"
          >
            {{ t('listen.labels.typeToCreateLabel') }}
          </div>

          <button
            v-for="label in filteredLabels"
            :key="label.key"
            type="button"
            @click="handleToggleLabel(label.name)"
            class="w-full px-2.5 py-1.5 rounded-lg flex items-center justify-between gap-2 text-left transition-colors cursor-pointer border"
            :class="
              itemLabelKeys.has(label.key)
                ? 'bg-teal-50/70 dark:bg-teal-950/40 border-teal-200/80 dark:border-teal-800/70'
                : 'border-transparent hover:bg-gray-50 dark:hover:bg-gray-800/70'
            "
          >
            <div class="flex items-center gap-2 min-w-0">
              <span
                class="w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors"
                :class="
                  itemLabelKeys.has(label.key)
                    ? 'bg-teal-600 border-teal-600 text-white'
                    : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800'
                "
              >
                <Check v-if="itemLabelKeys.has(label.key)" class="h-2.5 w-2.5" />
              </span>
              <span
                class="w-2 h-2 rounded-full shrink-0"
                :class="LISTEN_LABEL_COLORS[label.color].dotClass"
              ></span>
              <span class="text-xs font-medium text-gray-800 dark:text-gray-200 truncate">
                {{ label.name }}
              </span>
            </div>
            <span class="text-[10px] font-mono tabular-nums text-gray-400 dark:text-gray-500 shrink-0">
              {{ label.count }}
            </span>
          </button>
        </div>

        <!-- Footer Link to Label Manager -->
        <div class="pt-1.5 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <button
            type="button"
            @click="emit('open-label-manager'); emit('close')"
            class="text-[11px] font-semibold text-teal-600 dark:text-teal-400 hover:underline cursor-pointer"
          >
            {{ t('listen.labels.manageLabels') }}
          </button>
          <button
            type="button"
            @click="emit('close')"
            class="text-[11px] font-semibold text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 cursor-pointer"
          >
            {{ t('common.done') || 'Done' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
