/**
 * Dedicated IndexedDB persistence & multi-index query engine for the global
 * Memory (记忆) favorite directory.
 *
 * Database: GingkoMemoryDB (v1)
 * Object Store: memory_items (keyPath: "id")
 *
 * Secondary Indexes:
 *  - by_type              ('type')
 *  - by_savedAt           ('savedAt')
 *  - by_publishedAt       ('publishedAt')
 *  - by_pinned            ('pinned')
 *  - by_type_savedAt      (['type', 'savedAt'])
 *  - by_type_publishedAt  (['type', 'publishedAt'])
 *  - by_pinned_savedAt    (['pinned', 'savedAt'])
 *  - by_channelId         ('channelId')
 *  - by_authorLower       ('authorLower')
 *  - by_tags              ('tags', { multiEntry: true })
 *  - by_searchTokens      ('searchTokens', { multiEntry: true })
 */

import {
  extractPostTimestampMs,
  getPostCanonicalKey,
} from "./indexedDbPosts";

export const MEMORY_DB_NAME = "GingkoMemoryDB";
export const MEMORY_DB_VERSION = 1;
export const MEMORY_STORE_NAME = "memory_items";

export type MemoryItemType = "post" | "channel";
export type MemorySourceTab = "explorer" | "search" | "listen" | "import" | "unknown";
export type MemoryDateRange =
  | "all"
  | "today"
  | "yesterday"
  | "last3days"
  | "lastweek"
  | "lastmonth"
  | "lastyear";
export type MemoryDateBasis = "savedAt" | "publishedAt";
export type MemorySearchMode = "fulltext" | "regex";

export interface MemoryItemRecord {
  /** Canonical deterministic primary key: `post:<canonicalKey>` or `channel:<channelId>` */
  id: string;
  type: MemoryItemType;
  /** Normalized channel username / handle (lowercased, stripped of @ and URL) */
  channelId: string;
  sourceTab: MemorySourceTab;

  /** Timestamps in epoch ms */
  savedAt: number;
  updatedAt: number;
  /** Post publish time in ms; falls back to savedAt for channels / undated posts */
  publishedAt: number;
  /** True when publishedAt reflects an actual post publish timestamp */
  hasPublishDate: boolean;

  /** User curation fields */
  note: string;
  tags: string[];
  /** Numeric flag (0 | 1) so IndexedDB compound indexes sort deterministically */
  pinned: 0 | 1;

  /** Post-specific snapshot fields */
  postKey?: string;
  author?: string;
  authorUsername?: string;
  content?: string;
  postUrl?: string;
  views?: number;
  mediaPreviewUrl?: string;

  /** Channel-specific snapshot fields */
  channelTitle?: string;
  channelUsername?: string;
  channelDescription?: string;
  subscribers?: number;
  onlineCount?: number;
  isPrivate?: boolean;
  channelUrl?: string;

  /** Shared display fields */
  avatarUrl?: string;
  /** Compact raw snapshot for fidelity if needed later */
  snapshot?: Record<string, any>;

  /** Secondary index helper fields */
  authorLower: string;
  searchTokens: string[];
}

export interface MemoryQueryFilter {
  type?: "all" | MemoryItemType;
  dateRange?: MemoryDateRange;
  dateBasis?: MemoryDateBasis;
  query?: string;
  searchMode?: MemorySearchMode;
  pinnedOnly?: boolean;
  tags?: string[];
  limit?: number;
  offset?: number;
}

export interface MemoryQueryResult {
  items: MemoryItemRecord[];
  totalMatched: number;
  regexError: string | null;
  usedIndex: string;
}

export interface MemoryStats {
  total: number;
  posts: number;
  channels: number;
  pinned: number;
}

export interface MemoryTagCount {
  tag: string;
  count: number;
}

export interface MemoryArchiveBundle {
  schema: "gingko-memory-archive";
  version: 1;
  exportedAt: string;
  count: number;
  items: MemoryItemRecord[];
}

export interface MemoryImportSummary {
  added: number;
  updated: number;
  skipped: number;
  totalProcessed: number;
}

// ---------------------------------------------------------------------------
// Connection Management
// ---------------------------------------------------------------------------

let memoryDbPromise: Promise<IDBDatabase> | null = null;

function openMemoryDB(): Promise<IDBDatabase> {
  if (memoryDbPromise) return memoryDbPromise;

  memoryDbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is unavailable in this environment"));
      return;
    }

    const request = indexedDB.open(MEMORY_DB_NAME, MEMORY_DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      let store: IDBObjectStore;

      if (!db.objectStoreNames.contains(MEMORY_STORE_NAME)) {
        store = db.createObjectStore(MEMORY_STORE_NAME, { keyPath: "id" });
      } else {
        store = request.transaction!.objectStore(MEMORY_STORE_NAME);
      }

      const ensureIndex = (
        name: string,
        keyPath: string | string[],
        options?: IDBIndexParameters
      ) => {
        if (!store.indexNames.contains(name)) {
          store.createIndex(name, keyPath, options);
        }
      };

      ensureIndex("by_type", "type", { unique: false });
      ensureIndex("by_savedAt", "savedAt", { unique: false });
      ensureIndex("by_publishedAt", "publishedAt", { unique: false });
      ensureIndex("by_pinned", "pinned", { unique: false });
      ensureIndex("by_type_savedAt", ["type", "savedAt"], { unique: false });
      ensureIndex("by_type_publishedAt", ["type", "publishedAt"], { unique: false });
      ensureIndex("by_pinned_savedAt", ["pinned", "savedAt"], { unique: false });
      ensureIndex("by_channelId", "channelId", { unique: false });
      ensureIndex("by_authorLower", "authorLower", { unique: false });
      ensureIndex("by_tags", "tags", { unique: false, multiEntry: true });
      ensureIndex("by_searchTokens", "searchTokens", { unique: false, multiEntry: true });
    };

    request.onsuccess = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      db.onversionchange = () => {
        db.close();
        memoryDbPromise = null;
      };
      resolve(db);
    };

    request.onerror = (event) => {
      memoryDbPromise = null;
      reject((event.target as IDBOpenDBRequest).error || new Error("Failed to open Memory DB"));
    };
  });

  return memoryDbPromise;
}

