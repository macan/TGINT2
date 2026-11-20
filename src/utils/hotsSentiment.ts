/**
 * Multilingual Sentiment Analysis Engine for Listen Tab Hot Topic Clusters.
 *
 * Evaluates grouped Telegram posts across English, Chinese (Simplified & Traditional),
 * Russian, Japanese, Spanish/European languages, and common sentiment emojis, handling
 * local negation cues and engagement-weighted cluster aggregation.
 */

export type TopicSentimentLabel = 'positive' | 'neutral' | 'negative';

export interface TopicSentimentBreakdown {
  positive: number;
  neutral: number;
  negative: number;
}

export interface TopicSentimentSummary {
  label: TopicSentimentLabel;
  /** Normalized polarity score in [-1, 1] */
  score: number;
  counts: TopicSentimentBreakdown;
}

export interface SentimentPostInput {
  text?: string;
  cleanSnippet?: string;
  views?: number;
  linkPreview?: {
    title?: string;
    description?: string;
  };
}

// ---------------------------------------------------------------------------
// Lexicons (weights: 1 = mild/moderate polarity, 2 = strong polarity)
// ---------------------------------------------------------------------------

const EN_POSITIVE_WORDS: Record<string, number> = {
  // Strong positive
  breakthrough: 2,
  surge: 2,
  surges: 2,
  surged: 2,
  soar: 2,
  soars: 2,
  soared: 2,
  skyrocket: 2,
  skyrocketed: 2,
  milestone: 2,
  triumph: 2,
  victory: 2,
  ceasefire: 2,
  peace: 2,
  bullish: 2,
  rally: 2,
  rallies: 2,
  rallied: 2,
  outperform: 2,
  outperformed: 2,
  excellent: 2,
  amazing: 2,
  awesome: 2,
  outstanding: 2,
  revolutionary: 2,
  unprecedented: 1,
  success: 2,
  successful: 2,
  succeed: 2,
  succeeded: 2,
  approved: 2,
  approval: 2,
  win: 2,
  wins: 2,
  won: 2,
  winner: 2,
  celebrate: 2,
  celebrates: 2,
  celebration: 2,
  recovery: 2,
  rebound: 2,
  rebounds: 2,
  rebounded: 2,
  boom: 2,
  booming: 2,
  profit: 2,
  profits: 2,
  profitable: 2,
  innovative: 2,
  innovation: 2,
  rescue: 2,
  rescued: 2,
  saved: 2,
  // Moderate positive
  growth: 1.5,
  grow: 1,
  grows: 1,
  grew: 1,
  growing: 1,
  gain: 1.5,
  gains: 1.5,
  gained: 1.5,
  boost: 1.5,
  boosts: 1.5,
  boosted: 1.5,
  upgrade: 1.5,
  upgraded: 1.5,
  improve: 1.5,
  improves: 1.5,
  improved: 1.5,
  improvement: 1.5,
  strong: 1,
  stronger: 1.5,
  strongest: 2,
  positive: 1.5,
  optimistic: 1.5,
  optimism: 1.5,
  confidence: 1,
  confident: 1,
  partnership: 1.5,
  partnered: 1.5,
  agreement: 1.5,
  deal: 1,
  award: 1.5,
  awarded: 1.5,
  great: 1.5,
  good: 1,
  better: 1.5,
  best: 2,
  faster: 1,
  fastest: 1.5,
  free: 1,
  support: 1,
  supported: 1,
  supports: 1,
  funding: 1,
  raised: 1,
  invest: 1,
  investment: 1,
  relief: 1.5,
  stabilize: 1.5,
  stabilized: 1.5,
  stable: 1,
  launch: 1,
  launched: 1,
  launches: 1,
  expand: 1,
  expanded: 1,
  expansion: 1,
  dividend: 1.5,
  love: 1.5,
  happy: 1.5,
  excited: 1.5,
  exciting: 1.5,
  promising: 1.5,
  helpful: 1,
  benefit: 1,
  benefits: 1,
  safe: 1,
  safer: 1.5,
  resolved: 1.5,
  solved: 1.5,
  opportunity: 1,
  opportunities: 1,
  progress: 1.5,
  achieve: 1.5,
  achieved: 1.5,
  achievement: 1.5,
  rise: 1,
  rises: 1,
  rose: 1,
  rising: 1,
  record: 0.75,
  up: 0.5,
};

