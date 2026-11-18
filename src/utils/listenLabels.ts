import type { ListenItem } from "../types";

export type ListenLabelColorKey =
  | "teal"
  | "sky"
  | "indigo"
  | "violet"
  | "amber"
  | "rose"
  | "emerald"
  | "slate";

export type ListenLabelMatchMode = "any" | "all";

export interface ListenLabelDefinition {
  key: string;
  name: string;
  color: ListenLabelColorKey;
  description?: string;
  updatedAt: number;
}

export interface ListenLabelSummary {
  key: string;
  name: string;
  color: ListenLabelColorKey;
  description?: string;
  count: number;
  isCustom: boolean;
  updatedAt: number;
}

export interface FolderSelectOption {
  id: string | null;
  name: string;
  path: string;
  depth: number;
  itemCount: number;
}

export interface LabelColorStyleConfig {
  key: ListenLabelColorKey;
  dotClass: string;
  chipClass: string;
  activeChipClass: string;
  swatchClass: string;
  ringClass: string;
  hexLight: string;
  hexDark: string;
}

export const LISTEN_LABEL_COLOR_KEYS: ListenLabelColorKey[] = [
  "teal",
  "sky",
  "indigo",
  "violet",
  "amber",
  "rose",
  "emerald",
  "slate"
];

export const LISTEN_LABEL_COLORS: Record<ListenLabelColorKey, LabelColorStyleConfig> = {
  teal: {
    key: "teal",
    dotClass: "bg-teal-500 dark:bg-teal-400",
    chipClass:
      "bg-teal-50/90 dark:bg-teal-950/50 text-teal-800 dark:text-teal-200 border-teal-200/80 dark:border-teal-800/70 hover:border-teal-400 dark:hover:border-teal-600",
    activeChipClass:
      "bg-teal-600 dark:bg-teal-500 text-white border-teal-700 dark:border-teal-400 shadow-2xs",
    swatchClass: "bg-teal-500",
    ringClass: "ring-teal-500/40 border-teal-600 dark:border-teal-300",
    hexLight: "#0D9488",
    hexDark: "#2DD4BF"
  },
  sky: {
    key: "sky",
    dotClass: "bg-sky-500 dark:bg-sky-400",
    chipClass:
      "bg-sky-50/90 dark:bg-sky-950/50 text-sky-800 dark:text-sky-200 border-sky-200/80 dark:border-sky-800/70 hover:border-sky-400 dark:hover:border-sky-600",
    activeChipClass:
      "bg-sky-600 dark:bg-sky-500 text-white border-sky-700 dark:border-sky-400 shadow-2xs",
    swatchClass: "bg-sky-500",
    ringClass: "ring-sky-500/40 border-sky-600 dark:border-sky-300",
    hexLight: "#0284C7",
    hexDark: "#38BDF8"
  },
  indigo: {
    key: "indigo",
    dotClass: "bg-indigo-500 dark:bg-indigo-400",
    chipClass:
      "bg-indigo-50/90 dark:bg-indigo-950/50 text-indigo-800 dark:text-indigo-200 border-indigo-200/80 dark:border-indigo-800/70 hover:border-indigo-400 dark:hover:border-indigo-600",
    activeChipClass:
      "bg-indigo-600 dark:bg-indigo-500 text-white border-indigo-700 dark:border-indigo-400 shadow-2xs",
    swatchClass: "bg-indigo-500",
    ringClass: "ring-indigo-500/40 border-indigo-600 dark:border-indigo-300",
    hexLight: "#4F46E5",
    hexDark: "#818CF8"
  },
  violet: {
    key: "violet",
    dotClass: "bg-violet-500 dark:bg-violet-400",
    chipClass:
      "bg-violet-50/90 dark:bg-violet-950/50 text-violet-800 dark:text-violet-200 border-violet-200/80 dark:border-violet-800/70 hover:border-violet-400 dark:hover:border-violet-600",
    activeChipClass:
      "bg-violet-600 dark:bg-violet-500 text-white border-violet-700 dark:border-violet-400 shadow-2xs",
    swatchClass: "bg-violet-500",
    ringClass: "ring-violet-500/40 border-violet-600 dark:border-violet-300",
    hexLight: "#7C3AED",
    hexDark: "#A78BFA"
  },
  amber: {
    key: "amber",
    dotClass: "bg-amber-500 dark:bg-amber-400",
    chipClass:
      "bg-amber-50/90 dark:bg-amber-950/50 text-amber-800 dark:text-amber-200 border-amber-200/80 dark:border-amber-800/70 hover:border-amber-400 dark:hover:border-amber-600",
    activeChipClass:
      "bg-amber-600 dark:bg-amber-500 text-white border-amber-700 dark:border-amber-400 shadow-2xs",
    swatchClass: "bg-amber-500",
    ringClass: "ring-amber-500/40 border-amber-600 dark:border-amber-300",
    hexLight: "#D97706",
    hexDark: "#FBBF24"
  },
  rose: {
    key: "rose",
    dotClass: "bg-rose-500 dark:bg-rose-400",
    chipClass:
      "bg-rose-50/90 dark:bg-rose-950/50 text-rose-800 dark:text-rose-200 border-rose-200/80 dark:border-rose-800/70 hover:border-rose-400 dark:hover:border-rose-600",
    activeChipClass:
      "bg-rose-600 dark:bg-rose-500 text-white border-rose-700 dark:border-rose-400 shadow-2xs",
    swatchClass: "bg-rose-500",
    ringClass: "ring-rose-500/40 border-rose-600 dark:border-rose-300",
    hexLight: "#E11D48",
    hexDark: "#FB7185"
  },
  emerald: {
    key: "emerald",
    dotClass: "bg-emerald-500 dark:bg-emerald-400",
    chipClass:
      "bg-emerald-50/90 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-200 border-emerald-200/80 dark:border-emerald-800/70 hover:border-emerald-400 dark:hover:border-emerald-600",
    activeChipClass:
      "bg-emerald-600 dark:bg-emerald-500 text-white border-emerald-700 dark:border-emerald-400 shadow-2xs",
    swatchClass: "bg-emerald-500",
    ringClass: "ring-emerald-500/40 border-emerald-600 dark:border-emerald-300",
    hexLight: "#059669",
    hexDark: "#34D399"
  },
  slate: {
    key: "slate",
    dotClass: "bg-slate-500 dark:bg-slate-400",
    chipClass:
      "bg-slate-100 dark:bg-slate-800/80 text-slate-700 dark:text-slate-200 border-slate-300/80 dark:border-slate-600/70 hover:border-slate-400 dark:hover:border-slate-500",
    activeChipClass:
      "bg-slate-700 dark:bg-slate-500 text-white border-slate-800 dark:border-slate-400 shadow-2xs",
    swatchClass: "bg-slate-500",
    ringClass: "ring-slate-500/40 border-slate-600 dark:border-slate-300",
    hexLight: "#475569",
    hexDark: "#94A3B8"
  }
};