// ---------------------------------------------------------------------------
// Text Cleaning, Tokenization & Canonical Key Builders
// ---------------------------------------------------------------------------

function stripHtmlTags(raw: string): string {
  if (!raw) return "";
  return raw
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function normalizeTags(tags?: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of tags) {
    if (typeof raw !== "string") continue;
    const clean = raw.trim().replace(/^#+/, "").replace(/\s+/g, " ");
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(clean);
    }
  }
  return result;
}

/**
 * Generates deduplicated search tokens for IndexedDB's `by_searchTokens` multi-entry index.
 * Captures:
 *  - Lowercased Latin / Cyrillic / numeric words (>= 2 chars)
 *  - CJK unigrams (for 1-char exact lookup) and 2-char bigrams for fast Chinese/Japanese search
 * Caps token count per record to keep index writes fast and compact.
 */
export function buildSearchTokens(fields: Array<string | undefined | null>, maxTokens = 260): string[] {
  const tokens = new Set<string>();
  const combined = fields.filter(Boolean).join(" ").toLowerCase();
  if (!combined) return [];

  // 1. Word tokens (Latin, Cyrillic, Greek, Arabic, digits, underscore)
  const wordMatches = combined.match(/[\p{L}\p{N}_]+/gu) || [];
  for (const w of wordMatches) {
    if (tokens.size >= maxTokens) break;
    // Detect CJK runs separately for bigram indexing
    if (/[\u3400-\u9FFF\uF900-\uFAFF\u3040-\u30FF\uAC00-\uD7AF]/.test(w)) {
      const chars = Array.from(w);
      for (let i = 0; i < chars.length && tokens.size < maxTokens; i++) {
        if (i + 1 < chars.length) {
          tokens.add(chars[i] + chars[i + 1]);
        }
        if (chars.length <= 4) {
          tokens.add(chars[i]);
        }
      }
      if (w.length >= 2 && w.length <= 16 && tokens.size < maxTokens) {
        tokens.add(w);
      }
    } else if (w.length >= 2) {
      tokens.add(w.slice(0, 40));
    }
  }

  return Array.from(tokens);
}

/**
 * Extracts query tokens suitable for narrowing via `by_searchTokens`.
 */
function extractQueryIndexTokens(query: string): string[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return [];
  const rawTokens = new Set<string>();
  const words = trimmed.match(/[\p{L}\p{N}_]+/gu) || [];

  for (const w of words) {
    if (/[\u3400-\u9FFF\uF900-\uFAFF\u3040-\u30FF\uAC00-\uD7AF]/.test(w)) {
      const chars = Array.from(w);
      if (chars.length === 1) {
        rawTokens.add(chars[0]);
      } else {
        for (let i = 0; i < chars.length - 1; i++) {
          rawTokens.add(chars[i] + chars[i + 1]);
        }
      }
    } else if (w.length >= 3) {
      rawTokens.add(w);
    }
  }
  return Array.from(rawTokens);
}

const INVALID_HANDLE_VALUES = new Set([
  "null",
  "undefined",
  "none",
  "nan",
  "{}",
  "[object object]",
]);

const RESERVED_TG_PATH_SEGMENTS = new Set([
  "s",
  "c",
  "joinchat",
  "addstickers",
  "addemoji",
  "addtheme",
  "share",
  "iv",
  "proxy",
  "socks",
  "bg",
  "setlanguage",
  "login",
  "boost",
  "nft",
  "giftcode",
]);

/**
 * Parses a Telegram channel handle from a Telegram URL while preserving original casing.
 * Supports:
 *  - https://t.me/s/<channel>/<postId>
 *  - https://t.me/<channel>/<postId>
 *  - https://t.me/<channel>
 *  - https://t.me/c/<numericId>/<postId>  -> `-100<numericId>`
 *  - https://telegram.me/...
 */