const EN_NEGATIVE_WORDS: Record<string, number> = {
  // Strong negative
  crash: 2,
  crashes: 2,
  crashed: 2,
  crashing: 2,
  plunge: 2,
  plunges: 2,
  plunged: 2,
  collapse: 2,
  collapses: 2,
  collapsed: 2,
  hack: 2,
  hacked: 2,
  hacker: 2,
  hackers: 2,
  breach: 2,
  breached: 2,
  exploit: 2,
  exploited: 2,
  scam: 2,
  scammer: 2,
  fraud: 2,
  fraudulent: 2,
  bankrupt: 2,
  bankruptcy: 2,
  layoff: 2,
  layoffs: 2,
  fired: 1.5,
  war: 2,
  warfare: 2,
  attack: 2,
  attacks: 2,
  attacked: 2,
  airstrike: 2,
  airstrikes: 2,
  missile: 2,
  missiles: 2,
  bomb: 2,
  bombing: 2,
  explosion: 2,
  killed: 2,
  kill: 2,
  kills: 2,
  dead: 2,
  death: 2,
  deaths: 2,
  fatal: 2,
  casualties: 2,
  massacre: 2,
  terror: 2,
  terrorist: 2,
  disaster: 2,
  catastrophe: 2,
  catastrophic: 2,
  crisis: 2,
  recession: 2,
  bearish: 2,
  panic: 2,
  liquidation: 2,
  liquidated: 2,
  liquidations: 2,
  selloff: 2,
  outage: 2,
  outages: 2,
  vulnerability: 2,
  vulnerable: 1.5,
  ransomware: 2,
  malware: 2,
  terrible: 2,
  horrible: 2,
  worst: 2,
  fail: 1.5,
  fails: 1.5,
  failed: 2,
  failure: 2,
  corrupt: 2,
  corruption: 2,
  scandal: 2,
  arrest: 2,
  arrested: 2,
  indicted: 2,
  indictment: 2,
  convicted: 2,
  guilty: 2,
  sued: 1.5,
  lawsuit: 1.5,
  sanction: 1.5,
  sanctions: 1.5,
  sanctioned: 1.5,
  ban: 1.5,
  banned: 1.5,
  bans: 1.5,
  // Moderate negative
  loss: 1.5,
  losses: 1.5,
  lost: 1,
  lose: 1,
  slump: 1.5,
  slumps: 1.5,
  tumble: 1.5,
  tumbles: 1.5,
  tumbled: 1.5,
  drop: 1.25,
  drops: 1.25,
  dropped: 1.25,
  decline: 1.5,
  declines: 1.5,
  declined: 1.5,
  fell: 1.25,
  fall: 1,
  falling: 1,
  inflation: 1.25,
  deficit: 1.25,
  default: 1.5,
  debt: 1,
  warning: 1.5,
  warn: 1,
  warns: 1,
  warned: 1,
  threat: 1.5,
  threats: 1.5,
  threaten: 1.5,
  threatened: 1.5,
  danger: 1.5,
  dangerous: 1.5,
  risk: 1,
  risks: 1,
  risky: 1.25,
  conflict: 1.5,
  clash: 1.5,
  clashes: 1.5,
  protest: 1,
  protests: 1,
  riot: 2,
  riots: 2,
  earthquake: 1.5,
  flood: 1.5,
  flooding: 1.5,
  wildfire: 1.5,
  emergency: 1.5,
  evacuate: 1.5,
  evacuation: 1.5,
  injured: 1.5,
  wounded: 1.5,
  leak: 1.25,
  leaked: 1.25,
  delay: 1,
  delayed: 1.25,
  cancel: 1.25,
  canceled: 1.25,
  cancelled: 1.25,
  fine: 1.25,
  fined: 1.5,
  penalty: 1.5,
  penalties: 1.5,
  blocked: 1.25,
  shutdown: 1.5,
  shortage: 1.5,
  shortages: 1.5,
  bug: 1,
  bugs: 1,
  broken: 1.5,
  flaw: 1.5,
  flaws: 1.5,
  error: 1,
  errors: 1,
  strike: 1.5,
  strikes: 1.5,
  tension: 1.25,
  tensions: 1.25,
  dispute: 1,
  concern: 1,
  concerns: 1,
  worried: 1.25,
  fear: 1.5,
  fears: 1.5,
  bad: 1.5,
  worse: 1.5,
  poor: 1.25,
  weak: 1.25,
  weaker: 1.5,
  tariff: 1,
  tariffs: 1,
  downgrade: 1.5,
  downgraded: 1.5,
  down: 0.5,
};

