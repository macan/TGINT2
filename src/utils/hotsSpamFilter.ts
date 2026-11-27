/**
 * Multi-Layer Spam Detection & Filtering Engine for Listen Tab Hots Mode.
 *
 * Layer 1 (Instant, <1ms): Multilingual heuristic & structural spam scorer (EN/ZH/RU/JA/ES)
 *         + cross-channel coordinated ad-blast detector, with strict journalism guards.
 * Layer 2 (Local AI, <1ms/post after MiniLM embedding): Contrastive zero-shot semantic
 *         classification using the cached local multilingual MiniLM ONNX model in Web Worker.
 * Layer 3 (Remote High-Precision): Kev SystemOne API (`callSystemOne`) tagging with bounded
 *         concurrency, abort support, and persistent IndexedDB verdict caching.
 */

import { callSystemOne } from './systemone';
import {
  buildPostEmbeddingInput,
  dotProductVectors,
  fnv1aHash64,
} from './hotsVectorStore';
import type { HotPostItem } from './hotsEngine';

export type HotsSpamFilterMode = 'local' | 'hybrid' | 'systemone' | 'off';
export type HotsSpamSensitivity = 'strict' | 'balanced' | 'conservative';
export type HotsSpamSource = 'rule' | 'local-neural' | 'systemone' | 'override';

export interface SpamHeuristicResult {
  score: number; // 0..1
  label: 'spam' | 'promo' | 'clean';
  reasons: string[];
  hasExplicitAdDisclosure: boolean;
  hasPromoCues: boolean;
  isNewsGuarded: boolean;
}

export interface SemanticSpamScore {
  postKey: string;
  neuralScore: number; // 0..1
  maxSpamSim: number;
  maxLegitSim: number;
  margin: number;
  matchedCategory?: string;
}

export interface SpamEvaluationResult {
  postKey: string;
  contentHash: string;
  spamScore: number; // 0..1
  isSpam: boolean;
  label: 'spam' | 'promo' | 'clean';
  source: HotsSpamSource;
  reasons: string[];
  localRuleScore?: number;
  localNeuralScore?: number;
  systemOneScore?: number;
  userOverride?: 'ham' | 'spam';
  updatedAt: number;
}

export interface FilteredSpamPostItem {
  post: HotPostItem;
  evaluation: SpamEvaluationResult;
}

export interface SpamCacheStats {
  totalRecords: number;
  spamRecords: number;
  systemOneRecords: number;
  overrideRecords: number;
}

// ---------------------------------------------------------------------------
// Settings Persistence & Thresholds
// ---------------------------------------------------------------------------

const STORAGE_MODE_KEY = 'listen_hots_spam_filter_mode';
const STORAGE_SENSITIVITY_KEY = 'listen_hots_spam_sensitivity';

export function getSpamThreshold(sensitivity: HotsSpamSensitivity = 'balanced'): number {
  switch (sensitivity) {
    case 'strict':
      return 0.56;
    case 'conservative':
      return 0.80;
    default:
      return 0.68;
  }
}

export function getSavedSpamFilterMode(): HotsSpamFilterMode {
  if (typeof localStorage === 'undefined') return 'local';
  const raw = localStorage.getItem(STORAGE_MODE_KEY);
  if (raw === 'local' || raw === 'hybrid' || raw === 'systemone' || raw === 'off') {
    return raw;
  }
  return 'local';
}

export function saveSpamFilterMode(mode: HotsSpamFilterMode): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_MODE_KEY, mode);
  } catch {
    // ignore storage quota errors
  }
}

export function getSavedSpamSensitivity(): HotsSpamSensitivity {
  if (typeof localStorage === 'undefined') return 'balanced';
  const raw = localStorage.getItem(STORAGE_SENSITIVITY_KEY);
  if (raw === 'strict' || raw === 'balanced' || raw === 'conservative') {
    return raw;
  }
  return 'balanced';
}

export function saveSpamSensitivity(sensitivity: HotsSpamSensitivity): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_SENSITIVITY_KEY, sensitivity);
  } catch {
    // ignore storage quota errors
  }
}

export function computeSpamContentHash(post: Pick<HotPostItem, 'text' | 'cleanSnippet' | 'linkPreview'>): string {
  const raw = `${post.text || post.cleanSnippet || ''}|${post.linkPreview?.title || ''}|${post.linkPreview?.url || ''}`
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 600);
  return fnv1aHash64(raw);
}

// ---------------------------------------------------------------------------
// Layer 1: Multilingual Heuristic & Structural Spam Pre-Scorer
// ---------------------------------------------------------------------------

interface WeightedPattern {
  regex: RegExp;
  weight: number;
  reason: string;
  explicitDisclosure?: boolean;
  promoCue?: boolean;
}

