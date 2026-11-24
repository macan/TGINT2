<script setup lang="ts">
import { ref, computed, watch } from "vue";
import {
  Pin,
  PinOff,
  Tag,
  Plus,
  X,
  Save,
  Compass,
  ExternalLink,
  Trash2,
  Check,
  FileText,
  Radio,
  Users,
  Eye,
  Clock,
  Calendar,
} from "lucide-vue-next";
import { useI18n } from "../../i18n";
import { useMemory } from "../../composables/useMemory";
import {
  resolveMemoryChannelTarget,
  type MemoryItemRecord,
} from "../../utils/indexedDbMemory";

const props = defineProps<{
  item: MemoryItemRecord;
  highlightRegex?: RegExp | null;
  highlightTerms?: string[];
  compact?: boolean;
}>();

const emit = defineEmits<{
  (e: "updated", item: MemoryItemRecord): void;
  (e: "deleted", id: string): void;
  (e: "jump-to-explorer", item: MemoryItemRecord): void;
}>();

const { t } = useI18n();
const { memoryTagCounts, updateMemoryMeta, removeMemoryItem } = useMemory();

const draftNote = ref(props.item.note || "");
const draftTags = ref<string[]>([...(props.item.tags || [])]);
const draftPinned = ref(props.item.pinned === 1);
const newTagInput = ref("");
const isSaving = ref(false);
const justSaved = ref(false);
const hideMediaPreview = ref(false);

watch(
  () => props.item,
  (next) => {
    draftNote.value = next.note || "";
    draftTags.value = [...(next.tags || [])];
    draftPinned.value = next.pinned === 1;
    newTagInput.value = "";
    hideMediaPreview.value = false;
  },
  { immediate: false }
);

const isDirty = computed(() => {
  const noteChanged = draftNote.value !== (props.item.note || "");
  const origTags = props.item.tags || [];
  const tagsChanged =
    draftTags.value.length !== origTags.length ||
    draftTags.value.some((tag, i) => tag !== origTags[i]);
  const pinChanged = draftPinned.value !== (props.item.pinned === 1);
  return noteChanged || tagsChanged || pinChanged;
});

const suggestedTags = computed(() => {
  const existing = new Set(draftTags.value.map((x) => x.toLowerCase()));
  const q = newTagInput.value.trim().toLowerCase();
  return memoryTagCounts.value
    .filter((entry) => {
      const low = entry.tag.toLowerCase();
      if (existing.has(low)) return false;
      if (!q) return true;
      return low.includes(q);
    })
    .slice(0, 8);
});

const resolvedChannelHandle = computed(() => resolveMemoryChannelTarget(props.item));

const displayTitle = computed(() => {
  if (props.item.type === "channel") {
    return props.item.channelTitle || resolvedChannelHandle.value || "Channel";
  }
  return props.item.author || props.item.channelTitle || resolvedChannelHandle.value || "Telegram User";
});

const bodyText = computed(() => {
  if (props.item.type === "channel") {
    return props.item.channelDescription || "";
  }
  return props.item.content || "";
});

const externalUrl = computed(() => {
  const handle = resolvedChannelHandle.value;
  const fallbackTgUrl = handle
    ? handle.startsWith("-100")
      ? `https://t.me/c/${handle.slice(4)}`
      : `https://t.me/${handle}`
    : "";
  if (props.item.type === "channel") {
    return props.item.channelUrl || fallbackTgUrl;
  }
  return props.item.postUrl || fallbackTgUrl;
});

interface TextSegment {
  text: string;
  match: boolean;
}

function tokenizeHighlight(text: string): TextSegment[] {
  if (!text) return [];
  let matcher: RegExp | null = null;

  if (props.highlightRegex) {
    try {
      const flags = props.highlightRegex.flags.includes("g")
        ? props.highlightRegex.flags
        : `${props.highlightRegex.flags}g`;
      matcher = new RegExp(props.highlightRegex.source, flags);
    } catch {
      matcher = null;
    }
  } else if (props.highlightTerms && props.highlightTerms.length > 0) {
    const escaped = props.highlightTerms
      .filter(Boolean)
      .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    if (escaped.length > 0) {
      matcher = new RegExp(`(${escaped.join("|")})`, "gi");
    }
  }

  if (!matcher) return [{ text, match: false }];

  const segments: TextSegment[] = [];
  let lastIndex = 0;
  let guard = 0;
  let m: RegExpExecArray | null;

  while ((m = matcher.exec(text)) !== null && guard < 200) {
    guard++;
    if (m[0].length === 0) {
      matcher.lastIndex++;
      continue;
    }
    if (m.index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, m.index), match: false });
    }
    segments.push({ text: m[0], match: true });
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), match: false });
  }
  return segments.length ? segments : [{ text, match: false }];
}

const highlightedBodySegments = computed(() => tokenizeHighlight(bodyText.value));

function formatTimestamp(ms: number): string {
  if (!ms || !Number.isFinite(ms)) return "—";
  try {
    return new Date(ms).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return String(ms);
  }
}