export function parseChannelFromTelegramUrl(rawUrl?: unknown): string {
  if (rawUrl == null) return "";
  const str = String(rawUrl).trim();
  if (!str) return "";

  const match = str.match(
    /^(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me|telegram\.dog)\/(.+)$/i
  );
  if (!match || !match[1]) return "";

  const pathOnly = match[1].split(/[?#]/)[0];
  const segments = pathOnly.split("/").filter(Boolean);
  if (segments.length === 0) return "";

  const firstLower = segments[0].toLowerCase();

  // Private channel/supergroup post URL: t.me/c/<numericId>/<postId>
  if (firstLower === "c") {
    const numSeg = (segments[1] || "").trim();
    if (/^-100\d+$/.test(numSeg)) return numSeg;
    if (/^\d+$/.test(numSeg)) return `-100${numSeg}`;
    return "";
  }

  // Public channel web preview URL: t.me/s/<channel>/<postId?>
  if (firstLower === "s") {
    const handle = (segments[1] || "").replace(/^@+/, "").trim();
    if (!handle || handle.startsWith("+") || INVALID_HANDLE_VALUES.has(handle.toLowerCase())) {
      return "";
    }
    return handle;
  }

  // Reject non-channel reserved Telegram routes & invite links
  if (RESERVED_TG_PATH_SEGMENTS.has(firstLower) || segments[0].startsWith("+")) {
    return "";
  }

  const handle = segments[0].replace(/^@+/, "").trim();
  if (!handle || INVALID_HANDLE_VALUES.has(handle.toLowerCase())) {
    return "";
  }
  return handle;
}

/**
 * Extracts a numeric post ID from a Telegram post URL if present.
 */
function parsePostIdFromTelegramUrl(rawUrl?: unknown): string {
  if (rawUrl == null) return "";
  const str = String(rawUrl).trim();
  if (!str) return "";

  const match = str.match(
    /^(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me|telegram\.dog)\/(.+)$/i
  );
  if (!match || !match[1]) return "";

  const segments = match[1].split(/[?#]/)[0].split("/").filter(Boolean);
  if (segments.length < 2) return "";

  const firstLower = segments[0].toLowerCase();
  if (firstLower === "s" || firstLower === "c") {
    const idSeg = (segments[2] || "").trim();
    return /^\d+$/.test(idSeg) ? idSeg : "";
  }
  const idSeg = (segments[1] || "").trim();
  return /^\d+$/.test(idSeg) ? idSeg : "";
}

/**
 * Extracts the exact-case channel handle prefix from a Gingko post key
 * (`<channel>.<postId>`, e.g. `MyChannel.12345` or `-1001234567890.456`).
 */
export function parseChannelFromPostKey(rawKey?: unknown): string {
  if (rawKey == null) return "";
  const str = String(rawKey).trim();
  if (!str) return "";
  const dotIdx = str.indexOf(".");
  if (dotIdx <= 0) return "";
  const prefix = str.slice(0, dotIdx).replace(/^@+/, "").trim();
  if (!prefix || /\s/.test(prefix) || INVALID_HANDLE_VALUES.has(prefix.toLowerCase())) {
    return "";
  }
  return prefix;
}

/**
 * Cleans a raw channel handle or Telegram link while preserving exact original casing.
 */
export function cleanChannelHandle(raw?: unknown): string {
  if (raw == null) return "";
  const str = String(raw).trim();
  if (!str || INVALID_HANDLE_VALUES.has(str.toLowerCase())) return "";

  if (/(?:^|\/\/)(?:www\.)?(?:t\.me|telegram\.me|telegram\.dog)\//i.test(str)) {
    return parseChannelFromTelegramUrl(str);
  }

  let cleaned = str.split(/[?#]/)[0].replace(/\/+$/, "").replace(/^@+/, "").trim();
  if (!cleaned || INVALID_HANDLE_VALUES.has(cleaned.toLowerCase())) return "";

  // Handle shorthand paths like "s/ChannelName/123" or "c/123456/99"
  if (cleaned.includes("/")) {
    const parsedFromPath = parseChannelFromTelegramUrl(`https://t.me/${cleaned}`);
    if (parsedFromPath) return parsedFromPath;
    const parts = cleaned.split("/").filter(Boolean);
    cleaned = (parts[0] || "").replace(/^@+/, "").trim();
  }

  // Strip trailing .<postId> if a post key was passed
  const dotIdx = cleaned.indexOf(".");
  if (dotIdx > 0 && /^\d+$/.test(cleaned.slice(dotIdx + 1))) {
    cleaned = cleaned.slice(0, dotIdx);
  }

  if (!cleaned || INVALID_HANDLE_VALUES.has(cleaned.toLowerCase())) return "";
  return cleaned;
}

function isHandleLike(val: string): boolean {
  return Boolean(val) && !/\s/.test(val);
}

/**
 * Extracts the exact-case channel `@username` from channel metadata and/or card object.
 * Strictly prioritizes `metadata.username` first, then `channel.username`, before
 * falling back to URLs, listen arguments, or other identifier fields.
 */
export function extractChannelUsername(channel: any, metadata?: any): string {
  if (typeof channel === "string" && !metadata) {
    return cleanChannelHandle(channel);
  }

  const meta = metadata && typeof metadata === "object" ? metadata : null;
  const ch = channel && typeof channel === "object" ? channel : null;

  const isNonChannelListenNode =
    ch && (ch.type === "keyword" || ch.type === "folder");

  const strictCandidates: Array<string> = [
    // 1. Primary: .username on channel metadata (authoritative Telegram @username)
    cleanChannelHandle(meta?.username),
    // 2. .username on channel object (e.g. Channels Lookup or explicit object)
    cleanChannelHandle(ch?.username),
    // 3. Explicit Telegram URL on metadata or channel
    parseChannelFromTelegramUrl(meta?.url || meta?.link || ch?.url || ch?.link),
    // 4. Secondary username fields
    cleanChannelHandle(meta?.channelUsername),
    !isNonChannelListenNode ? cleanChannelHandle(ch?.argument) : "",
    cleanChannelHandle(ch?.channelUsername),
    // 5. Key / ID-style identifiers
    cleanChannelHandle(meta?.key),
    cleanChannelHandle(ch?.key),
    cleanChannelHandle(meta?.channel_id ?? meta?.channelId),
    cleanChannelHandle(ch?.channel_id ?? ch?.channelId),
  ];

  for (const cand of strictCandidates) {
    if (isHandleLike(cand)) return cand;
  }

  // 6. Only accept .name if it looks like a handle (no whitespace), before falling back to numeric IDs
  const metaName = cleanChannelHandle(meta?.name);
  if (isHandleLike(metaName)) return metaName;

  const chName = !isNonChannelListenNode ? cleanChannelHandle(ch?.name) : "";
  if (isHandleLike(chName)) return chName;

  // 7. Numeric / raw ID fallbacks (e.g. private channels without public @username)
  const idFallbacks = [
    cleanChannelHandle(meta?.id),
    cleanChannelHandle(ch?.id),
  ];
  for (const cand of idFallbacks) {
    if (isHandleLike(cand)) return cand;
  }

  if (typeof channel === "string") {
    return cleanChannelHandle(channel);
  }
  return "";
}

/**
 * Extracts the exact-case channel handle for a post directly from raw post data:
 * strictly prioritizes `post.data.url` (and `post.url`/`post.link`) and `post.key`
 * BEFORE falling back to cached fields or caller-provided fallback channels.
 * Never uses `post.data.owner` (which is often a display title, not a @username).
 */
export function extractPostChannelUsername(post: any, fallbackChannel = ""): string {
  if (!post) {
    const fb = cleanChannelHandle(fallbackChannel);
    return isHandleLike(fb) ? fb : "";
  }

  // 1. Parse from raw post URL (post.data.url first, then post.url / post.link)
  const fromDataUrl = parseChannelFromTelegramUrl(post?.data?.url);
  if (isHandleLike(fromDataUrl)) return fromDataUrl;

  const fromRootUrl = parseChannelFromTelegramUrl(post?.url || post?.link);
  if (isHandleLike(fromRootUrl)) return fromRootUrl;

  // 2. Parse from raw post.key (e.g. `ChannelName.12345` or `-1001234567890.456`)
  const fromKey = parseChannelFromPostKey(post?.key);
  if (isHandleLike(fromKey)) return fromKey;

  const fromIdKey = parseChannelFromPostKey(post?.id);
  if (isHandleLike(fromIdKey)) return fromIdKey;

  // 3. Fallback to explicit channel handle fields (excluding display-name fields like data.owner)
  const fallbacks = [
    cleanChannelHandle(post?.channelUsername),
    cleanChannelHandle(post?.data?.channel_username),
    cleanChannelHandle(post?.channel_id),
    cleanChannelHandle(post?.channel),
    cleanChannelHandle(post?.data?.channel_id),
    cleanChannelHandle(fallbackChannel),
  ];
  for (const cand of fallbacks) {
    if (isHandleLike(cand)) return cand;
  }

  return "";
}

/**
 * Resolves the best exact-case channel `@username` / target handle for a saved
 * MemoryItemRecord — used both for `@username` display and for `Open in Explorer`.
 * Automatically recovers accurate targets for previously saved post records by
 * parsing `postUrl` and `postKey` first.
 */
export function resolveMemoryChannelTarget(
  item: Pick<
    MemoryItemRecord,
    "type" | "channelId" | "channelUsername" | "postUrl" | "postKey" | "channelUrl"
  > | null | undefined
): string {
  if (!item) return "";

  if (item.type === "post") {
    const fromUrl = parseChannelFromTelegramUrl(item.postUrl);
    if (isHandleLike(fromUrl)) return fromUrl;

    const fromKey = parseChannelFromPostKey(item.postKey);
    if (isHandleLike(fromKey)) return fromKey;

    const fromUsername = cleanChannelHandle(item.channelUsername);
    if (isHandleLike(fromUsername)) return fromUsername;

    const fromId = cleanChannelHandle(item.channelId);
    if (isHandleLike(fromId)) return fromId;

    return "";
  }

  const fromUsername = cleanChannelHandle(item.channelUsername);
  if (isHandleLike(fromUsername)) return fromUsername;

  const fromUrl = parseChannelFromTelegramUrl(item.channelUrl);
  if (isHandleLike(fromUrl)) return fromUrl;

  const fromId = cleanChannelHandle(item.channelId);
  if (isHandleLike(fromId)) return fromId;

  return "";
}

export function getMemoryPostKey(post: any, fallbackChannel = ""): string {
  if (post?.key && typeof post.key === "string" && post.key.trim()) {
    return post.key.trim();
  }
  const channelUsername = extractPostChannelUsername(post, fallbackChannel);
  const urlPostId = parsePostIdFromTelegramUrl(
    post?.data?.url || post?.url || post?.link
  );
  const rawId =
    post?.id ??
    post?.data?.id ??
    post?.message_id ??
    post?.data?.message_id ??
    urlPostId;

  if (rawId != null && String(rawId).trim()) {
    const idStr = String(rawId).trim();
    if (idStr.includes(".")) return idStr;
    if (channelUsername) return `${channelUsername}.${idStr}`;
    return idStr;
  }

  return getPostCanonicalKey(post, channelUsername || fallbackChannel);
}

export function buildPostMemoryId(post: any, fallbackChannel = ""): string {
  const canonical = getMemoryPostKey(post, fallbackChannel);
  return `post:${canonical.toLowerCase()}`;
}

export function extractChannelHandle(channel: any, metadata?: any): string {
  return extractChannelUsername(channel, metadata).toLowerCase();
}

export function buildChannelMemoryId(channel: any, metadata?: any): string {
  const handle = extractChannelHandle(channel, metadata);
  return `channel:${handle || "unknown"}`;
}

export function buildPostMemoryRecord(
  post: any,
  opts: {
    fallbackChannel?: string;
    fallbackChannelTitle?: string;
    sourceTab?: MemorySourceTab;
    existing?: MemoryItemRecord | null;
  } = {}
): MemoryItemRecord {
  const now = Date.now();
  const channelUsername = extractPostChannelUsername(post, opts.fallbackChannel || "");
  const channelId = channelUsername.toLowerCase();
  const postKey = getMemoryPostKey(post, channelUsername || opts.fallbackChannel || "");
  const id = `post:${postKey.toLowerCase()}`;

  const rawText =
    post?.data?.message ||
    post?.data?.text ||
    post?.data?.content ||
    post?.data?.rawcontent ||
    post?.text ||
    post?.content ||
    post?.cleanSnippet ||
    "";
  const content = stripHtmlTags(String(rawText));

  const authorRaw =
    post?.data?.author ||
    post?.data?.user ||
    post?.author ||
    post?.channelTitle ||
    opts.fallbackChannelTitle ||
    channelUsername ||
    "Telegram User";
  const author = String(authorRaw).trim();

  const authorUsername =
    channelUsername || cleanChannelHandle(post?.data?.username || "");

  const parsedPublishMs = extractPostTimestampMs(post);
  const hasPublishDate = parsedPublishMs > 0;
  const publishedAt = hasPublishDate ? parsedPublishMs : (opts.existing?.savedAt ?? now);

  const rawUrl = String(post?.data?.url || post?.url || post?.link || "").trim();
  const postIdPart = postKey.includes(".")
    ? postKey.slice(postKey.indexOf(".") + 1)
    : parsePostIdFromTelegramUrl(rawUrl);

  let postUrl = rawUrl;
  if (!postUrl && channelUsername) {
    if (channelUsername.startsWith("-100")) {
      const numericId = channelUsername.slice(4);
      postUrl =
        postIdPart && /^\d+$/.test(postIdPart)
          ? `https://t.me/c/${numericId}/${postIdPart}`
          : "";
    } else {
      postUrl =
        postIdPart && /^\d+$/.test(postIdPart)
          ? `https://t.me/${channelUsername}/${postIdPart}`
          : `https://t.me/${channelUsername}`;
    }
  }

  const avatarUrl =
    post?.avatarUrl ||
    (channelUsername
      ? `https://i.gogingko.net/api/v1/v/telegram-profile/${channelUsername}`
      : "");

  const mediaPreviewUrl =
    post?.data?.photos && post.data.photos.length > 0 && post?.key
      ? `https://i.gogingko.net/api/v1/v/telegram-photo/${post.key}_0`
      : post?.data?.linkPreview?.image && post?.key
      ? `https://i.gogingko.net/api/v1/v/telegram-photo/${post.key}_l_0`
      : undefined;

  const viewsRaw = post?.data?.views ?? post?.views;
  const views = typeof viewsRaw === "number" && Number.isFinite(viewsRaw)
    ? viewsRaw
    : typeof viewsRaw === "string" && viewsRaw.trim() && !isNaN(Number(viewsRaw))
    ? Number(viewsRaw)
    : undefined;

  const note = opts.existing?.note ?? "";
  const tags = opts.existing?.tags ?? [];
  const pinned: 0 | 1 = opts.existing?.pinned ?? 0;
  const savedAt = opts.existing?.savedAt ?? now;

  const channelTitle =
    post?.channelTitle || post?.data?.owner || opts.fallbackChannelTitle || "";

  const record: MemoryItemRecord = {
    id,
    type: "post",
    channelId,
    channelUsername: channelUsername || undefined,
    sourceTab: opts.sourceTab || opts.existing?.sourceTab || "unknown",
    savedAt,
    updatedAt: now,
    publishedAt,
    hasPublishDate,
    note,
    tags,
    pinned,
    postKey,
    author,
    authorUsername,
    channelTitle,
    content,
    postUrl,
    views,
    mediaPreviewUrl,
    avatarUrl,
    authorLower: author.toLowerCase(),
    searchTokens: [],
  };

  record.searchTokens = computeRecordSearchTokens(record);
  return record;
}

export function buildChannelMemoryRecord(
  channel: any,
  opts: {
    metadata?: any;
    sourceTab?: MemorySourceTab;
    existing?: MemoryItemRecord | null;
  } = {}
): MemoryItemRecord {
  const now = Date.now();
  const meta = opts.metadata || channel || {};
  const channelUsername = extractChannelUsername(channel, opts.metadata);
  const channelId = channelUsername.toLowerCase();
  const id = `channel:${channelId || "unknown"}`;

  const channelTitle = String(
    meta?.title ||
      channel?.title ||
      meta?.name ||
      channel?.channelName ||
      channel?.name ||
      channelUsername ||
      "Channel"
  ).trim();

  const channelDescription = stripHtmlTags(
    String(
      meta?.description ||
        meta?.about ||
        channel?.description ||
        channel?.about ||
        ""
    )
  );

  const subRaw =
    meta?.subscribers ??
    meta?.members ??
    meta?.participants_count ??
    channel?.subscribers;
  const subscribers =
    subRaw !== undefined && subRaw !== null && !isNaN(Number(subRaw))
      ? Number(subRaw)
      : undefined;

  const onlineRaw = meta?.online ?? meta?.online_count ?? channel?.online;
  const onlineCount =
    onlineRaw !== undefined && onlineRaw !== null && onlineRaw !== "" && !isNaN(Number(onlineRaw))
      ? Number(onlineRaw)
      : undefined;

  const isPrivate = channelUsername.startsWith("-100");
  const avatarUrl =
    (typeof meta?.photo === "string" && meta.photo.startsWith("data:")
      ? meta.photo
      : "") ||
    channel?.avatarUrl ||
    (channelUsername
      ? `https://i.gogingko.net/api/v1/v/telegram-profile/${channelUsername}`
      : "");

  const channelUrl = channelUsername
    ? isPrivate
      ? `https://t.me/c/${channelUsername.slice(4)}`
      : `https://t.me/${channelUsername}`
    : "";

  const rawCreated = meta?.date || meta?.createdAt || channel?.date;
  let parsedCreatedMs = 0;
  if (rawCreated != null) {
    parsedCreatedMs = extractPostTimestampMs({ date: rawCreated });
  }
  const savedAt = opts.existing?.savedAt ?? now;
  const hasPublishDate = parsedCreatedMs > 0;
  const publishedAt = hasPublishDate ? parsedCreatedMs : savedAt;

  const note = opts.existing?.note ?? "";
  const tags = opts.existing?.tags ?? [];
  const pinned: 0 | 1 = opts.existing?.pinned ?? 0;

  const record: MemoryItemRecord = {
    id,
    type: "channel",
    channelId,
    sourceTab: opts.sourceTab || opts.existing?.sourceTab || "unknown",
    savedAt,
    updatedAt: now,
    publishedAt,
    hasPublishDate,
    note,
    tags,
    pinned,
    channelTitle,
    channelUsername,
    channelDescription,
    subscribers,
    onlineCount,
    isPrivate,
    channelUrl,
    avatarUrl,
    authorLower: (channelTitle || channelUsername || channelId).toLowerCase(),
    searchTokens: [],
  };

  record.searchTokens = computeRecordSearchTokens(record);
  return record;
}

export function computeRecordSearchTokens(record: MemoryItemRecord): string[] {
  return buildSearchTokens([
    record.author,
    record.authorUsername,
    record.channelId,
    record.channelTitle,
    record.channelUsername,
    record.content,
    record.channelDescription,
    record.note,
    ...(record.tags || []),
  ]);
}

// ---------------------------------------------------------------------------
// Date Range Window Computation (Local Wall-Clock Boundaries)
// ---------------------------------------------------------------------------

export function getMemoryDateBounds(
  range: MemoryDateRange,
  nowMs: number = Date.now()
): { startMs: number; endMs: number } | null {
  if (!range || range === "all") return null;

  const now = new Date(nowMs);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const DAY_MS = 86_400_000;

  switch (range) {
    case "today":
      return { startMs: startOfToday, endMs: nowMs + DAY_MS };
    case "yesterday":
      return { startMs: startOfToday - DAY_MS, endMs: startOfToday - 1 };
    case "last3days":
      return { startMs: startOfToday - 2 * DAY_MS, endMs: nowMs + DAY_MS };
    case "lastweek":
      return { startMs: startOfToday - 6 * DAY_MS, endMs: nowMs + DAY_MS };
    case "lastmonth":
      return { startMs: startOfToday - 29 * DAY_MS, endMs: nowMs + DAY_MS };
    case "lastyear":
      return { startMs: startOfToday - 364 * DAY_MS, endMs: nowMs + DAY_MS };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// CRUD Operations
// ---------------------------------------------------------------------------

export async function getMemoryItemById(id: string): Promise<MemoryItemRecord | null> {
  const db = await openMemoryDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MEMORY_STORE_NAME, "readonly");
    const req = tx.objectStore(MEMORY_STORE_NAME).get(id);
    req.onsuccess = () => resolve((req.result as MemoryItemRecord) || null);
    req.onerror = () => reject(req.error);
  });
}

export async function putMemoryItem(record: MemoryItemRecord): Promise<MemoryItemRecord> {
  const normalized: MemoryItemRecord = {
    ...record,
    tags: normalizeTags(record.tags),
    pinned: record.pinned ? 1 : 0,
    updatedAt: record.updatedAt || Date.now(),
    authorLower: (record.author || record.channelTitle || record.channelId || "").toLowerCase(),
  };
  normalized.searchTokens = computeRecordSearchTokens(normalized);

  const db = await openMemoryDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MEMORY_STORE_NAME, "readwrite");
    tx.objectStore(MEMORY_STORE_NAME).put(normalized);
    tx.oncomplete = () => resolve(normalized);
    tx.onerror = () => reject(tx.error);
  });
}

export async function putMemoryItemsBatch(records: MemoryItemRecord[]): Promise<number> {
  if (!records.length) return 0;
  const db = await openMemoryDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MEMORY_STORE_NAME, "readwrite");
    const store = tx.objectStore(MEMORY_STORE_NAME);
    for (const record of records) {
      const normalized: MemoryItemRecord = {
        ...record,
        tags: normalizeTags(record.tags),
        pinned: record.pinned ? 1 : 0,
        authorLower: (record.author || record.channelTitle || record.channelId || "").toLowerCase(),
      };
      normalized.searchTokens = computeRecordSearchTokens(normalized);
      store.put(normalized);
    }
    tx.oncomplete = () => resolve(records.length);
    tx.onerror = () => reject(tx.error);
  });
}

