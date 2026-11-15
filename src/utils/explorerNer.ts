/**
 * Explorer Named Entity Recognition (NER) & Timestamped Relation Extraction
 *
 * Defines 10 NER classes and 10 relation classes, persistent IndexedDB caching
 * keyed by (channel, postKey, extractorVersion), batch orchestration with
 * server-side Gemini structured extraction + multilingual local NLP fallback,
 * canonical entity merging, and safe HTML quote/entity highlighting.
 */

export type NerClassId =
  | "person"
  | "organization"
  | "nation"
  | "job_position"
  | "location"
  | "address"
  | "event"
  | "platform"
  | "asset_law"
  | "financial_metric";

export type RelationClassId =
  | "holds_role"
  | "affiliated_with"
  | "located_at"
  | "participated_in"
  | "targets_or_acts_on"
  | "issued_or_authored"
  | "cooperated_with"
  | "opposed_to"
  | "transferred_or_funded"
  | "operated_by";

export interface NerClassMeta {
  id: NerClassId;
  shortCode: string;
  accentHex: string;
  textClass: string;
  activeTabClass: string;
  dotClass: string;
}

export interface RelationClassMeta {
  id: RelationClassId;
  accentHex: string;
  textClass: string;
  directed: boolean;
}

export const NER_CLASSES: NerClassMeta[] = [
  {
    id: "person",
    shortCode: "PER",
    accentHex: "#0f766e",
    textClass: "text-teal-700 dark:text-teal-300",
    activeTabClass: "bg-teal-600 text-white",
    dotClass: "bg-teal-600",
  },
  {
    id: "organization",
    shortCode: "ORG",
    accentHex: "#2563eb",
    textClass: "text-blue-700 dark:text-blue-300",
    activeTabClass: "bg-blue-600 text-white",
    dotClass: "bg-blue-600",
  },
  {
    id: "nation",
    shortCode: "NAT",
    accentHex: "#4f46e5",
    textClass: "text-indigo-700 dark:text-indigo-300",
    activeTabClass: "bg-indigo-600 text-white",
    dotClass: "bg-indigo-600",
  },
  {
    id: "job_position",
    shortCode: "ROLE",
    accentHex: "#7c3aed",
    textClass: "text-violet-700 dark:text-violet-300",
    activeTabClass: "bg-violet-600 text-white",
    dotClass: "bg-violet-600",
  },
  {
    id: "location",
    shortCode: "LOC",
    accentHex: "#0284c7",
    textClass: "text-sky-700 dark:text-sky-300",
    activeTabClass: "bg-sky-600 text-white",
    dotClass: "bg-sky-600",
  },
  {
    id: "address",
    shortCode: "ADDR",
    accentHex: "#0d9488",
    textClass: "text-emerald-700 dark:text-emerald-300",
    activeTabClass: "bg-emerald-600 text-white",
    dotClass: "bg-emerald-600",
  },
  {
    id: "event",
    shortCode: "EVT",
    accentHex: "#d97706",
    textClass: "text-amber-700 dark:text-amber-300",
    activeTabClass: "bg-amber-600 text-white",
    dotClass: "bg-amber-600",
  },
  {
    id: "platform",
    shortCode: "PLT",
    accentHex: "#0891b2",
    textClass: "text-cyan-700 dark:text-cyan-300",
    activeTabClass: "bg-cyan-600 text-white",
    dotClass: "bg-cyan-600",
  },
  {
    id: "asset_law",
    shortCode: "LAW",
    accentHex: "#9333ea",
    textClass: "text-purple-700 dark:text-purple-300",
    activeTabClass: "bg-purple-600 text-white",
    dotClass: "bg-purple-600",
  },
  {
    id: "financial_metric",
    shortCode: "MET",
    accentHex: "#be123c",
    textClass: "text-rose-700 dark:text-rose-300",
    activeTabClass: "bg-rose-600 text-white",
    dotClass: "bg-rose-600",
  },
];

export const RELATION_CLASSES: RelationClassMeta[] = [
  { id: "holds_role", accentHex: "#7c3aed", textClass: "text-violet-700 dark:text-violet-300", directed: true },
  { id: "affiliated_with", accentHex: "#2563eb", textClass: "text-blue-700 dark:text-blue-300", directed: true },
  { id: "located_at", accentHex: "#0284c7", textClass: "text-sky-700 dark:text-sky-300", directed: true },
  { id: "participated_in", accentHex: "#d97706", textClass: "text-amber-700 dark:text-amber-300", directed: true },
  { id: "targets_or_acts_on", accentHex: "#dc2626", textClass: "text-red-700 dark:text-red-300", directed: true },
  { id: "issued_or_authored", accentHex: "#0d9488", textClass: "text-teal-700 dark:text-teal-300", directed: true },
  { id: "cooperated_with", accentHex: "#16a34a", textClass: "text-emerald-700 dark:text-emerald-300", directed: false },
  { id: "opposed_to", accentHex: "#e11d48", textClass: "text-rose-700 dark:text-rose-300", directed: false },
  { id: "transferred_or_funded", accentHex: "#9333ea", textClass: "text-purple-700 dark:text-purple-300", directed: true },
  { id: "operated_by", accentHex: "#0891b2", textClass: "text-cyan-700 dark:text-cyan-300", directed: true },
];

export const NER_CLASS_MAP = new Map<NerClassId, NerClassMeta>(
  NER_CLASSES.map((c) => [c.id, c])
);

export const RELATION_CLASS_MAP = new Map<RelationClassId, RelationClassMeta>(
  RELATION_CLASSES.map((r) => [r.id, r])
);

export const EXPLORER_NER_EXTRACTOR_VERSION = 1;

export interface ExtractedPostEntity {
  name: string;
  canonical: string;
  nerClass: NerClassId;
  quote: string;
}

export interface ExtractedPostRelation {
  subject: string;
  subjectClass: NerClassId;
  relationClass: RelationClassId;
  object: string;
  objectClass: NerClassId;
  quote: string;
  confidence: number;
}

export interface PostNerExtractionRecord {
  id: string; // `${normalizedChannel}::${postKey}`
  channelId: string;
  postKey: string;
  timestampMs: number;
  extractorVersion: number;
  engine: "gemini" | "local";
  entities: ExtractedPostEntity[];
  relations: ExtractedPostRelation[];
  updatedAt: number;
}

export interface AggregatedNerEntity {
  id: string;
  canonicalName: string;
  nerClass: NerClassId;
  aliases: string[];
  mentionCount: number;
  firstSeenMs: number;
  lastSeenMs: number;
  postKeys: string[];
  sampleQuotes: Array<{ postKey: string; timestampMs: number; quote: string }>;
  cooccurringIds: string[];
}

export interface RelationOccurrence {
  postKey: string;
  timestampMs: number;
  evidenceQuote: string;
  confidence: number;
  engine: "gemini" | "local";
}

export interface AggregatedNerRelation {
  id: string;
  subjectId: string;
  subjectName: string;
  subjectClass: NerClassId;
  relationClass: RelationClassId;
  objectId: string;
  objectName: string;
  objectClass: NerClassId;
  occurrences: RelationOccurrence[];
  earliestTimestampMs: number;
  latestTimestampMs: number;
  postKeys: string[];
}

export interface AggregatedNerIndex {
  entities: AggregatedNerEntity[];
  relations: AggregatedNerRelation[];
  entityById: Map<string, AggregatedNerEntity>;
  relationById: Map<string, AggregatedNerRelation>;
  classCounts: Record<NerClassId, number>;
  relationClassCounts: Record<RelationClassId, number>;
  totalMentions: number;
  postsAnalyzed: number;
  enginesUsed: Set<"gemini" | "local">;
}