const EN_PHRASES: Array<[RegExp, number]> = [
  [/\brecord\s+highs?\b/gi, 2],
  [/\ball[- ]time\s+high\b/gi, 2],
  [/\bopen[- ]source[d]?\b/gi, 1.2],
  [/\bpeace\s+(?:deal|talks|agreement|treaty)\b/gi, 2],
  [/\binterest\s+rate\s+cut\b/gi, 1],
  [/\brug\s+pull\b/gi, -2.5],
  [/\brecord\s+lows?\b/gi, -2],
  [/\ball[- ]time\s+low\b/gi, -2],
  [/\bdata\s+breach\b/gi, -2.5],
  [/\bsecurity\s+flaw\b/gi, -2],
  [/\bmarket\s+crash\b/gi, -2.5],
  [/\bprice\s+drop\b/gi, -1.2],
  [/\bno\s+casualties\b/gi, 1.5],
  [/\bno\s+injuries\b/gi, 1.5],
];

const EN_NEGATORS = new Set([
  'not',
  'no',
  'never',
  'without',
  'hardly',
  'barely',
  'neither',
  'nor',
  "isn't",
  "aren't",
  "wasn't",
  "weren't",
  "don't",
  "doesn't",
  "didn't",
  "won't",
  "can't",
  'cannot',
  'avoids',
  'avoided',
  'prevent',
  'prevented',
  'averted',
]);

// Chinese (Simplified + Traditional) phrases
const ZH_POSITIVE_PHRASES: Array<[string, number]> = [
  ['创新高', 2], ['創新高', 2], ['历史新高', 2], ['歷史新高', 2],
  ['暴涨', 2], ['暴漲', 2], ['大涨', 2], ['大漲', 2], ['飙升', 2], ['飆升', 2],
  ['突破', 1.8], ['利好', 2], ['牛市', 2], ['反弹', 1.5], ['反彈', 1.5],
  ['复苏', 1.5], ['復甦', 1.5], ['回暖', 1.5], ['强劲', 1.5], ['強勁', 1.5],
  ['盈利', 1.5], ['增长', 1.5], ['增長', 1.5], ['翻倍', 2], ['大增', 1.8],
  ['成功', 1.8], ['获批', 1.8], ['獲批', 1.8], ['批准', 1.4],
  ['达成协议', 2], ['達成協議', 2], ['停火', 2], ['和平', 1.8], ['胜利', 2], ['勝利', 2],
  ['合作', 1.2], ['融资', 1.2], ['融資', 1.2], ['领先', 1.5], ['領先', 1.5],
  ['开源', 1.2], ['開源', 1.2], ['升级', 1.2], ['升級', 1.2], ['里程碑', 2],
  ['优秀', 1.6], ['優秀', 1.6], ['好评', 1.6], ['好評', 1.6], ['惊喜', 1.5], ['驚喜', 1.5],
  ['提升', 1.2], ['改善', 1.4], ['稳定', 1.2], ['穩定', 1.2], ['支持', 1],
  ['免费', 1], ['免費', 1], ['获救', 1.8], ['獲救', 1.8], ['解决', 1.2], ['解決', 1.2],
  ['看好', 1.5], ['乐观', 1.5], ['樂觀', 1.5], ['上涨', 1.4], ['上漲', 1.4],
  ['超预期', 1.8], ['超預期', 1.8], ['创纪录', 1.5], ['創紀錄', 1.5],
];