export const LISTEN_LABELS_LS_KEY = "listen_label_definitions";
export const LISTEN_LABELS_DB_NAME = "GingkoListenLabelsDB";
export const LISTEN_LABELS_DB_VERSION = 1;
export const STORE_LABEL_DEFINITIONS = "label_definitions";

export function cleanLabelName(raw: string): string {
  if (typeof raw !== "string") return "";
  return raw
    .trim()
    .replace(/^#+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeLabelKey(raw: string): string {
  return cleanLabelName(raw).toLowerCase();
}

export function isValidLabelColorKey(color: unknown): color is ListenLabelColorKey {
  return typeof color === "string" && LISTEN_LABEL_COLOR_KEYS.includes(color as ListenLabelColorKey);
}

export function getDeterministicLabelColor(label: string): ListenLabelColorKey {
  const key = normalizeLabelKey(label) || cleanLabelName(label);
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash << 5) - hash + key.charCodeAt(i);
    hash |= 0;
  }
  const idx = Math.abs(hash) % LISTEN_LABEL_COLOR_KEYS.length;
  return LISTEN_LABEL_COLOR_KEYS[idx];
}

export function getLabelColorConfig(
  labelName: string,
  defsMap?: Record<string, ListenLabelDefinition>
): LabelColorStyleConfig {
  const key = normalizeLabelKey(labelName);
  const def = key && defsMap ? defsMap[key] : undefined;
  const colorKey = def && isValidLabelColorKey(def.color) ? def.color : getDeterministicLabelColor(labelName);
  return LISTEN_LABEL_COLORS[colorKey];
}

export function deduplicateLabelNames(rawTags: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of rawTags) {
    const clean = cleanLabelName(raw);
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(clean);
  }
  return result;
}

