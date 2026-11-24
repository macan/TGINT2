import { ref, shallowRef } from "vue";
import {
  buildChannelMemoryId,
  buildChannelMemoryRecord,
  buildPostMemoryId,
  buildPostMemoryRecord,
  bulkDeleteMemoryItems,
  bulkUpdateMemoryItems,
  deleteMemoryItem,
  exportMemoryArchive,
  getAllMemoryIds,
  getAllMemoryTagCounts,
  getMemoryItemById,
  getMemoryStats,
  importMemoryArchive,
  putMemoryItem,
  putMemoryItemsBatch,
  queryMemoryItems,
  updateMemoryItemMeta,
  type MemoryArchiveBundle,
  type MemoryImportSummary,
  type MemoryItemRecord,
  type MemoryQueryFilter,
  type MemoryQueryResult,
  type MemorySourceTab,
  type MemoryStats,
  type MemoryTagCount,
} from "../utils/indexedDbMemory";

export interface MemoryToastState {
  visible: boolean;
  message: string;
  tone: "saved" | "removed" | "info" | "error";
  canUndo: boolean;
}

const savedMemoryIds = shallowRef<Set<string>>(new Set());
const memoryVersion = ref(0);
const memoryStats = ref<MemoryStats>({
  total: 0,
  posts: 0,
  channels: 0,
  pinned: 0,
});
const memoryTagCounts = ref<MemoryTagCount[]>([]);
const isMemoryInitialized = ref(false);

const memoryToast = ref<MemoryToastState>({
  visible: false,
  message: "",
  tone: "info",
  canUndo: false,
});

let undoBuffer: MemoryItemRecord[] = [];
let toastTimer: ReturnType<typeof setTimeout> | null = null;
let initPromise: Promise<void> | null = null;
let broadcastChannel: BroadcastChannel | null = null;

function showMemoryToast(
  message: string,
  tone: MemoryToastState["tone"] = "info",
  undoItems: MemoryItemRecord[] = []
) {
  if (toastTimer) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }
  undoBuffer = undoItems;
  memoryToast.value = {
    visible: true,
    message,
    tone,
    canUndo: undoItems.length > 0,
  };
  toastTimer = setTimeout(() => {
    memoryToast.value = { ...memoryToast.value, visible: false };
    toastTimer = null;
  }, undoItems.length > 0 ? 5000 : 2600);
}

export function dismissMemoryToast() {
  if (toastTimer) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }
  memoryToast.value = { ...memoryToast.value, visible: false };
}

function notifyOtherTabs() {
  try {
    if (broadcastChannel) {
      broadcastChannel.postMessage({ type: "memory-updated", at: Date.now() });
    }
  } catch {
    // Ignore BroadcastChannel errors in restricted contexts
  }
}

async function refreshMemorySummary(broadcast = false) {
  try {
    const [ids, stats, tags] = await Promise.all([
      getAllMemoryIds(),
      getMemoryStats(),
      getAllMemoryTagCounts(),
    ]);
    savedMemoryIds.value = new Set(ids);
    memoryStats.value = stats;
    memoryTagCounts.value = tags;
    memoryVersion.value++;
    if (broadcast) notifyOtherTabs();
  } catch (err) {
    console.error("[Memory] Failed to refresh summary:", err);
  }
}

export function initMemoryStore(): Promise<void> {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      if (typeof BroadcastChannel !== "undefined" && !broadcastChannel) {
        broadcastChannel = new BroadcastChannel("gingko-memory-sync");
        broadcastChannel.onmessage = () => {
          refreshMemorySummary(false);
        };
      }
    } catch {
      // BroadcastChannel optional
    }

    await refreshMemorySummary(false);
    isMemoryInitialized.value = true;
  })();

  return initPromise;
}

// Kick off hydration automatically when module loads in browser
if (typeof window !== "undefined") {
  initMemoryStore();
}

