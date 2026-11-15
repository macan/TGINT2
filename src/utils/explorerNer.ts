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

export const EXPLORER_NER_EXTRACTOR_VERSION = 2;
export const EXPLORER_NER_LOCAL_VERSION = 2;

export function isNerRecordCurrent(
  rec: PostNerExtractionRecord | null | undefined,
  channelId: string
): boolean {
  if (!rec || rec.channelId !== channelId) return false;
  if (rec.engine === "gemini") {
    return rec.extractorVersion >= 1;
  }
  return rec.extractorVersion >= EXPLORER_NER_LOCAL_VERSION;
}

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
  { canonical: "United States", patterns: ["United States", "U.S.A.", "USA", "U.S.", "America", "美國", "美国", "美方", "美利堅", "США", "Соединённые Штаты", "Америка"] },
  { canonical: "China", patterns: ["China", "PRC", "Mainland China", "中國", "中国", "中方", "中國大陸", "內地", "内地", "Китай", "КНР"] },
  { canonical: "United Kingdom", patterns: ["United Kingdom", "Britain", "Great Britain", "UK", "U.K.", "英國", "英国", "英方", "大不列顛", "Великобритания"] },
  { canonical: "Ukraine", patterns: ["Ukraine", "烏克蘭", "乌克兰", "烏方", "乌方", "Украина"] },
  { canonical: "Russia", patterns: ["Russia", "Russian Federation", "俄羅斯", "俄罗斯", "俄國", "俄方", "Россия", "РФ"] },
  { canonical: "Taiwan", patterns: ["Taiwan", "ROC", "台灣", "臺灣", "台方", "中華民國", "中华民国", "Тайвань"] },
  { canonical: "Japan", patterns: ["Japan", "日本", "日方", "Япония"] },
  { canonical: "South Korea", patterns: ["South Korea", "Republic of Korea", "ROK", "韓國", "韩国", "南韓", "南韩", "韓方", "Южная Корея"] },
  { canonical: "North Korea", patterns: ["North Korea", "DPRK", "朝鮮", "北韓", "北韩", "朝鲜", "КНДР"] },
  { canonical: "European Union", patterns: ["European Union", "EU", "歐盟", "欧盟", "歐洲聯盟", "Евросоюз", "ЕС"] },
  { canonical: "Germany", patterns: ["Germany", "德國", "德国", "德方", "Германия", "ФРГ"] },
  { canonical: "France", patterns: ["France", "法國", "法国", "法方", "Франция"] },
  { canonical: "Israel", patterns: ["Israel", "以色列", "以方", "Израиль"] },
  { canonical: "Palestine", patterns: ["Palestine", "巴勒斯坦", "巴方", "Палестина"] },
  { canonical: "Iran", patterns: ["Iran", "伊朗", "伊方", "Иран"] },
  { canonical: "India", patterns: ["India", "印度", "印方", "Индия"] },
  { canonical: "Canada", patterns: ["Canada", "加拿大", "加方", "Канада"] },
  { canonical: "Australia", patterns: ["Australia", "澳洲", "澳大利亞", "澳大利亚", "澳方", "Австралия"] },
  { canonical: "Philippines", patterns: ["Philippines", "菲律賓", "菲律宾", "菲方", "Филиппины"] },
  { canonical: "Singapore", patterns: ["Singapore", "新加坡", "星洲", "Сингапур"] },
  { canonical: "Vietnam", patterns: ["Vietnam", "Viet Nam", "越南", "越方", "Вьетнам"] },
  { canonical: "Poland", patterns: ["Poland", "波蘭", "波兰", "Польша"] },
  { canonical: "Turkey", patterns: ["Turkey", "Türkiye", "土耳其", "Турция"] },
  { canonical: "Syria", patterns: ["Syria", "敘利亞", "叙利亚", "Сирия"] },
  { canonical: "Brazil", patterns: ["Brazil", "巴西", "Бразилия"] },
  { canonical: "Mexico", patterns: ["Mexico", "墨西哥", "Мексика"] },
  { canonical: "Italy", patterns: ["Italy", "意大利", "義大利", "Италия"] },
  { canonical: "Spain", patterns: ["Spain", "西班牙", "Испания"] },
  { canonical: "Netherlands", patterns: ["Netherlands", "Holland", "荷蘭", "荷兰", "Нидерланды"] },
  { canonical: "Switzerland", patterns: ["Switzerland", "瑞士", "Швейцария"] },
  { canonical: "Saudi Arabia", patterns: ["Saudi Arabia", "沙地阿拉伯", "沙特阿拉伯", "沙烏地阿拉伯", "Саудовская Аравия"] },
  { canonical: "United Arab Emirates", patterns: ["United Arab Emirates", "UAE", "阿聯酋", "阿联酋", "ОАЭ"] },
  { canonical: "Egypt", patterns: ["Egypt", "埃及", "Египет"] },
  { canonical: "Lebanon", patterns: ["Lebanon", "黎巴嫩", "Ливан"] },
  { canonical: "Yemen", patterns: ["Yemen", "也門", "葉門", "Йемен"] },
  { canonical: "Belarus", patterns: ["Belarus", "白俄羅斯", "白俄罗斯", "Беларусь"] },
  { canonical: "Sweden", patterns: ["Sweden", "瑞典", "Швеция"] },
  { canonical: "Finland", patterns: ["Finland", "芬蘭", "芬兰", "Финляндия"] },
  { canonical: "Norway", patterns: ["Norway", "挪威", "Норвегия"] },
  { canonical: "Indonesia", patterns: ["Indonesia", "印尼", "印度尼西亞", "Индонезия"] },
  { canonical: "Malaysia", patterns: ["Malaysia", "馬來西亞", "马来西亚", "大馬", "Малайзия"] },
  { canonical: "Thailand", patterns: ["Thailand", "泰國", "泰国", "Таиланд"] },
  { canonical: "Myanmar", patterns: ["Myanmar", "Burma", "緬甸", "缅甸", "Мьянма"] },
];