export function loadLabelDefinitionsFromLocalStorage(): Record<string, ListenLabelDefinition> {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(LISTEN_LABELS_LS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    const list = parseImportedLabels(parsed);
    const map: Record<string, ListenLabelDefinition> = {};
    for (const def of list) {
      map[def.key] = def;
    }
    return map;
  } catch (err) {
    console.warn("Failed to load listen_label_definitions from LocalStorage:", err);
    return {};
  }
}

export function saveLabelDefinitionsToLocalStorage(defs: Record<string, ListenLabelDefinition>): void {
  if (typeof localStorage === "undefined") return;
  try {
    const payload = Object.values(defs).sort((a, b) => a.name.localeCompare(b.name));
    localStorage.setItem(LISTEN_LABELS_LS_KEY, JSON.stringify(payload));
  } catch (err) {
    console.warn("Failed to save listen_label_definitions to LocalStorage:", err);
  }
}

let labelDbInstance: IDBDatabase | null = null;
let labelDbPromise: Promise<IDBDatabase> | null = null;

export function initListenLabelsDB(): Promise<IDBDatabase> {
  if (labelDbInstance) {
    return Promise.resolve(labelDbInstance);
  }
  if (labelDbPromise) {
    return labelDbPromise;
  }

  labelDbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not supported in this environment"));
      return;
    }

    const request = indexedDB.open(LISTEN_LABELS_DB_NAME, LISTEN_LABELS_DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_LABEL_DEFINITIONS)) {
        db.createObjectStore(STORE_LABEL_DEFINITIONS, { keyPath: "key" });
      }
    };

    request.onsuccess = (event) => {
      labelDbInstance = (event.target as IDBOpenDBRequest).result;
      labelDbInstance.onversionchange = () => {
        labelDbInstance?.close();
        labelDbInstance = null;
        labelDbPromise = null;
      };
      resolve(labelDbInstance);
    };

    request.onerror = (event) => {
      console.warn("Failed to open GingkoListenLabelsDB:", (event.target as IDBOpenDBRequest).error);
      labelDbPromise = null;
      reject((event.target as IDBOpenDBRequest).error);
    };
  });

  return labelDbPromise;
}

export async function loadLabelDefinitionsFromIndexedDB(): Promise<Record<string, ListenLabelDefinition>> {
  if (typeof indexedDB === "undefined") return {};
  try {
    const db = await initListenLabelsDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_LABEL_DEFINITIONS], "readonly");
      const store = tx.objectStore(STORE_LABEL_DEFINITIONS);
      const req = store.getAll();
      req.onsuccess = () => {
        const list = parseImportedLabels(req.result || []);
        const map: Record<string, ListenLabelDefinition> = {};
        for (const def of list) {
          map[def.key] = def;
        }
        resolve(map);
      };
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn("Failed to load listen labels from IndexedDB:", err);
    return {};
  }
}

export async function saveLabelDefinitionsToIndexedDB(
  defs: Record<string, ListenLabelDefinition>
): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    const db = await initListenLabelsDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_LABEL_DEFINITIONS], "readwrite");
      const store = tx.objectStore(STORE_LABEL_DEFINITIONS);
      const clearReq = store.clear();
      clearReq.onerror = () => reject(clearReq.error);
      clearReq.onsuccess = () => {
        for (const def of Object.values(defs)) {
          store.put({
            key: def.key,
            name: def.name,
            color: def.color,
            description: def.description || undefined,
            updatedAt: def.updatedAt || Date.now()
          });
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted"));
    });
  } catch (err) {
    console.warn("Failed to save listen labels to IndexedDB:", err);
  }
}

export function parseImportedLabels(rawLabels: unknown): ListenLabelDefinition[] {
  if (!rawLabels) return [];
  const entries = Array.isArray(rawLabels)
    ? rawLabels
    : typeof rawLabels === "object"
      ? Object.values(rawLabels as Record<string, unknown>)
      : [];

  const seen = new Map<string, ListenLabelDefinition>();
  for (const raw of entries) {
    if (!raw || typeof raw !== "object") continue;
    const obj = raw as Record<string, unknown>;
    const name = cleanLabelName(String(obj.name ?? obj.label ?? obj.key ?? ""));
    if (!name) continue;
    const key = normalizeLabelKey(name);
    const color = isValidLabelColorKey(obj.color) ? obj.color : getDeterministicLabelColor(name);
    const updatedAt = typeof obj.updatedAt === "number" && obj.updatedAt > 0 ? obj.updatedAt : Date.now();
    const description = typeof obj.description === "string" && obj.description.trim()
      ? obj.description.trim()
      : undefined;

    const existing = seen.get(key);
    if (!existing || updatedAt >= existing.updatedAt) {
      seen.set(key, { key, name, color, description, updatedAt });
    }
  }
  return Array.from(seen.values());
}