export async function updateMemoryItemMeta(
  id: string,
  patch: { note?: string; tags?: string[]; pinned?: boolean }
): Promise<MemoryItemRecord | null> {
  const existing = await getMemoryItemById(id);
  if (!existing) return null;

  const updated: MemoryItemRecord = {
    ...existing,
    note: patch.note !== undefined ? patch.note : existing.note,
    tags: patch.tags !== undefined ? normalizeTags(patch.tags) : existing.tags,
    pinned: patch.pinned !== undefined ? (patch.pinned ? 1 : 0) : existing.pinned,
    updatedAt: Date.now(),
  };
  updated.searchTokens = computeRecordSearchTokens(updated);

  return putMemoryItem(updated);
}

export async function deleteMemoryItem(id: string): Promise<MemoryItemRecord | null> {
  const existing = await getMemoryItemById(id);
  if (!existing) return null;

  const db = await openMemoryDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MEMORY_STORE_NAME, "readwrite");
    tx.objectStore(MEMORY_STORE_NAME).delete(id);
    tx.oncomplete = () => resolve(existing);
    tx.onerror = () => reject(tx.error);
  });
}

export async function bulkDeleteMemoryItems(ids: string[]): Promise<MemoryItemRecord[]> {
  if (!ids.length) return [];
  const db = await openMemoryDB();
  const removed: MemoryItemRecord[] = [];

  return new Promise((resolve, reject) => {
    const tx = db.transaction(MEMORY_STORE_NAME, "readwrite");
    const store = tx.objectStore(MEMORY_STORE_NAME);
    let pending = ids.length;

    for (const id of ids) {
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        if (getReq.result) {
          removed.push(getReq.result as MemoryItemRecord);
          store.delete(id);
        }
        pending--;
        if (pending === 0) {
          // Wait for tx.oncomplete
        }
      };
    }

    tx.oncomplete = () => resolve(removed);
    tx.onerror = () => reject(tx.error);
  });
}