const LOCATION_ENTRIES: Array<{ canonical: string; patterns: string[] }> = [
  { canonical: "Washington, D.C.", patterns: ["Washington, D.C.", "Washington DC", "Washington", "華盛頓", "华盛顿", "華府", "Вашингтон"] },
  { canonical: "London", patterns: ["London", "倫敦", "伦敦", "Лондон"] },
  { canonical: "Beijing", patterns: ["Beijing", "北京", "Пекин"] },
  { canonical: "Shanghai", patterns: ["Shanghai", "上海", "Шанхай"] },
  { canonical: "Guangzhou", patterns: ["Guangzhou", "Canton", "廣州", "广州"] },
  { canonical: "Shenzhen", patterns: ["Shenzhen", "深圳"] },
  { canonical: "Hong Kong", patterns: ["Hong Kong", "HK", "香港", "本港", "Гонконг"] },
  { canonical: "Macau", patterns: ["Macau", "Macao", "澳門", "澳门"] },
  { canonical: "Taipei", patterns: ["Taipei", "台北", "臺北", "Тайбэй"] },
  { canonical: "Kaohsiung", patterns: ["Kaohsiung", "高雄"] },
  { canonical: "Tokyo", patterns: ["Tokyo", "東京", "东京", "Токио"] },
  { canonical: "Seoul", patterns: ["Seoul", "首爾", "首尔", "Сеул"] },
  { canonical: "Kyiv", patterns: ["Kyiv", "Kiev", "基輔", "基辅", "Киев"] },
  { canonical: "Moscow", patterns: ["Moscow", "莫斯科", "Москва"] },
  { canonical: "Brussels", patterns: ["Brussels", "布魯塞爾", "布鲁塞尔", "Брюссель"] },
  { canonical: "New York", patterns: ["New York", "NYC", "紐約", "纽约", "Нью-Йорк"] },
  { canonical: "Los Angeles", patterns: ["Los Angeles", "洛杉磯", "洛杉矶"] },
  { canonical: "San Francisco", patterns: ["San Francisco", "舊金山", "圣弗朗西斯科", "三藩市"] },
  { canonical: "Silicon Valley", patterns: ["Silicon Valley", "矽谷", "硅谷"] },
  { canonical: "Paris", patterns: ["Paris", "巴黎", "Париж"] },
  { canonical: "Berlin", patterns: ["Berlin", "柏林", "Берлин"] },
  { canonical: "Jerusalem", patterns: ["Jerusalem", "耶路撒冷", "Иерусалим"] },
  { canonical: "Tel Aviv", patterns: ["Tel Aviv", "特拉維夫", "特拉维夫", "Тель-Авив"] },
  { canonical: "Gaza", patterns: ["Gaza", "Gaza Strip", "加薩", "加沙", "加沙地帶", "Газа"] },
  { canonical: "Rafah", patterns: ["Rafah", "拉法"] },
  { canonical: "Beirut", patterns: ["Beirut", "貝魯特", "Бейрут"] },
  { canonical: "Tehran", patterns: ["Tehran", "德黑蘭", "德黑兰", "Тегеран"] },
  { canonical: "Geneva", patterns: ["Geneva", "日內瓦", "日内瓦", "Женева"] },
  { canonical: "Munich", patterns: ["Munich", "慕尼黑", "Мюнхен"] },
  { canonical: "Crimea", patterns: ["Crimea", "克里米亞", "克里米亚", "Крым"] },
  { canonical: "Donbas", patterns: ["Donbas", "Donbass", "頓巴斯", "顿巴斯", "Донбасс"] },
  { canonical: "Kursk", patterns: ["Kursk", "庫爾斯克", "Курск"] },
  { canonical: "Taiwan Strait", patterns: ["Taiwan Strait", "台海", "台灣海峽", "臺灣海峽"] },
  { canonical: "South China Sea", patterns: ["South China Sea", "南海", "南中國海"] },
  { canonical: "Red Sea", patterns: ["Red Sea", "紅海", "红海"] },
  { canonical: "Black Sea", patterns: ["Black Sea", "黑海", "Чёрное море"] },
  { canonical: "Kowloon", patterns: ["Kowloon", "九龍", "九龙"] },
  { canonical: "New Territories", patterns: ["New Territories", "新界"] },
  { canonical: "Central, HK", patterns: ["Central", "中環"] },
  { canonical: "Admiralty, HK", patterns: ["Admiralty", "金鐘"] },
  { canonical: "Causeway Bay", patterns: ["Causeway Bay", "銅鑼灣"] },
  { canonical: "Wan Chai", patterns: ["Wan Chai", "灣仔"] },
  { canonical: "Mong Kok", patterns: ["Mong Kok", "旺角"] },
  { canonical: "Tsim Sha Tsui", patterns: ["Tsim Sha Tsui", "TST", "尖沙咀"] },
  { canonical: "Yau Ma Tei", patterns: ["Yau Ma Tei", "油麻地"] },
  { canonical: "Sham Shui Po", patterns: ["Sham Shui Po", "深水埗"] },
  { canonical: "Sha Tin", patterns: ["Sha Tin", "沙田"] },
  { canonical: "Tsuen Wan", patterns: ["Tsuen Wan", "荃灣"] },
  { canonical: "Tuen Mun", patterns: ["Tuen Mun", "屯門"] },
  { canonical: "Yuen Long", patterns: ["Yuen Long", "元朗"] },
  { canonical: "Kwun Tong", patterns: ["Kwun Tong", "觀塘"] },
  { canonical: "Tseung Kwan O", patterns: ["Tseung Kwan O", "將軍澳"] },
  { canonical: "Tung Chung", patterns: ["Tung Chung", "東涌"] },
  { canonical: "West Kowloon", patterns: ["West Kowloon", "西九龍"] },
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
  "Commander", "Ambassador", "Chief", "Executive", "Officer", "Defense", "Defence",
  "Foreign", "Finance", "National", "Security", "Special", "Armed", "Forces",
  "Northern", "Southern", "Eastern", "Western", "United", "Royal", "Federal",
]);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Precompile fast single-pass lookup indices for Nations & Locations (eliminates nested RegExp construction)
function buildDictionaryMatcher(entries: Array<{ canonical: string; patterns: string[] }>) {
  const asciiLookup = new Map<string, string>();
  const nonAsciiLookup = new Map<string, string>();
  const asciiPatterns: string[] = [];
  const nonAsciiPatterns: string[] = [];

  for (const entry of entries) {
    for (const pat of entry.patterns) {
      if (/^[\x00-\x7F]+$/.test(pat)) {
        asciiLookup.set(pat.toLowerCase(), entry.canonical);
        asciiPatterns.push(escapeRegExp(pat));
      } else {
        nonAsciiLookup.set(pat.toLowerCase(), entry.canonical);
        nonAsciiPatterns.push(escapeRegExp(pat));
      }
    }
  }

  // Sort longest-first so multi-word names match before abbreviations
  asciiPatterns.sort((a, b) => b.length - a.length);
  nonAsciiPatterns.sort((a, b) => b.length - a.length);

  const asciiRx = asciiPatterns.length
    ? new RegExp(`(?<![A-Za-z0-9])(?:${asciiPatterns.join("|")})(?![A-Za-z0-9])`, "gi")
    : null;
  const nonAsciiRx = nonAsciiPatterns.length
    ? new RegExp(`(?:${nonAsciiPatterns.join("|")})`, "gi")
    : null;

  return { asciiRx, asciiLookup, nonAsciiRx, nonAsciiLookup };
}

const NATION_MATCHER = buildDictionaryMatcher(NATION_ENTRIES);
const LOCATION_MATCHER = buildDictionaryMatcher(LOCATION_ENTRIES);

// Precompiled Extractor RegExps (Module-level for maximum throughput)
const RX_LATLON_DECIMAL =
  /(?<prefix>(?:lat(?:itude)?|coord(?:inates)?|gps|座標|經緯度|经纬度)\s*[:：=]?\s*)?(?<lat>[+-]?\d{1,2}\.\d{2,8})\s*(?<latDeg>°)?\s*(?<latHem>[NSns])?\s*[,;\/\s]+\s*(?:lon(?:gitude)?\s*[:：=]?\s*)?(?<lon>[+-]?\d{1,3}\.\d{2,8})\s*(?<lonDeg>°)?\s*(?<lonHem>[EWew])?/g;
