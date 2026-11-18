<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import {
  Tag,
  Plus,
  Check,
  X,
  Edit,
  Trash2,
  Search,
  Filter
} from "lucide-vue-next";
import { useI18n } from "../../i18n";
import {
  LISTEN_LABEL_COLOR_KEYS,
  LISTEN_LABEL_COLORS,
  cleanLabelName,
  normalizeLabelKey,
  type ListenLabelColorKey,
  type ListenLabelSummary
} from "../../utils/listenLabels";

const props = defineProps<{
  isOpen: boolean;
  labels: ListenLabelSummary[];
  activeFilterLabels: string[];
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "create-label", payload: { name: string; color: ListenLabelColorKey }): void;
  (e: "update-label-color", payload: { name: string; color: ListenLabelColorKey }): void;
  (e: "rename-label", payload: { oldName: string; newName: string }): void;
  (e: "delete-label", name: string): void;
  (e: "toggle-filter", name: string): void;
}>();

const { t } = useI18n();

const newLabelName = ref("");
const newLabelColor = ref<ListenLabelColorKey>("teal");
const searchQuery = ref("");

const editingKey = ref<string | null>(null);
const editingName = ref("");
const colorPickerKey = ref<string | null>(null);
const confirmingDeleteKey = ref<string | null>(null);

watch(
  () => props.isOpen,
  (open) => {
    if (!open) {
      editingKey.value = null;
      editingName.value = "";
      colorPickerKey.value = null;
      confirmingDeleteKey.value = null;
      searchQuery.value = "";
    }
  }
);

const filteredLabels = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return props.labels;
  return props.labels.filter((l) => l.name.toLowerCase().includes(q));
});

const newLabelCollision = computed(() => {
  const key = normalizeLabelKey(newLabelName.value);
  if (!key) return false;
  return props.labels.some((l) => l.key === key);
});

const handleCreate = () => {
  const clean = cleanLabelName(newLabelName.value);
  if (!clean) return;
  emit("create-label", { name: clean, color: newLabelColor.value });
  newLabelName.value = "";
};

const startEdit = (label: ListenLabelSummary) => {
  editingKey.value = label.key;
  editingName.value = label.name;
  confirmingDeleteKey.value = null;
  colorPickerKey.value = null;
};

const commitRename = (label: ListenLabelSummary) => {
  const clean = cleanLabelName(editingName.value);
  if (clean && clean !== label.name) {
    emit("rename-label", { oldName: label.name, newName: clean });
  }
  editingKey.value = null;
  editingName.value = "";
};

const cancelEdit = () => {
  editingKey.value = null;
  editingName.value = "";
};

const selectColorForLabel = (label: ListenLabelSummary, color: ListenLabelColorKey) => {
  emit("update-label-color", { name: label.name, color });
  colorPickerKey.value = null;
};

const isFilterActive = (name: string) => {
  const key = normalizeLabelKey(name);
  return props.activeFilterLabels.some((f) => normalizeLabelKey(f) === key);
};

const handleKeydown = (e: KeyboardEvent) => {
  if (props.isOpen && e.key === "Escape") {
    if (editingKey.value) {
      cancelEdit();
    } else if (colorPickerKey.value) {
      colorPickerKey.value = null;
    } else if (confirmingDeleteKey.value) {
      confirmingDeleteKey.value = null;
    } else {
      emit("close");
    }
  }
};