const ZH_NEGATIVE_PHRASES: Array<[string, number]> = [
  ['暴跌', 2.2], ['大跌', 2], ['崩盘', 2.2], ['崩盤', 2.2], ['重挫', 2], ['跳水', 1.8],
  ['利空', 2], ['熊市', 2], ['抛售', 1.8], ['拋售', 1.8], ['爆仓', 2.2], ['爆倉', 2.2],
  ['清算', 1.8], ['亏损', 1.8], ['虧損', 1.8], ['破产', 2.2], ['破產', 2.2], ['违约', 2], ['違約', 2],
  ['裁员', 2], ['裁員', 2], ['失业', 1.8], ['失業', 1.8], ['衰退', 1.8], ['萎缩', 1.6], ['萎縮', 1.6],
  ['下跌', 1.5], ['下滑', 1.4], ['下挫', 1.6], ['低迷', 1.5], ['通胀', 1.2], ['通脹', 1.2],
  ['袭击', 2.2], ['襲擊', 2.2], ['空袭', 2.2], ['空襲', 2.2], ['攻击', 2], ['攻擊', 2],
  ['战争', 2], ['戰爭', 2], ['冲突', 1.8], ['衝突', 1.8], ['导弹', 2], ['導彈', 2], ['爆炸', 2],
  ['死亡', 2.2], ['遇难', 2.2], ['遇難', 2.2], ['伤亡', 2.2], ['傷亡', 2.2], ['身亡', 2.2], ['受伤', 1.6], ['受傷', 1.6],
  ['危机', 2], ['危機', 2], ['灾难', 2.2], ['災難', 2.2], ['地震', 1.6], ['洪水', 1.6], ['火灾', 1.8], ['火災', 1.8],
  ['制裁', 1.6], ['封禁', 1.8], ['禁止', 1.4], ['起诉', 1.6], ['起訴', 1.6], ['诉讼', 1.4], ['訴訟', 1.4],
  ['逮捕', 2], ['被捕', 2], ['罚款', 1.6], ['罰款', 1.6], ['处罚', 1.5], ['處罰', 1.5], ['丑闻', 2], ['醜聞', 2],
  ['黑客', 2], ['駭客', 2], ['漏洞', 1.8], ['盗窃', 2], ['盜竊', 2], ['被盗', 2], ['被盜', 2],
  ['诈骗', 2.2], ['詐騙', 2.2], ['骗局', 2.2], ['騙局', 2.2], ['跑路', 2.2], ['泄露', 1.8], ['洩漏', 1.8],
  ['宕机', 2], ['當機', 2], ['故障', 1.6], ['中断', 1.5], ['中斷', 1.5], ['瘫痪', 2], ['癱瘓', 2],
  ['失败', 1.8], ['失敗', 1.8], ['延期', 1.2], ['取消', 1.3], ['短缺', 1.5],
  ['警告', 1.4], ['威胁', 1.6], ['威脅', 1.6], ['恐慌', 2], ['担忧', 1.3], ['擔憂', 1.3],
  ['抗议', 1.3], ['抗議', 1.3], ['暴动', 2], ['暴動', 2], ['风险', 1.1], ['風險', 1.1], ['危险', 1.6], ['危險', 1.6],
  ['恶化', 1.8], ['惡化', 1.8], ['糟糕', 1.8], ['严重', 1], ['嚴重', 1],
];

const ZH_NEGATION_PREFIX = /(?:无法|無法|并非|並非|难以|難以|不再|未能|没有|沒有|并未|並未|[不未无無没沒非否])/;

// Russian / Cyrillic stems
const RU_POSITIVE_STEMS: Array<[string, number]> = [
  ['прорыв', 2], ['успех', 1.8], ['успешн', 1.8], ['побед', 2], ['перемир', 2],
  ['соглашен', 1.4], ['рекордн', 1.5], ['инновац', 1.5], ['прибыль', 1.6],
  ['укреп', 1.4], ['одобр', 1.5], ['стабил', 1.2], ['восстанов', 1.5],
  ['вырос', 1.5], ['рост', 1.2], ['поддержк', 1.2], ['мирн', 1.5], ['спасен', 1.8],
];