const RX_LATLON_DMS =
  /(\d{1,2})\s*°\s*(\d{1,2})\s*[′']\s*(?:(\d{1,2}(?:\.\d+)?)\s*[″"]\s*)?([NSns])\s*[,;\s]+\s*(\d{1,3})\s*°\s*(\d{1,2})\s*[′']\s*(?:(\d{1,2}(?:\.\d+)?)\s*[″"]\s*)?([EWew])/g;

// English + Romanized Yue/Mandarin Addresses & Facilities
const RX_ADDR_EN =
  /\b(?:\d{1,5}(?:-\d{1,5})?\s+(?:[A-Z][A-Za-z0-9.'-]+\s+){1,4}(?:Street|St\.?|Avenue|Ave\.?|Road|Rd\.?|Boulevard|Blvd\.?|Lane|Ln\.?|Drive|Dr\.?|Court|Ct\.?|Way|Square|Sq\.?|Plaza|Place|Pl\.?|Terrace|Crescent|Quay|Promenade)|(?:10\s+)?Downing Street|White House|Kremlin|Pentagon|Capitol Hill|Westminster|Buckingham Palace|Élysée Palace|Elysee Palace|Zhongnanhai|Great Hall of the People|Tiananmen Square|Red Square|Times Square|Trafalgar Square|Piccadilly Circus|Wall Street|Champs-[EÉ]lys[eé]es|Queen'?s Road(?:\s+(?:Central|East|West))?|Hennessy Road|Nathan Road|Des Voeux Road(?:\s+(?:Central|West))?|Connaught Road(?:\s+(?:Central|West))?|Chater Road|Argyle Street|Sai Yeung Choi Street|Canton Road|Tamar Park|Chek Lap Kok|Victoria Harbour|Harbour City|Pacific Place|Langham Place|Chungking Mansions|Port of [A-Z][a-z]+|(?:[A-Z][A-Za-z0-9'&-]+\s+){1,3}(?:International Airport|Airport|Air Base|Airfield|Naval Base|Military Base|Army Base|Garrison|Embassy|Consulate|Hospital|Prison|Detention Cent(?:er|re)|Courthouse|High Court|Supreme Court|Headquarters|HQ|Train Station|Railway Station|Metro Station|MTR Station|Station|Terminal|Border Crossing|Checkpoint|Building|Tower|Center|Centre|Plaza|Mall|Square|Palace))\b/g;

// Translated Foreign Addresses/Landmarks & Native Chinese/Yue (廣東話/繁簡中文) Addresses
const RX_ADDR_CJK_TRANSLATED =
  /(?:唐寧街(?:\d+號)?|賓夕法尼亞大道(?:\d+號)?|香榭麗舍(?:大道|大街)|第五大道|第五街|華爾街(?:\d+號)?|华尔街(?:\d+号)?|百老匯(?:大道)?|艦隊街|牛津街|攝政街|皮卡迪利(?:廣場|圓環)|特拉法加(?:廣場|廣塲)|愛麗舍宮|愛麗榭宮|白金漢宮|肯辛頓宮|溫莎(?:城堡|堡)|西敏宮|威斯敏斯特(?:宮|教堂)|國會(?:山莊|山|大廈|大樓)|白宮|五角(?:大廈|大樓)|克里姆林宮|克宮|紅場|盧比揚卡|中南海|人民大會堂|天安門廣場|故宮博物院|青瓦台|龍山總統府|首相官邸|聯合國總部|世貿中心|時代(?:廣場|廣塲)|希斯(?:路|羅)機場|蓋特威克機場|格域機場|史坦斯特機場|甘迺迪機場|肯尼迪機場|紐(?:華|瓦)克機場|戴高樂機場|法蘭克福機場|史基(?:浦|蒲)機場|羽田機場|成田機場|關西機場|仁川(?:國際)?機場|樟宜機場|赤鱲角機場|香港國際機場|桃園(?:國際)?機場|松山機場|大興(?:國際)?機場|首都(?:國際)?機場|啟德郵輪碼頭|啟德體育園|西九龍(?:高鐵)?站|高鐵西九龍站|紅磡(?:車|港鐵)?站|金鐘添馬公園|添馬艦|香港政府總部|政府總部|禮賓府|中聯辦|國安公署|駐港部隊大廈|終審法院|高等法院|西九龍裁判法院|東區裁判法院|荔枝角收押所|赤柱監獄|壁屋監獄|羅湖口岸|落馬洲(?:支線)?口岸|皇崗口岸|深圳灣口岸|蓮塘口岸|港珠澳大橋口岸|太古廣場|國際金融中心|環球貿易廣場|朗豪坊|海港城|又一城|置地廣場|合和中心|長江集團中心|中銀大廈|匯豐總行大廈|香港會展中心|灣仔會展|彌敦道|皇后大道(?:中|東|西)?|軒尼詩道|干諾道(?:中|西)?|德輔道(?:中|西)?|遮打道|亞皆老街|西洋菜(?:南|北)?街|波斯富街|羅素街|廣東道|上海街|駱克道)/g;

const RX_ADDR_CJK_STRUCTURED =
  /(?:[\u4e00-\u9fff]{2,6}(?:區|市|縣))?(?:[東西南北中]?[\u4e00-\u9fff]{2,8}(?:大道[東西南北中]?|馬路|海旁|斜路|公路|街|道[東西南北中]?|路(?:[一二三四五六七八九十]+段)?|巷|弄|里|坊|徑))\s*(?:\d+(?:至\d+)?[A-Za-z]?號|[一二三四五六七八九十百千]+號)(?:\s*\d+[樓層F字樓座室鋪舖])?|[\u4e00-\u9fffA-Za-z0-9]{2,12}(?:\d+號)?(?:商業大廈|工業大廈|工廈|商場|廣場|廣塲|大廈|大樓|機場|火車站|高鐵站|地鐵站|港鐵站|碼頭|口岸|海軍基地|空軍基地|軍事基地|基地|大使館|總領事館|領事館|法院|裁判法院|監獄|收押所|警署|警察總部|政府總部)/g;

const RX_ADDR_CJK_BLACKLIST =
  /^(?:這條|呢條|嗰條|一條|整條|全條|大街|小巷|過馬|出街|逛街|行街|上路|問路|心路|活路|退路|後路|生路|死路|正路|歪路|大路|小路|中心|廣場舞|全場|現場|商場內|大廈內|大樓內)/;

// Platforms & Handles
const RX_HANDLE = /(?:^|[\s(])(@[A-Za-z0-9_]{3,32})\b/g;
const RX_URL_PLAT =
  /\b(?:https?:\/\/)?(?:t\.me|x\.com|twitter\.com|youtube\.com|youtu\.be|github\.com|facebook\.com|instagram\.com|threads\.net|bsky\.app|lihkg\.com|substack\.com)\/[A-Za-z0-9_./-]+/gi;
const RX_PLAT_NAMED =
  /\b(?:Telegram|Signal|WhatsApp|YouTube|GitHub|TikTok|Instagram|Facebook|Twitter|Discord|Reddit|WeChat|Threads|Bluesky|Mastodon|Line|LIHKG|Douyin|Xiaohongshu|Bilibili)\b|連登|微博|小紅書|抖音|微信|電報/gi;

// Financial & Metrics
const RX_MONEY_EN =
  /(?:USD|EUR|GBP|HKD|MOP|TWD|RMB|CNY|JPY|KRW|AUD|CAD|SGD)?\s*(?:HK\$|US\$|NT\$|AU\$|S\$|\$|€|£|¥)\s?\d+(?:[.,]\d+)?\s*(?:trillion|billion|million|thousand|[TBMK]\b)?|\b\d+(?:[.,]\d+)?\s*(?:trillion|billion|million|thousand)\s*(?:dollars|USD|euros|EUR|pounds|GBP|yuan|RMB|CNY|yen|JPY|HKD)\b|\b\d+(?:\.\d+)?%|\b\d{1,4}\s*bps\b|\b\d{1,3}(?:,\d{3})+\s*(?:people|troops|soldiers|casualties|deaths|injured|protesters|voters|users|subscribers|shares|barrels|drones|missiles)\b/gi;
const RX_MONEY_CJK =
  /(?:(?:新台幣|港幣|港元|澳門幣|澳門元|人民幣|美元|美金|歐元|英鎊|日圓|日元)?\s*\d+(?:\.\d+)?[億萬千百]*\s*(?:美元|美金|港元|港幣|澳門元|澳門幣|台幣|人民幣|歐元|英鎊|日圓|日元|元))|(?:\d+(?:\.\d+)?(?:%|％|個基點))|(?:\d+(?:\.\d+)?[億萬千]?(?:人|名|架|枚|艘|輛)(?:死亡|受傷|失蹤|被捕|參加|失業|軍人|士兵|無人機|導彈|戰機))/g;

// Organizations: General + Military Forces + Political Parties (EN, CJK/Yue, RU)
const RX_ORG_EN =
  /\b(?:[A-Z][A-Za-z0-9&'-]+\s+){1,4}(?:Inc\.?|Corp\.?|Corporation|Ltd\.?|LLC|PLC|Group|Holdings|Bank|Exchange|Agency|Ministry|Department|Committee|Commission|Council|Authority|Parliament|Congress|Senate|House|Court|Police|Bureau|Institute|University|College|Foundation|Federation|Union|Association|Alliance|Command|Airlines|Motors|Networks|Labs|AI|Media|Times|Post|News|Herald|Journal|Observatory|Fund)\b/g;

const RX_ORG_MILITARY_EN =
  /\b(?:(?:\d+(?:st|nd|rd|th)\s+)?(?:[A-Z][A-Za-z0-9.&'-]+\s+){0,3}(?:Armed Forces|Ground Forces|Air Force|Air Defence Forces|Air Defense Forces|Navy|Naval Fleet|Pacific Fleet|Black Sea Fleet|Northern Fleet|Baltic Fleet|Marine Corps|Marines|Special Forces|Special Operations|National Guard|Coast Guard|Border Guard|Mechanized Brigade|Armored Brigade|Assault Brigade|Airborne Brigade|Artillery Brigade|Brigade|Regiment|Battalion|Division|Squadron|Corps|Task Force|Militia|Paramilitary Forces|Defense Forces|Defence Forces|Revolutionary Guard|Guards|Reconnaissance)|Wagner Group|Azov Brigade|Iron Dome|IDF|AFU|UAF|PLA|PLAN|PLAAF|PLARF|IRGC|USSOCOM|CENTCOM|INDOPACOM|EUCOM|NORAD|RAF|USAF|USN|USMC|FSB|GRU|SVR|SBU|GUR|HUR|MI5|MI6|GCHQ|DGSE|Mossad|Shin Bet|SDF|PKK|YPG|RSF|SAF|Hamas|Hezbollah|Houthis|Taliban)\b/g;

const RX_ORG_PARTY_EN =
  /\b(?:(?:[A-Z][A-Za-z0-9&'-]+\s+){0,3}(?:Democratic Party|Republican Party|Labour Party|Conservative Party|Liberal Party|Liberal Democratic Party|Socialist Party|Communist Party|Green Party|Libertarian Party|Nationalist Party|Reform Party|Civic Party|People'?s Party|Political Party|Party|Coalition|Bloc|Caucus|Parliamentary Group|Political Front)|GOP|DNC|RNC|CCP|CPC|KMT|DPP|TPP|LDP|CDU|CSU|SPD|FDP|AfD|SNP|DUP|BJP|INC|ANC|PAP|DAB|FTU|NPP|Likud|Fidesz|Syriza|Podemos|Sinn F[eé]in|National Rally|Reform UK)\b/g;

const RX_ORG_ACRO =
  /\b(?:NATO|WHO|IMF|WTO|UN|UNESCO|UNHCR|UNICEF|FBI|CIA|NSA|SEC|DOJ|DOD|FED|ECB|OPEC|BRICS|ASEAN|APEC|NASA|SpaceX|OpenAI|Anthropic|Google|DeepMind|Mistral|xAI|Apple|Microsoft|Meta|Nvidia|NVIDIA|Tesla|Amazon|TSMC|ASML|Intel|AMD|ARM|ByteDance|Tencent|Alibaba|Huawei|Samsung|Sony|HKEX|NYSE|NASDAQ|Binance|Coinbase|ICAC|Reuters|Bloomberg|BBC|CNN|AP|AFP|SCMP|Xinhua|TASS)\b/g;

const RX_ORG_CJK =
  /(?:中國人民解放軍|人民解放軍|中國共產黨|中共|中國國民黨|國民黨|民主進步黨|民進黨|台灣民眾黨|民眾黨|時代力量|民主建港協進聯盟|民建聯|香港工會聯合會|工聯會|新民黨|經民聯|公民黨|自由黨|民主黨|社民連|實政圓桌|自民黨|立憲民主黨|公明黨|維新會|共和黨|工黨|保守黨|綠黨|統一俄羅斯黨|人民行動黨|執政黨|在野黨|反對派聯盟|革命衛隊|國民警衛隊|自衛隊|維和部隊|特種部隊|海軍陸戰隊|國防軍|武警部隊|武警|海警局|海警|廉政公署|警務處|國安處|入境處|海關|懲教署|金管局|證監會|港交所|聯準會|美聯儲|央視|新華社|路透社|彭博社|美聯社|法新社|南華早報|明報|星島日報|香港電台|無線電視|國軍|美軍|俄軍|烏軍|以軍|日軍|韓軍|英軍|法軍|北約部隊|聯軍)|[\u4e00-\u9fffA-Za-z0-9第]{2,10}(?:公司|集團|控股|銀行|交易所|部|委員會|管理局|局|署|院|廳|法院|最高法院|警署|警方|檢察院|檢方|大學|學院|研究所|學會|協會|聯合會|基金會|政黨|黨團|戰區|軍區|艦隊|軍團|兵團|航空兵|裝甲師|步兵師|機械化旅|摩步旅|空降旅|砲兵旅|特戰旅|陸戰旅|防衛省|總參謀部|軍情局|安全局|情報局|中央銀行|通訊社|電視台|日報|時報|周刊)/g;

const RX_ORG_RU =
  /(?<![А-Яа-яЁёA-Za-z0-9_])(?:ВСУ|ВС РФ|ЧВК Вагнер|Росгвардия|ГРУ|ФСБ|СБУ|ГУР|МО РФ|СВР|Единая Россия|КПРФ|ЛДПР|Яблоко|ЦБ РФ|МИД РФ|(?:\d+-я\s+)?[А-ЯЁA-Z][а-яёА-ЯЁa-zA-Z-]{2,24}\s+(?:бригада|дивизия|армия|флот|полк|батальон|партия|министерство|комитет))(?![А-Яа-яЁёA-Za-z0-9_])/g;

// Job Positions & Persons (EN, CJK/Yue, RU)
const RX_ROLE_PERSON_EN =
  /\b(President|Prime Minister|Deputy Prime Minister|Minister|Secretary of State|Defense Secretary|Defence Secretary|Treasury Secretary|CEO|Chief Executive Officer|CFO|CTO|COO|Chief Executive|Chairman|Chairwoman|Director|Commissioner|Spokesperson|Spokeswoman|Spokesman|Press Secretary|Governor|Senator|Representative|Chancellor|Premier|Mayor|Judge|Prosecutor|General|Admiral|Commander|Ambassador|Special Envoy|Secretary-General)\s+([A-Z][A-Za-zÀ-ÖØ-öø-ÿ'-]+(?:\s+(?:(?:van|von|de|al|bin)\s+)?[A-Z][A-Za-zÀ-ÖØ-öø-ÿ'-]+){1,2})/g;

const RX_ROLE_STANDALONE_EN =
  /\b(President|Prime Minister|Deputy Prime Minister|Secretary of State|Defense Minister|Defence Minister|Foreign Minister|Finance Minister|Chief Executive Officer|Chief Executive|CEO|CFO|CTO|Chairman|Chairwoman|Central Bank Governor|Attorney General|Supreme Leader|Speaker of the House|Secretary-General|Special Envoy|High Representative|Commander-in-Chief)\b/g;

const RX_ROLE_PERSON_CJK =
  /(特首|行政長官|政務司司長|財政司司長|律政司司長|副司長|司長|總統|副總統|總理|副總理|首相|國務卿|外長|外交部長|防長|國防部長|財長|財政部長|主席|副主席|執行長|行政總裁|首席執行官|總裁|副總裁|董事長|副董事長|總編輯|創辦人|聯合創辦人|秘書長|主任|局長|處長|署長|專員|市長|省長|州長|議員|立法會議員|區議員|國會議員|發言人|大使|特使|將軍|司令員|司令|總參謀長|法官|檢察官)([\u4e00-\u9fff]{2,4})/g;

const RX_CJK_ROLE_STANDALONE =
  /(?:行政長官|特首|政務司司長|財政司司長|律政司司長|國務卿|外交部長|國防部長|財政部長|行政總裁|首席執行官|秘書長|總參謀長|檢察官|新聞秘書|發言人)/g;

const RX_PERSON_EN =
  /\b([A-Z][a-zÀ-ÖØ-öø-ÿ]{1,15}(?:\s+[A-Z]\.)?\s+(?:(?:van|von|de|la|al|bin|Mc|Mac|O')\s*)?[A-Z][a-zÀ-ÖØ-öø-ÿ'-]{1,20}(?:\s+[A-Z][a-zÀ-ÖØ-öø-ÿ'-]{1,18})?)\b/g;

const RX_PERSON_RU =
  /(?<![А-Яа-яЁёA-Za-z0-9_])([А-ЯЁ][а-яё]{1,18}\s+[А-ЯЁ][а-яё]{2,22})(?![А-Яа-яЁёA-Za-z0-9_])/g;

const RX_CJK_PERSON_CUE =
  /(?:^|[，。；：\s「『（(])([\u4e00-\u9fff]{2,3})(?:表示|指出|強調|透露|稱|說|批評|警告|宣布|簽署|會見|訪問|出席|回應|認為|呼籲)/g;

const CJK_PERSON_STOP = new Set([
  "今天", "昨天", "明天", "日前", "目前", "今年", "去年", "明年", "最近", "同時",
  "此外", "另外", "然而", "但是", "不過", "因此", "所以", "我們", "他們", "她們",
  "大家", "記者", "消息", "報導", "報道", "當局", "政府", "官方", "方面", "部門",
  "專家", "學者", "分析", "調查", "報告", "文件", "聲明", "公告", "會議", "法院",
  "警方", "軍方", "市場", "公司", "企業", "銀行", "機構", "組織", "國家", "地區",
  "香港", "台灣", "中國", "美國", "英國", "日本", "韓國", "俄國", "烏方", "美方",
  "中方", "英方", "日方", "韓方", "俄方", "以方", "民眾", "市民", "網友", "網民",
]);

const RX_CJK_LEAD_NOISE =
  /^(?:香港方面|台灣方面|台北方面|北京方面|美方|中方|俄方|烏方|代表團|當局|警方|軍方|以及|關於|針對|來自|代表|隨後|目前|今天|今日|昨天|昨日|明天|並於|並在|並向|並赴|位於|坐落於?|前往|抵達|來到|返回|重返|撤離|駐守|召開|舉行|參加|出席|發起|實施|違反|討論|簽署|通過|公布|發布|提出|推動|於|在|到|抵|赴|往|經|從|由|向|及|和|與|跟|同|或|並|把|被|將|是|有)+/;
const RX_CJK_MID_PREP_BLEED =
  /^[\u4e00-\u9fff]{1,2}(?:前往|抵達|來到|駐守|位於|坐落於?|到達|回到|赴往)/;

function stripCjkLeadNoise(raw: string): string {
  let prev = "";
  let cur = raw.trim().replace(RX_CJK_MID_PREP_BLEED, "");
  while (cur !== prev) {
    prev = cur;
    cur = cur.replace(RX_CJK_LEAD_NOISE, "").trim();
  }
  return cur;
}

// Events & Incidents (multi-word summit/event phrases matched BEFORE bare G7/G20 acronyms)
const RX_EVENT_EN =
  /\b(?:(?:[A-Z][A-Za-z0-9-]+\s+){1,2}(?:Summit|Ministerial|Election|By-election|Referendum|Hearing|Protests?|Rally|March|Offensive|Ceasefire|Sanctions?|Inquiry|Trial|Verdict|Earthquake|Typhoon|IPO|Earnings)|World Economic Forum|Munich Security Conference|UN General Assembly|Operation\s+[A-Z][A-Za-z0-9-]+|Signal No\.\s*\d+|G7|G20|COP\d{2}|Davos)\b/g;
const RX_EVENT_CJK =
  /(?:八號風球|九號風球|十號風球|黑色暴雨警告|施政報告|財政預算案|全國兩會|兩會|三中全會|奧運會|世界盃|亞洲盃|進博會)|[\u4e00-\u9fffA-Za-z0-9]{2,10}(?:峰會|大選|選舉|補選|初選|公投|聽證會|抗議|遊行|示威|罷工|罷課|演習|軍演|停火|審判|判決|宣判|記者會|論壇|暴動|衝突|地震|風災|颱風|襲擊)/g;

// Products / Assets / Laws
const RX_ASSET_LAW_EN =
  /\b(?:(?:[A-Z][A-Za-z0-9-]+\s+){1,3}(?:Act|Bill|Treaty|Accord|Agreement|Resolution|Charter|Directive|Regulation|Ordinance|Law|Sanctions Package)|Article\s+\d+|Section\s+\d+|Resolution\s+\d+|Basic Law|National Security Law|GDPR|CHIPS Act|NDAA|AI Act|GPT-\d[A-Za-z0-9.-]*|ChatGPT|Claude\s*\d?(?:\.\d)?|Gemini\s*\d?(?:\.\d)?|Llama\s*\d?(?:\.\d)?|Bitcoin|Ethereum|Solana|Ripple|BTC|ETH|USDT|USDC|SOL|XRP|BNB|F-16|F-35|Su-35|J-20|HIMARS|ATACMS|Storm Shadow|Patriot|Starlink|iPhone\s*\d*|MacBook|Hang Seng Index|S&P 500|Nasdaq|Dow Jones)\b/g;
const RX_ASSET_LAW_CJK =
  /(?:《[^》]{2,30}》|香港基本法|基本法|香港國安法|國安法|維護國家安全條例|第23條|廿三條|恆生指數|恒生指數|標普500|納斯達克|道瓊斯|比特幣|以太幣)|[\u4e00-\u9fffA-Za-z0-9]{2,12}(?:法案|條例|法例|協議|條約|憲法|決議|白皮書|關稅|晶片|飛彈|導彈|戰機|無人機)/g;

// Precompiled Relation Cue RegExps
const RX_REL_LOC = /\b(?:in|at|to|from|near|visited|met in|based in)\b|在|於|抵|赴|前往|位於|坐落|駐/i;
const RX_REL_ISSUE = /\b(?:sign|signed|pass|passed|issue|issued|announce|announced|launch|launched|propose|proposed|release|released|enact|enacted|tabled)\b|簽署|通過|公布|發布|發表|提出|推出|頒布|立法/i;
const RX_REL_FUND = /\b(?:invest|invested|fund|funded|pay|paid|grant|granted|fine|fined|spend|spent|donate|donated|raise|raised|worth|budget|aid|billion|million)\b|投資|撥款|資助|罰款|捐款|援助|花費|總值|集資|融資|億|萬/i;
const RX_REL_OP_BY = /\b(?:operat(?:e|ed|es|ing)|own|owned|run|official|channel|account|via|posted|managed by)\b|營運|經營|官方|隸屬|帳號|頻道|由.*負責/i;
const RX_REL_HOSTILE = /\b(?:sanction|sanctioned|sue|sued|attack|attacked|struck|strike|arrest|arrested|charge|charged|ban|banned|probe|probed|condemn|condemned|accuse|accused|warn|warned|oppose|opposed|clash|clashed|retaliat(?:e|ed|ing)|critic(?:ize|ized|ises|ised|izing|ising)?|slam|slammed|rebuke|rebuked|denounce|denounced|blame|blamed)\b|制裁|起訴|控告|檢控|攻擊|打擊|逮捕|拘捕|禁止|封殺|調查|譴責|指控|警告|反對|衝突|批評|指責|炮轟|駁斥/i;
const RX_REL_OPPOSE = /\b(?:sanction|sanctioned|condemn|condemned|oppose|opposed|clash|clashed|dispute|disputed|critic(?:ize|ized|ises|ised|izing|ising)?|boycott|boycotted|slam|slammed|rebuke|rebuked|denounce|denounced)\b|反對|批評|指責|衝突|爭議|制裁|譴責|抵制|炮轟/i;
const RX_REL_COOP = /\b(?:met|meet|partner|partnered|agree|agreed|ally|allied|cooperat(?:e|ed|ing)|joint|support|supported|welcome|welcomed|pact|deal)\b|會見|會談|會晤|合作|結盟|簽約|同意|支持|聯手|共同|攜手/i;

function splitSentences(text: string): string[] {
  // Do not split inside decimal numbers (35.6762) or abbreviations/initials (U.S., U.K., St., John A.)
  return text
    .split(/(?<!\d)(?<=[.!?。！？\n])(?<!\b(?:U\.S|U\.K|U\.N|E\.U|Mr|Ms|Mrs|Dr|St|Mt|No|Lt|Col|Gen|Sgt|Cmdr|Inc|Ltd|Corp|Co|vs)\.)(?<!\b[A-Z]\.)\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 4);
}

export function extractNerSinglePostLocal(
  postKey: string,
  timestampMs: number,
  text: string,
  meta?: { author?: string; forwardTarget?: string; contactName?: string }
): { entities: ExtractedPostEntity[]; relations: ExtractedPostRelation[] } {
  const entities: ExtractedPostEntity[] = [];
  const relations: ExtractedPostRelation[] = [];
  const seenEntityMap = new Map<string, ExtractedPostEntity>();
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
    const existing = seenEntityMap.get(k);
    if (existing) {
      return existing;
    }
    const ent: ExtractedPostEntity = {
      name: cleanName,
      canonical: cleanCanonical,
      nerClass,
      quote: quote.slice(0, 200),
    };
    seenEntityMap.set(k, ent);
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

  // Structured Telegram post metadata
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
    const sentEntityKeys = new Set<string>();

    const addSentEntity = (
      name: string,
      canonical: string,
      nerClass: NerClassId
    ) => {
      const e = pushEntity(name, canonical, nerClass, sentence);
      if (e) {
        const k = normalizeEntityKey(e.nerClass, e.canonical);
        if (!sentEntityKeys.has(k)) {
          sentEntityKeys.add(k);
          sentEntities.push(e);
        }
      }
      return e;
    };

    // 1. Nations (single-pass precompiled regex matchers)
    if (NATION_MATCHER.asciiRx) {
      NATION_MATCHER.asciiRx.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = NATION_MATCHER.asciiRx.exec(sentence)) !== null) {
        const canon = NATION_MATCHER.asciiLookup.get(m[0].toLowerCase());
        if (canon) addSentEntity(m[0], canon, "nation");
      }
    }
    if (NATION_MATCHER.nonAsciiRx) {
      NATION_MATCHER.nonAsciiRx.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = NATION_MATCHER.nonAsciiRx.exec(sentence)) !== null) {
        const canon = NATION_MATCHER.nonAsciiLookup.get(m[0].toLowerCase());
        if (canon) addSentEntity(m[0], canon, "nation");
      }
    }

    // 2. Locations (places + lat,long decimal & DMS coordinates)
    if (LOCATION_MATCHER.asciiRx) {
      LOCATION_MATCHER.asciiRx.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = LOCATION_MATCHER.asciiRx.exec(sentence)) !== null) {
        const canon = LOCATION_MATCHER.asciiLookup.get(m[0].toLowerCase());
        if (canon) addSentEntity(m[0], canon, "location");
      }
    }
    if (LOCATION_MATCHER.nonAsciiRx) {
      LOCATION_MATCHER.nonAsciiRx.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = LOCATION_MATCHER.nonAsciiRx.exec(sentence)) !== null) {
        const canon = LOCATION_MATCHER.nonAsciiLookup.get(m[0].toLowerCase());
        if (canon) addSentEntity(m[0], canon, "location");
      }
    }

    // 2b. Decimal lat,long coordinates -> location
    RX_LATLON_DECIMAL.lastIndex = 0;
    let dm: RegExpExecArray | null;
    while ((dm = RX_LATLON_DECIMAL.exec(sentence)) !== null) {
      const g = dm.groups;
      if (!g) continue;
      const hasMarker = Boolean(g.prefix || g.latDeg || g.latHem || g.lonDeg || g.lonHem);
      const latFrac = (g.lat.split(".")[1] || "").length;
      const lonFrac = (g.lon.split(".")[1] || "").length;
      if (!hasMarker && (latFrac < 3 || lonFrac < 3)) continue;

      let latVal = parseFloat(g.lat);
      let lonVal = parseFloat(g.lon);
      if (g.latHem && g.latHem.toUpperCase() === "S") latVal = -Math.abs(latVal);
      if (g.lonHem && g.lonHem.toUpperCase() === "W") lonVal = -Math.abs(lonVal);

      if (
        Number.isFinite(latVal) &&
        Number.isFinite(lonVal) &&
        Math.abs(latVal) <= 90 &&
        Math.abs(lonVal) <= 180 &&
        !(latVal === 0 && lonVal === 0)
      ) {
        const canon = `${latVal.toFixed(4)}, ${lonVal.toFixed(4)}`;
        addSentEntity(dm[0].trim(), canon, "location");
      }
    }

    // 2c. DMS coordinates -> location
    RX_LATLON_DMS.lastIndex = 0;
    while ((dm = RX_LATLON_DMS.exec(sentence)) !== null) {
      const latD = Number(dm[1]);
      const latM = Number(dm[2]);
      const latS = Number(dm[3] || 0);
      const latH = dm[4].toUpperCase();
      const lonD = Number(dm[5]);
      const lonM = Number(dm[6]);
      const lonS = Number(dm[7] || 0);
      const lonH = dm[8].toUpperCase();
      if (latD <= 90 && lonD <= 180 && latM < 60 && lonM < 60 && latS < 60 && lonS < 60) {
        let decLat = latD + latM / 60 + latS / 3600;
        let decLon = lonD + lonM / 60 + lonS / 3600;
        if (latH === "S") decLat = -decLat;
        if (lonH === "W") decLon = -decLon;
        const canon = `${decLat.toFixed(4)}, ${decLon.toFixed(4)}`;
        addSentEntity(dm[0].trim(), canon, "location");
      }
    }

    // 3. Addresses & Facilities (structured HK/TW/CN streets matched alongside translated landmarks, deduplicating left-bleed)
    RX_ADDR_EN.lastIndex = 0;
    for (const m of sentence.matchAll(RX_ADDR_EN)) {
      const val = m[0].trim();
      addSentEntity(val, val, "address");
    }
    const translatedCjkAddrs: string[] = [];
    RX_ADDR_CJK_TRANSLATED.lastIndex = 0;
    for (const m of sentence.matchAll(RX_ADDR_CJK_TRANSLATED)) {
      const val = m[0].trim();
      translatedCjkAddrs.push(val);
    }
    const structuredCjkAddrs: string[] = [];
    RX_ADDR_CJK_STRUCTURED.lastIndex = 0;
    for (const m of sentence.matchAll(RX_ADDR_CJK_STRUCTURED)) {
      const val = stripCjkLeadNoise(m[0]);
      if (val.length < 3 || RX_ADDR_CJK_BLACKLIST.test(val)) continue;
      // Skip if structured match merely prepends noise to an already-recognized translated address with no trailing street number
      const isLeftBleedOverTranslated = translatedCjkAddrs.some(
        (tr) => val.length > tr.length && val.endsWith(tr)
      );
      if (isLeftBleedOverTranslated) continue;
      structuredCjkAddrs.push(val);
    }
    for (const val of structuredCjkAddrs) {
      addSentEntity(val, val, "address");
    }
    for (const val of translatedCjkAddrs) {
      // Avoid emitting bare road (e.g., "彌敦道", "亞皆老街") when a numbered address ("彌敦道300號", "旺角亞皆老街8號") was already added
      const supersededByNumbered = structuredCjkAddrs.some((st) => {
        const idx = st.indexOf(val);
        return (
          idx !== -1 &&
          st.length > val.length &&
          /^\d|[一二三四五六七八九十]/.test(st.slice(idx + val.length))
        );
      });
      if (!supersededByNumbered) {
        addSentEntity(val, val, "address");
      }
    }

    // 4. Platforms & Handles
    RX_HANDLE.lastIndex = 0;
    for (const m of sentence.matchAll(RX_HANDLE)) {
      addSentEntity(m[1], m[1], "platform");
    }
    RX_URL_PLAT.lastIndex = 0;
    for (const m of sentence.matchAll(RX_URL_PLAT)) {
      const val = m[0].replace(/[.,;)]+$/, "");
      addSentEntity(val, val, "platform");
    }
    RX_PLAT_NAMED.lastIndex = 0;
    for (const m of sentence.matchAll(RX_PLAT_NAMED)) {
      addSentEntity(m[0], m[0], "platform");
    }

    // 5. Financial & Metrics
    RX_MONEY_EN.lastIndex = 0;
    for (const m of sentence.matchAll(RX_MONEY_EN)) {
      const val = m[0].trim();
      addSentEntity(val, val, "financial_metric");
    }
    RX_MONEY_CJK.lastIndex = 0;
    for (const m of sentence.matchAll(RX_MONEY_CJK)) {
      const val = m[0].trim();
      addSentEntity(val, val, "financial_metric");
    }

    // 6. Organizations (General + Military Forces + Political Parties + Acronyms + RU + CJK/Yue)
    RX_ORG_MILITARY_EN.lastIndex = 0;
    for (const m of sentence.matchAll(RX_ORG_MILITARY_EN)) {
      const val = m[0].trim().replace(/^(?:The|A|An)\s+/i, "");
      if (!LAT_STOPWORDS.has(val)) addSentEntity(val, val, "organization");
    }
    RX_ORG_PARTY_EN.lastIndex = 0;
    for (const m of sentence.matchAll(RX_ORG_PARTY_EN)) {
      const val = m[0].trim().replace(/^(?:The|A|An)\s+/i, "");
      if (!LAT_STOPWORDS.has(val)) addSentEntity(val, val, "organization");
    }
    RX_ORG_EN.lastIndex = 0;
    for (const m of sentence.matchAll(RX_ORG_EN)) {
      const val = m[0].trim().replace(/^(?:The|A|An)\s+/i, "");
      if (!LAT_STOPWORDS.has(val)) addSentEntity(val, val, "organization");
    }
    RX_ORG_ACRO.lastIndex = 0;
    for (const m of sentence.matchAll(RX_ORG_ACRO)) {
      addSentEntity(m[0], m[0], "organization");
    }
    RX_ORG_CJK.lastIndex = 0;
    for (const m of sentence.matchAll(RX_ORG_CJK)) {
      const val = stripCjkLeadNoise(m[0]);
      if (val.length >= 2) addSentEntity(val, val, "organization");
    }
    RX_ORG_RU.lastIndex = 0;
    for (const m of sentence.matchAll(RX_ORG_RU)) {
      addSentEntity(m[0].trim(), m[0].trim(), "organization");
    }

    // 7. Job Position + Adjacent Person pairing
    RX_ROLE_PERSON_EN.lastIndex = 0;
    for (const m of sentence.matchAll(RX_ROLE_PERSON_EN)) {
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
    RX_ROLE_STANDALONE_EN.lastIndex = 0;
    for (const m of sentence.matchAll(RX_ROLE_STANDALONE_EN)) {
      addSentEntity(m[1].trim(), m[1].trim(), "job_position");
    }

    RX_ROLE_PERSON_CJK.lastIndex = 0;
    for (const m of sentence.matchAll(RX_ROLE_PERSON_CJK)) {
      const roleStr = m[1].trim();
      const candName = m[2]
        .trim()
        .replace(/(?:前往|抵達|來到|表示|指出|強調|透露|宣布|宣佈|簽署|會見|訪問|出席|回應|認為|呼籲|[今昨明將並在於與及說稱會被的向到赴前])$/, "")
        .replace(/[今昨明將並在於與及說稱表示會被的向到前]+$/g, "");
      addSentEntity(roleStr, roleStr, "job_position");
      if (
        candName.length >= 2 &&
        !CJK_PERSON_STOP.has(candName) &&
        !/[的是在與和及並將稱表示說會被]/.test(candName)
      ) {
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
    RX_CJK_ROLE_STANDALONE.lastIndex = 0;
    for (const m of sentence.matchAll(RX_CJK_ROLE_STANDALONE)) {
      addSentEntity(m[0].trim(), m[0].trim(), "job_position");
    }

    // 8. Standalone Person Names (EN, RU, CJK speech/action cue)
    RX_PERSON_EN.lastIndex = 0;
    for (const m of sentence.matchAll(RX_PERSON_EN)) {
      const candidate = m[1].trim();
      const words = candidate.split(/\s+/);
      if (words.some((w) => LAT_STOPWORDS.has(w))) continue;
      const lowerCand = candidate.toLowerCase();
      const alreadyCaptured = sentEntities.some(
        (e) =>
          e.canonical.toLowerCase() === lowerCand ||
          e.canonical.toLowerCase().includes(lowerCand)
      );
      if (!alreadyCaptured) {
        addSentEntity(candidate, candidate, "person");
      }
    }

    RX_PERSON_RU.lastIndex = 0;
    for (const m of sentence.matchAll(RX_PERSON_RU)) {
      const cand = m[1].trim();
      const lowerCand = cand.toLowerCase();
      if (!sentEntities.some((e) => e.canonical.toLowerCase().includes(lowerCand))) {
        addSentEntity(cand, cand, "person");
      }
    }

    RX_CJK_PERSON_CUE.lastIndex = 0;
    for (const m of sentence.matchAll(RX_CJK_PERSON_CUE)) {
      const cand = m[1].trim();
      if (
        cand.length >= 2 &&
        !CJK_PERSON_STOP.has(cand) &&
        !sentEntities.some((e) => e.canonical.includes(cand))
      ) {
        addSentEntity(cand, cand, "person");
      }
    }

    // 9. Events & Incidents
    RX_EVENT_EN.lastIndex = 0;
    for (const m of sentence.matchAll(RX_EVENT_EN)) {
      addSentEntity(m[0].trim(), m[0].trim(), "event");
    }
    RX_EVENT_CJK.lastIndex = 0;
    for (const m of sentence.matchAll(RX_EVENT_CJK)) {
      const val = stripCjkLeadNoise(m[0]);
      if (val.length >= 3) addSentEntity(val, val, "event");
    }

    // 10. Products / Assets / Laws
    RX_ASSET_LAW_EN.lastIndex = 0;
    for (const m of sentence.matchAll(RX_ASSET_LAW_EN)) {
      addSentEntity(m[0].trim(), m[0].trim(), "asset_law");
    }
    RX_ASSET_LAW_CJK.lastIndex = 0;
    for (const m of sentence.matchAll(RX_ASSET_LAW_CJK)) {
      const val = stripCjkLeadNoise(m[0].replace(/[《》]/g, ""));
      if (val.length >= 3) {
        addSentEntity(val, val, "asset_law");
      }
    }

    // Sentence-level Relation Linking among detected entities
    if (sentEntities.length >= 2) {
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
      const facilities = sentEntities.filter((e) => e.nerClass === "address");

      const primaryActor = actors[0] || null;

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

      // located_at (actors or events -> address/location/nation)
      if (primaryActor && places.length >= 1) {
        const targetPlace = places.find((pl) => pl.canonical !== primaryActor.canonical);
        if (targetPlace) {
          const hasCue = RX_REL_LOC.test(sentence);
          if (hasCue || targetPlace.nerClass === "address") {
            pushRelation(
              { name: primaryActor.canonical, nerClass: primaryActor.nerClass },
              "located_at",
              { name: targetPlace.canonical, nerClass: targetPlace.nerClass },
              sentence,
              hasCue ? 0.8 : 0.68
            );
          }
        }
      }
      if (events.length >= 1 && places.length >= 1) {
        pushRelation(
          { name: events[0].canonical, nerClass: "event" },
          "located_at",
          { name: places[0].canonical, nerClass: places[0].nerClass },
          sentence,
          0.75
        );
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
      if (primaryActor && laws.length >= 1 && RX_REL_ISSUE.test(sentence)) {
        pushRelation(
          { name: primaryActor.canonical, nerClass: primaryActor.nerClass },
          "issued_or_authored",
          { name: laws[0].canonical, nerClass: "asset_law" },
          sentence,
          0.8
        );
      }

      // transferred_or_funded
      if (primaryActor && metrics.length >= 1 && RX_REL_FUND.test(sentence)) {
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

      // operated_by (platform or facility -> actor)
      if (platforms.length >= 1 && primaryActor && primaryActor.nerClass !== "platform") {
        if (RX_REL_OP_BY.test(sentence)) {
          pushRelation(
            { name: platforms[0].canonical, nerClass: "platform" },
            "operated_by",
            { name: primaryActor.canonical, nerClass: primaryActor.nerClass },
            sentence,
            0.74
          );
        }
      } else if (facilities.length >= 1 && orgActor && RX_REL_OP_BY.test(sentence)) {
        pushRelation(
          { name: facilities[0].canonical, nerClass: "address" },
          "operated_by",
          { name: orgActor.canonical, nerClass: "organization" },
          sentence,
          0.72
        );
      }

      // Actor-to-Actor relations: opposed_to / targets_or_acts_on / cooperated_with
      if (actors.length >= 2) {
        const a1 = actors[0];
        const a2 = actors[1];
        if (RX_REL_HOSTILE.test(sentence)) {
          const isOpposed = RX_REL_OPPOSE.test(sentence);
          pushRelation(
            { name: a1.canonical, nerClass: a1.nerClass },
            isOpposed ? "opposed_to" : "targets_or_acts_on",
            { name: a2.canonical, nerClass: a2.nerClass },
            sentence,
            0.79
          );
        } else if (RX_REL_COOP.test(sentence)) {
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
      if (isNerRecordCurrent(rec, channelId)) {
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

  const mapGeminiExtractionsToRecords = (
    chunkItems: typeof candidatePosts,
    extractions: any[]
  ): PostNerExtractionRecord[] => {
    const byKey = new Map<string, any>();
    for (const ex of extractions) {
      if (ex && ex.postKey) byKey.set(String(ex.postKey), ex);
    }
    const now = Date.now();
    return chunkItems.map((c) => {
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
  };

  const callDirectGeminiNer = async (
    chunkItems: typeof candidatePosts,
    apiKey: string,
    signal?: AbortSignal
  ): Promise<any[] | null> => {
    const inputPosts = chunkItems.map((c) => ({
      postKey: c.postKey,
      dateLabel: c.dateLabel,
      author: c.author || "",
      text: c.text.slice(0, 2400),
    }));
    const systemInstruction = `You are a strict multilingual Named Entity Recognition (NER) and Relation Extraction analyst inspecting posts from channel "${String(options.channelName || "unknown")}".
For every input post, extract named entities and directed/undirected relations grounded strictly in the post text.
Allowed nerClass values (exactly 10): person, organization, nation, job_position, location, address, event, platform, asset_law, financial_metric.
Allowed relationClass values (exactly 10): holds_role, affiliated_with, located_at, participated_in, targets_or_acts_on, issued_or_authored, cooperated_with, opposed_to, transferred_or_funded, operated_by.
Rules:
1. Canonicalize entity names cleanly (e.g. "US" / "U.S." -> "United States" for canonical, keep exact surface span in name).
2. Always include a concise verbatim quote snippet from that post supporting each entity and relation.
3. Preserve exact postKey values.`;

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-4-hydrogen:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents: [{ role: "user", parts: [{ text: JSON.stringify(inputPosts) }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                extractions: {
                  type: "ARRAY",
                  items: {
                    type: "OBJECT",
                    properties: {
                      postKey: { type: "STRING" },
                      entities: {
                        type: "ARRAY",
                        items: {
                          type: "OBJECT",
                          properties: {
                            name: { type: "STRING" },
                            canonical: { type: "STRING" },
                            nerClass: { type: "STRING" },
                            quote: { type: "STRING" },
                          },
                          required: ["name", "canonical", "nerClass", "quote"],
                        },
                      },
                      relations: {
                        type: "ARRAY",
                        items: {
                          type: "OBJECT",
                          properties: {
                            subject: { type: "STRING" },
                            subjectClass: { type: "STRING" },
                            relationClass: { type: "STRING" },
                            object: { type: "STRING" },
                            objectClass: { type: "STRING" },
                            quote: { type: "STRING" },
                            confidence: { type: "NUMBER" },
                          },
                          required: [
                            "subject",
                            "subjectClass",
                            "relationClass",
                            "object",
                            "objectClass",
                            "quote",
                            "confidence",
                          ],
                        },
                      },
                    },
                    required: ["postKey", "entities", "relations"],
                  },
                },
              },
              required: ["extractions"],
            },
          },
        }),
      }
    );
    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    const rawText = json?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) return null;
    const parsed = JSON.parse(rawText);
    return Array.isArray(parsed?.extractions) ? parsed.extractions : [];
  };

  const GEMINI_CHUNK_SIZE = 20;
  const LOCAL_CHUNK_SIZE = 80;
  const storedGeminiKey =
    typeof localStorage !== "undefined" ? localStorage.getItem("gemini_api_key") || "" : "";
  let geminiUnavailable = false;
  let serverNerEndpointMissing = false;
  let usedGemini = false;
  let usedLocal = false;

  let cursor = 0;
  while (cursor < candidatePosts.length) {
    if (options.signal?.aborted) {
      return {
        records: Array.from(existingMap.values()),
        progress,
        aborted: true,
      };
    }

    const chunkSize = geminiUnavailable ? LOCAL_CHUNK_SIZE : GEMINI_CHUNK_SIZE;
    const chunk = candidatePosts.slice(cursor, cursor + chunkSize);
    cursor += chunk.length;
    let batchRecords: PostNerExtractionRecord[] | null = null;

    if (!geminiUnavailable) {
      try {
        const requestBody = {
          channelName: options.channelName,
          apiKey: storedGeminiKey || undefined,
          posts: chunk.map((c) => ({
            postKey: c.postKey,
            timestampMs: c.timestampMs,
            dateLabel: c.dateLabel,
            author: c.author,
            text: c.text,
          })),
        };

        let res: Response | null = null;
        if (!serverNerEndpointMissing) {
          res = await fetch("/api/gemini/ner", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: options.signal,
            body: JSON.stringify(requestBody),
          });

          // Behind Cloudflare Workers / proxies that block POST (405), try GET if payload fits in URL
          if (res.status === 405) {
            const encodedPayload = encodeURIComponent(JSON.stringify(requestBody));
            if (encodedPayload.length <= 5500) {
              const getRes = await fetch(`/api/gemini/ner?payload=${encodedPayload}`, {
                method: "GET",
                signal: options.signal,
              });
              const ctGet = getRes.headers.get("content-type") || "";
              if (getRes.ok && ctGet.includes("application/json")) {
                res = getRes;
              }
            }
          }
        }

        const ct = res ? res.headers.get("content-type") || "" : "";
        const isJsonResponse = ct.includes("application/json");

        if (res && res.ok && isJsonResponse) {
          const payload = await res.json();
          const extractions = Array.isArray(payload?.extractions) ? payload.extractions : [];
          batchRecords = mapGeminiExtractionsToRecords(chunk, extractions);
          usedGemini = true;
        } else if (
          serverNerEndpointMissing ||
          !res ||
          res.status === 400 ||
          res.status === 404 ||
          res.status === 405 ||
          res.status === 501 ||
          (res.ok && !isJsonResponse)
        ) {
          // Server endpoint missing or blocked on static Cloudflare Workers/Pages (405/404/HTML rewrite)
          if (res && (res.status === 404 || res.status === 405 || res.status === 501 || (res.ok && !isJsonResponse))) {
            serverNerEndpointMissing = true;
          }

          // If user explicitly provided a client-side Gemini API key, attempt direct Gemini REST fallback
          if (storedGeminiKey && (!res || res.status !== 400)) {
            const directExtractions = await callDirectGeminiNer(chunk, storedGeminiKey, options.signal);
            if (directExtractions) {
              batchRecords = mapGeminiExtractionsToRecords(chunk, directExtractions);
              usedGemini = true;
            } else {
              geminiUnavailable = true;
            }
          } else {
            // Switch cleanly to optimized local structured NLP without flagging HTTP 405/404 as failure
            geminiUnavailable = true;
          }
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

    // Yield briefly between local chunks so large batches keep UI responsive
    if (geminiUnavailable && cursor < candidatePosts.length) {
      await new Promise((r) => setTimeout(r, 0));
    }
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
