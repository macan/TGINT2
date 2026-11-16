/**
 * Pure utilities for CJK / Japanese / Chinese NER:
 *   1. Script routing (`isChineseDominantText`, `isJapaneseDominantText`, `hasCjkCharacters`)
 *   2. Native `Intl.Segmenter` word splitter for GLiNER (`CjkAwareWordSplitter`)
 *   3. Clause chunking for 512-token BERT models (`splitIntoCjkBertChunks`)
 *   4. WordPiece character-offset alignment & BIESO OntoNotes -> 10-class decoding
 *      for `Xenova/bert-base-chinese-ner`
 */

export type CjkWorkerNerClassId =
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

export interface DecodedBertSpan {
  spanText: string;
  start: number;
  end: number;
  nerClass: CjkWorkerNerClassId;
  rawLabel: string;
  score: number;
}

export const EXPLORER_NER_ML_CJK_VERSION = 3;

// Verified id2label table from `Xenova/bert-base-chinese-ner` (ckiplab/bert-base-chinese-ner, 73 BIESO labels)
export const CJK_BERT_ID2LABEL: Record<number, string> = {
  0: "O",
  1: "B-CARDINAL",
  2: "B-DATE",
  3: "B-EVENT",
  4: "B-FAC",
  5: "B-GPE",
  6: "B-LANGUAGE",
  7: "B-LAW",
  8: "B-LOC",
  9: "B-MONEY",
  10: "B-NORP",
  11: "B-ORDINAL",
  12: "B-ORG",
  13: "B-PERCENT",
  14: "B-PERSON",
  15: "B-PRODUCT",
  16: "B-QUANTITY",
  17: "B-TIME",
  18: "B-WORK_OF_ART",
  19: "I-CARDINAL",
  20: "I-DATE",
  21: "I-EVENT",
  22: "I-FAC",
  23: "I-GPE",
  24: "I-LANGUAGE",
  25: "I-LAW",
  26: "I-LOC",
  27: "I-MONEY",
  28: "I-NORP",
  29: "I-ORDINAL",
  30: "I-ORG",
  31: "I-PERCENT",
  32: "I-PERSON",
  33: "I-PRODUCT",
  34: "I-QUANTITY",
  35: "I-TIME",
  36: "I-WORK_OF_ART",
  37: "E-CARDINAL",
  38: "E-DATE",
  39: "E-EVENT",
  40: "E-FAC",
  41: "E-GPE",
  42: "E-LANGUAGE",
  43: "E-LAW",
  44: "E-LOC",
  45: "E-MONEY",
  46: "E-NORP",
  47: "E-ORDINAL",
  48: "E-ORG",
  49: "E-PERCENT",
  50: "E-PERSON",
  51: "E-PRODUCT",
  52: "E-QUANTITY",
  53: "E-TIME",
  54: "E-WORK_OF_ART",
  55: "S-CARDINAL",
  56: "S-DATE",
  57: "S-EVENT",
  58: "S-FAC",
  59: "S-GPE",
  60: "S-LANGUAGE",
  61: "S-LAW",
  62: "S-LOC",
  63: "S-MONEY",
  64: "S-NORP",
  65: "S-ORDINAL",
  66: "S-ORG",
  67: "S-PERCENT",
  68: "S-PERSON",
  69: "S-PRODUCT",
  70: "S-QUANTITY",
  71: "S-TIME",
  72: "S-WORK_OF_ART",
};

const RX_HAN_GLOBAL = /[\u4e00-\u9fff\u3400-\u4dbf]/g;
const RX_KANA_GLOBAL = /[\u3040-\u309f\u30a0-\u30ff]/g;
const RX_HANGUL_GLOBAL = /[\uac00-\ud7af]/g;
const RX_HAN_TEST = /[\u4e00-\u9fff\u3400-\u4dbf]/;
const RX_CJK_OR_KANA_TEST = /[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u309f\u30a0-\u30ff]/;

export function hasCjkCharacters(text: string): boolean {
  return Boolean(text && RX_HAN_TEST.test(text));
}