const RU_NEGATIVE_STEMS: Array<[string, number]> = [
  ['атак', 2], ['удар', 1.8], ['войн', 2], ['погиб', 2.2], ['смерт', 2], ['жертв', 2],
  ['взрыв', 2], ['обстрел', 2], ['ракет', 1.8], ['кризис', 2], ['обвал', 2],
  ['паден', 1.6], ['упал', 1.5], ['санкц', 1.6], ['запрет', 1.5], ['арест', 1.8],
  ['взлом', 2], ['мошенн', 2], ['утечк', 1.8], ['угроз', 1.6], ['авар', 1.8],
  ['пожар', 1.8], ['катастроф', 2.2], ['сбой', 1.6], ['убыт', 1.8], ['банкрот', 2],
  ['дефицит', 1.5], ['конфликт', 1.6], ['протест', 1.3], ['штраф', 1.5], ['уязвим', 1.8],
  ['ранен', 1.6], ['разруш', 2], ['опасн', 1.6], ['провал', 2], ['скандал', 2],
];

// Japanese terms
const JA_POSITIVE_TERMS: Array<[string, number]> = [
  ['急騰', 2], ['上昇', 1.5], ['最高値', 2], ['突破', 1.6], ['成功', 1.8],
  ['承認', 1.5], ['提携', 1.3], ['成長', 1.5], ['回復', 1.5], ['革新', 1.6],
  ['好調', 1.6], ['改善', 1.4], ['合意', 1.5], ['勝利', 2], ['無料', 1], ['強化', 1.2],
];

const JA_NEGATIVE_TERMS: Array<[string, number]> = [
  ['暴落', 2.2], ['急落', 2], ['下落', 1.5], ['崩壊', 2.2], ['攻撃', 2],
  ['戦争', 2], ['死亡', 2.2], ['犠牲', 2], ['危機', 2], ['制裁', 1.6],
  ['禁止', 1.4], ['逮捕', 2], ['訴訟', 1.5], ['不正', 1.8], ['流出', 1.8],
  ['障害', 1.7], ['失敗', 1.8], ['警告', 1.4], ['脅威', 1.6], ['災害', 2],
  ['地震', 1.6], ['火災', 1.8], ['爆発', 2], ['赤字', 1.8], ['破綻', 2.2],
  ['倒産', 2.2], ['悪化', 1.8], ['懸念', 1.3],
];

// Spanish / Romance terms
const ES_POSITIVE_WORDS: Record<string, number> = {
  éxito: 2,
  crecimiento: 1.5,
  récord: 1.5,
  acuerdo: 1.4,
  paz: 2,
  victoria: 2,
  aumento: 1.2,
  aprobado: 1.6,
  recuperación: 1.6,
  innovación: 1.6,
  ganancia: 1.6,
  ganancias: 1.6,
  sube: 1.2,
  alza: 1.4,
  positivo: 1.5,
  positiva: 1.5,
  mejora: 1.4,
};

const ES_NEGATIVE_WORDS: Record<string, number> = {
  ataque: 2,
  ataques: 2,
  guerra: 2,
  muerte: 2,
  muertos: 2,
  crisis: 2,
  caída: 1.6,
  desplome: 2,
  sanciones: 1.6,
  prohibición: 1.5,
  fraude: 2,
  estafa: 2,
  hackeo: 2,
  fallo: 1.5,
  alerta: 1.3,
  amenaza: 1.6,
  desastre: 2,
  incendio: 1.8,
  explosión: 2,
  conflicto: 1.6,
  protesta: 1.2,
  pérdida: 1.6,
  pérdidas: 1.6,
  quiebra: 2,
  multa: 1.5,
  recesión: 2,
  heridos: 1.6,
};

const POSITIVE_EMOJI_RE = /[🚀🎉✅📈💪🥳🌟👏👍💚🏆😊😄❤️✨🙌🎯]/gu;
const NEGATIVE_EMOJI_RE = /[📉💥❌😢😡🤬💀☠️🔻💔😱😰🆘⛔🔴💣🔥⚠️🚨]/gu;