onMounted(() => {
  document.addEventListener("keydown", handleKeydown);
});
onUnmounted(() => {
  document.removeEventListener("keydown", handleKeydown);
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="isOpen"
      class="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-[2px]"
      @click.self="emit('close')"
    >
      <div
        role="dialog"
        aria-modal="true"
        :aria-label="t('listen.labels.managerTitle')"
        class="w-full max-w-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700/80 rounded-2xl shadow-xl overflow-hidden flex flex-col max-h-[85vh]"
      >
        <!-- Header -->
        <div class="px-5 py-4 border-b border-gray-200/80 dark:border-gray-800 flex items-center justify-between gap-3 bg-gray-50/70 dark:bg-gray-800/40">
          <div class="flex items-center gap-2.5 min-w-0">
            <div class="w-8 h-8 rounded-xl bg-teal-50 dark:bg-teal-950/60 border border-teal-200/80 dark:border-teal-800/70 flex items-center justify-center text-teal-600 dark:text-teal-400 shrink-0">
              <Tag class="h-4 w-4" />
            </div>
            <div class="min-w-0">
              <h3 class="text-sm font-bold text-gray-900 dark:text-white tracking-tight truncate">
                {{ t('listen.labels.managerTitle') }}
              </h3>
              <p class="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                {{ t('listen.labels.managerSubtitle') }}
              </p>
            </div>
          </div>

          <div class="flex items-center gap-2 shrink-0">
            <span class="px-2 py-0.5 rounded-md text-[11px] font-mono tabular-nums font-semibold bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700">
              {{ labels.length }}
            </span>
            <button
              type="button"
              @click="emit('close')"
              class="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer"
              :title="t('common.close')"
            >
              <X class="h-4 w-4" />
            </button>
          </div>
        </div>

        <!-- Create New Label Form -->
        <div class="p-4 border-b border-gray-200/80 dark:border-gray-800 space-y-3 bg-white dark:bg-gray-900">
          <div class="flex items-center gap-2">
            <div class="relative flex-1">
              <span class="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-mono font-bold text-gray-400 dark:text-gray-500">#</span>
              <input
                v-model="newLabelName"
                type="text"
                maxlength="40"
                :placeholder="t('listen.labels.newLabelPlaceholder')"
                @keydown.enter.prevent="handleCreate"
                class="w-full pl-7 pr-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/70 dark:bg-gray-800/80 text-xs font-medium text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500"
              />
            </div>
            <button
              type="button"
              @click="handleCreate"
              :disabled="!cleanLabelName(newLabelName)"
              class="px-3.5 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold inline-flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
            >
              <Plus class="h-3.5 w-3.5" />
              <span>{{ newLabelCollision ? t('listen.labels.updateColor') : t('listen.labels.createLabel') }}</span>
            </button>
          </div>

          <!-- Color Swatch Selector -->
          <div class="flex items-center justify-between gap-2 flex-wrap">
            <span class="text-[11px] font-semibold text-gray-500 dark:text-gray-400">
              {{ t('listen.labels.colorPreset') }}:
            </span>
            <div class="flex items-center gap-1.5">
              <button
                v-for="colorKey in LISTEN_LABEL_COLOR_KEYS"
                :key="colorKey"
                type="button"
                @click="newLabelColor = colorKey"
                class="w-6 h-6 rounded-lg flex items-center justify-center border transition-all cursor-pointer"
                :class="[
                  LISTEN_LABEL_COLORS[colorKey].swatchClass,
                  newLabelColor === colorKey
                    ? 'ring-2 ring-offset-2 ring-teal-500 dark:ring-offset-gray-900 border-white/80 scale-105'
                    : 'border-transparent opacity-75 hover:opacity-100'
                ]"
                :title="colorKey"
                :aria-label="colorKey"
              >
                <Check v-if="newLabelColor === colorKey" class="h-3.5 w-3.5 text-white drop-shadow-2xs" />
              </button>
            </div>
          </div>
        </div>

        <!-- Search filter inside manager -->
        <div v-if="labels.length > 4" class="px-4 py-2.5 border-b border-gray-100 dark:border-gray-800 bg-gray-50/40 dark:bg-gray-900/60">
          <div class="relative">
            <Search class="h-3.5 w-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              v-model="searchQuery"
              type="text"
              :placeholder="t('listen.labels.searchLabels')"
              class="w-full pl-8 pr-8 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs text-gray-800 dark:text-gray-200 placeholder-gray-400 focus:outline-none focus:border-teal-500"
            />
            <button
              v-if="searchQuery"
              type="button"
              @click="searchQuery = ''"
              class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 cursor-pointer"
            >
              <X class="h-3 w-3" />
            </button>
          </div>
        </div>

        <!-- Labels List -->
        <div class="flex-1 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-800/80 p-2 space-y-1">
          <div
            v-if="filteredLabels.length === 0"
            class="py-10 px-4 text-center text-xs text-gray-400 dark:text-gray-500"
          >
            {{ labels.length === 0 ? t('listen.labels.emptyManager') : t('listen.labels.noMatchingLabels') }}
          </div>

          <div
            v-for="label in filteredLabels"
            :key="label.key"
            class="rounded-xl px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors border border-transparent hover:border-gray-200/70 dark:hover:border-gray-700/70"
          >
            <div class="flex items-center justify-between gap-2.5">
              <!-- Left: Color Trigger + Name -->
              <div class="flex items-center gap-2.5 min-w-0 flex-1">
                <button
                  type="button"
                  @click="colorPickerKey = colorPickerKey === label.key ? null : label.key"
                  class="w-5 h-5 rounded-md shrink-0 border border-black/10 dark:border-white/15 cursor-pointer transition-transform hover:scale-110 flex items-center justify-center"
                  :class="LISTEN_LABEL_COLORS[label.color].swatchClass"
                  :title="t('listen.labels.changeColor')"
                ></button>

                <!-- Inline rename input -->
                <div v-if="editingKey === label.key" class="flex items-center gap-1.5 flex-1 min-w-0">
                  <input
                    v-model="editingName"
                    type="text"
                    maxlength="40"
                    @keydown.enter.prevent="commitRename(label)"
                    @keydown.esc.stop.prevent="cancelEdit"
                    class="flex-1 min-w-0 px-2 py-1 text-xs font-medium rounded-lg border border-teal-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none"
                    autofocus
                  />
                  <button
                    type="button"
                    @click="commitRename(label)"
                    class="p-1 rounded-lg text-teal-600 dark:text-teal-400 hover:bg-teal-50 dark:hover:bg-teal-950/50 cursor-pointer"
                    :title="t('common.confirm')"
                  >
                    <Check class="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    @click="cancelEdit"
                    class="p-1 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 cursor-pointer"
                    :title="t('common.cancel')"
                  >
                    <X class="h-3.5 w-3.5" />
                  </button>
                </div>

                <!-- Label Badge Display -->
                <div v-else class="flex items-center gap-2 min-w-0 flex-1">
                  <span
                    class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg text-xs font-semibold border truncate max-w-[200px]"
                    :class="LISTEN_LABEL_COLORS[label.color].chipClass"
                  >
                    <span class="w-1.5 h-1.5 rounded-full shrink-0" :class="LISTEN_LABEL_COLORS[label.color].dotClass"></span>
                    <span class="truncate">{{ label.name }}</span>
                  </span>
                  <span
                    class="text-[11px] font-mono tabular-nums text-gray-400 dark:text-gray-500 shrink-0"
                    :title="t('listen.labels.channelCountTitle', { count: label.count })"
                  >
                    {{ label.count }}
                  </span>
                </div>
              </div>

              <!-- Right: Row Actions -->
              <div class="flex items-center gap-1 shrink-0">
                <template v-if="confirmingDeleteKey === label.key">
                  <span class="text-[10px] text-rose-600 dark:text-rose-400 font-semibold mr-1">
                    {{ t('listen.labels.confirmDeleteShort') }}
                  </span>
                  <button
                    type="button"
                    @click="emit('delete-label', label.name); confirmingDeleteKey = null"
                    class="px-2 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-[10px] font-bold cursor-pointer"
                  >
                    {{ t('common.delete') }}
                  </button>
                  <button
                    type="button"
                    @click="confirmingDeleteKey = null"
                    class="px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 text-[10px] font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer"
                  >
                    {{ t('common.cancel') }}
                  </button>
                </template>
                <template v-else>
                  <button
                    type="button"
                    @click="emit('toggle-filter', label.name)"
                    class="p-1.5 rounded-lg transition-colors cursor-pointer"
                    :class="
                      isFilterActive(label.name)
                        ? 'bg-teal-50 dark:bg-teal-950/60 text-teal-600 dark:text-teal-400'
                        : 'text-gray-400 hover:text-teal-600 dark:hover:text-teal-400 hover:bg-gray-100 dark:hover:bg-gray-700/70'
                    "
                    :title="t('listen.labels.toggleFilterAction')"
                  >
                    <Filter class="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    @click="startEdit(label)"
                    class="p-1.5 rounded-lg text-gray-400 hover:text-sky-600 dark:hover:text-sky-400 hover:bg-gray-100 dark:hover:bg-gray-700/70 transition-colors cursor-pointer"
                    :title="t('listen.labels.renameLabel')"
                  >
                    <Edit class="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    @click="confirmingDeleteKey = label.key"
                    class="p-1.5 rounded-lg text-gray-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors cursor-pointer"
                    :title="t('listen.labels.deleteLabel')"
                  >
                    <Trash2 class="h-3.5 w-3.5" />
                  </button>
                </template>
              </div>
            </div>

            <!-- Inline Swatch Row for Recoloring -->
            <div
              v-if="colorPickerKey === label.key"
              class="mt-2 pt-2 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between gap-2 pl-7"
            >
              <span class="text-[10px] font-semibold text-gray-400 dark:text-gray-500">
                {{ t('listen.labels.pickColor') }}
              </span>
              <div class="flex items-center gap-1.5">
                <button
                  v-for="colorKey in LISTEN_LABEL_COLOR_KEYS"
                  :key="colorKey"
                  type="button"
                  @click="selectColorForLabel(label, colorKey)"
                  class="w-5 h-5 rounded-md flex items-center justify-center cursor-pointer transition-transform hover:scale-110"
                  :class="[
                    LISTEN_LABEL_COLORS[colorKey].swatchClass,
                    label.color === colorKey ? 'ring-2 ring-offset-1 ring-teal-500 dark:ring-offset-gray-900' : ''
                  ]"
                  :title="colorKey"
                >
                  <Check v-if="label.color === colorKey" class="h-3 w-3 text-white" />
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div class="px-5 py-3 border-t border-gray-200/80 dark:border-gray-800 bg-gray-50/70 dark:bg-gray-800/40 flex items-center justify-between text-[11px] text-gray-500 dark:text-gray-400">
          <span>{{ t('listen.labels.localSyncedNote') }}</span>
          <button
            type="button"
            @click="emit('close')"
            class="px-3.5 py-1.5 rounded-xl bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 font-bold text-xs hover:opacity-90 transition-opacity cursor-pointer"
          >
            {{ t('common.done') || 'Done' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