export function isJapaneseDominantText(text: string): boolean {
  if (!text) return false;
  const kanaCount = (text.match(RX_KANA_GLOBAL) || []).length;
  if (kanaCount < 3) return false;
  const hanCount = (text.match(RX_HAN_GLOBAL) || []).length;
  return kanaCount / Math.max(1, hanCount + kanaCount) >= 0.15;
}

/**
 * Returns true when a post should be routed to `Xenova/bert-base-chinese-ner`
 * instead of multilingual GLiNER (Han-dominant Simplified/Traditional/Cantonese text,
 * excluding Japanese Kana-dominant or Hangul-dominant posts).
 */
export function isChineseDominantText(text: string): boolean {
  if (!text) return false;
  if (isJapaneseDominantText(text)) return false;

  const hangulCount = (text.match(RX_HANGUL_GLOBAL) || []).length;
  const hanCount = (text.match(RX_HAN_GLOBAL) || []).length;
  if (hanCount < 4) return false;
  if (hangulCount > hanCount) return false;

  const nonSpaceLen = text.replace(/\s+/g, "").length;
  return hanCount >= 10 || hanCount / Math.max(1, nonSpaceLen) >= 0.2;
}

export type BatchModelHint = "cjk" | "gliner" | "both";

export function detectBatchModelHint(texts: string[]): BatchModelHint {
  if (!texts || texts.length === 0) return "cjk";
  let cjkCount = 0;
  let otherCount = 0;
  for (const t of texts) {
    if (!t || t.trim().length < 3) continue;
    if (isChineseDominantText(t)) {
      cjkCount += 1;
    } else {
      otherCount += 1;
    }
  }
  if (cjkCount > 0 && otherCount === 0) return "cjk";
  if (otherCount > 0 && cjkCount === 0) return "gliner";
  if (cjkCount > 0 && otherCount > 0) return "both";
  return "cjk";
}

type IntlSegmenterType = {
  segment(input: string): Iterable<{ segment: string; index: number; isWordLike?: boolean }>;
};

let zhSegmenter: IntlSegmenterType | null | undefined;
let jaSegmenter: IntlSegmenterType | null | undefined;

function getSegmenter(locale: "zh-Hant" | "ja"): IntlSegmenterType | null {
  const SegmenterCtor = (
    globalThis as unknown as {
      Intl?: {
        Segmenter?: new (
          loc: string,
          opts: { granularity: "word" }
        ) => IntlSegmenterType;
      };
    }
  ).Intl?.Segmenter;

  if (typeof SegmenterCtor !== "function") return null;

  if (locale === "ja") {
    if (jaSegmenter === undefined) {
      try {
        jaSegmenter = new SegmenterCtor("ja", { granularity: "word" });
      } catch {
        jaSegmenter = null;
      }
    }
    return jaSegmenter;
  }

  if (zhSegmenter === undefined) {
    try {
      zhSegmenter = new SegmenterCtor("zh-Hant", { granularity: "word" });
    } catch {
      zhSegmenter = null;
    }
  }
  return zhSegmenter;
}

/**
 * Drop-in replacement for GLiNER's internal `WhitespaceTokenSplitter`.
 * Avoids character-by-character splitting of CJK ideographs and Japanese Kana by
 * delegating CJK/Kana texts to the browser's native ICU `Intl.Segmenter`,
 * while preserving exact `[token, start, end]` character offsets.
 */
export class CjkAwareWordSplitter {
  private readonly fallbackPattern = /\w+(?:[-_]\w+)*|\S/g;

  *call(text: string): Generator<[string, number, number]> {
    if (!text) return;
    if (RX_CJK_OR_KANA_TEST.test(text)) {
      const segLocale: "zh-Hant" | "ja" = isJapaneseDominantText(text) ? "ja" : "zh-Hant";
      const segmenter = getSegmenter(segLocale);
      if (segmenter) {
        for (const seg of segmenter.segment(text)) {
          if (seg.segment.trim().length === 0) continue;
          yield [seg.segment, seg.index, seg.index + seg.segment.length];
        }
        return;
      }
    }

    const rx = new RegExp(this.fallbackPattern.source, "g");
    let match: RegExpExecArray | null;
    while ((match = rx.exec(text)) !== null) {
      yield [match[0], match.index, rx.lastIndex];
    }
  }
}