export function useMemory() {
  const isIdSaved = (id: string): boolean => {
    if (!id) return false;
    return savedMemoryIds.value.has(id);
  };

  const isPostSaved = (post: any, fallbackChannel = ""): boolean => {
    if (!post) return false;
    return savedMemoryIds.value.has(buildPostMemoryId(post, fallbackChannel));
  };

  const isChannelSaved = (channel: any, metadata?: any): boolean => {
    if (!channel && !metadata) return false;
    return savedMemoryIds.value.has(buildChannelMemoryId(channel, metadata));
  };

  const togglePostMemory = async (
    post: any,
    opts: {
      fallbackChannel?: string;
      fallbackChannelTitle?: string;
      sourceTab?: MemorySourceTab;
      savedMessage?: string;
      removedMessage?: string;
    } = {}
  ): Promise<boolean> => {
    await initMemoryStore();
    const id = buildPostMemoryId(post, opts.fallbackChannel || "");

    if (savedMemoryIds.value.has(id)) {
      const next = new Set(savedMemoryIds.value);
      next.delete(id);
      savedMemoryIds.value = next;

      const removed = await deleteMemoryItem(id);
      await refreshMemorySummary(true);
      showMemoryToast(
        opts.removedMessage || "Removed post from Memory",
        "removed",
        removed ? [removed] : []
      );
      return false;
    }

    const existing = await getMemoryItemById(id);
    const record = buildPostMemoryRecord(post, {
      fallbackChannel: opts.fallbackChannel,
      fallbackChannelTitle: opts.fallbackChannelTitle,
      sourceTab: opts.sourceTab,
      existing,
    });

    const next = new Set(savedMemoryIds.value);
    next.add(record.id);
    savedMemoryIds.value = next;

    await putMemoryItem(record);
    await refreshMemorySummary(true);
    showMemoryToast(opts.savedMessage || "Saved post to Memory", "saved");
    return true;
  };

  const toggleChannelMemory = async (
    channel: any,
    opts: {
      metadata?: any;
      sourceTab?: MemorySourceTab;
      savedMessage?: string;
      removedMessage?: string;
    } = {}
  ): Promise<boolean> => {
    await initMemoryStore();
    const id = buildChannelMemoryId(channel, opts.metadata);

    if (savedMemoryIds.value.has(id)) {
      const next = new Set(savedMemoryIds.value);
      next.delete(id);
      savedMemoryIds.value = next;

      const removed = await deleteMemoryItem(id);
      await refreshMemorySummary(true);
      showMemoryToast(
        opts.removedMessage || "Removed channel from Memory",
        "removed",
        removed ? [removed] : []
      );
      return false;
    }

    const existing = await getMemoryItemById(id);
    const record = buildChannelMemoryRecord(channel, {
      metadata: opts.metadata,
      sourceTab: opts.sourceTab,
      existing,
    });

    const next = new Set(savedMemoryIds.value);
    next.add(record.id);
    savedMemoryIds.value = next;

    await putMemoryItem(record);
    await refreshMemorySummary(true);
    showMemoryToast(opts.savedMessage || "Saved channel to Memory", "saved");
    return true;
  };

  const updateMemoryMeta = async (
    id: string,
    patch: { note?: string; tags?: string[]; pinned?: boolean }
  ): Promise<MemoryItemRecord | null> => {
    await initMemoryStore();
    const updated = await updateMemoryItemMeta(id, patch);
    await refreshMemorySummary(true);
    return updated;
  };

  const removeMemoryItem = async (
    id: string,
    removedMessage?: string
  ): Promise<MemoryItemRecord | null> => {
    await initMemoryStore();
    const removed = await deleteMemoryItem(id);
    await refreshMemorySummary(true);
    if (removed) {
      showMemoryToast(removedMessage || "Removed from Memory", "removed", [removed]);
    }
    return removed;
  };

  const bulkRemoveMemory = async (
    ids: string[],
    removedMessage?: string
  ): Promise<MemoryItemRecord[]> => {
    await initMemoryStore();
    const removed = await bulkDeleteMemoryItems(ids);
    await refreshMemorySummary(true);
    if (removed.length > 0) {
      showMemoryToast(
        removedMessage || `Removed ${removed.length} items from Memory`,
        "removed",
        removed
      );
    }
    return removed;
  };

  const bulkUpdateMemory = async (
    ids: string[],
    action:
      | { kind: "addTag"; tag: string }
      | { kind: "removeTag"; tag: string }
      | { kind: "setPinned"; pinned: boolean },
    toastMessage?: string
  ): Promise<number> => {
    await initMemoryStore();
    const count = await bulkUpdateMemoryItems(ids, action);
    await refreshMemorySummary(true);
    if (toastMessage) {
      showMemoryToast(toastMessage, "info");
    }
    return count;
  };

  const undoLastMemoryDelete = async (restoredMessage?: string): Promise<number> => {
    if (!undoBuffer.length) return 0;
    const toRestore = [...undoBuffer];
    undoBuffer = [];
    dismissMemoryToast();
    await putMemoryItemsBatch(toRestore);
    await refreshMemorySummary(true);
    showMemoryToast(
      restoredMessage || `Restored ${toRestore.length} item${toRestore.length > 1 ? "s" : ""}`,
      "saved"
    );
    return toRestore.length;
  };

  const queryMemory = async (filter: MemoryQueryFilter): Promise<MemoryQueryResult> => {
    await initMemoryStore();
    return queryMemoryItems(filter);
  };

  const exportMemoryJson = async (): Promise<MemoryArchiveBundle> => {
    await initMemoryStore();
    return exportMemoryArchive();
  };

  const importMemoryJson = async (rawPayload: unknown): Promise<MemoryImportSummary> => {
    await initMemoryStore();
    const summary = await importMemoryArchive(rawPayload);
    await refreshMemorySummary(true);
    return summary;
  };

  return {
    savedMemoryIds,
    memoryVersion,
    memoryStats,
    memoryTagCounts,
    memoryToast,
    isMemoryInitialized,
    initMemoryStore,
    isIdSaved,
    isPostSaved,
    isChannelSaved,
    togglePostMemory,
    toggleChannelMemory,
    updateMemoryMeta,
    removeMemoryItem,
    bulkRemoveMemory,
    bulkUpdateMemory,
    undoLastMemoryDelete,
    dismissMemoryToast,
    showMemoryToast,
    queryMemory,
    exportMemoryJson,
    importMemoryJson,
    refreshMemorySummary,
  };
}