const EXPLICIT_AD_PATTERNS: WeightedPattern[] = [
  // Russian mandatory advertising law markers (erid / ИНН / #реклама)
  {
    regex: /\berid\s*[:：=]?\s*[a-zA-Z0-9_-]{6,}/i,
    weight: 0.90,
    reason: 'Sponsored ad tag (erid)',
    explicitDisclosure: true,
    promoCue: true,
  },
  {
    regex: /(?:^|\s)(?:#реклама|реклама\.|на правах рекламы|партнерский материал|партнёрский материал|рекламодатель\s*[:：])/i,
    weight: 0.86,
    reason: 'Russian ad disclosure',
    explicitDisclosure: true,
    promoCue: true,
  },
  // Chinese explicit ad / paid promotion markers
  {
    regex: /(?:^|\s|#)(?:广告|推广|赞助推广|商业推广|品牌推广|硬广|软文推广|合作推广)(?:\s|$|[】\]：:])|【\s*(?:广告|推广|赞助|福利|优惠)\s*】/,
    weight: 0.86,
    reason: 'Chinese ad disclosure',
    explicitDisclosure: true,
    promoCue: true,
  },
  // English / Japanese / Spanish explicit sponsored tags
  {
    regex: /(?:^|\s)(?:#ad|#sponsored|#promo|#promotion|#partner|#PR|#広告|paid promotion|sponsored post|sponsored message|publicidad pagada)(?:\s|$|[.,!])/i,
    weight: 0.84,
    reason: 'Sponsored ad disclosure',
    explicitDisclosure: true,
    promoCue: true,
  },
];

const HIGH_SIGNAL_SPAM_PATTERNS: WeightedPattern[] = [
  // Gambling / Casino / Betting promos (EN / ZH / RU / ES)
  {
    regex: /(?:online casino|free spins|casino bonus|betting tips|sportsbook|slot bonus|jackpot bonus|1xbet|mostbet|melbet|pin-?up casino|фриспин|казино бонус|онлайн[- ]?казино|бонус\s+\d+%\s+на\s+(?:первый\s+)?депозит|ставки на спорт|букмекер.*бонус|промокод.*ставк|博彩|菠菜平台|网赌|线上赌场|真人娱乐城|棋牌(?:娱乐|捕鱼)|首存送|注册(?:即)?送(?:彩金|usdt)|百家乐|体育投注|电子游艺|apuestas deportivas.*bono)/i,
    weight: 0.62,
    reason: 'Gambling/betting promo',
    promoCue: true,
  },
  // Crypto pump / VIP signal / airdrop / guaranteed profit scams
  {
    regex: /(?:guaranteed\s+(?:\d+%?\s+)?(?:daily\s+|weekly\s+|monthly\s+)?(?:profit|returns?|roi)|(?:100x|1000x)\s+(?:gem|vip|crypto|coin|profit|signals?)|vip\s+(?:crypto\s+|trading\s+|forex\s+)?signals?|free\s+(?:crypto\s+|trading\s+)?signals?|forex signals?|binary options?|claim (?:your )?airdrop|presale (?:is )?live|pump signal|copy trading.*profit|daily roi|сигналы (?:крипт|трейдинг|вип)|гарантированн(?:ый|ая) доход|памп канал|бесплатные сигналы|арбитраж крипт.*обучен|稳赚不赔|日赚\d+|带单老师|合约带单|现货带单|内部消息.*拉盘|空投领取|免费领u|usdt跑分|搬砖套利|高额返佣|躺赚|保本收益)/i,
    weight: 0.60,
    reason: 'Crypto/trading scam or signal promo',
    promoCue: true,
  },
  // Adult / escort / illicit solicitation
  {
    regex: /(?:escort service|onlyfans leak|vip nudes|adult cams|18\+ vip|слив 18\+|интим услуги|эскорт услуг|同城约炮|楼凤|外围女|空降上门|色情视频|福利姬|免费看片|成人视频.*地址|深夜福利)/i,
    weight: 0.68,
    reason: 'Adult solicitation spam',
    promoCue: true,
  },
  // Illicit / grey-market / VPN / account / brush-order ads
  {
    regex: /(?:刷单兼职|兼职日结|招代理|诚招代理|免费领红包|接码平台|代充|低价出(?:售|号)|出售(?:账号|实名|银行卡|微信号)|稳定机场|高速机场|vpn节点|翻墙节点|机场推荐|科学上网.*优惠码|买粉|刷量|代发广告|引流推广|全网最低价|限时秒杀|下单立减|领券下单|淘宝内部券|京东优惠券|拼多多助力)/i,
    weight: 0.56,
    reason: 'Commercial/grey-market ad',
    promoCue: true,
  },
  // Telegram ad / business contact / DM sales pitch
  {
    regex: /(?:dm\s+(?:me\s+)?(?:for\s+(?:ads?|promo|promotion|price|details|vip)|@[a-zA-Z0-9_]{3,})|contact\s+@\w+\s+for\s+(?:ads?|promo|business|vip|price)|for (?:advertising|promo|collaboration)\s*[:：]?\s*@|по вопросам рекламы\s*[:：]?|купить рекламу|заказать рекламу|писать в лс\s*@|пиши в лс|связаться с менеджером|商务合作\s*[:：]?|广告合作\s*[:：]?|投放广告|私聊(?:领取|咨询|购买|报价|进群)|(?:联系|私信|24小时)客服|加微(?:信)?\s*[:：]?|vx\s*[:：]\s*[a-zA-Z0-9_-]{4,}|whatsapp\s*[:：]?\s*\+?\d{7,})/i,
    weight: 0.44,
    reason: 'Direct sales/ad contact CTA',
    promoCue: true,
  },
  // Promo code / discount / referral blast
  {
    regex: /(?:promo\s*code|coupon\s*code|use code|discount code|sign[- ]?up bonus|welcome bonus|limited[- ]?time offer|get \d{1,2}%\s*off|промокод\s*[:：«"']?\s*[A-Z0-9_-]{3,}|скидка\s*\d{1,2}%|бесплатный доступ по ссылке|получи бонус|забирай бонус|优惠码|折扣码|专属链接|邀请码|限时优惠|首单立减|注册即送|扫码领取|限定クーポン|código promocional)/i,
    weight: 0.44,
    reason: 'Promo code / discount CTA',
    promoCue: true,
  },
  // Cross-channel subscription blast / bot start funnel
  {
    regex: /(?:join (?:our|my|the) (?:vip|private|exclusive|free) (?:channel|group|bot)|subscribe to get (?:free|access|bonus)|click (?:here|below) to (?:join|claim|start)|переходи по ссылке|подписывайся на наш|успей подписаться|доступ открыт на \d+ час|点击(?:下方|链接)(?:加入|领取|进入|立即)|长按识别二维码|扫码进群|限时免费进群)/i,
    weight: 0.36,
    reason: 'Funnel / subscription bait',
    promoCue: true,
  },
];

// Journalism & reporting indicators that prevent flagging genuine news ABOUT scams/crypto/ads
const JOURNALISM_GUARD_REGEX =
  /(?:\b(?:according to|reported|reports say|officials said|police arrested|indicted|charged with|regulator|ministry|central bank|court ruled|lawsuit|investigation|announced today|statement|press release|reuters|bloomberg|associated press|bbc|tass|interfax|xinhua)\b|警方(?:通报|破获|抓获|提醒)|检察院|法院判处|监管部门|证监会|央行|新华社|央视新闻|据报道|官方通报|消息人士称|сообщил|сообщает|задержали|возбуждено уголовное дело|суд признал|центробанк|минфин|по данным|заявил)/i;

const NEWS_DOMAINS = new Set([
  'reuters.com',
  'bloomberg.com',
  'apnews.com',
  'bbc.com',
  'bbc.co.uk',
  'ft.com',
  'wsj.com',
  'nytimes.com',
  'theguardian.com',
  'cnbc.com',
  'economist.com',
  'washingtonpost.com',
  'cnn.com',
  'aljazeera.com',
  'dw.com',
  'france24.com',
  'tass.ru',
  'ria.ru',
  'interfax.ru',
  'rbc.ru',
  'kommersant.ru',
  'xinhuanet.com',
  'news.cn',
  'zaobao.com.sg',
  'scmp.com',
  'nikkei.com',
  'nhk.or.jp',
  'techcrunch.com',
  'theverge.com',
  'wired.com',
  'arstechnica.com',
  'nature.com',
  'science.org',
]);

export function scorePostSpamHeuristic(
  post: Pick<HotPostItem, 'text' | 'cleanSnippet' | 'linkPreview' | 'channelName' | 'channelUsername'>,
  options?: { channelIsSpamAutoClass?: boolean }
): SpamHeuristicResult {
  const rawText = (post.text || post.cleanSnippet || '').trim();
  const lpTitle = (post.linkPreview?.title || '').trim();
  const lpDesc = (post.linkPreview?.description || '').trim();
  const lpUrl = (post.linkPreview?.url || '').trim();
  const lpDomain = (post.linkPreview?.domain || '').trim().toLowerCase().replace(/^www\./, '');
  const combined = `${rawText}\n${lpTitle}\n${lpDesc}`.trim();

  if (!combined) {
    return {
      score: 0,
      label: 'clean',
      reasons: [],
      hasExplicitAdDisclosure: false,
      hasPromoCues: false,
      isNewsGuarded: false,
    };
  }

  let score = 0;
  const reasons: string[] = [];
  let hasExplicitAdDisclosure = false;
  let hasPromoCues = false;

  // 1. Explicit ad disclosures
  for (const pat of EXPLICIT_AD_PATTERNS) {
    if (pat.regex.test(combined)) {
      score = Math.max(score, pat.weight);
      hasExplicitAdDisclosure = true;
      hasPromoCues = true;
      if (!reasons.includes(pat.reason)) reasons.push(pat.reason);
    }
  }

  // 2. High-signal spam & promotional patterns
  let patternHits = 0;
  for (const pat of HIGH_SIGNAL_SPAM_PATTERNS) {
    if (pat.regex.test(combined)) {
      patternHits++;
      score += pat.weight * (patternHits === 1 ? 1 : 0.65);
      if (pat.promoCue) hasPromoCues = true;
      if (!reasons.includes(pat.reason)) reasons.push(pat.reason);
    }
  }

  // 3. Structural signals: Telegram bot/invite/referral URLs + @handle dumps + promo emoji saturation
  const fullUrlBlob = `${rawText} ${lpUrl}`;
  const inviteOrBotLinks =
    fullUrlBlob.match(/(?:t\.me\/(?:\+|joinchat\/|[a-zA-Z0-9_]+bot\b)|[?&](?:start|ref|referral|aff|affiliate|promo|utm_source)=)/gi) ||
    [];
  const httpLinks = fullUrlBlob.match(/https?:\/\/\S+/gi) || [];
  const mentions = rawText.match(/@[a-zA-Z0-9_]{4,}/g) || [];
  const promoEmojis = rawText.match(/[🔥💰🚀💸👇👉🎁✅💎🎰🎲💵💳🛒⚡💯🎉📢🔞]/gu) || [];

  if (inviteOrBotLinks.length >= 1) {
    const boost = inviteOrBotLinks.length >= 2 ? 0.30 : 0.16;
    score += boost;
    hasPromoCues = true;
    reasons.push('Telegram invite/bot/referral link');
  }

  if (httpLinks.length >= 3 && rawText.length < 480 && hasPromoCues) {
    score += 0.18;
    reasons.push('Dense promotional link block');
  }

  if (mentions.length >= 3 && hasPromoCues) {
    score += 0.16;
    reasons.push('Multiple contact handles');
  }

  // Promotional emoji saturation combined with commercial/promo cues
  if (promoEmojis.length >= 5 && (hasPromoCues || inviteOrBotLinks.length > 0)) {
    score += 0.16;
    reasons.push('Promotional emoji density');
  }

  // Channel-level spam prior (mild boost only, never sufficient alone)
  if (options?.channelIsSpamAutoClass) {
    score += 0.14;
    reasons.push('Channel tagged as spam');
  }

  // 4. Strict journalism guard (protects news reports ABOUT scams/crypto/gambling)
  const isNewsDomain = Boolean(lpDomain && NEWS_DOMAINS.has(lpDomain));
  const isNewsText = JOURNALISM_GUARD_REGEX.test(combined);
  const isNewsGuarded = (isNewsDomain || isNewsText) && !hasExplicitAdDisclosure;

  if (isNewsGuarded && score > 0) {
    // Dampen significantly when legitimate reporting context is present and there is no explicit ad tag
    const hasDirectSalesCta = reasons.includes('Direct sales/ad contact CTA') || reasons.includes('Promo code / discount CTA');
    score *= hasDirectSalesCta ? 0.72 : 0.42;
  }

  const clamped = Math.max(0, Math.min(0.99, Number(score.toFixed(3))));
  const label: 'spam' | 'promo' | 'clean' =
    clamped >= 0.68 ? 'spam' : clamped >= 0.40 ? 'promo' : 'clean';

  return {
    score: clamped,
    label,
    reasons: reasons.slice(0, 4),
    hasExplicitAdDisclosure,
    hasPromoCues,
    isNewsGuarded,
  };
}

/**
 * Normalizes body text for detecting coordinated cross-channel ad blasts
 * (identical commercial copy blasted across multiple Telegram channels).
 */
function buildBlastFingerprint(post: HotPostItem): string {
  const cleaned = (post.text || post.cleanSnippet || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/gi, ' <url> ')
    .replace(/t\.me\/\S+/gi, ' <tg> ')
    .replace(/@[a-z0-9_]+/gi, ' <at> ')
    .replace(/[^\p{L}\p{N}<>]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length < 35) return '';
  return fnv1aHash64(cleaned.slice(0, 260));
}

export function evaluateBatchHeuristicSpam(
  posts: HotPostItem[],
  spamChannelKeys?: Set<string>
): Map<string, SpamHeuristicResult> {
  const results = new Map<string, SpamHeuristicResult>();
  const blastGroups = new Map<string, { channels: Set<string>; postKeys: string[] }>();

  for (const post of posts) {
    const chNorm = (post.channelUsername || post.channelName || post.channelId || '')
      .toLowerCase()
      .replace(/^@/, '');
    const channelIsSpamAutoClass = Boolean(spamChannelKeys && chNorm && spamChannelKeys.has(chNorm));
    const res = scorePostSpamHeuristic(post, { channelIsSpamAutoClass });
    results.set(post.key, res);

    // Track cross-channel identical copy for ad-blast detection
    const fp = buildBlastFingerprint(post);
    if (fp) {
      let grp = blastGroups.get(fp);
      if (!grp) {
        grp = { channels: new Set<string>(), postKeys: [] };
        blastGroups.set(fp, grp);
      }
      if (chNorm) grp.channels.add(chNorm);
      grp.postKeys.push(post.key);
    }
  }

  // Coordinated cross-channel ad-blast boost:
  // If >=2 distinct channels post the EXACT same copy AND it carries promo/invite cues (and isn't news-guarded),
  // boost its spam score so paid ad networks don't masquerade as top clusters.
  for (const grp of blastGroups.values()) {
    if (grp.channels.size < 2) continue;
    for (const key of grp.postKeys) {
      const r = results.get(key);
      if (!r || !r.hasPromoCues || r.isNewsGuarded) continue;
      const blastBoost = grp.channels.size >= 3 ? 0.30 : 0.20;
      const boosted = Math.min(0.98, Number((r.score + blastBoost).toFixed(3)));
      r.score = boosted;
      r.label = boosted >= 0.68 ? 'spam' : boosted >= 0.40 ? 'promo' : 'clean';
      if (!r.reasons.includes('Cross-channel promo blast')) {
        r.reasons.push('Cross-channel promo blast');
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Layer 2: Client-Side Local Neural Semantic Spam Classifier (MiniLM Prototypes)
// ---------------------------------------------------------------------------

export interface SpamPrototypeItem {
  category: string;
  text: string;
}

/**
 * Curated multilingual spam/ad prototype anchors embedded once by the local
 * `Xenova/paraphrase-multilingual-MiniLM-L12-v2` ONNX model in the Web Worker.
 */
export const SPAM_PROTOTYPE_ITEMS: SpamPrototypeItem[] = [
  // English spam & promotional exemplars
  {
    category: 'Sponsored Ad',
    text: 'Sponsored promotion: get 50% off discount with promo code today, click the link below to claim your exclusive limited time offer.',
  },
  {
    category: 'Crypto/Trading Scam',
    text: 'Join our VIP crypto trading signals channel for guaranteed daily profits, 100x altcoin gems, free airdrop claim and presale access.',
  },
  {
    category: 'Gambling Promo',
    text: 'Register now at our online casino and sportsbook to receive 200 free spins, welcome deposit bonus, and VIP betting tips.',
  },
  {
    category: 'Channel Cross-Promo',
    text: 'Subscribe to our exclusive private Telegram channel and start our bot now for free bonuses, giveaways, and advertising inquiries DM manager.',
  },
  {
    category: 'Adult/Escort Spam',
    text: 'Exclusive 18+ adult VIP leaks, private escort services, dating meetup, message our bot now for instant private access.',
  },
  {
    category: 'Fake Job/Sales Pitch',
    text: 'Earn $500 daily working from home with zero experience, guaranteed payout, contact us on WhatsApp or Telegram for recruitment details.',
  },
  // Chinese spam & promotional exemplars
  {
    category: '广告推广',
    text: '【广告推广】限时优惠特价促销，输入专属优惠码立减折扣，点击下方链接立即注册领取新人福利大礼包，商务合作联系客服。',
  },
  {
    category: '币圈带单/杀猪盘',
    text: '专业带单老师内部消息精准拉盘，合约现货稳赚不赔日赚千元，免费领取USDT空投福利，私聊进VIP交流群一起搬砖套利。',
  },
  {
    category: '博彩棋牌广告',
    text: '顶级线上博彩娱乐平台，注册即送体验彩金，首存高额返佣，体育投注百家乐棋牌电子游艺全天秒提现，点击链接立即开户。',
  },
  {
    category: '灰产/机场/兼职刷单',
    text: '高速稳定VPN科学上网机场节点低价促销，诚招代理高额返佣，兼职刷单日结工资，出售实名账号接码代充，加微信私聊报价。',
  },
  {
    category: '色情引流广告',
    text: '同城约炮楼凤空降上门服务，海量成人免费视频深夜福利群，点击链接或扫码立即进群观看。',
  },
  // Russian spam & promotional exemplars
  {
    category: 'Реклама / Промо',
    text: 'Реклама. Используй промокод на скидку 50% и получи бесплатный бонус при регистрации, переходи по ссылке и забирай предложение erid.',
  },
  {
    category: 'Крипто-сигналы / Скам',
    text: 'Бесплатные VIP сигналы по криптовалюте и трейдингу, гарантированный доход каждый день, вступай в закрытый канал и пиши менеджеру в ЛС.',
  },
  {
    category: 'Казино / Ставки',
    text: 'Онлайн казино и букмекерская контора дарит фриспины и бонус на первый депозит, лучшие ставки на спорт по промокоду по ссылке.',
  },
  {
    category: 'Взаимопиар / Бот-реклама',
    text: 'Подписывайся на наш закрытый Telegram канал и запускай бота, доступ открыт только 24 часа, по вопросам рекламы пишите менеджеру.',
  },
];

/**
 * Contrastive legitimate news, analysis, and commentary anchors to ensure
 * genuine news (including reporting ABOUT scams, crypto, or regulations) stays clean.
 */
export const LEGIT_PROTOTYPE_TEXTS: string[] = [
  'Breaking news: government officials and parliament announced new economic policy measures and international diplomacy talks today.',
  'Financial markets update: central bank interest rate decision impacts stock indices, bond yields, inflation data, and quarterly corporate earnings.',
  'Technology and science report: researchers published a new artificial intelligence model benchmark and semiconductor hardware architecture.',
  'Security and law enforcement report: police and financial regulators charged suspects in a major online fraud and cryptocurrency scam investigation.',
  'Military and geopolitical briefing: defense ministry issued an official operational update regarding regional border developments and negotiations.',
  '突发新闻：政府部门发布最新政策公告，外交代表团举行双边会谈讨论贸易与地缘局势。',
  '财经市场报道：央行公布最新利率决议，股市与汇率出现波动，多家科技企业发布季度财报数据。',
  '警方与监管通报：公安机关成功破获特大跨境网络诈骗与非法赌博案件，提醒公众谨防电信诈骗。',
  '科技前沿资讯：人工智能大模型与芯片产业迎来重要技术突破，研究团队开源最新算法框架。',
  'Срочные новости: правительство и министерство иностранных дел сделали официальное заявление по итогам переговоров и экономической политики.',
  'Финансовая аналитика: центральный банк прокомментировал уровень инфляции, курс валют и ситуацию на фондовом рынке.',
  'Правоохранительные органы сообщили о задержании группы мошенников и предупредили граждан о новых схемах обмана в сети.',
];

export const SPAM_PROTOTYPE_TEXTS: string[] = SPAM_PROTOTYPE_ITEMS.map((p) => p.text);

/**
 * Scores a single L2-normalized post embedding against cached spam & legitimate prototype vectors.
 * Runs in <0.02ms per post inside the Web Worker.
 */
export function scoreVectorAgainstSpamPrototypes(
  postVec: Float32Array,
  spamProtoVecs: Float32Array[],
  legitProtoVecs: Float32Array[]
): Omit<SemanticSpamScore, 'postKey'> {
  if (!postVec || spamProtoVecs.length === 0 || legitProtoVecs.length === 0) {
    return { neuralScore: 0, maxSpamSim: 0, maxLegitSim: 0, margin: 0 };
  }

  let top1Spam = -1;
  let top2Spam = -1;
  let bestSpamIdx = 0;

  for (let i = 0; i < spamProtoVecs.length; i++) {
    const sim = dotProductVectors(postVec, spamProtoVecs[i]);
    if (sim > top1Spam) {
      top2Spam = top1Spam;
      top1Spam = sim;
      bestSpamIdx = i;
    } else if (sim > top2Spam) {
      top2Spam = sim;
    }
  }

  let top1Legit = -1;
  let top2Legit = -1;
  for (let i = 0; i < legitProtoVecs.length; i++) {
    const sim = dotProductVectors(postVec, legitProtoVecs[i]);
    if (sim > top1Legit) {
      top2Legit = top1Legit;
      top1Legit = sim;
    } else if (sim > top2Legit) {
      top2Legit = sim;
    }
  }

  const spamMean = top2Spam > -0.5 ? 0.65 * top1Spam + 0.35 * top2Spam : top1Spam;
  const legitMean = top2Legit > -0.5 ? 0.65 * top1Legit + 0.35 * top2Legit : top1Legit;
  const margin = spamMean - legitMean;

  // Calibrated probability mapping:
  // A genuine spam post typically exhibits BOTH high absolute similarity to spam prototypes (>=0.42)
  // AND a positive margin over legitimate news/editorial prototypes.
  let neuralScore = 0;
  if (top1Spam >= 0.34) {
    // Logistic curve centered at margin = +0.06, modulated by absolute spam similarity strength
    const marginProb = 1 / (1 + Math.exp(-(margin - 0.055) * 14));
    const absGate = Math.max(0, Math.min(1, (top1Spam - 0.32) / 0.28));
    neuralScore = marginProb * (0.35 + 0.65 * absGate);
  }

  return {
    neuralScore: Number(Math.max(0, Math.min(0.99, neuralScore)).toFixed(3)),
    maxSpamSim: Number(top1Spam.toFixed(3)),
    maxLegitSim: Number(top1Legit.toFixed(3)),
    margin: Number(margin.toFixed(3)),
    matchedCategory: SPAM_PROTOTYPE_ITEMS[bestSpamIdx]?.category,
  };
}

/**
 * Fuses Layer 1 heuristic score with Layer 2 local neural semantic score cleanly.
 */
export function fuseLocalSpamScores(
  heuristic: SpamHeuristicResult,
  semantic?: SemanticSpamScore | null,
  threshold: number = 0.68
): {
  spamScore: number;
  isSpam: boolean;
  label: 'spam' | 'promo' | 'clean';
  source: HotsSpamSource;
  reasons: string[];
} {
  const reasons = [...heuristic.reasons];

  if (!semantic) {
    return {
      spamScore: heuristic.score,
      isSpam: heuristic.score >= threshold,
      label: heuristic.score >= threshold ? 'spam' : heuristic.score >= 0.40 ? 'promo' : 'clean',
      source: 'rule',
      reasons,
    };
  }

  let fused: number;

  if (heuristic.hasExplicitAdDisclosure) {
    // Explicit disclosure (#广告 / erid: / #реклама / #sponsored) is authoritative
    fused = Math.max(heuristic.score, 0.85);
  } else if (heuristic.score >= 0.40 && semantic.neuralScore >= 0.50) {
    // Both heuristics and local neural agree -> strong confidence boost
    fused = Math.min(0.98, Math.max(heuristic.score, semantic.neuralScore) + 0.14);
  } else if (semantic.neuralScore >= 0.74 && semantic.margin >= 0.10 && !heuristic.isNewsGuarded) {
    // Obfuscated or keyword-free spam strongly caught by local neural semantics
    fused = Math.max(semantic.neuralScore, heuristic.score * 0.35 + semantic.neuralScore * 0.72);
  } else if (semantic.margin <= -0.08 && heuristic.score < 0.78) {
    // Local neural strongly recognizes legitimate news/editorial -> dampen borderline rule hits
    fused = heuristic.score * 0.62 + semantic.neuralScore * 0.25;
  } else {
    fused = heuristic.score * 0.58 + semantic.neuralScore * 0.42;
  }

  fused = Number(Math.max(0, Math.min(0.99, fused)).toFixed(3));

  if (semantic.neuralScore >= 0.55 && semantic.matchedCategory) {
    const neuralTag = `Local AI: ${semantic.matchedCategory}`;
    if (!reasons.includes(neuralTag)) {
      reasons.unshift(neuralTag);
    }
  }

  const usedNeural = semantic.neuralScore >= 0.45 || Math.abs(fused - heuristic.score) >= 0.08;
  return {
    spamScore: fused,
    isSpam: fused >= threshold,
    label: fused >= threshold ? 'spam' : fused >= 0.40 ? 'promo' : 'clean',
    source: usedNeural ? 'local-neural' : 'rule',
    reasons: reasons.slice(0, 4),
  };
}

// ---------------------------------------------------------------------------
// Layer 3: Kev SystemOne API Remote Post Spam Tagger
/**
 * Determines whether a post is genuinely ambiguous / difficult for Local Rule + Local AI
 * to judge on its own (used by Hybrid mode so SystemOne API is ONLY called on truly
 * uncertain posts rather than clearly clean or clearly spam posts).
 */
export function isPostAmbiguousForLocalSpam(
  heuristic: SpamHeuristicResult,
  semantic: SemanticSpamScore | null | undefined,
  fusedScore: number,
  threshold: number
): { ambiguous: boolean; uncertaintyPriority: number } {
  // Explicit ad disclosures (erid, #ad, #广告, #реклама) are already certain spam
  if (heuristic.hasExplicitAdDisclosure) {
    return { ambiguous: false, uncertaintyPriority: 0 };
  }

  // Protected news articles with sub-threshold scores are clearly legitimate
  if (heuristic.isNewsGuarded && fusedScore < threshold - 0.06) {
    return { ambiguous: false, uncertaintyPriority: 0 };
  }

  // Case 1: Score falls inside the narrow uncertainty band straddling the decision boundary
  const lowBand = Math.max(0.42, threshold - 0.14);
  const highBand = Math.min(0.86, threshold + 0.08);
  const inBoundaryBand = fusedScore >= lowBand && fusedScore < highBand;

  // Case 2: Strong disagreement between Local Rule and Local Neural AI
  let hasLayerConflict = false;
  let conflictStrength = 0;
  if (semantic) {
    if (semantic.neuralScore >= 0.68 && heuristic.score < 0.25 && !heuristic.isNewsGuarded) {
      hasLayerConflict = true;
      conflictStrength = semantic.neuralScore - heuristic.score;
    } else if (heuristic.score >= 0.48 && heuristic.score < 0.78 && semantic.neuralScore <= 0.28) {
      hasLayerConflict = true;
      conflictStrength = heuristic.score - semantic.neuralScore;
    }
  }

  if (!inBoundaryBand && !hasLayerConflict) {
    return { ambiguous: false, uncertaintyPriority: 0 };
  }

  // Priority favors posts closest to the decision threshold and with strongest rule/AI conflict
  const distToThreshold = Math.abs(fusedScore - threshold);
  const boundaryPriority = inBoundaryBand ? Math.max(0, 1 - distToThreshold * 4) : 0;
  const priority = Number((boundaryPriority + conflictStrength * 0.6).toFixed(3));
  return { ambiguous: true, uncertaintyPriority: priority };
}

// ---------------------------------------------------------------------------
// Layer 3: Kev SystemOne API Remote High-Precision Spam Tagger (Single-Post)
// ---------------------------------------------------------------------------

export const SYSTEM_ONE_POST_SPAM_QUESTIONS = {
  spam_check: {
    type: 'choice',
    instructions:
      'Determine whether this single Telegram post is spam/unsolicited advertisement/scam, low-value self-promotion, or legitimate news/informational content.',
    criteria: {
      spam: 'unsolicited advertisement, paid sponsored promotion (erid, #ad, #广告, #реклама), gambling/casino/betting ad, crypto pump/airdrop/VIP trading signals scam, phishing, adult/escort solicitation, VPN/account selling, fake job/brush-order recruitment, or bulk affiliate sales spam',
      promotional: 'channel cross-promotion, giveaway/contest funnel, discount coupon blast, or direct commercial product sales pitch without substantive news value',
      legitimate: 'substantive news reporting, geopolitical or financial analysis, tech/science update, official statement, commentary, or journalism (including news articles reporting ABOUT scams, crypto fraud, or regulations)',
    },
  },
};

export async function classifyPostWithSystemOne(
  post: HotPostItem,
  signal?: AbortSignal
): Promise<{
  spamScore: number;
  label: 'spam' | 'promo' | 'clean';
  reason: string;
}> {
  const prep = buildPostEmbeddingInput(post);
  const rawSnippet = (post.text || post.cleanSnippet || prep.text || '').trim().slice(0, 650);
  // Always send a single-post object (never a batch array) so the classification maps 1-to-1 to this post
  const state = {
    channel: post.channelName || post.channelUsername || '',
    text: rawSnippet,
    linkTitle: post.linkPreview?.title ? post.linkPreview.title.slice(0, 140) : undefined,
    linkDomain: post.linkPreview?.domain || undefined,
  };

  const response = await callSystemOne<any>(state, SYSTEM_ONE_POST_SPAM_QUESTIONS, {
    timeoutMs: 25_000,
    signal,
  });

  const ans =
    response?.answers?.spam_check ||
    response?.res?.answers?.spam_check ||
    response?.answers?.L1 ||
    response?.answers;

  let choice = '';
  let confidence = 0;
  let probs: Record<string, number> | null = null;

  if (typeof ans === 'string') {
    choice = ans.trim().toLowerCase();
    confidence = 0.85;
  } else if (ans && typeof ans === 'object') {
    choice = String(ans.choice || ans.category || ans.class || '').trim().toLowerCase();
    if (typeof ans.confidence === 'number') {
      confidence = ans.confidence;
    }
    if (ans.probabilities && typeof ans.probabilities === 'object') {
      probs = ans.probabilities;
    }
  }

  let spamScore = 0;
  if (probs) {
    const pSpam = Number(probs.spam ?? 0);
    const pPromo = Number(probs.promotional ?? probs.promo ?? 0);
    const pLegit = Number(probs.legitimate ?? probs.ham ?? probs.clean ?? 0);
    spamScore = Math.min(0.99, Math.max(0, pSpam + pPromo * 0.72));
    // Guard against missing probability keys
    if (pSpam === 0 && pPromo === 0 && pLegit === 0) {
      spamScore = choice === 'spam' ? Math.max(0.78, confidence) : choice === 'promotional' ? Math.max(0.55, confidence * 0.75) : 0.08;
    }
  } else if (choice === 'spam') {
    spamScore = Math.max(0.78, Math.min(0.99, confidence || 0.85));
  } else if (choice === 'promotional' || choice === 'promo') {
    spamScore = Math.max(0.54, Math.min(0.84, (confidence || 0.75) * 0.78));
  } else {
    spamScore = Math.max(0.02, Math.min(0.25, 1 - (confidence || 0.85)));
  }

  spamScore = Number(spamScore.toFixed(3));
  const label: 'spam' | 'promo' | 'clean' =
    spamScore >= 0.68 ? 'spam' : spamScore >= 0.42 ? 'promo' : 'clean';
  const reason =
    choice === 'spam'
      ? `SystemOne: Spam (${Math.round(spamScore * 100)}%)`
      : choice === 'promotional'
        ? `SystemOne: Promotional (${Math.round(spamScore * 100)}%)`
        : `SystemOne: Legitimate (${Math.round((1 - spamScore) * 100)}%)`;

  return { spamScore, label, reason };
}

export async function classifyPostsWithSystemOneBatch(
  posts: HotPostItem[],
  options: {
    threshold: number;
    concurrency?: number;
    signal?: AbortSignal;
    onProgress?: (done: number, total: number) => void;
  }
): Promise<Map<string, SpamEvaluationResult>> {
  const results = new Map<string, SpamEvaluationResult>();
  if (!Array.isArray(posts) || posts.length === 0) return results;

  const concurrency = Math.max(1, Math.min(4, options.concurrency ?? 3));
  const total = posts.length;
  let nextIdx = 0;
  let completed = 0;

  const workerLoop = async () => {
    while (nextIdx < total) {
      if (options.signal?.aborted) return;
      const idx = nextIdx++;
      const post = posts[idx];
      if (!post) continue;

      try {
        const res = await classifyPostWithSystemOne(post, options.signal);
        const evaluation: SpamEvaluationResult = {
          postKey: post.key,
          contentHash: computeSpamContentHash(post),
          spamScore: res.spamScore,
          isSpam: res.spamScore >= options.threshold,
          label: res.label,
          source: 'systemone',
          reasons: [res.reason],
          systemOneScore: res.spamScore,
          updatedAt: Date.now(),
        };
        results.set(post.key, evaluation);
        // Persist immediately per-post so completed SystemOne verdicts are never lost if aborted
        await saveCachedSpamEvaluations([evaluation]);
      } catch (err: unknown) {
        if (options.signal?.aborted || (err as { name?: string })?.name === 'AbortError') {
          return;
        }
        // Non-fatal: skip failed remote post so local score remains active
      } finally {
        completed++;
        options.onProgress?.(completed, total);
      }
    }
  };

  const workers = Array.from({ length: Math.min(concurrency, total) }, () => workerLoop());
  await Promise.all(workers);

  return results;
}

// ---------------------------------------------------------------------------
// Persistent IndexedDB Spam Classification & User Override Store
// ---------------------------------------------------------------------------

const SPAM_DB_NAME = 'GingkoHotsSpamDB';
const SPAM_DB_VERSION = 1;
const STORE_SPAM_VERDICTS = 'post_spam_verdicts';
const MAX_CACHED_SPAM_RECORDS = 20_000;
const MAX_SPAM_RECORD_AGE_MS = 30 * 24 * 3600 * 1000;

function openSpamDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(SPAM_DB_NAME, SPAM_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_SPAM_VERDICTS)) {
        const store = db.createObjectStore(STORE_SPAM_VERDICTS, { keyPath: 'postKey' });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open Hots Spam DB'));
  });
}

export async function getCachedSpamEvaluations(
  items: Array<{ postKey: string; contentHash: string }>
): Promise<Map<string, SpamEvaluationResult>> {
  const result = new Map<string, SpamEvaluationResult>();
  if (typeof indexedDB === 'undefined' || !Array.isArray(items) || items.length === 0) {
    return result;
  }

  try {
    const db = await openSpamDb();
    try {
      const expectedHashes = new Map<string, string>();
      for (const it of items) {
        expectedHashes.set(it.postKey, it.contentHash);
      }

      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_SPAM_VERDICTS, 'readonly');
        const store = tx.objectStore(STORE_SPAM_VERDICTS);

        if (items.length > 250) {
          const req = store.getAll();
          req.onsuccess = () => {
            const rows = (req.result || []) as SpamEvaluationResult[];
            for (const row of rows) {
              if (!row) continue;
              const expectedHash = expectedHashes.get(row.postKey);
              if (expectedHash && (row.userOverride || row.contentHash === expectedHash)) {
                result.set(row.postKey, row);
              }
            }
            resolve();
          };
          req.onerror = () => reject(req.error);
        } else {
          for (const it of items) {
            const req = store.get(it.postKey);
            req.onsuccess = () => {
              const row = req.result as SpamEvaluationResult | undefined;
              if (row && (row.userOverride || row.contentHash === it.contentHash)) {
                result.set(it.postKey, row);
              }
            };
          }
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        }
      });
    } finally {
      db.close();
    }
  } catch {
    // Graceful fallback when IndexedDB is unavailable
  }

  return result;
}

export async function saveCachedSpamEvaluations(
  records: SpamEvaluationResult[]
): Promise<void> {
  if (typeof indexedDB === 'undefined' || !Array.isArray(records) || records.length === 0) {
    return;
  }
  try {
    const db = await openSpamDb();
    try {
      const now = Date.now();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_SPAM_VERDICTS, 'readwrite');
        const store = tx.objectStore(STORE_SPAM_VERDICTS);
        for (const rec of records) {
          if (!rec?.postKey) continue;
          store.put({ ...rec, updatedAt: rec.updatedAt || now });
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      await pruneSpamStoreIfNeeded(db);
    } finally {
      db.close();
    }
  } catch {
    // Ignore storage quota errors
  }
}

async function pruneSpamStoreIfNeeded(db: IDBDatabase): Promise<void> {
  try {
    const count = await new Promise<number>((resolve, reject) => {
      const tx = db.transaction(STORE_SPAM_VERDICTS, 'readonly');
      const req = tx.objectStore(STORE_SPAM_VERDICTS).count();
      req.onsuccess = () => resolve(req.result || 0);
      req.onerror = () => reject(req.error);
    });
    if (count <= MAX_CACHED_SPAM_RECORDS) return;

    const cutoff = Date.now() - MAX_SPAM_RECORD_AGE_MS;
    const excessTarget = count - Math.floor(MAX_CACHED_SPAM_RECORDS * 0.85);
    let deleted = 0;

    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_SPAM_VERDICTS, 'readwrite');
      const store = tx.objectStore(STORE_SPAM_VERDICTS);
      const index = store.index('updatedAt');
      const cursorReq = index.openCursor();
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) return;
        const row = cursor.value as SpamEvaluationResult;
        // Preserve manual user overrides during LRU eviction
        if (!row.userOverride && (deleted < excessTarget || (row.updatedAt || 0) < cutoff)) {
          cursor.delete();
          deleted++;
        }
        cursor.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // ignore
  }
}

export async function setPostSpamOverride(
  postKey: string,
  contentHash: string,
  override: 'ham' | 'spam' | null
): Promise<void> {
  if (typeof indexedDB === 'undefined' || !postKey) return;
  try {
    const db = await openSpamDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_SPAM_VERDICTS, 'readwrite');
        const store = tx.objectStore(STORE_SPAM_VERDICTS);
        if (override === null) {
          store.delete(postKey);
        } else {
          const rec: SpamEvaluationResult = {
            postKey,
            contentHash,
            spamScore: override === 'spam' ? 1 : 0,
            isSpam: override === 'spam',
            label: override === 'spam' ? 'spam' : 'clean',
            source: 'override',
            reasons: [override === 'ham' ? 'Restored by user (Not Spam)' : 'Marked as spam by user'],
            userOverride: override,
            updatedAt: Date.now(),
          };
          store.put(rec);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  } catch {
    // ignore
  }
}

export async function getSpamCacheStats(): Promise<SpamCacheStats> {
  if (typeof indexedDB === 'undefined') {
    return { totalRecords: 0, spamRecords: 0, systemOneRecords: 0, overrideRecords: 0 };
  }
  try {
    const db = await openSpamDb();
    try {
      return await new Promise<SpamCacheStats>((resolve) => {
        const tx = db.transaction(STORE_SPAM_VERDICTS, 'readonly');
        const req = tx.objectStore(STORE_SPAM_VERDICTS).getAll();
        req.onsuccess = () => {
          const rows = (req.result || []) as SpamEvaluationResult[];
          let spamRecords = 0;
          let systemOneRecords = 0;
          let overrideRecords = 0;
          for (const r of rows) {
            if (r.isSpam) spamRecords++;
            if (r.source === 'systemone' || typeof r.systemOneScore === 'number') systemOneRecords++;
            if (r.userOverride) overrideRecords++;
          }
          resolve({
            totalRecords: rows.length,
            spamRecords,
            systemOneRecords,
            overrideRecords,
          });
        };
        req.onerror = () =>
          resolve({ totalRecords: 0, spamRecords: 0, systemOneRecords: 0, overrideRecords: 0 });
      });
    } finally {
      db.close();
    }
  } catch {
    return { totalRecords: 0, spamRecords: 0, systemOneRecords: 0, overrideRecords: 0 };
  }
}

export async function clearSpamEvaluationCache(preserveUserOverrides: boolean = true): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  try {
    const db = await openSpamDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_SPAM_VERDICTS, 'readwrite');
        const store = tx.objectStore(STORE_SPAM_VERDICTS);
        if (!preserveUserOverrides) {
          store.clear();
        } else {
          const cursorReq = store.openCursor();
          cursorReq.onsuccess = () => {
            const cursor = cursorReq.result;
            if (!cursor) return;
            const row = cursor.value as SpamEvaluationResult;
            if (!row.userOverride) {
              cursor.delete();
            }
            cursor.continue();
          };
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  } catch {
    // ignore
  }
}