export interface CjkTextChunk {
  chunkText: string;
  startOffset: number;
}

const BERT_MAX_CHUNK_CHARS = 280;
const BERT_OVERLAP_CHARS = 24;

/**
 * Splits long Chinese posts at sentence/clause boundaries so each chunk stays safely
 * inside BERT's 512 WordPiece token limit (`<= 280` chars even with mixed English/URLs).
 */
export function splitIntoCjkBertChunks(text: string): CjkTextChunk[] {
  if (!text || text.trim().length < 2) return [];
  const rawSegments: Array<{ text: string; startOffset: number }> = [];

  const rxBoundary = /[^\n.!?。！？]+(?:[.!?。！？]+|$)/g;
  let m: RegExpExecArray | null;
  while ((m = rxBoundary.exec(text)) !== null) {
    const seg = m[0];
    if (seg.trim().length < 2) continue;
    rawSegments.push({ text: seg, startOffset: m.index });
  }
  if (rawSegments.length === 0) {
    rawSegments.push({ text, startOffset: 0 });
  }

  // Coalesce short adjacent sentences into one BERT chunk (<= BERT_MAX_CHUNK_CHARS)
  // so cross-clause context stays intact and BERT runs even fewer forward passes.
  const packed: CjkTextChunk[] = [];
  let accStart = -1;
  let accEnd = -1;

  const flushAcc = () => {
    if (accStart >= 0 && accEnd > accStart) {
      const slice = text.slice(accStart, accEnd);
      if (slice.trim().length >= 2) {
        packed.push({ chunkText: slice, startOffset: accStart });
      }
    }
    accStart = -1;
    accEnd = -1;
  };

  for (const seg of rawSegments) {
    const segEnd = seg.startOffset + seg.text.length;
    if (seg.text.length <= BERT_MAX_CHUNK_CHARS) {
      if (accStart < 0) {
        accStart = seg.startOffset;
        accEnd = segEnd;
      } else if (segEnd - accStart <= BERT_MAX_CHUNK_CHARS) {
        accEnd = segEnd;
      } else {
        flushAcc();
        accStart = seg.startOffset;
        accEnd = segEnd;
      }
      continue;
    }

    flushAcc();

    // Oversized single sentence -> split at clause punctuation or sliding window
    const subParts: Array<{ text: string; startOffset: number }> = [];
    const rxClause = /[^,，;；:：\n]+(?:[,，;；:：]+|$)/g;
    let cm: RegExpExecArray | null;
    while ((cm = rxClause.exec(seg.text)) !== null) {
      if (cm[0].trim().length >= 2) {
        subParts.push({ text: cm[0], startOffset: seg.startOffset + cm.index });
      }
    }

    const partsToSlice = subParts.length > 1 ? subParts : [seg];
    for (const part of partsToSlice) {
      if (part.text.length <= BERT_MAX_CHUNK_CHARS) {
        packed.push({ chunkText: part.text, startOffset: part.startOffset });
        continue;
      }
      let pos = 0;
      while (pos < part.text.length) {
        let end = Math.min(part.text.length, pos + BERT_MAX_CHUNK_CHARS);
        if (end < part.text.length) {
          const spaceBack = part.text.lastIndexOf(" ", end);
          if (spaceBack > pos + 40) {
            end = spaceBack + 1;
          }
        }
        const slice = part.text.slice(pos, end);
        if (slice.trim().length >= 2) {
          packed.push({
            chunkText: slice,
            startOffset: part.startOffset + pos,
          });
        }
        if (end >= part.text.length) break;
        pos = Math.max(pos + 32, end - BERT_OVERLAP_CHARS);
      }
    }
  }
  flushAcc();

  return packed;
}

const BERT_SPECIAL_TOKENS = new Set(["[CLS]", "[SEP]", "[PAD]", "[MASK]"]);