function cleanTextForSentiment(post: SentimentPostInput): string {
  const parts: string[] = [];
  if (post.text) parts.push(post.text);
  else if (post.cleanSnippet) parts.push(post.cleanSnippet);
  if (post.linkPreview?.title) parts.push(post.linkPreview.title);
  if (post.linkPreview?.description) parts.push(post.linkPreview.description);

  return parts
    .join(' ')
    .replace(/<[^>]*>?/gm, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/@[a-zA-Z0-9_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Scores a single post and returns its normalized sentiment polarity in [-1, 1].
 */
export function analyzePostSentiment(post: SentimentPostInput): {
  label: TopicSentimentLabel;
  score: number;
} {
  const rawText = cleanTextForSentiment(post);
  if (!rawText) {
    return { label: 'neutral', score: 0 };
  }

  let polaritySum = 0;

  // 1. Multi-word English idioms / news phrases
  for (const [pattern, weight] of EN_PHRASES) {
    const matches = rawText.match(pattern);
    if (matches && matches.length > 0) {
      polaritySum += Math.min(matches.length, 2) * weight;
    }
  }

  // 2. Latin-script words (English & Spanish) with local negation window
  const latinWords = rawText.toLowerCase().match(/[a-z\u00c0-\u024f]+(?:'[a-z]+)?/g);
  if (latinWords && latinWords.length > 0) {
    for (let i = 0; i < latinWords.length; i++) {
      const w = latinWords[i];
      let wScore = 0;
      if (Object.prototype.hasOwnProperty.call(EN_POSITIVE_WORDS, w)) {
        wScore = EN_POSITIVE_WORDS[w];
      } else if (Object.prototype.hasOwnProperty.call(EN_NEGATIVE_WORDS, w)) {
        wScore = -EN_NEGATIVE_WORDS[w];
      } else if (Object.prototype.hasOwnProperty.call(ES_POSITIVE_WORDS, w)) {
        wScore = ES_POSITIVE_WORDS[w];
      } else if (Object.prototype.hasOwnProperty.call(ES_NEGATIVE_WORDS, w)) {
        wScore = -ES_NEGATIVE_WORDS[w];
      }

      if (wScore !== 0) {
        // Inspect up to 3 preceding tokens for negation (skip punctuation-separated clauses)
        let negated = false;
        const lookbackStart = Math.max(0, i - 3);
        for (let j = lookbackStart; j < i; j++) {
          if (EN_NEGATORS.has(latinWords[j]) || latinWords[j] === 'sin' || latinWords[j] === 'nunca') {
            negated = true;
            break;
          }
        }
        polaritySum += negated ? wScore * -0.75 : wScore;
      }
    }
  }

  // 3. Chinese (Simplified & Traditional) with negation prefix check
  if (/[\u3400-\u4DBF\u4E00-\u9FFF]/.test(rawText)) {
    const isJapanese = /[\u3040-\u309F\u30A0-\u30FF]/.test(rawText);

    if (isJapanese) {
      for (const [term, weight] of JA_POSITIVE_TERMS) {
        if (rawText.includes(term)) polaritySum += weight;
      }
      for (const [term, weight] of JA_NEGATIVE_TERMS) {
        if (rawText.includes(term)) polaritySum -= weight;
      }
    } else {
      for (const [phrase, weight] of ZH_POSITIVE_PHRASES) {
        const idx = rawText.indexOf(phrase);
        if (idx !== -1) {
          const rawPrefix = rawText.slice(Math.max(0, idx - 4), idx);
          const clausePrefix = rawPrefix.split(/[，。！？；、,.!?;:\s]/).pop() || '';
          const negated = ZH_NEGATION_PREFIX.test(clausePrefix);
          polaritySum += negated ? -weight * 0.75 : weight;
        }
      }
      for (const [phrase, weight] of ZH_NEGATIVE_PHRASES) {
        const idx = rawText.indexOf(phrase);
        if (idx !== -1) {
          const rawPrefix = rawText.slice(Math.max(0, idx - 4), idx);
          const clausePrefix = rawPrefix.split(/[，。！？；、,.!?;:\s]/).pop() || '';
          const negated = ZH_NEGATION_PREFIX.test(clausePrefix);
          polaritySum += negated ? weight * 0.75 : -weight;
        }
      }
    }
  }

  // 4. Cyrillic (Russian / Ukrainian) stems with "не " / "без " negation check
  if (/[\u0400-\u04FF]/.test(rawText)) {
    const ruWords = rawText.toLowerCase().match(/[\u0400-\u04FF]+/g) || [];
    for (let i = 0; i < ruWords.length; i++) {
      const rw = ruWords[i];
      let wScore = 0;
      for (const [stem, weight] of RU_POSITIVE_STEMS) {
        if (rw.startsWith(stem)) {
          wScore = weight;
          break;
        }
      }
      if (wScore === 0) {
        for (const [stem, weight] of RU_NEGATIVE_STEMS) {
          if (rw.startsWith(stem)) {
            wScore = -weight;
            break;
          }
        }
      }
      if (wScore !== 0) {
        const prev = i > 0 ? ruWords[i - 1] : '';
        const negated = prev === 'не' || prev === 'без' || prev === 'нет';
        polaritySum += negated ? wScore * -0.75 : wScore;
      }
    }
  }

  // 5. Emoji sentiment signals (capped gently so alert emojis don't dominate long text)
  const posEmojis = rawText.match(POSITIVE_EMOJI_RE);
  if (posEmojis && posEmojis.length > 0) {
    polaritySum += Math.min(posEmojis.length, 2) * 0.65;
  }
  const negEmojis = rawText.match(NEGATIVE_EMOJI_RE);
  if (negEmojis && negEmojis.length > 0) {
    // Note: 🔥 and 🚨 are frequently used on breaking news regardless of valence; weight mildly
    let emojiNeg = 0;
    for (const em of negEmojis.slice(0, 3)) {
      emojiNeg += em === '🔥' || em === '🚨' || em === '⚠️' ? 0.35 : 0.7;
    }
    polaritySum -= Math.min(emojiNeg, 1.5);
  }

  // Normalize smoothly to [-1, 1]
  const score = Number(Math.tanh(polaritySum / 3.2).toFixed(3));
  let label: TopicSentimentLabel = 'neutral';
  if (score >= 0.18) {
    label = 'positive';
  } else if (score <= -0.18) {
    label = 'negative';
  }

  return { label, score };
}

/**
 * Aggregates sentiment across all posts in a hot topic cluster using
 * dampened view-weighted polarity averaging.
 */
export function analyzeClusterSentiment(posts: SentimentPostInput[]): TopicSentimentSummary {
  if (!Array.isArray(posts) || posts.length === 0) {
    return {
      label: 'neutral',
      score: 0,
      counts: { positive: 0, neutral: 0, negative: 0 },
    };
  }

  let weightedSum = 0;
  let totalWeight = 0;
  const counts: TopicSentimentBreakdown = {
    positive: 0,
    neutral: 0,
    negative: 0,
  };

  for (const post of posts) {
    const res = analyzePostSentiment(post);
    counts[res.label]++;

    const views = typeof post.views === 'number' && post.views > 0 ? post.views : 0;
    // Bounded logarithmic engagement weight in [1, 3]
    const weight = 1 + Math.min(2, Math.log10(1 + views) * 0.4);
    weightedSum += res.score * weight;
    totalWeight += weight;
  }

  const avgScore = totalWeight > 0 ? weightedSum / totalWeight : 0;
  const roundedScore = Number(avgScore.toFixed(2));

  let label: TopicSentimentLabel = 'neutral';
  if (roundedScore >= 0.15) {
    label = 'positive';
  } else if (roundedScore <= -0.15) {
    label = 'negative';
  }

  return {
    label,
    score: roundedScore,
    counts,
  };
}

/**
 * Sanitizes external/AI sentiment string into a strict TopicSentimentLabel.
 */
export function normalizeSentimentLabel(raw: unknown): TopicSentimentLabel | undefined {
  if (typeof raw !== 'string') return undefined;
  const cleaned = raw.trim().toLowerCase();
  if (cleaned === 'positive' || cleaned === 'pos' || cleaned === 'bullish') return 'positive';
  if (cleaned === 'negative' || cleaned === 'neg' || cleaned === 'bearish') return 'negative';
  if (cleaned === 'neutral' || cleaned === 'neu' || cleaned === 'mixed') return 'neutral';
  return undefined;
}