export async function bulkUpdateMemoryItems(
  ids: string[],
  action:
    | { kind: "addTag"; tag: string }
    | { kind: "removeTag"; tag: string }
    | { kind: "setPinned"; pinned: boolean }
): Promise<number> {
  if (!ids.length) return 0;
  const db = await openMemoryDB();
  let updatedCount = 0;

  return new Promise((resolve, reject) => {
    const tx = db.transaction(MEMORY_STORE_NAME, "readwrite");
    const store = tx.objectStore(MEMORY_STORE_NAME);

    for (const id of ids) {
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const rec = getReq.result as MemoryItemRecord | undefined;
        if (!rec) return;

        let nextTags = rec.tags || [];
        let nextPinned: 0 | 1 = rec.pinned;

        if (action.kind === "addTag") {
          nextTags = normalizeTags([...nextTags, action.tag]);
        } else if (action.kind === "removeTag") {
          const target = action.tag.trim().toLowerCase();
          nextTags = nextTags.filter((t) => t.toLowerCase() !== target);
        } else if (action.kind === "setPinned") {
          nextPinned = action.pinned ? 1 : 0;
        }

        const next: MemoryItemRecord = {
          ...rec,
          tags: nextTags,
          pinned: nextPinned,
          updatedAt: Date.now(),
        };
        next.searchTokens = computeRecordSearchTokens(next);
        store.put(next);
        updatedCount++;
      };
    }

    tx.oncomplete = () => resolve(updatedCount);
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAllMemoryIds(): Promise<string[]> {
  const db = await openMemoryDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MEMORY_STORE_NAME, "readonly");
    const req = tx.objectStore(MEMORY_STORE_NAME).getAllKeys();
    req.onsuccess = () => resolve((req.result as string[]) || []);
    req.onerror = () => reject(req.error);
  });
}