/**
 * Aligns BERT WordPiece tokens back to exact `[start, end]` character indices in `text`.
 * Handles `##` continuations, special tokens, NFKC width differences, case variants, and `[UNK]`.
 */
export function alignWordPieceTokensToText(
  text: string,
  tokens: string[]
): Array<[number, number] | null> {
  const offsets: Array<[number, number] | null> = new Array(tokens.length).fill(null);
  const textLower = text.toLowerCase();
  let cursor = 0;

  const findPieceAt = (piece: string, fromIdx: number, maxLookahead = 48): number => {
    if (!piece) return -1;
    const limit = Math.min(text.length, fromIdx + maxLookahead);
    const windowStr = text.slice(fromIdx, limit);
    const exactIdx = windowStr.indexOf(piece);
    if (exactIdx !== -1) return fromIdx + exactIdx;

    const pieceLower = piece.toLowerCase();
    const lowerIdx = textLower.slice(fromIdx, limit).indexOf(pieceLower);
    if (lowerIdx !== -1) return fromIdx + lowerIdx;

    // Match fullwidth Unicode variants via per-char NFKC scan within tight window
    const pieceNorm = piece.normalize("NFKC").toLowerCase();
    for (let p = fromIdx; p < limit; p++) {
      let acc = "";
      let endP = p;
      while (endP < Math.min(text.length, p + piece.length + 3) && acc.length < pieceNorm.length) {
        acc += text[endP].normalize("NFKC").toLowerCase();
        endP += 1;
      }
      if (acc === pieceNorm) return p;
    }
    return -1;
  };

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (!tok || BERT_SPECIAL_TOKENS.has(tok)) {
      offsets[i] = null;
      continue;
    }

    if (tok === "[UNK]") {
      while (cursor < text.length && /\s/.test(text[cursor])) {
        cursor++;
      }
      if (cursor >= text.length) {
        offsets[i] = null;
        continue;
      }
      // Look ahead for next known non-UNK token to determine exact [UNK] span length
      let nextMatchPos = -1;
      for (let look = i + 1; look < Math.min(tokens.length, i + 4); look++) {
        const nextTok = tokens[look];
        if (!nextTok || BERT_SPECIAL_TOKENS.has(nextTok) || nextTok === "[UNK]") continue;
        const nextPiece = nextTok.startsWith("##") ? nextTok.slice(2) : nextTok;
        const found = findPieceAt(nextPiece, cursor + 1, 24);
        if (found !== -1) {
          nextMatchPos = found;
          break;
        }
      }
      const code = text.codePointAt(cursor);
      const charStep = code && code > 0xffff ? 2 : 1;
      const unkStart = cursor;
      let unkEnd =
        nextMatchPos > unkStart ? nextMatchPos : Math.min(text.length, unkStart + charStep);
      while (unkEnd > unkStart + charStep && /\s/.test(text[unkEnd - 1])) {
        unkEnd--;
      }
      offsets[i] = [unkStart, unkEnd];
      cursor = unkEnd;
      continue;
    }

    const isContinuation = tok.startsWith("##");
    const piece = isContinuation ? tok.slice(2) : tok;
    if (!isContinuation) {
      while (cursor < text.length && /\s/.test(text[cursor])) {
        cursor++;
      }
    }

    const found = findPieceAt(piece, cursor, 64);
    if (found !== -1) {
      // Compute consumed length in source text (usually piece.length)
      let end = Math.min(text.length, found + piece.length);
      // Adjust if surrogate pair or NFKC multi-char mismatch
      if (
        text.slice(found, end).toLowerCase() !== piece.toLowerCase() &&
        text.slice(found, end).normalize("NFKC").toLowerCase() !==
          piece.normalize("NFKC").toLowerCase()
      ) {
        const targetNorm = piece.normalize("NFKC").toLowerCase();
        let acc = "";
        let probe = found;
        while (probe < text.length && acc.length < targetNorm.length) {
          acc += text[probe].normalize("NFKC").toLowerCase();
          probe++;
        }
        end = probe;
      }
      offsets[i] = [found, end];
      cursor = end;
    } else {
      offsets[i] = null;
    }
  }

  return offsets;
}