export function mergeLabelDefinitionMaps(
  primary: Record<string, ListenLabelDefinition>,
  secondary: Record<string, ListenLabelDefinition>
): Record<string, ListenLabelDefinition> {
  const merged: Record<string, ListenLabelDefinition> = { ...primary };
  for (const [key, def] of Object.entries(secondary)) {
    const existing = merged[key];
    if (!existing || (def.updatedAt || 0) > (existing.updatedAt || 0)) {
      merged[key] = def;
    }
  }
  return merged;
}

export function collectLabelSummariesFromTree(
  nodes: ListenItem[],
  defsMap: Record<string, ListenLabelDefinition>
): ListenLabelSummary[] {
  const counts = new Map<string, { displayName: string; count: number }>();

  const walk = (items: ListenItem[]) => {
    for (const node of items) {
      if (!node.isFolder && Array.isArray(node.tags)) {
        const nodeSeen = new Set<string>();
        for (const rawTag of node.tags) {
          const clean = cleanLabelName(rawTag);
          if (!clean) continue;
          const key = clean.toLowerCase();
          if (nodeSeen.has(key)) continue;
          nodeSeen.add(key);

          const cur = counts.get(key);
          if (cur) {
            cur.count += 1;
          } else {
            counts.set(key, { displayName: clean, count: 1 });
          }
        }
      }
      if (node.isFolder && Array.isArray(node.children) && node.children.length > 0) {
        walk(node.children);
      }
    }
  };

  if (Array.isArray(nodes)) {
    walk(nodes);
  }

  const keys = new Set<string>([...Object.keys(defsMap), ...counts.keys()]);
  const summaries: ListenLabelSummary[] = [];

  for (const key of keys) {
    const def = defsMap[key];
    const used = counts.get(key);
    const name = def?.name || used?.displayName || key;
    const color =
      def && isValidLabelColorKey(def.color) ? def.color : getDeterministicLabelColor(name);
    summaries.push({
      key,
      name,
      color,
      description: def?.description,
      count: used?.count || 0,
      isCustom: !!def,
      updatedAt: def?.updatedAt || 0
    });
  }

  return summaries.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export function itemMatchesLabelFilter(
  itemTags: string[] | undefined,
  selectedLabels: string[],
  matchMode: ListenLabelMatchMode = "any"
): boolean {
  if (!Array.isArray(selectedLabels) || selectedLabels.length === 0) {
    return true;
  }
  if (!Array.isArray(itemTags) || itemTags.length === 0) {
    return false;
  }

  const itemKeys = new Set(itemTags.map((t) => normalizeLabelKey(t)).filter(Boolean));
  const selectedKeys = selectedLabels.map((t) => normalizeLabelKey(t)).filter(Boolean);
  if (selectedKeys.length === 0) return true;

  if (matchMode === "all") {
    return selectedKeys.every((key) => itemKeys.has(key));
  }
  return selectedKeys.some((key) => itemKeys.has(key));
}

export function renameLabelInTree(
  nodes: ListenItem[],
  oldLabelName: string,
  newLabelName: string
): { tree: ListenItem[]; updatedItems: number } {
  const oldKey = normalizeLabelKey(oldLabelName);
  const cleanNext = cleanLabelName(newLabelName);
  if (!oldKey || !cleanNext) {
    return { tree: nodes, updatedItems: 0 };
  }

  let updatedItems = 0;

  const mapNode = (node: ListenItem): ListenItem => {
    let nextTags = node.tags;
    let changed = false;

    if (!node.isFolder && Array.isArray(node.tags) && node.tags.length > 0) {
      const mapped = node.tags.map((tag) => {
        if (normalizeLabelKey(tag) === oldKey) {
          changed = true;
          return cleanNext;
        }
        return cleanLabelName(tag);
      });
      if (changed) {
        nextTags = deduplicateLabelNames(mapped);
        updatedItems++;
      }
    }

    const nextChildren =
      node.isFolder && Array.isArray(node.children) ? node.children.map(mapNode) : node.children;

    if (!changed && nextChildren === node.children) {
      return node;
    }

    return {
      ...node,
      tags: nextTags && nextTags.length > 0 ? nextTags : undefined,
      children: nextChildren
    };
  };

  const tree = nodes.map(mapNode);
  return { tree, updatedItems };
}

export function removeLabelFromTree(
  nodes: ListenItem[],
  targetLabelName: string
): { tree: ListenItem[]; updatedItems: number } {
  const targetKey = normalizeLabelKey(targetLabelName);
  if (!targetKey) {
    return { tree: nodes, updatedItems: 0 };
  }

  let updatedItems = 0;

  const mapNode = (node: ListenItem): ListenItem => {
    let nextTags = node.tags;
    let changed = false;

    if (!node.isFolder && Array.isArray(node.tags) && node.tags.length > 0) {
      const filtered = node.tags.filter((tag) => {
        const keep = normalizeLabelKey(tag) !== targetKey;
        if (!keep) changed = true;
        return keep;
      });
      if (changed) {
        nextTags = filtered.length > 0 ? filtered : undefined;
        updatedItems++;
      }
    }

    const nextChildren =
      node.isFolder && Array.isArray(node.children) ? node.children.map(mapNode) : node.children;

    if (!changed && nextChildren === node.children) {
      return node;
    }

    return {
      ...node,
      tags: nextTags,
      children: nextChildren
    };
  };

  const tree = nodes.map(mapNode);
  return { tree, updatedItems };
}

export function setItemLabelsInTree(
  nodes: ListenItem[],
  itemId: string,
  labels: string[]
): ListenItem[] {
  const cleanTags = deduplicateLabelNames(labels);
  const nextTags = cleanTags.length > 0 ? cleanTags : undefined;

  const mapNode = (node: ListenItem): ListenItem => {
    if (node.id === itemId && !node.isFolder) {
      return {
        ...node,
        tags: nextTags
      };
    }
    if (node.isFolder && Array.isArray(node.children)) {
      let childChanged = false;
      const nextChildren = node.children.map((child) => {
        const updated = mapNode(child);
        if (updated !== child) childChanged = true;
        return updated;
      });
      if (childChanged) {
        return {
          ...node,
          children: nextChildren
        };
      }
    }
    return node;
  };

  return nodes.map(mapNode);
}

export function batchUpdateLabelsInTree(
  nodes: ListenItem[],
  itemIds: Set<string>,
  addLabels: string[],
  removeLabels: string[]
): { tree: ListenItem[]; updatedItems: number } {
  if (!itemIds || itemIds.size === 0) {
    return { tree: nodes, updatedItems: 0 };
  }

  const toAdd = deduplicateLabelNames(addLabels);
  const removeKeys = new Set(removeLabels.map((l) => normalizeLabelKey(l)).filter(Boolean));
  let updatedItems = 0;

  const mapNode = (node: ListenItem): ListenItem => {
    let updatedNode = node;
    if (!node.isFolder && itemIds.has(node.id)) {
      const current = Array.isArray(node.tags) ? node.tags : [];
      const kept = current.filter((t) => !removeKeys.has(normalizeLabelKey(t)));
      const combined = deduplicateLabelNames([...kept, ...toAdd]);
      updatedItems++;
      updatedNode = {
        ...node,
        tags: combined.length > 0 ? combined : undefined
      };
    }
    if (updatedNode.isFolder && Array.isArray(updatedNode.children)) {
      return {
        ...updatedNode,
        children: updatedNode.children.map(mapNode)
      };
    }
    return updatedNode;
  };

  return {
    tree: nodes.map(mapNode),
    updatedItems
  };
}

function cloneTree(nodes: ListenItem[]): ListenItem[] {
  return nodes.map((node) => ({
    ...node,
    tags: Array.isArray(node.tags) ? [...node.tags] : node.tags,
    children: Array.isArray(node.children) ? cloneTree(node.children) : node.children
  }));
}

function countFolderLeaves(node: ListenItem): number {
  if (!node.isFolder) return 1;
  if (!Array.isArray(node.children)) return 0;
  return node.children.reduce((acc, child) => acc + countFolderLeaves(child), 0);
}

export function collectFolderOptions(
  nodes: ListenItem[],
  rootLabel: string
): FolderSelectOption[] {
  const options: FolderSelectOption[] = [];
  const totalLeaves = nodes.reduce((acc, n) => acc + countFolderLeaves(n), 0);
  options.push({
    id: null,
    name: rootLabel,
    path: "",
    depth: 0,
    itemCount: totalLeaves
  });

  const walk = (items: ListenItem[], depth: number, ancestorPath: string[]) => {
    for (const node of items) {
      if (node.isFolder) {
        options.push({
          id: node.id,
          name: node.name,
          path: ancestorPath.join(" › "),
          depth,
          itemCount: countFolderLeaves(node)
        });
        if (Array.isArray(node.children) && node.children.length > 0) {
          walk(node.children, depth + 1, [...ancestorPath, node.name]);
        }
      }
    }
  };

  walk(nodes, 1, []);
  return options;
}

export function collectFolderLeafIds(folder: ListenItem): string[] {
  if (!folder || !folder.isFolder || !Array.isArray(folder.children)) {
    return folder && !folder.isFolder ? [folder.id] : [];
  }
  const ids: string[] = [];
  const walk = (items: ListenItem[]) => {
    for (const item of items) {
      if (!item.isFolder) {
        ids.push(item.id);
      } else if (Array.isArray(item.children)) {
        walk(item.children);
      }
    }
  };
  walk(folder.children);
  return ids;
}

export function batchMoveItemsInTree(
  nodes: ListenItem[],
  itemIds: Set<string>,
  targetFolderId: string | null
): { tree: ListenItem[]; movedCount: number } {
  if (!itemIds || itemIds.size === 0) {
    return { tree: nodes, movedCount: 0 };
  }

  const nextTree = cloneTree(nodes);
  const extracted: ListenItem[] = [];

  const folderContainsTarget = (folder: ListenItem, folderId: string): boolean => {
    if (folder.id === folderId) return true;
    if (!Array.isArray(folder.children)) return false;
    return folder.children.some((c) => c.isFolder && folderContainsTarget(c, folderId));
  };

  const extractMatching = (items: ListenItem[]): ListenItem[] => {
    const remaining: ListenItem[] = [];
    for (const item of items) {
      const canMove =
        itemIds.has(item.id) &&
        !(targetFolderId && item.isFolder && folderContainsTarget(item, targetFolderId));
      if (canMove) {
        extracted.push(item);
      } else {
        if (item.isFolder && Array.isArray(item.children)) {
          item.children = extractMatching(item.children);
        }
        remaining.push(item);
      }
    }
    return remaining;
  };

  const strippedTree = extractMatching(nextTree);
  if (extracted.length === 0) {
    return { tree: nodes, movedCount: 0 };
  }

  if (targetFolderId === null) {
    strippedTree.push(...extracted);
    return { tree: strippedTree, movedCount: extracted.length };
  }

  let inserted = false;
  const insertIntoTarget = (items: ListenItem[]): boolean => {
    for (const item of items) {
      if (item.isFolder && item.id === targetFolderId) {
        if (!Array.isArray(item.children)) {
          item.children = [];
        }
        item.children.push(...extracted);
        inserted = true;
        return true;
      }
      if (item.isFolder && Array.isArray(item.children) && insertIntoTarget(item.children)) {
        return true;
      }
    }
    return false;
  };

  insertIntoTarget(strippedTree);
  if (!inserted) {
    return { tree: nodes, movedCount: 0 };
  }

  return { tree: strippedTree, movedCount: extracted.length };
}

export function createFolderAndMoveItemsInTree(
  nodes: ListenItem[],
  folderName: string,
  parentFolderId: string | null,
  itemIds: Set<string>
): { tree: ListenItem[]; newFolder: ListenItem | null; movedCount: number } {
  const cleanName = folderName.trim();
  if (!cleanName) {
    return { tree: nodes, newFolder: null, movedCount: 0 };
  }

  const nextTree = cloneTree(nodes);
  const newFolder: ListenItem = {
    id: `folder-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: cleanName,
    isFolder: true,
    create_time: new Date().toISOString(),
    children: []
  };

  if (!parentFolderId) {
    nextTree.push(newFolder);
  } else {
    let added = false;
    const attach = (items: ListenItem[]): boolean => {
      for (const item of items) {
        if (item.isFolder && item.id === parentFolderId) {
          if (!Array.isArray(item.children)) item.children = [];
          item.children.push(newFolder);
          added = true;
          return true;
        }
        if (item.isFolder && Array.isArray(item.children) && attach(item.children)) {
          return true;
        }
      }
      return false;
    };
    attach(nextTree);
    if (!added) {
      nextTree.push(newFolder);
    }
  }

  if (!itemIds || itemIds.size === 0) {
    return { tree: nextTree, newFolder, movedCount: 0 };
  }

  const movedResult = batchMoveItemsInTree(nextTree, itemIds, newFolder.id);
  return {
    tree: movedResult.tree,
    newFolder,
    movedCount: movedResult.movedCount
  };
}