export async function getAllMemoryItems(): Promise<MemoryItemRecord[]> {
  const db = await openMemoryDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MEMORY_STORE_NAME, "readonly");
    const req = tx.objectStore(MEMORY_STORE_NAME).getAll();
    req.onsuccess = () => resolve((req.result as MemoryItemRecord[]) || []);
    req.onerror = () => reject(req.error);
  });
}

export async function getMemoryStats(): Promise<MemoryStats> {
  const db = await openMemoryDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MEMORY_STORE_NAME, "readonly");
    const store = tx.objectStore(MEMORY_STORE_NAME);
    const totalReq = store.count();
    const postsReq = store.index("by_type").count(IDBKeyRange.only("post"));
    const channelsReq = store.index("by_type").count(IDBKeyRange.only("channel"));
    const pinnedReq = store.index("by_pinned").count(IDBKeyRange.only(1));

    tx.oncomplete = () => {
      resolve({
        total: totalReq.result || 0,
        posts: postsReq.result || 0,
        channels: channelsReq.result || 0,
        pinned: pinnedReq.result || 0,
      });
    };
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAllMemoryTagCounts(): Promise<MemoryTagCount[]> {
  const db = await openMemoryDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MEMORY_STORE_NAME, "readonly");
    const index = tx.objectStore(MEMORY_STORE_NAME).index("by_tags");
    const counts = new Map<string, number>();

    const req = index.openKeyCursor();
    req.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursor | null>).result;
      if (cursor) {
        const tag = String(cursor.key);
        counts.set(tag, (counts.get(tag) || 0) + 1);
        cursor.continue();
      } else {
        const list = Array.from(counts.entries())
          .map(([tag, count]) => ({ tag, count }))
          .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
        resolve(list);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

// ---------------------------------------------------------------------------
// Multi-Index Query Engine
// ---------------------------------------------------------------------------

function readFromIndex(
  store: IDBObjectStore,
  indexName: string,
  range?: IDBKeyRange
): Promise<MemoryItemRecord[]> {
  return new Promise((resolve, reject) => {
    const index = store.index(indexName);
    const req = range ? index.getAll(range) : index.getAll();
    req.onsuccess = () => resolve((req.result as MemoryItemRecord[]) || []);
    req.onerror = () => reject(req.error);
  });
}

function getSearchableFields(item: MemoryItemRecord): string[] {
  return [
    item.author || "",
    item.authorUsername || "",
    item.channelId || "",
    item.content || "",
    item.channelTitle || "",
    item.channelUsername || "",
    item.channelDescription || "",
    item.note || "",
    ...(item.tags || []),
  ];
}

/**
 * Executes a multi-dimensional query leveraging IndexedDB secondary indexes first,
 * then applying fine-grained tag, full-text, or validated regex predicates.
 */
export async function queryMemoryItems(filter: MemoryQueryFilter = {}): Promise<MemoryQueryResult> {
  const typeFilter = filter.type || "all";
  const dateRange = filter.dateRange || "all";
  const dateBasis: MemoryDateBasis = filter.dateBasis || "savedAt";
  const searchMode: MemorySearchMode = filter.searchMode || "fulltext";
  const queryTrimmed = (filter.query || "").trim();
  const selectedTags = normalizeTags(filter.tags || []);
  const pinnedOnly = Boolean(filter.pinnedOnly);

  let compiledRegex: RegExp | null = null;
  if (queryTrimmed && searchMode === "regex") {
    try {
      compiledRegex = new RegExp(queryTrimmed, "i");
    } catch (err: any) {
      return {
        items: [],
        totalMatched: 0,
        regexError: err?.message || "Invalid regular expression",
        usedIndex: "none",
      };
    }
  }

  const bounds = getMemoryDateBounds(dateRange);
  const db = await openMemoryDB();

  let candidates: MemoryItemRecord[] = [];
  let usedIndex = "by_savedAt";

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(MEMORY_STORE_NAME, "readonly");
    const store = tx.objectStore(MEMORY_STORE_NAME);

    (async () => {
      try {
        // Strategy 1: If tag filter is active, narrow directly via multi-entry `by_tags` index
        if (selectedTags.length > 0) {
          usedIndex = "by_tags";
          candidates = await readFromIndex(store, "by_tags", IDBKeyRange.only(selectedTags[0]));
        }
        // Strategy 2: Full-text query with strong index tokens & no narrow type+date combo
        else if (
          queryTrimmed &&
          searchMode === "fulltext" &&
          !bounds &&
          typeFilter === "all" &&
          !pinnedOnly
        ) {
          const idxTokens = extractQueryIndexTokens(queryTrimmed);
          if (idxTokens.length > 0) {
            usedIndex = "by_searchTokens";
            // Pick longest token for highest selectivity
            const selectiveToken = idxTokens.reduce((a, b) => (b.length > a.length ? b : a), idxTokens[0]);
            const tokenMatches = await readFromIndex(
              store,
              "by_searchTokens",
              IDBKeyRange.only(selectiveToken)
            );
            // Deduplicate by id (multiEntry can yield unique records, guard defensively)
            const dedup = new Map<string, MemoryItemRecord>();
            for (const rec of tokenMatches) dedup.set(rec.id, rec);
            candidates = Array.from(dedup.values());
          } else {
            usedIndex = dateBasis === "publishedAt" ? "by_publishedAt" : "by_savedAt";
            candidates = await readFromIndex(store, usedIndex);
          }
        }
        // Strategy 3: Pinned-only without type filter -> use `by_pinned_savedAt`
        else if (pinnedOnly && typeFilter === "all" && dateBasis === "savedAt") {
          usedIndex = "by_pinned_savedAt";
          const range = bounds
            ? IDBKeyRange.bound([1, bounds.startMs], [1, bounds.endMs])
            : IDBKeyRange.bound([1, 0], [1, Number.MAX_SAFE_INTEGER]);
          candidates = await readFromIndex(store, usedIndex, range);
        }
        // Strategy 4: Type + Date compound index (`by_type_savedAt` or `by_type_publishedAt`)
        else if (typeFilter !== "all") {
          usedIndex = dateBasis === "publishedAt" ? "by_type_publishedAt" : "by_type_savedAt";
          const range = bounds
            ? IDBKeyRange.bound([typeFilter, bounds.startMs], [typeFilter, bounds.endMs])
            : IDBKeyRange.bound([typeFilter, 0], [typeFilter, Number.MAX_SAFE_INTEGER]);
          candidates = await readFromIndex(store, usedIndex, range);
        }
        // Strategy 5: Date range index (`by_savedAt` or `by_publishedAt`)
        else {
          usedIndex = dateBasis === "publishedAt" ? "by_publishedAt" : "by_savedAt";
          const range = bounds ? IDBKeyRange.bound(bounds.startMs, bounds.endMs) : undefined;
          candidates = await readFromIndex(store, usedIndex, range);
        }
        resolve();
      } catch (err) {
        reject(err);
      }
    })();
  });

  // Post-index filtering for combined predicates
  const fulltextTerms =
    queryTrimmed && searchMode === "fulltext"
      ? queryTrimmed.toLowerCase().split(/\s+/).filter(Boolean)
      : [];

  const selectedTagKeys = selectedTags.map((t) => t.toLowerCase());

  const filtered = candidates.filter((item) => {
    if (typeFilter !== "all" && item.type !== typeFilter) return false;
    if (pinnedOnly && item.pinned !== 1) return false;

    if (bounds) {
      const ts = dateBasis === "publishedAt" ? item.publishedAt : item.savedAt;
      if (ts < bounds.startMs || ts > bounds.endMs) return false;
    }

    if (selectedTagKeys.length > 0) {
      const itemTagSet = new Set((item.tags || []).map((t) => t.toLowerCase()));
      for (const reqTag of selectedTagKeys) {
        if (!itemTagSet.has(reqTag)) return false;
      }
    }

    if (compiledRegex) {
      const fields = getSearchableFields(item);
      if (!fields.some((f) => f && compiledRegex!.test(f))) {
        return false;
      }
    } else if (fulltextTerms.length > 0) {
      const haystack = getSearchableFields(item).join("\n").toLowerCase();
      for (const term of fulltextTerms) {
        if (!haystack.includes(term)) return false;
      }
    }

    return true;
  });

  // Sort: pinned first, then active date basis descending, then savedAt descending
  filtered.sort((a, b) => {
    if (b.pinned !== a.pinned) return b.pinned - a.pinned;
    const tsA = dateBasis === "publishedAt" ? a.publishedAt : a.savedAt;
    const tsB = dateBasis === "publishedAt" ? b.publishedAt : b.savedAt;
    if (tsB !== tsA) return tsB - tsA;
    return b.savedAt - a.savedAt;
  });

  const totalMatched = filtered.length;
  const offset = filter.offset || 0;
  const items =
    filter.limit && filter.limit > 0
      ? filtered.slice(offset, offset + filter.limit)
      : filtered.slice(offset);

  return {
    items,
    totalMatched,
    regexError: null,
    usedIndex,
  };
}