const DEFAULT_NATION_SET = new Set([
  "美國", "美国", "美方", "美利堅",
  "中國", "中国", "中方", "中國大陸", "中華人民共和國", "中华人民共和国",
  "英國", "英国", "英方",
  "烏克蘭", "乌克兰", "烏方", "乌方",
  "俄羅斯", "俄罗斯", "俄國", "俄国", "俄方",
  "台灣", "臺灣", "中華民國", "中华民国",
  "日本", "日方",
  "韓國", "韩国", "南韓", "南韩", "韓方",
  "朝鮮", "朝鲜", "北韓", "北韩",
  "德國", "德国", "德方",
  "法國", "法国", "法方",
  "以色列", "以方",
  "巴勒斯坦", "巴方",
  "伊朗", "伊方",
  "印度", "印方",
  "加拿大", "加方",
  "澳洲", "澳大利亞", "澳大利亚",
  "菲律賓", "菲律宾", "菲方",
  "新加坡",
  "越南", "越方",
  "波蘭", "波兰",
  "土耳其",
  "敘利亞", "叙利亚",
  "巴西",
  "墨西哥",
  "意大利", "義大利",
  "西班牙",
  "荷蘭", "荷兰",
  "瑞士",
  "沙地阿拉伯", "沙特阿拉伯", "沙烏地阿拉伯",
  "阿聯酋", "阿联酋",
  "埃及",
  "黎巴嫩",
  "也門", "葉門",
  "白俄羅斯", "白俄罗斯",
  "瑞典",
  "芬蘭", "芬兰",
  "挪威",
  "印尼", "印度尼西亞",
  "馬來西亞", "马来西亚", "大馬",
  "泰國", "泰国",
  "緬甸", "缅甸",
  "歐洲聯盟", "歐盟", "欧盟",
]);

function mapOntoTypeToNerClass(
  ontoType: string,
  spanText: string,
  classifyGpe?: (spanText: string) => "nation" | "location"
): CjkWorkerNerClassId | null {
  switch (ontoType) {
    case "PERSON":
      return "person";
    case "ORG":
      return "organization";
    case "GPE": {
      if (classifyGpe) return classifyGpe(spanText);
      const trimmed = spanText.trim();
      return DEFAULT_NATION_SET.has(trimmed) ? "nation" : "location";
    }
    case "NORP": {
      const trimmed = spanText.trim();
      if (trimmed.length < 2) return null;
      if (classifyGpe && classifyGpe(trimmed) === "nation") return "nation";
      if (DEFAULT_NATION_SET.has(trimmed)) return "nation";
      if (/[語话話文族裔籍]$/.test(trimmed) || /^(?:中國|美國|英國|日本|韓國|俄國|台灣|香港|澳門)人$/.test(trimmed)) {
        return null;
      }
      return "organization";
    }
    case "LOC":
      return "location";
    case "FAC":
      return "address";
    case "EVENT":
      return "event";
    case "LAW":
    case "PRODUCT":
    case "WORK_OF_ART":
      return "asset_law";
    case "MONEY":
    case "PERCENT":
    case "QUANTITY":
      return "financial_metric";
    default:
      // CARDINAL, ORDINAL, DATE, TIME, LANGUAGE skipped
      return null;
  }
}

export interface DecodeBiesoOptions {
  text: string;
  tokens: string[];
  attentionMask: ArrayLike<number | bigint>;
  logitsData: ArrayLike<number>;
  batchIndex: number;
  seqLen: number;
  numLabels: number;
  id2label?: Record<number, string>;
  confidenceThreshold?: number;
  classifyGpe?: (spanText: string) => "nation" | "location";
}

function softmaxTop1(
  logitsData: ArrayLike<number>,
  offset: number,
  numLabels: number
): { labelId: number; prob: number } {
  let maxLogit = -Infinity;
  let bestId = 0;
  for (let c = 0; c < numLabels; c++) {
    const v = logitsData[offset + c];
    if (v > maxLogit) {
      maxLogit = v;
      bestId = c;
    }
  }
  let sumExp = 0;
  for (let c = 0; c < numLabels; c++) {
    sumExp += Math.exp(logitsData[offset + c] - maxLogit);
  }
  const prob = sumExp > 0 ? 1 / sumExp : 0;
  return { labelId: bestId, prob };
}