export interface ActiveNerFeedFilter {
  type: "entity" | "relation";
  id: string;
  label: string;
  sublabel?: string;
  postKeys: string[];
  quotes: Array<{ postKey: string; timestampMs: number; quote: string }>;
  surfaceTerms: string[];
}

export interface NerBatchProgress {
  done: number;
  total: number;
  cachedSkipped: number;
  engine: "gemini" | "local" | "mixed" | null;
  failedBatches: number;
  lastError: string | null;
}

// ---------------------------------------------------------------------------
// Normalization & Utility Helpers
// ---------------------------------------------------------------------------

export function normalizeNerChannelKey(channel: string): string {
  if (!channel) return "";
  return String(channel)
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(?:t\.me|telegram\.me)\//i, "")
    .replace(/^@/, "");
}

export function extractExplorerPostTimestampMs(post: any): number {
  const raw =
    post?.data?.date ??
    post?.date ??
    post?.data?.created_at ??
    post?.created_at ??
    post?.data?.timestamp ??
    post?.timestamp;
  if (raw == null) return 0;
  if (typeof raw === "number") {
    return raw < 10_000_000_000 ? raw * 1000 : raw;
  }
  const num = Number(raw);
  if (!Number.isNaN(num) && num > 0) {
    return num < 10_000_000_000 ? num * 1000 : num;
  }
  const parsed = Date.parse(String(raw));
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function stripHtmlToPlainText(htmlOrText: string): string {
  if (!htmlOrText) return "";
  return String(htmlOrText)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function extractPostPlainText(post: any): string {
  const parts: string[] = [];
  const rawMain = post?.data?.content || post?.data?.rawcontent || "";
  const cleanMain = stripHtmlToPlainText(rawMain);
  if (cleanMain) parts.push(cleanMain);

  if (post?.data?.linkPreview?.title) {
    parts.push(String(post.data.linkPreview.title).trim());
  }
  if (post?.data?.linkPreview?.description) {
    parts.push(String(post.data.linkPreview.description).trim());
  }
  if (post?.data?.forward_url) {
    parts.push(`Forwarded from ${String(post.data.forward_url).trim()}`);
  }
  if (Array.isArray(post?.data?.reply) && post.data.reply[1]) {
    parts.push(stripHtmlToPlainText(String(post.data.reply[1])).slice(0, 280));
  }
  if (post?.data?.contact && typeof post.data.contact === "object") {
    const c = post.data.contact;
    const full = [c.first_name, c.last_name].filter(Boolean).join(" ").trim();
    if (full) parts.push(`Contact: ${full}`);
  }
  return parts.join("\n").trim();
}

const VALID_NER_SET = new Set<string>(NER_CLASSES.map((c) => c.id));
const VALID_REL_SET = new Set<string>(RELATION_CLASSES.map((r) => r.id));

export function coerceNerClass(val: string | undefined): NerClassId {
  const v = String(val || "").trim().toLowerCase();
  if (VALID_NER_SET.has(v)) return v as NerClassId;
  if (v.includes("person") || v.includes("human") || v.includes("people")) return "person";
  if (v.includes("org") || v.includes("company") || v.includes("agency")) return "organization";
  if (v.includes("nation") || v.includes("country") || v.includes("state") || v.includes("polity")) return "nation";
  if (v.includes("job") || v.includes("role") || v.includes("title") || v.includes("position")) return "job_position";
  if (v.includes("addr") || v.includes("facility") || v.includes("street") || v.includes("building")) return "address";
  if (v.includes("loc") || v.includes("city") || v.includes("place") || v.includes("region")) return "location";
  if (v.includes("event") || v.includes("incident") || v.includes("summit")) return "event";
  if (v.includes("plat") || v.includes("handle") || v.includes("channel") || v.includes("domain")) return "platform";
  if (v.includes("law") || v.includes("asset") || v.includes("product") || v.includes("treaty")) return "asset_law";
  if (v.includes("fin") || v.includes("metric") || v.includes("money") || v.includes("number")) return "financial_metric";
  return "organization";
}

export function coerceRelationClass(val: string | undefined): RelationClassId {
  const v = String(val || "").trim().toLowerCase();
  if (VALID_REL_SET.has(v)) return v as RelationClassId;
  if (v.includes("role") || v.includes("position") || v.includes("title")) return "holds_role";
  if (v.includes("affil") || v.includes("member") || v.includes("work")) return "affiliated_with";
  if (v.includes("loc") || v.includes("based") || v.includes("visit") || v.includes("reside")) return "located_at";
  if (v.includes("partic") || v.includes("attend")) return "participated_in";
  if (v.includes("target") || v.includes("attack") || v.includes("act")) return "targets_or_acts_on";
  if (v.includes("issu") || v.includes("author") || v.includes("sign") || v.includes("pass")) return "issued_or_authored";
  if (v.includes("coop") || v.includes("all") || v.includes("partner") || v.includes("meet")) return "cooperated_with";
  if (v.includes("oppos") || v.includes("critic") || v.includes("sanction") || v.includes("sued")) return "opposed_to";
  if (v.includes("fund") || v.includes("transfer") || v.includes("invest") || v.includes("pay")) return "transferred_or_funded";
  if (v.includes("operat") || v.includes("own") || v.includes("run")) return "operated_by";
  return "affiliated_with";
}

function normalizeEntityKey(nerClass: NerClassId, canonical: string): string {
  const cleaned = canonical
    .trim()
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/[.,;:!?'"()[\]{}]/g, "")
    .replace(/\s+/g, " ");
  return `${nerClass}::${cleaned}`;
}

export function formatNerTimestamp(ms: number): string {
  if (!ms || ms <= 0) return "—";
  try {
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return "—";
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${y}-${m}-${day} ${hh}:${mm}`;
  } catch {
    return "—";
  }
}

export function formatNerDateDay(ms: number): string {
  if (!ms || ms <= 0) return "Undated";
  try {
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return "Undated";
    return d.toISOString().slice(0, 10);
  } catch {
    return "Undated";
  }
}

// ---------------------------------------------------------------------------
// IndexedDB Persistence Layer (GingkoExplorerNerDB)
// ---------------------------------------------------------------------------

const NER_DB_NAME = "GingkoExplorerNerDB";
const NER_DB_VERSION = 1;
const NER_STORE_NAME = "post_extractions";

let nerDbPromise: Promise<IDBDatabase> | null = null;

function openNerDatabase(): Promise<IDBDatabase> {
  if (nerDbPromise) return nerDbPromise;
  nerDbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(NER_DB_NAME, NER_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(NER_STORE_NAME)) {
        const store = db.createObjectStore(NER_STORE_NAME, { keyPath: "id" });
        store.createIndex("channelId", "channelId", { unique: false });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onclose = () => {
        nerDbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      nerDbPromise = null;
      reject(req.error || new Error("Failed to open NER IndexedDB"));
    };
  });
  return nerDbPromise;
}

export async function loadChannelNerExtractions(
  channel: string
): Promise<PostNerExtractionRecord[]> {
  const channelId = normalizeNerChannelKey(channel);
  if (!channelId) return [];
  try {
    const db = await openNerDatabase();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(NER_STORE_NAME, "readonly");
      const store = tx.objectStore(NER_STORE_NAME);
      const index = store.index("channelId");
      const req = index.getAll(IDBKeyRange.only(channelId));
      req.onsuccess = () => {
        const rows = Array.isArray(req.result) ? req.result : [];
        resolve(rows);
      };
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn("loadChannelNerExtractions error:", err);
    return [];
  }
}

export async function saveChannelNerExtractions(
  records: PostNerExtractionRecord[]
): Promise<void> {
  if (!records.length) return;
  try {
    const db = await openNerDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(NER_STORE_NAME, "readwrite");
      const store = tx.objectStore(NER_STORE_NAME);
      for (const rec of records) {
        store.put(rec);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn("saveChannelNerExtractions error:", err);
  }
}

export async function clearChannelNerExtractions(channel: string): Promise<void> {
  const channelId = normalizeNerChannelKey(channel);
  if (!channelId) return;
  try {
    const db = await openNerDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(NER_STORE_NAME, "readwrite");
      const store = tx.objectStore(NER_STORE_NAME);
      const index = store.index("channelId");
      const req = index.getAllKeys(IDBKeyRange.only(channelId));
      req.onsuccess = () => {
        const keys = Array.isArray(req.result) ? req.result : [];
        for (const k of keys) {
          store.delete(k);
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn("clearChannelNerExtractions error:", err);
  }
}

// ---------------------------------------------------------------------------
// Deterministic Multilingual Local NER & Relation Extractor (Zero-Key Fallback)
// ---------------------------------------------------------------------------

const NATION_ENTRIES: Array<{ canonical: string; patterns: string[] }> = [
  { canonical: "United States", patterns: ["United States", "U.S.A.", "USA", "U.S.", "America", "美國", "美国", "美方", "США", "Соединённые Штаты"] },
  { canonical: "China", patterns: ["China", "PRC", "Mainland China", "中國", "中国", "中方", "Китай", "КНР"] },
  { canonical: "United Kingdom", patterns: ["United Kingdom", "Britain", "Great Britain", "UK", "U.K.", "英國", "英国", "英方", "Великобритания"] },
  { canonical: "Ukraine", patterns: ["Ukraine", "烏克蘭", "乌克兰", "烏方", "Украина"] },
  { canonical: "Russia", patterns: ["Russia", "Russian Federation", "俄羅斯", "俄罗斯", "俄國", "俄方", "Россия", "РФ"] },
  { canonical: "Taiwan", patterns: ["Taiwan", "ROC", "台灣", "臺灣", "台方", "Тайвань"] },
  { canonical: "Japan", patterns: ["Japan", "日本", "日方", "Япония"] },
  { canonical: "South Korea", patterns: ["South Korea", "Republic of Korea", "ROK", "韓國", "韩国", "南韓", "Южная Корея"] },
  { canonical: "North Korea", patterns: ["North Korea", "DPRK", "朝鮮", "北韓", "朝鲜", "КНДР"] },
  { canonical: "European Union", patterns: ["European Union", "EU", "歐盟", "欧盟", "Евросоюз", "ЕС"] },
  { canonical: "Germany", patterns: ["Germany", "德國", "德国", "德方", "Германия"] },
  { canonical: "France", patterns: ["France", "法國", "法国", "法方", "Франция"] },
  { canonical: "Israel", patterns: ["Israel", "以色列", "以方", "Израиль"] },
  { canonical: "Palestine", patterns: ["Palestine", "巴勒斯坦", "Палестина"] },
  { canonical: "Iran", patterns: ["Iran", "伊朗", "Иран"] },
  { canonical: "India", patterns: ["India", "印度", "Индия"] },
  { canonical: "Canada", patterns: ["Canada", "加拿大", "Канада"] },
  { canonical: "Australia", patterns: ["Australia", "澳洲", "澳大利亞", "澳大利亚", "Австралия"] },
  { canonical: "Philippines", patterns: ["Philippines", "菲律賓", "菲律宾", "Филиппины"] },
  { canonical: "Singapore", patterns: ["Singapore", "新加坡", "Сингапур"] },
  { canonical: "Vietnam", patterns: ["Vietnam", "越南", "Вьетнам"] },
  { canonical: "Poland", patterns: ["Poland", "波蘭", "波兰", "Польша"] },
  { canonical: "Turkey", patterns: ["Turkey", "Türkiye", "土耳其", "Турция"] },
  { canonical: "Syria", patterns: ["Syria", "敘利亞", "叙利亚", "Сирия"] },
  { canonical: "Brazil", patterns: ["Brazil", "巴西", "Бразилия"] },
  { canonical: "Mexico", patterns: ["Mexico", "墨西哥", "Мексика"] },
];

const LOCATION_ENTRIES: Array<{ canonical: string; patterns: string[] }> = [
  { canonical: "Washington, D.C.", patterns: ["Washington, D.C.", "Washington DC", "Washington", "華盛頓", "华盛顿", "Вашингтон"] },
  { canonical: "London", patterns: ["London", "倫敦", "伦敦", "Лондон"] },
  { canonical: "Beijing", patterns: ["Beijing", "北京", "Пекин"] },
  { canonical: "Shanghai", patterns: ["Shanghai", "上海", "Шанхай"] },
  { canonical: "Shenzhen", patterns: ["Shenzhen", "深圳"] },
  { canonical: "Hong Kong", patterns: ["Hong Kong", "香港", "Гонконг"] },
  { canonical: "Taipei", patterns: ["Taipei", "台北", "臺北", "Тайбэй"] },
  { canonical: "Kaohsiung", patterns: ["Kaohsiung", "高雄"] },
  { canonical: "Tokyo", patterns: ["Tokyo", "東京", "东京", "Токио"] },
  { canonical: "Seoul", patterns: ["Seoul", "首爾", "首尔", "Сеул"] },
  { canonical: "Kyiv", patterns: ["Kyiv", "Kiev", "基輔", "基辅", "Киев"] },
  { canonical: "Moscow", patterns: ["Moscow", "莫斯科", "Москва"] },
  { canonical: "Brussels", patterns: ["Brussels", "布魯塞爾", "布鲁塞尔", "Брюссель"] },
  { canonical: "New York", patterns: ["New York", "NYC", "紐約", "纽约", "Нью-Йорк"] },
  { canonical: "San Francisco", patterns: ["San Francisco", "舊金山", "圣弗朗西斯科", "三藩市"] },
  { canonical: "Silicon Valley", patterns: ["Silicon Valley", "矽谷", "硅谷"] },
  { canonical: "Paris", patterns: ["Paris", "巴黎", "Париж"] },
  { canonical: "Berlin", patterns: ["Berlin", "柏林", "Берлин"] },
  { canonical: "Jerusalem", patterns: ["Jerusalem", "耶路撒冷", "Иерусалим"] },
  { canonical: "Gaza", patterns: ["Gaza", "Gaza Strip", "加薩", "加沙", "Газа"] },
  { canonical: "Tehran", patterns: ["Tehran", "德黑蘭", "德黑兰", "Тегеран"] },
  { canonical: "Geneva", patterns: ["Geneva", "日內瓦", "日内瓦", "Женева"] },
  { canonical: "Munich", patterns: ["Munich", "慕尼黑", "Мюнхен"] },
  { canonical: "Central, HK", patterns: ["Central", "中環"] },
  { canonical: "Admiralty, HK", patterns: ["Admiralty", "金鐘"] },
  { canonical: "Wan Chai", patterns: ["Wan Chai", "灣仔"] },
  { canonical: "Mong Kok", patterns: ["Mong Kok", "旺角"] },
];

const LAT_STOPWORDS = new Set([
  "The", "This", "That", "These", "Those", "Here", "There", "When", "Where", "While",
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
  "January", "February", "March", "April", "May", "June", "July", "August",
  "September", "October", "November", "December", "Breaking", "Update", "Updated",
  "Telegram", "Source", "Read", "More", "Click", "Watch", "Video", "Photo",
  "Forwarded", "Contact", "Channel", "Today", "Tomorrow", "Yesterday", "According",
  "However", "Meanwhile", "Furthermore", "Additionally", "First", "Second", "Third",
  "New", "High", "Low", "All", "Some", "Many", "Most", "After", "Before", "During",
  "President", "Prime", "Minister", "Deputy", "Secretary", "Chairman", "Chairwoman",
  "Director", "Commissioner", "Spokesperson", "Governor", "Senator", "Representative",
  "Chancellor", "Premier", "Mayor", "Judge", "Prosecutor", "General", "Admiral",
  "Commander", "Ambassador", "Chief", "Executive", "Officer",
]);

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?。！？\n])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 4);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findPatternMatch(sentence: string, pattern: string): string | null {
  const isAscii = /^[\x00-\x7F]+$/.test(pattern);
  if (isAscii) {
    const rx = new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(pattern)}(?![A-Za-z0-9])`, "i");
    const m = sentence.match(rx);
    return m ? m[0] : null;
  }
  return sentence.includes(pattern) ? pattern : null;
}

export function extractNerSinglePostLocal(
  postKey: string,
  timestampMs: number,
  text: string,
  meta?: { author?: string; forwardTarget?: string; contactName?: string }
): { entities: ExtractedPostEntity[]; relations: ExtractedPostRelation[] } {
  const entities: ExtractedPostEntity[] = [];
  const relations: ExtractedPostRelation[] = [];
  const seenEntityKey = new Set<string>();
  const seenRelKey = new Set<string>();

  const pushEntity = (
    name: string,
    canonical: string,
    nerClass: NerClassId,
    quote: string
  ): ExtractedPostEntity | null => {
    const cleanName = name.trim();
    const cleanCanonical = canonical.trim();
    if (!cleanName || !cleanCanonical || cleanCanonical.length < 2 || cleanCanonical.length > 90) {
      return null;
    }
    const k = normalizeEntityKey(nerClass, cleanCanonical);
    if (seenEntityKey.has(k)) {
      return entities.find((e) => normalizeEntityKey(e.nerClass, e.canonical) === k) || null;
    }
    seenEntityKey.add(k);
    const ent: ExtractedPostEntity = {
      name: cleanName,
      canonical: cleanCanonical,
      nerClass,
      quote: quote.slice(0, 200),
    };
    entities.push(ent);
    return ent;
  };

  const pushRelation = (
    subj: { name: string; nerClass: NerClassId },
    rel: RelationClassId,
    obj: { name: string; nerClass: NerClassId },
    quote: string,
    confidence: number
  ) => {
    if (!subj.name || !obj.name) return;
    if (subj.name.toLowerCase() === obj.name.toLowerCase()) return;
    const key = `${subj.name.toLowerCase()}|${rel}|${obj.name.toLowerCase()}`;
    if (seenRelKey.has(key)) return;
    seenRelKey.add(key);
    relations.push({
      subject: subj.name,
      subjectClass: subj.nerClass,
      relationClass: rel,
      object: obj.name,
      objectClass: obj.nerClass,
      quote: quote.slice(0, 220),
      confidence,
    });
  };

  // Optional contact person from post metadata
  if (meta?.contactName) {
    pushEntity(meta.contactName, meta.contactName, "person", `Contact: ${meta.contactName}`);
  }
  if (meta?.forwardTarget) {
    const fwdHandle = meta.forwardTarget.startsWith("@")
      ? meta.forwardTarget
      : `@${meta.forwardTarget}`;
    pushEntity(fwdHandle, fwdHandle, "platform", `Forwarded from ${fwdHandle}`);
  }

  const sentences = splitSentences(text);

  for (const sentence of sentences) {
    const sentEntities: ExtractedPostEntity[] = [];

    const addSentEntity = (
      name: string,
      canonical: string,
      nerClass: NerClassId
    ) => {
      const e = pushEntity(name, canonical, nerClass, sentence);
      if (e && !sentEntities.some((x) => normalizeEntityKey(x.nerClass, x.canonical) === normalizeEntityKey(e.nerClass, e.canonical))) {
        sentEntities.push(e);
      }
      return e;
    };

    // 1. Nations
    for (const entry of NATION_ENTRIES) {
      for (const pat of entry.patterns) {
        const hit = findPatternMatch(sentence, pat);
        if (hit) {
          addSentEntity(hit, entry.canonical, "nation");
          break;
        }
      }
    }

    // 2. Locations
    for (const entry of LOCATION_ENTRIES) {
      for (const pat of entry.patterns) {
        const hit = findPatternMatch(sentence, pat);
        if (hit) {
          addSentEntity(hit, entry.canonical, "location");
          break;
        }
      }
    }

    // 3. Addresses / Facilities
    const enAddrRx =
      /\b(?:\d{1,5}\s+(?:[A-Z][A-Za-z0-9.'-]+\s+){1,4}(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Way|Square|Sq|Plaza|Place|Pl)|(?:White House|Kremlin|Pentagon|Downing Street|10 Downing Street|Capitol Hill|Westminster|Zhongnanhai|Great Hall of the People|Tiananmen Square|Port of [A-Z][a-z]+|[A-Z][A-Za-z0-9'&-]+\s+(?:Airport|Air Base|Naval Base|Embassy|Consulate|Hospital|Prison|Courthouse|Headquarters|HQ|Station|Terminal|Building|Tower|Center|Centre)))\b/g;
    for (const m of sentence.matchAll(enAddrRx)) {
      const val = m[0].trim();
      addSentEntity(val, val, "address");
    }
    const cjkAddrRx =
      /[\u4e00-\u9fff]{2,12}(?:[0-9一二三四五六七八九十百千]+號)?(?:大廈|大樓|廣場|中心|機場|車站|港口|碼頭|基地|大使館|領事館|法院|警署|警察局|政府總部|白宮|克里姆林宮|五角大廈|中南海)/g;
    for (const m of sentence.matchAll(cjkAddrRx)) {
      const val = m[0].trim();
      addSentEntity(val, val, "address");
    }

    // 4. Platforms & Handles
    const handleRx = /(?:^|[\s(])(@[A-Za-z0-9_]{3,32})\b/g;
    for (const m of sentence.matchAll(handleRx)) {
      addSentEntity(m[1], m[1], "platform");
    }
    const urlRx = /\b(?:https?:\/\/)?(?:t\.me|x\.com|twitter\.com|youtube\.com|youtu\.be|github\.com|facebook\.com|instagram\.com)\/[A-Za-z0-9_./-]+/gi;
    for (const m of sentence.matchAll(urlRx)) {
      const val = m[0].replace(/[.,;)]+$/, "");
      addSentEntity(val, val, "platform");
    }
    const platNamedRx = /\b(?:Telegram|Signal|WhatsApp|YouTube|GitHub|TikTok|Instagram|Facebook|Twitter|Discord|Reddit|WeChat)\b/gi;
    for (const m of sentence.matchAll(platNamedRx)) {
      addSentEntity(m[0], m[0], "platform");
    }

    // 5. Financial & Metrics
    const moneyRx =
      /(?:USD|EUR|GBP|HKD|TWD|RMB|CNY|JPY)?\s*(?:\$|€|£|¥|HK\$|NT\$)\s?\d+(?:[.,]\d+)?\s*(?:trillion|billion|million|thousand|[TBMK]\b)?|\b\d+(?:[.,]\d+)?\s*(?:trillion|billion|million)\s*(?:dollars|USD|euros|EUR|pounds|GBP|yuan|RMB|yen)\b|\b\d+(?:\.\d+)?%|\b\d{1,3}(?:,\d{3})+\s*(?:people|troops|soldiers|casualties|deaths|injured|protesters|voters|users|subscribers|shares|barrels)\b/gi;
    for (const m of sentence.matchAll(moneyRx)) {
      const val = m[0].trim();
      addSentEntity(val, val, "financial_metric");
    }
    const cjkMoneyRx =
      /(?:[新台幣港幣人民幣美元歐元日圓]*\s*\d+(?:\.\d+)?[億萬千百]*\s*(?:美元|港元|台幣|人民幣|歐元|英鎊|日圓|元))|(?:\d+(?:\.\d+)?(?:%|％))|(?:\d+(?:\.\d+)?[億萬千]?(?:人|名)(?:死亡|受傷|失蹤|被捕|參加|失業))/g;
    for (const m of sentence.matchAll(cjkMoneyRx)) {
      const val = m[0].trim();
      addSentEntity(val, val, "financial_metric");
    }

    // 6. Organizations (EN + CJK + Acronyms)
    const enOrgRx =
      /\b(?:[A-Z][A-Za-z0-9&'-]+\s+){1,4}(?:Inc\.?|Corp\.?|Corporation|Ltd\.?|LLC|PLC|Group|Holdings|Bank|Exchange|Agency|Ministry|Department|Committee|Commission|Council|Authority|Parliament|Congress|Senate|House|Court|Police|Bureau|Institute|University|College|Foundation|Party|Federation|Union|Association|Alliance|Command|Forces|Airlines|Motors|Networks|Labs|AI|Media|Times|Post|News|Herald|Journal)\b/g;
    for (const m of sentence.matchAll(enOrgRx)) {
      const val = m[0].trim().replace(/^(?:The|A|An)\s+/i, "");
      if (!LAT_STOPWORDS.has(val)) {
        addSentEntity(val, val, "organization");
      }
    }
    const acroOrgRx = /\b(?:NATO|WHO|IMF|WTO|UN|UNESCO|UNHCR|FBI|CIA|NSA|SEC|DOJ|DOD|FED|ECB|OPEC|BRICS|ASEAN|NASA|SpaceX|OpenAI|Anthropic|Google|Apple|Microsoft|Meta|Nvidia|NVIDIA|Tesla|Amazon|TSMC|Reuters|Bloomberg|BBC|CNN|AP|AFP|Xinhua|TASS|IDF|Hamas|Hezbollah)\b/g;
    for (const m of sentence.matchAll(acroOrgRx)) {
      addSentEntity(m[0], m[0], "organization");
    }
    const cjkOrgRx =
      /[\u4e00-\u9fffA-Za-z0-9]{2,10}(?:公司|集團|銀行|交易所|部|委員會|管理局|局|署|院|廳|法院|最高法院|警署|警方|檢察院|檢方|大學|學院|研究所|學會|協會|聯合會|基金會|政黨|工黨|民主黨|共和黨|軍方|國防部|外交部|財政部|商務部|中央銀行|聯準會|美聯儲|通訊社|電視台|日報|時報)/g;
    for (const m of sentence.matchAll(cjkOrgRx)) {
      const val = m[0].trim();
      addSentEntity(val, val, "organization");
    }

    // 7. Job Position + Adjacent Person pairing
    const titlePersonEnRx =
      /\b(President|Prime Minister|Minister|Deputy Prime Minister|Secretary of State|Defense Secretary|Treasury Secretary|CEO|Chief Executive Officer|Chairman|Chairwoman|Director|Commissioner|Spokesperson|Governor|Senator|Representative|Chancellor|Premier|Mayor|Judge|Prosecutor|General|Admiral|Commander|Ambassador)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z'-]+){1,2})/g;
    for (const m of sentence.matchAll(titlePersonEnRx)) {
      const role = addSentEntity(m[1].trim(), m[1].trim(), "job_position");
      const person = addSentEntity(m[2].trim(), m[2].trim(), "person");
      if (role && person) {
        pushRelation(
          { name: person.canonical, nerClass: "person" },
          "holds_role",
          { name: role.canonical, nerClass: "job_position" },
          sentence,
          0.9
        );
      }
    }
    const enStandaloneRoleRx =
      /\b(President|Prime Minister|Secretary of State|Defense Minister|Foreign Minister|Finance Minister|Chief Executive Officer|CEO|Chairman|Central Bank Governor|Attorney General|Supreme Leader|Speaker of the House)\b/g;
    for (const m of sentence.matchAll(enStandaloneRoleRx)) {
      addSentEntity(m[1].trim(), m[1].trim(), "job_position");
    }

    const cjkRolePersonRx =
      /(總統|副總統|總理|副總理|首相|國務卿|外長|外交部長|防長|國防部長|財長|財政部長|主席|副主席|執行長|行政總裁|總裁|董事長|主任|局長|署長|市長|州長|議員|發言人|大使|將軍|司令|法官|檢察官)([\u4e00-\u9fff]{2,4})/g;
    for (const m of sentence.matchAll(cjkRolePersonRx)) {
      const roleStr = m[1].trim();
      const candName = m[2].trim().replace(/[今昨明將並在於與及說稱表示會被]+$/g, "");
      addSentEntity(roleStr, roleStr, "job_position");
      if (candName.length >= 2 && !/[的是在與和及並將稱表示說會被]/.test(candName)) {
        addSentEntity(candName, candName, "person");
        pushRelation(
          { name: candName, nerClass: "person" },
          "holds_role",
          { name: roleStr, nerClass: "job_position" },
          sentence,
          0.88
        );
      }
    }

    // 8. Standalone Multi-Word Capitalized Person Names
    const enPersonRx = /\b([A-Z][a-z]{1,15}\s+(?:(?:van|von|de|al|bin)\s+)?[A-Z][a-z'-]{1,18}(?:\s+[A-Z][a-z'-]{1,18})?)\b/g;
    for (const m of sentence.matchAll(enPersonRx)) {
      const candidate = m[1].trim();
      const words = candidate.split(/\s+/);
      if (words.some((w) => LAT_STOPWORDS.has(w))) continue;
      // Avoid shadowing already captured Org/Loc/Nat/Addr
      const alreadyCaptured = sentEntities.some(
        (e) => e.canonical.toLowerCase() === candidate.toLowerCase() || e.canonical.toLowerCase().includes(candidate.toLowerCase())
      );
      if (!alreadyCaptured) {
        addSentEntity(candidate, candidate, "person");
      }
    }

    // 9. Events & Incidents
    const enEventRx =
      /\b(?:G7|G20|COP\d{2}|World Economic Forum|Munich Security Conference|UN General Assembly|Operation\s+[A-Z][A-Za-z0-9-]+|[A-Z][A-Za-z0-9-]+\s+(?:Summit|Election|Referendum|Hearing|Protests?|Rally|Offensive|Ceasefire|Sanctions?|Inquiry|Trial|Verdict))\b/g;
    for (const m of sentence.matchAll(enEventRx)) {
      addSentEntity(m[0].trim(), m[0].trim(), "event");
    }
    const cjkEventRx =
      /[\u4e00-\u9fffA-Za-z0-9]{2,10}(?:峰會|大選|選舉|公投|聽證會|抗議|遊行|示威|罷工|演習|軍演|停火|審判|判決|記者會|論壇|暴動|衝突)/g;
    for (const m of sentence.matchAll(cjkEventRx)) {
      addSentEntity(m[0].trim(), m[0].trim(), "event");
    }

    // 10. Products / Assets / Laws
    const enAssetLawRx =
      /\b(?:[A-Z][A-Za-z0-9-]+\s+(?:Act|Bill|Treaty|Accord|Resolution|Charter|Sanctions Package)|Resolution\s+\d+|Article\s+\d+|Section\s+\d+|GPT-\d(?:\.\d)?|Claude\s*\d?(?:\.\d)?|Gemini\s*\d?(?:\.\d)?|Bitcoin|Ethereum|BTC|ETH|USDT|F-16|F-35|HIMARS|Patriot|Starlink)\b/g;
    for (const m of sentence.matchAll(enAssetLawRx)) {
      addSentEntity(m[0].trim(), m[0].trim(), "asset_law");
    }
    const cjkAssetLawRx =
      /(?:《[^》]{2,30}》|[\u4e00-\u9fffA-Za-z0-9]{2,12}(?:法案|條例|協議|條約|憲法|決議|白皮書|關稅))/g;
    for (const m of sentence.matchAll(cjkAssetLawRx)) {
      const val = m[0]
        .replace(/[《》]/g, "")
        .replace(/^(?:討論|簽署|通過|公布|發布|提出|推動|違反|實施|修訂)/, "")
        .trim();
      if (val.length >= 3) {
        addSentEntity(val, val, "asset_law");
      }
    }

    // Sentence-level Relation Linking among detected entities
    if (sentEntities.length >= 2) {
      const lower = sentence.toLowerCase();
      const actors = sentEntities.filter(
        (e) => e.nerClass === "person" || e.nerClass === "organization" || e.nerClass === "nation"
      );
      const places = sentEntities.filter(
        (e) => e.nerClass === "address" || e.nerClass === "location" || e.nerClass === "nation"
      );
      const events = sentEntities.filter((e) => e.nerClass === "event");
      const laws = sentEntities.filter((e) => e.nerClass === "asset_law");
      const metrics = sentEntities.filter((e) => e.nerClass === "financial_metric");
      const platforms = sentEntities.filter((e) => e.nerClass === "platform");
      const roles = sentEntities.filter((e) => e.nerClass === "job_position");

      const primaryActor = actors[0] || sentEntities[0];

      // holds_role / affiliated_with
      if (actors.length >= 1 && roles.length >= 1) {
        const p = actors.find((a) => a.nerClass === "person") || actors[0];
        pushRelation(
          { name: p.canonical, nerClass: p.nerClass },
          "holds_role",
          { name: roles[0].canonical, nerClass: "job_position" },
          sentence,
          0.78
        );
      }

      const personActor = actors.find((a) => a.nerClass === "person");
      const orgActor = actors.find((a) => a.nerClass === "organization");
      if (personActor && orgActor) {
        pushRelation(
          { name: personActor.canonical, nerClass: "person" },
          "affiliated_with",
          { name: orgActor.canonical, nerClass: "organization" },
          sentence,
          0.76
        );
      }

      // located_at
      if (primaryActor && places.length >= 1) {
        const targetPlace = places.find((pl) => pl.canonical !== primaryActor.canonical);
        if (targetPlace && /\b(?:in|at|to|from|near|visited|met in)\b|在|於|抵|赴|前往|位於/.test(lower)) {
          pushRelation(
            { name: primaryActor.canonical, nerClass: primaryActor.nerClass },
            "located_at",
            { name: targetPlace.canonical, nerClass: targetPlace.nerClass },
            sentence,
            0.74
          );
        }
      }

      // participated_in
      if (primaryActor && events.length >= 1) {
        pushRelation(
          { name: primaryActor.canonical, nerClass: primaryActor.nerClass },
          "participated_in",
          { name: events[0].canonical, nerClass: "event" },
          sentence,
          0.77
        );
      }

      // issued_or_authored
      if (primaryActor && laws.length >= 1 && /\b(?:sign|signed|pass|passed|issue|issued|announce|announced|launch|launched|propose|proposed|release|released)\b|簽署|通過|公布|發布|發表|提出|推出/.test(lower)) {
        pushRelation(
          { name: primaryActor.canonical, nerClass: primaryActor.nerClass },
          "issued_or_authored",
          { name: laws[0].canonical, nerClass: "asset_law" },
          sentence,
          0.8
        );
      }

      // transferred_or_funded
      if (primaryActor && metrics.length >= 1 && /\b(?:invest|fund|pay|paid|grant|fine|fined|spend|spent|donate|raise|raised|worth|budget|aid|billion|million)\b|投資|撥款|資助|罰款|捐款|援助|花費|總值|億|萬/.test(lower)) {
        const recipient = actors[1] || places[0];
        pushRelation(
          { name: primaryActor.canonical, nerClass: primaryActor.nerClass },
          "transferred_or_funded",
          recipient
            ? { name: recipient.canonical, nerClass: recipient.nerClass }
            : { name: metrics[0].canonical, nerClass: "financial_metric" },
          sentence,
          0.75
        );
      }

      // operated_by
      if (platforms.length >= 1 && primaryActor && primaryActor.nerClass !== "platform") {
        if (/\b(?:operat|own|run|official|channel|account|via|posted)\b|營運|經營|官方|隸屬|帳號|頻道/.test(lower)) {
          pushRelation(
            { name: platforms[0].canonical, nerClass: "platform" },
            "operated_by",
            { name: primaryActor.canonical, nerClass: primaryActor.nerClass },
            sentence,
            0.72
          );
        }
      }

      // Actor-to-Actor relations: opposed_to / targets_or_acts_on / cooperated_with
      if (actors.length >= 2) {
        const a1 = actors[0];
        const a2 = actors[1];
        if (/\b(?:sanction|sue|sued|attack|struck|strike|arrest|ban|banned|probe|condemn|accuse|warn|oppose|clash|retaliat)\b|制裁|起訴|控告|攻擊|打擊|逮捕|禁止|封殺|調查|譴責|指控|警告|反對|衝突/.test(lower)) {
          const isOpposed = /\b(?:sanction|condemn|oppose|clash|dispute|critic)\b|反對|批評|衝突|爭議|制裁|譴責/.test(lower);
          pushRelation(
            { name: a1.canonical, nerClass: a1.nerClass },
            isOpposed ? "opposed_to" : "targets_or_acts_on",
            { name: a2.canonical, nerClass: a2.nerClass },
            sentence,
            0.79
          );
        } else if (/\b(?:met|meet|partner|agree|agreed|ally|allied|cooperat|joint|support|welcome|pact|deal)\b|會見|會談|合作|結盟|簽約|同意|支持|聯手|共同/.test(lower)) {
          pushRelation(
            { name: a1.canonical, nerClass: a1.nerClass },
            "cooperated_with",
            { name: a2.canonical, nerClass: a2.nerClass },
            sentence,
            0.77
          );
        }
      }
    }
  }

  return { entities, relations };
}

export function extractNerBatchLocal(
  channelId: string,
  batchPosts: Array<{
    postKey: string;
    timestampMs: number;
    text: string;
    author?: string;
    forwardTarget?: string;
    contactName?: string;
  }>
): PostNerExtractionRecord[] {
  const now = Date.now();
  return batchPosts.map((item) => {
    const { entities, relations } = extractNerSinglePostLocal(
      item.postKey,
      item.timestampMs,
      item.text,
      {
        author: item.author,
        forwardTarget: item.forwardTarget,
        contactName: item.contactName,
      }
    );
    return {
      id: `${channelId}::${item.postKey}`,
      channelId,
      postKey: item.postKey,
      timestampMs: item.timestampMs,
      extractorVersion: EXPLORER_NER_EXTRACTOR_VERSION,
      engine: "local",
      entities,
      relations,
      updatedAt: now,
    };
  });
}

// ---------------------------------------------------------------------------
// Batch Orchestrator (/api/gemini/ner + IndexedDB cache + Local Fallback)
// ---------------------------------------------------------------------------

export interface RunNerBatchOptions {
  channelName: string;
  posts: any[];
  existingRecords: PostNerExtractionRecord[];
  forceReextract?: boolean;
  signal?: AbortSignal;
  onProgress?: (progress: NerBatchProgress) => void;
  onRecordsUpdated?: (allRecords: PostNerExtractionRecord[]) => void;
}

export async function runChannelNerExtractionBatch(
  options: RunNerBatchOptions
): Promise<{
  records: PostNerExtractionRecord[];
  progress: NerBatchProgress;
  aborted: boolean;
}> {
  const channelId = normalizeNerChannelKey(options.channelName);
  const existingMap = new Map<string, PostNerExtractionRecord>();

  if (!options.forceReextract) {
    for (const rec of options.existingRecords) {
      if (rec.channelId === channelId && rec.extractorVersion === EXPLORER_NER_EXTRACTOR_VERSION) {
        existingMap.set(rec.postKey, rec);
      }
    }
  }

  const candidatePosts: Array<{
    postKey: string;
    timestampMs: number;
    dateLabel: string;
    text: string;
    author?: string;
    forwardTarget?: string;
    contactName?: string;
  }> = [];

  for (const post of options.posts || []) {
    const postKey = String(post?.key || post?.id || "").trim();
    if (!postKey) continue;
    if (!options.forceReextract && existingMap.has(postKey)) continue;

    const text = extractPostPlainText(post);
    if (!text || text.length < 3) continue;

    const timestampMs = extractExplorerPostTimestampMs(post);
    const contact = post?.data?.contact;
    const contactName =
      contact && typeof contact === "object"
        ? [contact.first_name, contact.last_name].filter(Boolean).join(" ").trim()
        : undefined;

    let forwardTarget: string | undefined;
    if (typeof post?.data?.forward_url === "string") {
      const m = post.data.forward_url.match(/t\.me\/([^/]+)/i);
      if (m && m[1]) forwardTarget = m[1];
    }

    candidatePosts.push({
      postKey,
      timestampMs,
      dateLabel: formatNerTimestamp(timestampMs),
      text: text.slice(0, 2400),
      author: post?.data?.author || post?.data?.user || undefined,
      forwardTarget,
      contactName,
    });
  }

  const totalToProcess = candidatePosts.length;
  const cachedSkipped = existingMap.size;

  const progress: NerBatchProgress = {
    done: 0,
    total: totalToProcess,
    cachedSkipped,
    engine: null,
    failedBatches: 0,
    lastError: null,
  };

  if (totalToProcess === 0) {
    options.onProgress?.({ ...progress });
    return {
      records: Array.from(existingMap.values()),
      progress,
      aborted: false,
    };
  }

  options.onProgress?.({ ...progress });

  const CHUNK_SIZE = 20;
  const storedGeminiKey =
    typeof localStorage !== "undefined" ? localStorage.getItem("gemini_api_key") || "" : "";
  let geminiUnavailable = false;
  let usedGemini = false;
  let usedLocal = false;

  for (let i = 0; i < candidatePosts.length; i += CHUNK_SIZE) {
    if (options.signal?.aborted) {
      return {
        records: Array.from(existingMap.values()),
        progress,
        aborted: true,
      };
    }

    const chunk = candidatePosts.slice(i, i + CHUNK_SIZE);
    let batchRecords: PostNerExtractionRecord[] | null = null;

    if (!geminiUnavailable) {
      try {
        const res = await fetch("/api/gemini/ner", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: options.signal,
          body: JSON.stringify({
            channelName: options.channelName,
            apiKey: storedGeminiKey || undefined,
            posts: chunk.map((c) => ({
              postKey: c.postKey,
              timestampMs: c.timestampMs,
              dateLabel: c.dateLabel,
              author: c.author,
              text: c.text,
            })),
          }),
        });

        if (res.ok) {
          const payload = await res.json();
          const extractions = Array.isArray(payload?.extractions) ? payload.extractions : [];
          const byKey = new Map<string, any>();
          for (const ex of extractions) {
            if (ex && ex.postKey) byKey.set(String(ex.postKey), ex);
          }

          const now = Date.now();
          batchRecords = chunk.map((c) => {
            const raw = byKey.get(c.postKey);
            const rawEntities = Array.isArray(raw?.entities) ? raw.entities : [];
            const rawRelations = Array.isArray(raw?.relations) ? raw.relations : [];

            const cleanEntities: ExtractedPostEntity[] = rawEntities
              .filter((e: any) => e && (e.canonical || e.name))
              .map((e: any) => ({
                name: String(e.name || e.canonical).trim(),
                canonical: String(e.canonical || e.name).trim(),
                nerClass: coerceNerClass(e.nerClass),
                quote: String(e.quote || "").trim().slice(0, 220),
              }));

            const cleanRelations: ExtractedPostRelation[] = rawRelations
              .filter((r: any) => r && r.subject && r.object)
              .map((r: any) => ({
                subject: String(r.subject).trim(),
                subjectClass: coerceNerClass(r.subjectClass),
                relationClass: coerceRelationClass(r.relationClass),
                object: String(r.object).trim(),
                objectClass: coerceNerClass(r.objectClass),
                quote: String(r.quote || "").trim().slice(0, 240),
                confidence: Math.min(1, Math.max(0.1, Number(r.confidence ?? 0.85))),
              }));

            return {
              id: `${channelId}::${c.postKey}`,
              channelId,
              postKey: c.postKey,
              timestampMs: c.timestampMs,
              extractorVersion: EXPLORER_NER_EXTRACTOR_VERSION,
              engine: "gemini" as const,
              entities: cleanEntities,
              relations: cleanRelations,
              updatedAt: now,
            };
          });
          usedGemini = true;
        } else if (res.status === 400 || res.status === 404) {
          // Server Gemini key not configured -> switch cleanly to local structured NLP
          geminiUnavailable = true;
        } else {
          const errBody = await res.json().catch(() => ({}));
          progress.failedBatches += 1;
          progress.lastError = errBody?.error || `HTTP ${res.status}`;
        }
      } catch (err: any) {
        if (err?.name === "AbortError") {
          return {
            records: Array.from(existingMap.values()),
            progress,
            aborted: true,
          };
        }
        progress.failedBatches += 1;
        progress.lastError = err?.message || "Network error during extraction";
      }
    }

    if (!batchRecords) {
      batchRecords = extractNerBatchLocal(channelId, chunk);
      usedLocal = true;
    }

    for (const rec of batchRecords) {
      existingMap.set(rec.postKey, rec);
    }

    await saveChannelNerExtractions(batchRecords);

    progress.done += chunk.length;
    progress.engine =
      usedGemini && usedLocal ? "mixed" : usedGemini ? "gemini" : "local";

    const merged = Array.from(existingMap.values());
    options.onRecordsUpdated?.(merged);
    options.onProgress?.({ ...progress });
  }

  return {
    records: Array.from(existingMap.values()),
    progress,
    aborted: false,
  };
}

// ---------------------------------------------------------------------------
// Canonical Entity & Timestamped Relation Aggregation
// ---------------------------------------------------------------------------

export function aggregateNerIndex(records: PostNerExtractionRecord[]): AggregatedNerIndex {
  const entityMap = new Map<string, AggregatedNerEntity>();
  const aliasSetMap = new Map<string, Set<string>>();
  const postKeySetMap = new Map<string, Set<string>>();
  const cooccurMap = new Map<string, Map<string, number>>();
  const relationMap = new Map<string, AggregatedNerRelation>();
  const relPostKeySetMap = new Map<string, Set<string>>();

  const classCounts = Object.fromEntries(
    NER_CLASSES.map((c) => [c.id, 0])
  ) as Record<NerClassId, number>;
  const relationClassCounts = Object.fromEntries(
    RELATION_CLASSES.map((r) => [r.id, 0])
  ) as Record<RelationClassId, number>;

  const enginesUsed = new Set<"gemini" | "local">();
  let totalMentions = 0;

  const ensureEntity = (
    canonicalName: string,
    surfaceName: string,
    nerClass: NerClassId,
    postKey: string,
    timestampMs: number,
    quote: string
  ): AggregatedNerEntity => {
    const id = normalizeEntityKey(nerClass, canonicalName);
    let ent = entityMap.get(id);
    if (!ent) {
      ent = {
        id,
        canonicalName: canonicalName.trim(),
        nerClass,
        aliases: [],
        mentionCount: 0,
        firstSeenMs: timestampMs || 0,
        lastSeenMs: timestampMs || 0,
        postKeys: [],
        sampleQuotes: [],
        cooccurringIds: [],
      };
      entityMap.set(id, ent);
      aliasSetMap.set(id, new Set());
      postKeySetMap.set(id, new Set());
    }

    const aliases = aliasSetMap.get(id)!;
    if (surfaceName && surfaceName.trim() && surfaceName.trim() !== ent.canonicalName) {
      aliases.add(surfaceName.trim());
    }
    aliases.add(ent.canonicalName);

    const pkeys = postKeySetMap.get(id)!;
    const isNewPost = !pkeys.has(postKey);
    pkeys.add(postKey);

    ent.mentionCount += 1;
    totalMentions += 1;

    if (timestampMs > 0) {
      if (ent.firstSeenMs === 0 || timestampMs < ent.firstSeenMs) ent.firstSeenMs = timestampMs;
      if (timestampMs > ent.lastSeenMs) ent.lastSeenMs = timestampMs;
    }

    if (quote && (isNewPost || ent.sampleQuotes.length < 8)) {
      if (!ent.sampleQuotes.some((q) => q.postKey === postKey && q.quote === quote)) {
        ent.sampleQuotes.push({ postKey, timestampMs, quote });
      }
    }
    return ent;
  };

  for (const rec of records) {
    enginesUsed.add(rec.engine);
    const postEntityIds: string[] = [];

    for (const ent of rec.entities || []) {
      const agg = ensureEntity(
        ent.canonical || ent.name,
        ent.name,
        ent.nerClass,
        rec.postKey,
        rec.timestampMs,
        ent.quote
      );
      if (!postEntityIds.includes(agg.id)) {
        postEntityIds.push(agg.id);
      }
    }

    // Track co-occurrences inside same post
    for (let i = 0; i < postEntityIds.length; i++) {
      for (let j = i + 1; j < postEntityIds.length; j++) {
        const a = postEntityIds[i];
        const b = postEntityIds[j];
        if (!cooccurMap.has(a)) cooccurMap.set(a, new Map());
        if (!cooccurMap.has(b)) cooccurMap.set(b, new Map());
        cooccurMap.get(a)!.set(b, (cooccurMap.get(a)!.get(b) || 0) + 1);
        cooccurMap.get(b)!.set(a, (cooccurMap.get(b)!.get(a) || 0) + 1);
      }
    }

    for (const rel of rec.relations || []) {
      const subjEnt = ensureEntity(
        rel.subject,
        rel.subject,
        rel.subjectClass,
        rec.postKey,
        rec.timestampMs,
        rel.quote
      );
      const objEnt = ensureEntity(
        rel.object,
        rel.object,
        rel.objectClass,
        rec.postKey,
        rec.timestampMs,
        rel.quote
      );

      const relMeta = RELATION_CLASS_MAP.get(rel.relationClass);
      const isDirected = relMeta?.directed !== false;
      const pairKey = isDirected
        ? `${subjEnt.id}=>${rel.relationClass}=>${objEnt.id}`
        : [subjEnt.id, objEnt.id].sort().join(`<=${rel.relationClass}=>`);

      let aggRel = relationMap.get(pairKey);
      if (!aggRel) {
        aggRel = {
          id: pairKey,
          subjectId: subjEnt.id,
          subjectName: subjEnt.canonicalName,
          subjectClass: subjEnt.nerClass,
          relationClass: rel.relationClass,
          objectId: objEnt.id,
          objectName: objEnt.canonicalName,
          objectClass: objEnt.nerClass,
          occurrences: [],
          earliestTimestampMs: rec.timestampMs || 0,
          latestTimestampMs: rec.timestampMs || 0,
          postKeys: [],
        };
        relationMap.set(pairKey, aggRel);
        relPostKeySetMap.set(pairKey, new Set());
      }

      const duplicateOcc = aggRel.occurrences.some(
        (o) => o.postKey === rec.postKey && o.evidenceQuote === rel.quote
      );
      if (!duplicateOcc) {
        aggRel.occurrences.push({
          postKey: rec.postKey,
          timestampMs: rec.timestampMs,
          evidenceQuote: rel.quote,
          confidence: rel.confidence,
          engine: rec.engine,
        });
      }

      relPostKeySetMap.get(pairKey)!.add(rec.postKey);
      if (rec.timestampMs > 0) {
        if (aggRel.earliestTimestampMs === 0 || rec.timestampMs < aggRel.earliestTimestampMs) {
          aggRel.earliestTimestampMs = rec.timestampMs;
        }
        if (rec.timestampMs > aggRel.latestTimestampMs) {
          aggRel.latestTimestampMs = rec.timestampMs;
        }
      }
    }
  }

  const entities: AggregatedNerEntity[] = Array.from(entityMap.values()).map((ent) => {
    ent.aliases = Array.from(aliasSetMap.get(ent.id) || []);
    ent.postKeys = Array.from(postKeySetMap.get(ent.id) || []);
    ent.sampleQuotes.sort((a, b) => b.timestampMs - a.timestampMs);
    const coMap = cooccurMap.get(ent.id);
    if (coMap) {
      ent.cooccurringIds = Array.from(coMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([k]) => k);
    }
    classCounts[ent.nerClass] = (classCounts[ent.nerClass] || 0) + 1;
    return ent;
  });

  entities.sort((a, b) => b.mentionCount - a.mentionCount || b.lastSeenMs - a.lastSeenMs);

  const relations: AggregatedNerRelation[] = Array.from(relationMap.values()).map((rel) => {
    rel.occurrences.sort((a, b) => b.timestampMs - a.timestampMs);
    rel.postKeys = Array.from(relPostKeySetMap.get(rel.id) || []);
    relationClassCounts[rel.relationClass] = (relationClassCounts[rel.relationClass] || 0) + 1;
    return rel;
  });

  relations.sort(
    (a, b) =>
      b.latestTimestampMs - a.latestTimestampMs ||
      b.occurrences.length - a.occurrences.length
  );

  return {
    entities,
    relations,
    entityById: entityMap,
    relationById: relationMap,
    classCounts,
    relationClassCounts,
    totalMentions,
    postsAnalyzed: records.length,
    enginesUsed,
  };
}

// ---------------------------------------------------------------------------
// Safe Post HTML Quote / Entity Highlighter
// ---------------------------------------------------------------------------

/**
 * Safely highlights matched terms or quote fragments inside already-sanitized
 * HTML text nodes without corrupting HTML tags or link attributes.
 */
export function highlightNerTextInHtml(
  sanitizedHtml: string,
  terms: string[]
): string {
  if (!sanitizedHtml || !Array.isArray(terms) || terms.length === 0) {
    return sanitizedHtml;
  }

  const cleanTerms = Array.from(
    new Set(
      terms
        .map((t) => String(t || "").trim())
        .filter((t) => t.length >= 2)
    )
  ).sort((a, b) => b.length - a.length);

  if (cleanTerms.length === 0) return sanitizedHtml;

  const pattern = new RegExp(
    `(${cleanTerms.slice(0, 10).map((t) => escapeRegExp(t)).join("|")})`,
    "gi"
  );

  // Split around HTML tags so replacements only touch visible text segments
  const tokens = sanitizedHtml.split(/(<[^>]+>)/g);
  return tokens
    .map((token) => {
      if (!token || token.startsWith("<")) return token;
      return token.replace(
        pattern,
        '<mark class="explorer-ner-highlight bg-amber-200/80 dark:bg-amber-500/35 text-gray-900 dark:text-amber-100 rounded px-0.5 font-semibold">$1</mark>'
      );
    })
    .join("");
}