// ---------------------------------------------------------------------------
// JSON Archive Export & Import
// ---------------------------------------------------------------------------

export async function exportMemoryArchive(): Promise<MemoryArchiveBundle> {
  const items = await getAllMemoryItems();
  items.sort((a, b) => b.pinned - a.pinned || b.savedAt - a.savedAt);
  return {
    schema: "gingko-memory-archive",
    version: 1,
    exportedAt: new Date().toISOString(),
    count: items.length,
    items,
  };
}

export async function importMemoryArchive(rawPayload: unknown): Promise<MemoryImportSummary> {
  let rawItems: any[] = [];
  if (Array.isArray(rawPayload)) {
    rawItems = rawPayload;
  } else if (
    rawPayload &&
    typeof rawPayload === "object" &&
    Array.isArray((rawPayload as any).items)
  ) {
    rawItems = (rawPayload as any).items;
  } else {
    throw new Error("Invalid Memory archive JSON format");
  }

  const existingAll = await getAllMemoryItems();
  const existingMap = new Map<string, MemoryItemRecord>(
    existingAll.map((item) => [item.id, item])
  );

  const toWrite: MemoryItemRecord[] = [];
  let added = 0;
  let updated = 0;
  let skipped = 0;

  for (const entry of rawItems) {
    if (!entry || typeof entry !== "object") {
      skipped++;
      continue;
    }

    const type: MemoryItemType | null =
      entry.type === "post" || entry.type === "channel" ? entry.type : null;
    if (!type) {
      skipped++;
      continue;
    }

    const resolvedChannelUsername = resolveMemoryChannelTarget({
      type,
      channelId: entry.channelId || "",
      channelUsername: entry.channelUsername || entry.username || entry.authorUsername || "",
      postUrl: entry.postUrl || "",
      postKey: entry.postKey || "",
      channelUrl: entry.channelUrl || "",
    });
    const channelId = resolvedChannelUsername.toLowerCase();
    const id =
      typeof entry.id === "string" && entry.id.trim()
        ? entry.id.trim().toLowerCase()
        : type === "post" && entry.postKey
        ? `post:${String(entry.postKey).trim().toLowerCase()}`
        : channelId
        ? `${type}:${channelId}`
        : "";

    if (!id) {
      skipped++;
      continue;
    }

    const existing = existingMap.get(id);
    const now = Date.now();
    const savedAt =
      typeof entry.savedAt === "number" && entry.savedAt > 0
        ? entry.savedAt
        : existing?.savedAt || now;
    const publishedAt =
      typeof entry.publishedAt === "number" && entry.publishedAt > 0
        ? entry.publishedAt
        : existing?.publishedAt || savedAt;

    const mergedTags = normalizeTags([
      ...(existing?.tags || []),
      ...(Array.isArray(entry.tags) ? entry.tags : []),
    ]);

    const mergedNote =
      typeof entry.note === "string" && entry.note.trim()
        ? entry.note
        : existing?.note || "";

    const record: MemoryItemRecord = {
      ...(existing || {}),
      ...entry,
      id,
      type,
      channelId: channelId || existing?.channelId || "",
      channelUsername:
        resolvedChannelUsername || existing?.channelUsername || entry.channelUsername || undefined,
      sourceTab: (entry.sourceTab as MemorySourceTab) || existing?.sourceTab || "import",
      savedAt,
      updatedAt: now,
      publishedAt,
      hasPublishDate:
        typeof entry.hasPublishDate === "boolean"
          ? entry.hasPublishDate
          : Boolean(existing?.hasPublishDate),
      note: mergedNote,
      tags: mergedTags,
      pinned: entry.pinned ? 1 : existing?.pinned ? 1 : 0,
      authorLower: String(
        entry.author || entry.channelTitle || resolvedChannelUsername || channelId || existing?.authorLower || ""
      ).toLowerCase(),
      searchTokens: [],
    };
    record.searchTokens = computeRecordSearchTokens(record);

    toWrite.push(record);
    if (existing) {
      updated++;
    } else {
      added++;
    }
  }

  if (toWrite.length > 0) {
    await putMemoryItemsBatch(toWrite);
  }

  return {
    added,
    updated,
    skipped,
    totalProcessed: rawItems.length,
  };
}