/**
 * Decodes `[batch, seq_len, num_labels]` logits from `Xenova/bert-base-chinese-ner`
 * into merged verbatim spans mapped onto our 10 unified NER classes.
 */
export function decodeBiesoTokenLogits(opts: DecodeBiesoOptions): DecodedBertSpan[] {
  const {
    text,
    tokens,
    attentionMask,
    logitsData,
    batchIndex,
    seqLen,
    numLabels,
    id2label = CJK_BERT_ID2LABEL,
    confidenceThreshold = 0.48,
    classifyGpe,
  } = opts;

  const tokenOffsets = alignWordPieceTokensToText(text, tokens);
  const rawSpans: Array<{
    ontoType: string;
    start: number;
    end: number;
    scores: number[];
  }> = [];

  let active: {
    ontoType: string;
    start: number;
    end: number;
    scores: number[];
  } | null = null;

  const flushActive = () => {
    if (active) {
      rawSpans.push(active);
      active = null;
    }
  };

  const validLen = Math.min(seqLen, tokens.length);
  for (let t = 0; t < validLen; t++) {
    const maskVal = Number(attentionMask[t] ?? 0);
    if (maskVal === 0) {
      flushActive();
      continue;
    }
    const tokOffset = tokenOffsets[t];
    if (!tokOffset) {
      // Special tokens like [CLS], [SEP] break spans
      if (BERT_SPECIAL_TOKENS.has(tokens[t])) {
        flushActive();
      }
      continue;
    }

    const logitOffset = (batchIndex * seqLen + t) * numLabels;
    const { labelId, prob } = softmaxTop1(logitsData, logitOffset, numLabels);
    const tag = id2label[labelId] || "O";

    if (tag === "O" || tag.length < 3 || tag[1] !== "-") {
      flushActive();
      continue;
    }

    const prefix = tag[0]; // B | I | E | S
    const ontoType = tag.slice(2);
    const [charStart, charEnd] = tokOffset;

    if (prefix === "S") {
      flushActive();
      rawSpans.push({
        ontoType,
        start: charStart,
        end: charEnd,
        scores: [prob],
      });
    } else if (prefix === "B") {
      flushActive();
      active = {
        ontoType,
        start: charStart,
        end: charEnd,
        scores: [prob],
      };
    } else if (prefix === "I") {
      if (active && active.ontoType === ontoType) {
        active.end = Math.max(active.end, charEnd);
        active.scores.push(prob);
      } else {
        flushActive();
        active = {
          ontoType,
          start: charStart,
          end: charEnd,
          scores: [prob],
        };
      }
    } else if (prefix === "E") {
      if (active && active.ontoType === ontoType) {
        active.end = Math.max(active.end, charEnd);
        active.scores.push(prob);
        flushActive();
      } else {
        flushActive();
        rawSpans.push({
          ontoType,
          start: charStart,
          end: charEnd,
          scores: [prob],
        });
      }
    }
  }
  flushActive();

  const decoded: DecodedBertSpan[] = [];
  for (const sp of rawSpans) {
    const rawSlice = text.slice(sp.start, sp.end);
    const trimmed = rawSlice.trim();
    if (trimmed.length < 2) continue;

    const leadWs = rawSlice.indexOf(trimmed);
    const start = sp.start + Math.max(0, leadWs);
    const end = start + trimmed.length;

    const avgScore =
      sp.scores.reduce((acc, s) => acc + s, 0) / Math.max(1, sp.scores.length);
    if (avgScore < confidenceThreshold) continue;

    const nerClass = mapOntoTypeToNerClass(sp.ontoType, trimmed, classifyGpe);
    if (!nerClass) continue;

    decoded.push({
      spanText: trimmed,
      start,
      end,
      nerClass,
      rawLabel: sp.ontoType,
      score: Number(avgScore.toFixed(4)),
    });
  }

  return decoded;
}