async function persistChanges(override?: { note?: string; tags?: string[]; pinned?: boolean }) {
  isSaving.value = true;
  try {
    const updated = await updateMemoryMeta(props.item.id, {
      note: override?.note !== undefined ? override.note : draftNote.value,
      tags: override?.tags !== undefined ? override.tags : draftTags.value,
      pinned: override?.pinned !== undefined ? override.pinned : draftPinned.value,
    });
    if (updated) {
      emit("updated", updated);
      justSaved.value = true;
      setTimeout(() => {
        justSaved.value = false;
      }, 1500);
    }
  } finally {
    isSaving.value = false;
  }
}

async function addTag(raw?: string) {
  const val = (raw ?? newTagInput.value).trim().replace(/^#+/, "");
  if (!val) return;
  if (!draftTags.value.some((x) => x.toLowerCase() === val.toLowerCase())) {
    draftTags.value = [...draftTags.value, val];
    newTagInput.value = "";
    await persistChanges({ tags: draftTags.value });
  } else {
    newTagInput.value = "";
  }
}

async function removeTag(tag: string) {
  draftTags.value = draftTags.value.filter((x) => x !== tag);
  await persistChanges({ tags: draftTags.value });
}

async function togglePin() {
  draftPinned.value = !draftPinned.value;
  await persistChanges({ pinned: draftPinned.value });
}

async function handleDelete() {
  const removed = await removeMemoryItem(
    props.item.id,
    props.item.type === "post" ? t("memory.toastPostRemoved") : t("memory.toastChannelRemoved")
  );
  if (removed) {
    emit("deleted", props.item.id);
  }
}

function handleNoteKeydown(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    persistChanges();
  }
}
</script>

<template>
  <div class="space-y-4">
    <!-- Top Header & Actions -->
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          <component
            :is="item.type === 'channel' ? Radio : FileText"
            class="w-3.5 h-3.5 shrink-0"
            :class="item.type === 'channel' ? 'text-teal-600 dark:text-teal-400' : 'text-amber-600 dark:text-amber-400'"
          />
          <span class="font-medium text-gray-700 dark:text-gray-300">
            {{ item.type === "channel" ? t("memory.typeChannel") : t("memory.typePost") }}
          </span>
          <span aria-hidden="true">·</span>
          <span v-if="resolvedChannelHandle" class="font-mono truncate">@{{ resolvedChannelHandle }}</span>
          <template v-if="item.type === 'post' && item.views !== undefined">
            <span aria-hidden="true">·</span>
            <span class="inline-flex items-center gap-1 font-mono tabular-nums">
              <Eye class="w-3 h-3" />
              {{ item.views.toLocaleString() }}
            </span>
          </template>
          <template v-if="item.type === 'channel' && item.subscribers !== undefined">
            <span aria-hidden="true">·</span>
            <span class="inline-flex items-center gap-1 font-mono tabular-nums">
              <Users class="w-3 h-3" />
              {{ item.subscribers.toLocaleString() }}
            </span>
          </template>
        </div>

        <h4 class="mt-1 text-sm sm:text-base font-bold text-gray-900 dark:text-white leading-snug break-words">
          {{ displayTitle }}
        </h4>

        <!-- Timestamps unboxed metadata -->
        <div class="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] font-mono tabular-nums text-gray-500 dark:text-gray-400">
          <span class="inline-flex items-center gap-1">
            <Clock class="w-3 h-3 text-gray-400" />
            {{ t("memory.savedAtLabel") }}: {{ formatTimestamp(item.savedAt) }}
          </span>
          <template v-if="item.hasPublishDate">
            <span aria-hidden="true">·</span>
            <span class="inline-flex items-center gap-1">
              <Calendar class="w-3 h-3 text-gray-400" />
              {{ t("memory.publishedAtLabel") }}: {{ formatTimestamp(item.publishedAt) }}
            </span>
          </template>
        </div>
      </div>

      <!-- Primary & Utility Actions -->
      <div class="flex flex-wrap items-center gap-1.5 shrink-0">
        <button
          type="button"
          @click="togglePin"
          class="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0"
          :class="
            draftPinned
              ? 'bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-700/70'
              : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-amber-300 dark:hover:border-amber-600'
          "
        >
          <component :is="draftPinned ? PinOff : Pin" class="w-3.5 h-3.5" />
          <span>{{ draftPinned ? t("memory.unpin") : t("memory.pin") }}</span>
        </button>

        <button
          v-if="resolvedChannelHandle"
          type="button"
          @click="$emit('jump-to-explorer', item)"
          class="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0"
        >
          <Compass class="w-3.5 h-3.5" />
          <span>{{ t("memory.openInExplorer") }}</span>
        </button>

        <a
          v-if="externalUrl"
          :href="externalUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-750 text-gray-700 dark:text-gray-300 text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
        >
          <ExternalLink class="w-3.5 h-3.5" />
          <span>TG</span>
        </a>

        <button
          type="button"
          @click="handleDelete"
          class="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-rose-200 dark:border-rose-900/50 bg-rose-50/70 dark:bg-rose-950/30 hover:bg-rose-100 dark:hover:bg-rose-900/40 text-rose-600 dark:text-rose-400 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0"
          :title="t('memory.deleteItem')"
        >
          <Trash2 class="w-3.5 h-3.5" />
          <span class="hidden sm:inline">{{ t("memory.delete") }}</span>
        </button>
      </div>
    </div>

    <!-- Snapshot Content Preview -->
    <div
      class="rounded-xl border border-gray-200/80 dark:border-gray-700/80 bg-gray-50/70 dark:bg-gray-900/40 p-3.5 text-xs sm:text-sm text-gray-800 dark:text-gray-200 leading-relaxed whitespace-pre-wrap break-words"
      :class="compact ? 'max-h-56 overflow-y-auto' : 'max-h-80 overflow-y-auto'"
    >
      <template v-if="bodyText">
        <template v-for="(seg, idx) in highlightedBodySegments" :key="idx">
          <mark v-if="seg.match" class="rounded px-0.5 bg-amber-200/80 dark:bg-amber-700/60 text-inherit">{{ seg.text }}</mark>
          <template v-else>{{ seg.text }}</template>
        </template>
      </template>
      <span v-else class="italic text-gray-400 dark:text-gray-500">
        {{ item.type === "channel" ? t("memory.noChannelDesc") : t("memory.noPostText") }}
      </span>

      <div
        v-if="item.mediaPreviewUrl && !hideMediaPreview"
        class="mt-3 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 max-w-xs"
      >
        <img
          :src="item.mediaPreviewUrl"
          alt="Saved media preview"
          referrerpolicy="no-referrer"
          @error="hideMediaPreview = true"
          class="w-full h-auto max-h-48 object-cover"
        />
      </div>
    </div>

    <!-- Personal Note Editor -->
    <div class="space-y-1.5">
      <div class="flex items-center justify-between gap-2">
        <label class="text-xs font-semibold text-gray-700 dark:text-gray-300">
          {{ t("memory.personalNote") }}
        </label>
        <div class="flex items-center gap-2">
          <span v-if="justSaved" class="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
            <Check class="w-3 h-3" />
            {{ t("memory.saved") }}
          </span>
          <button
            type="button"
            :disabled="!isDirty || isSaving"
            @click="persistChanges()"
            class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap shrink-0"
            :class="
              isDirty
                ? 'bg-gray-900 dark:bg-white text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-100'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
            "
          >
            <Save class="w-3 h-3" />
            <span>{{ t("memory.saveNote") }}</span>
          </button>
        </div>
      </div>

      <textarea
        v-model="draftNote"
        @keydown="handleNoteKeydown"
        rows="3"
        :placeholder="t('memory.notePlaceholder')"
        class="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/70 px-3 py-2 text-xs sm:text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-500 resize-y"
      ></textarea>
    </div>

    <!-- Custom Tags Editor -->
    <div class="space-y-2">
      <div class="flex items-center gap-1.5 text-xs font-semibold text-gray-700 dark:text-gray-300">
        <Tag class="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
        <span>{{ t("memory.customTags") }}</span>
      </div>

      <div class="flex flex-wrap items-center gap-1.5">
        <span
          v-for="tag in draftTags"
          :key="tag"
          class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-amber-200/90 dark:border-amber-800/70 bg-amber-50/80 dark:bg-amber-950/40 text-xs font-medium text-amber-800 dark:text-amber-200"
        >
          <span>#{{ tag }}</span>
          <button
            type="button"
            @click="removeTag(tag)"
            class="p-0.5 rounded hover:bg-amber-200/60 dark:hover:bg-amber-800/60 cursor-pointer"
            :aria-label="`Remove ${tag}`"
          >
            <X class="w-3 h-3" />
          </button>
        </span>

        <div class="flex items-center gap-1">
          <input
            v-model="newTagInput"
            type="text"
            @keydown.enter.prevent="addTag()"
            :placeholder="t('memory.addTagPlaceholder')"
            class="w-36 sm:w-44 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/70 px-2.5 py-1 text-xs text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-500"
          />
          <button
            type="button"
            @click="addTag()"
            :disabled="!newTagInput.trim()"
            class="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 hover:bg-amber-50 dark:hover:bg-amber-950/40 text-xs font-semibold text-gray-700 dark:text-gray-300 disabled:opacity-40 cursor-pointer transition-colors whitespace-nowrap shrink-0"
          >
            <Plus class="w-3 h-3" />
            <span>{{ t("memory.add") }}</span>
          </button>
        </div>
      </div>

      <!-- Existing Tag Suggestions -->
      <div v-if="suggestedTags.length > 0" class="flex flex-wrap items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400">
        <span>{{ t("memory.suggestedTags") }}:</span>
        <button
          v-for="s in suggestedTags"
          :key="s.tag"
          type="button"
          @click="addTag(s.tag)"
          class="px-1.5 py-0.5 rounded border border-dashed border-gray-300 dark:border-gray-600 hover:border-amber-400 dark:hover:border-amber-500 hover:text-amber-700 dark:hover:text-amber-300 transition-colors cursor-pointer"
        >
          +{{ s.tag }}
        </button>
      </div>
    </div>
  </div>
</template>
