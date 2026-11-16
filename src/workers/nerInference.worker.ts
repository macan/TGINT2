/**
 * Dedicated Web Worker for in-browser multilingual GLiNER.js NER inference.
 *
 * Streams & persists `onnx-community/gliner_multi-v2.1` quantized weights in
 * Browser Cache Storage (`gingko-ner-models-v1`), initializes ONNX Runtime Web
 * prioritizing WebGPU with automatic WASM SIMD fallback, and chunks input
 * posts safely within the mDeBERTa 384-token window so CJK, Cantonese (Yue),
 * Russian, and English texts extract cleanly without overflowing.
 */

import { Gliner } from "gliner";

export type WorkerNerClassId =
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

export interface WorkerMlSpan {
  spanText: string;
  start: number;
  end: number;
  nerClass: WorkerNerClassId;
  rawLabel: string;
  score: number;
}

export interface WorkerPostInput {
  postKey: string;
  text: string;
}

export type WorkerInMessage =
  | { id: number; type: "warmup" }
  | { id: number; type: "infer-batch"; posts: WorkerPostInput[] }
  | { id: number; type: "clear-cache" }
  | { id: number; type: "abort" };

export type WorkerOutMessage =
  | {
      type: "progress";
      stage: "checking" | "downloading" | "loading_cache" | "initializing" | "ready";
      loadedBytes: number;
      totalBytes: number;
      percent: number;
      provider?: "webgpu" | "wasm" | null;
      cached?: boolean;
    }
  | {
      id: number;
      type: "warmup-done";
      provider: "webgpu" | "wasm";
      cached: boolean;
    }
  | {
      id: number;
      type: "infer-done";
      provider: "webgpu" | "wasm";
      results: Array<{ postKey: string; spans: WorkerMlSpan[] }>;
    }
  | {
      id: number;
      type: "clear-done";
    }
  | {
      id: number;
      type: "error";
      message: string;
      aborted?: boolean;
    };

const MODEL_TOKENIZER_ID = "onnx-community/gliner_multi-v2.1";
const MODEL_ONNX_URL =
  "https://huggingface.co/onnx-community/gliner_multi-v2.1/resolve/main/onnx/model_quantized.onnx";
const CACHE_NAME = "gingko-ner-models-v1";
const APPROX_MODEL_BYTES = 349_175_808; // ~333 MiB fallback when Content-Length omitted
const ONNX_WASM_CDN = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.2/dist/";

// 11 zero-shot labels (well below model max_types = 25) mapped back to our 10 NER classes
const GLINER_LABEL_DEFS: Array<{ prompt: string; nerClass: WorkerNerClassId }> = [
  { prompt: "person", nerClass: "person" },
  { prompt: "organization", nerClass: "organization" },
  { prompt: "political party", nerClass: "organization" },
  { prompt: "military force", nerClass: "organization" },
  { prompt: "country", nerClass: "nation" },
  { prompt: "job title", nerClass: "job_position" },
  { prompt: "location", nerClass: "location" },
  { prompt: "street address or facility", nerClass: "address" },
  { prompt: "event", nerClass: "event" },
  { prompt: "law or treaty or product", nerClass: "asset_law" },
  { prompt: "financial metric", nerClass: "financial_metric" },
];

const ENTITY_PROMPTS = GLINER_LABEL_DEFS.map((d) => d.prompt);
const PROMPT_TO_NER_CLASS = new Map<string, WorkerNerClassId>(
  GLINER_LABEL_DEFS.map((d) => [d.prompt, d.nerClass])
);

const MAX_CHUNK_WORDS = 95;
const MAX_CHUNK_CHARS = 190;
const OVERLAP_CHARS = 18;
const INFER_SUBBATCH_SIZE = 4;
const ML_CONFIDENCE_THRESHOLD = 0.42;

let glinerInstance: Gliner | null = null;
let activeProvider: "webgpu" | "wasm" | null = null;
let initPromise: Promise<"webgpu" | "wasm"> | null = null;
let activeAbortController: AbortController | null = null;
let abortRequested = false;

function emit(msg: WorkerOutMessage) {
  (self as unknown as { postMessage: (m: unknown) => void }).postMessage(msg);
}

async function detectWebGpuSupport(): Promise<boolean> {
  try {
    const nav = (self as unknown as { navigator?: { gpu?: { requestAdapter?: () => Promise<unknown> } } }).navigator;
    if (!nav?.gpu || typeof nav.gpu.requestAdapter !== "function") {
      return false;
    }
    const adapter = await nav.gpu.requestAdapter();
    return Boolean(adapter);
  } catch {
    return false;
  }
}

async function persistModelToCache(bytes: Uint8Array): Promise<boolean> {
  if (typeof caches === "undefined") return false;
  try {
    const cache = await caches.open(CACHE_NAME);
    const resp = new Response(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(bytes.byteLength),
      },
    });
    await cache.put(MODEL_ONNX_URL, resp);
    return true;
  } catch {
    return false;
  }
}

async function loadOrDownloadModelBytes(
  signal: AbortSignal
): Promise<{ bytes: Uint8Array; fromCache: boolean }> {
  emit({
    type: "progress",
    stage: "checking",
    loadedBytes: 0,
    totalBytes: 0,
    percent: 0,
  });

  if (typeof caches !== "undefined") {
    try {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(MODEL_ONNX_URL);
      if (cached) {
        emit({
          type: "progress",
          stage: "loading_cache",
          loadedBytes: 0,
          totalBytes: 0,
          percent: 100,
          cached: true,
        });
        const buf = await cached.arrayBuffer();
        if (buf.byteLength > 50_000_000) {
          return { bytes: new Uint8Array(buf), fromCache: true };
        }
        await cache.delete(MODEL_ONNX_URL).catch(() => {});
      }
    } catch {
      // Cache Storage may be unavailable in restricted contexts; proceed to fetch
    }
  }

  const res = await fetch(MODEL_ONNX_URL, {
    signal,
    mode: "cors",
    credentials: "omit",
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch model weights (HTTP ${res.status})`);
  }

  const contentLen = Number(res.headers.get("content-length") || "0");
  const totalBytes = Number.isFinite(contentLen) && contentLen > 0 ? contentLen : APPROX_MODEL_BYTES;

  if (!res.body) {
    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    await persistModelToCache(bytes);
    emit({
      type: "progress",
      stage: "downloading",
      loadedBytes: bytes.byteLength,
      totalBytes: bytes.byteLength,
      percent: 100,
    });
    return { bytes, fromCache: false };
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loadedBytes = 0;
  let lastProgressAt = 0;

  while (true) {
    if (signal.aborted) {
      await reader.cancel().catch(() => {});
      throw new DOMException("Download aborted", "AbortError");
    }
    const { done, value } = await reader.read();
    if (done) break;
    if (value && value.byteLength > 0) {
      chunks.push(value);
      loadedBytes += value.byteLength;
      const now = performance.now();
      if (now - lastProgressAt >= 120) {
        lastProgressAt = now;
        const pct = Math.min(99, Math.round((loadedBytes / Math.max(loadedBytes, totalBytes)) * 100));
        emit({
          type: "progress",
          stage: "downloading",
          loadedBytes,
          totalBytes: Math.max(loadedBytes, totalBytes),
          percent: pct,
        });
      }
    }
  }

  const combined = new Uint8Array(loadedBytes);
  let writeOffset = 0;
  for (const c of chunks) {
    combined.set(c, writeOffset);
    writeOffset += c.byteLength;
  }

  emit({
    type: "progress",
    stage: "downloading",
    loadedBytes,
    totalBytes: Math.max(loadedBytes, totalBytes),
    percent: 100,
  });

  await persistModelToCache(combined);
  return { bytes: combined, fromCache: false };
}

async function createGlinerSession(
  bytes: Uint8Array,
  provider: "webgpu" | "wasm"
): Promise<Gliner> {
  const isCrossOriginIsolated = Boolean(
    (self as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated
  );
  const gliner = new Gliner({
    tokenizerPath: MODEL_TOKENIZER_ID,
    modelType: "span-level",
    maxWidth: 12,
    onnxSettings: {
      modelPath: bytes,
      executionProvider: provider,
      wasmPaths: ONNX_WASM_CDN,
      multiThread: provider === "wasm" ? isCrossOriginIsolated : false,
      fetchBinary: false,
    },
    transformersSettings: {
      allowLocalModels: false,
      useBrowserCache: true,
    },
  });
  await gliner.initialize();
  return gliner;
}

async function ensureInitialized(signal: AbortSignal): Promise<{
  provider: "webgpu" | "wasm";
  cached: boolean;
}> {
  if (glinerInstance && activeProvider) {
    return { provider: activeProvider, cached: true };
  }

  if (initPromise) {
    const provider = await initPromise;
    return { provider, cached: true };
  }

  let wasCached = false;
  initPromise = (async () => {
    const { bytes, fromCache } = await loadOrDownloadModelBytes(signal);
    wasCached = fromCache;

    if (signal.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    const canWebGpu = await detectWebGpuSupport();
    const preferred: "webgpu" | "wasm" = canWebGpu ? "webgpu" : "wasm";

    emit({
      type: "progress",
      stage: "initializing",
      loadedBytes: bytes.byteLength,
      totalBytes: bytes.byteLength,
      percent: 100,
      provider: preferred,
      cached: fromCache,
    });

    if (preferred === "webgpu") {
      try {
        // Slice buffer copy when trying WebGPU so WASM fallback still has intact weights if GPU driver rejects int8 ops
        const gpuBytes = new Uint8Array(bytes);
        glinerInstance = await createGlinerSession(gpuBytes, "webgpu");
        activeProvider = "webgpu";
      } catch {
        emit({
          type: "progress",
          stage: "initializing",
          loadedBytes: bytes.byteLength,
          totalBytes: bytes.byteLength,
          percent: 100,
          provider: "wasm",
          cached: fromCache,
        });
        glinerInstance = await createGlinerSession(bytes, "wasm");
        activeProvider = "wasm";
      }
    } else {
      glinerInstance = await createGlinerSession(bytes, "wasm");
      activeProvider = "wasm";
    }

    emit({
      type: "progress",
      stage: "ready",
      loadedBytes: bytes.byteLength,
      totalBytes: bytes.byteLength,
      percent: 100,
      provider: activeProvider,
      cached: fromCache,
    });

    return activeProvider;
  })();

  try {
    const provider = await initPromise;
    return { provider, cached: wasCached };
  } catch (err) {
    glinerInstance = null;
    activeProvider = null;
    throw err;
  } finally {
    initPromise = null;
  }
}

function countApproxSplitterWords(s: string): number {
  const matches = s.match(/\w+(?:[-_]\w+)*|\S/g);
  return matches ? matches.length : 0;
}

interface TextChunk {
  chunkText: string;
  startOffset: number;
}

/**
 * Splits post text into clause-sized chunks whose token length stays comfortably
 * inside GLiNER's 384-token mDeBERTa window across Latin, CJK, and Cyrillic scripts.
 */
function splitIntoGlinerChunks(text: string): TextChunk[] {
  if (!text || text.trim().length < 2) return [];
  const rawSegments: Array<{ text: string; startOffset: number }> = [];

  // 1. Split first along newlines and major sentence punctuation
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

  // 2. Further split oversized segments at clause punctuation or sliding window
  const finalChunks: TextChunk[] = [];
  for (const seg of rawSegments) {
    if (
      seg.text.length <= MAX_CHUNK_CHARS &&
      countApproxSplitterWords(seg.text) <= MAX_CHUNK_WORDS
    ) {
      finalChunks.push({ chunkText: seg.text, startOffset: seg.startOffset });
      continue;
    }

    // Try splitting by clause punctuation first
    const subParts: Array<{ text: string; startOffset: number }> = [];
    const rxClause = /[^,，;；:：\n]+(?:[,，;；:：]+|$)/g;
    let cm: RegExpExecArray | null;
    while ((cm = rxClause.exec(seg.text)) !== null) {
      if (cm[0].trim().length >= 2) {
        subParts.push({ text: cm[0], startOffset: seg.startOffset + cm.index });
      }
    }

    const partsToPack = subParts.length > 1 ? subParts : [seg];
    for (const part of partsToPack) {
      if (
        part.text.length <= MAX_CHUNK_CHARS &&
        countApproxSplitterWords(part.text) <= MAX_CHUNK_WORDS
      ) {
        finalChunks.push({ chunkText: part.text, startOffset: part.startOffset });
        continue;
      }

      // Sliding window slice with boundary snap on ASCII spaces
      let pos = 0;
      while (pos < part.text.length) {
        let end = Math.min(part.text.length, pos + MAX_CHUNK_CHARS);
        if (end < part.text.length) {
          const spaceBack = part.text.lastIndexOf(" ", end);
          if (spaceBack > pos + 40) {
            end = spaceBack + 1;
          }
        }
        const slice = part.text.slice(pos, end);
        if (slice.trim().length >= 2) {
          finalChunks.push({
            chunkText: slice,
            startOffset: part.startOffset + pos,
          });
        }
        if (end >= part.text.length) break;
        pos = Math.max(pos + 24, end - OVERLAP_CHARS);
      }
    }
  }

  return finalChunks;
}

async function runInferenceWithAutoFallback(
  texts: string[],
  signal: AbortSignal
): ReturnType<Gliner["inference"]> {
  if (!glinerInstance) {
    await ensureInitialized(signal);
  }
  try {
    return await glinerInstance!.inference({
      texts,
      entities: ENTITY_PROMPTS,
      flatNer: true,
      threshold: ML_CONFIDENCE_THRESHOLD,
      multiLabel: false,
    });
  } catch (err) {
    // Some WebGPU drivers fail on int8 DeBERTa ops during first inference rather than session create
    if (activeProvider === "webgpu") {
      glinerInstance = null;
      activeProvider = null;
      const { bytes, fromCache } = await loadOrDownloadModelBytes(signal);
      emit({
        type: "progress",
        stage: "initializing",
        loadedBytes: bytes.byteLength,
        totalBytes: bytes.byteLength,
        percent: 100,
        provider: "wasm",
        cached: fromCache,
      });
      glinerInstance = await createGlinerSession(bytes, "wasm");
      activeProvider = "wasm";
      emit({
        type: "progress",
        stage: "ready",
        loadedBytes: bytes.byteLength,
        totalBytes: bytes.byteLength,
        percent: 100,
        provider: "wasm",
        cached: fromCache,
      });
      return await glinerInstance.inference({
        texts,
        entities: ENTITY_PROMPTS,
        flatNer: true,
        threshold: ML_CONFIDENCE_THRESHOLD,
        multiLabel: false,
      });
    }
    throw err;
  }
}

async function handleInferBatch(posts: WorkerPostInput[], signal: AbortSignal) {
  const { provider } = await ensureInitialized(signal);
  let resolvedProvider = provider;

  interface ChunkJob {
    postIndex: number;
    chunkText: string;
    startOffset: number;
  }

  const allJobs: ChunkJob[] = [];
  const perPostRawSpans: WorkerMlSpan[][] = posts.map(() => []);

  posts.forEach((p, idx) => {
    const chunks = splitIntoGlinerChunks(p.text || "");
    for (const ch of chunks) {
      allJobs.push({
        postIndex: idx,
        chunkText: ch.chunkText,
        startOffset: ch.startOffset,
      });
    }
  });

  for (let i = 0; i < allJobs.length; i += INFER_SUBBATCH_SIZE) {
    if (abortRequested || signal.aborted) {
      throw new DOMException("Inference aborted", "AbortError");
    }

    const batchJobs = allJobs.slice(i, i + INFER_SUBBATCH_SIZE);
    const batchResults = await runInferenceWithAutoFallback(
      batchJobs.map((j) => j.chunkText),
      signal
    );
    if (activeProvider) {
      resolvedProvider = activeProvider;
    }

    for (let j = 0; j < batchJobs.length; j++) {
      const job = batchJobs[j];
      const entities = batchResults[j] || [];
      for (const ent of entities) {
        const nerClass = PROMPT_TO_NER_CLASS.get(ent.label);
        if (!nerClass) continue;
        const cleanSpan = String(ent.spanText || "").trim();
        if (cleanSpan.length < 2) continue;
        perPostRawSpans[job.postIndex].push({
          spanText: cleanSpan,
          start: job.startOffset + Math.max(0, ent.start),
          end: job.startOffset + Math.max(0, ent.end),
          nerClass,
          rawLabel: ent.label,
          score: Number(ent.score || 0),
        });
      }
    }
  }

  // Deduplicate overlapping window hits inside each post, keeping highest score
  const output = posts.map((p, idx) => {
    const spans = perPostRawSpans[idx].sort((a, b) => b.score - a.score);
    const kept: WorkerMlSpan[] = [];
    for (const s of spans) {
      const overlaps = kept.some(
        (k) =>
          (s.start < k.end && s.end > k.start) ||
          (s.nerClass === k.nerClass &&
            s.spanText.toLowerCase() === k.spanText.toLowerCase() &&
            Math.abs(s.start - k.start) <= OVERLAP_CHARS)
      );
      if (!overlaps) {
        kept.push(s);
      }
    }
    kept.sort((a, b) => a.start - b.start);
    return { postKey: p.postKey, spans: kept };
  });

  return { provider: resolvedProvider, results: output };
}

// Serialize async operations inside worker so ONNX session isn't mutated concurrently
let taskQueue: Promise<void> = Promise.resolve();

self.addEventListener("message", (ev: MessageEvent<WorkerInMessage>) => {
  const msg = ev.data;
  if (!msg) return;

  if (msg.type === "abort") {
    abortRequested = true;
    activeAbortController?.abort();
    return;
  }

  taskQueue = taskQueue.then(async () => {
    abortRequested = false;
    activeAbortController = new AbortController();
    const signal = activeAbortController.signal;

    try {
      if (msg.type === "clear-cache") {
        glinerInstance = null;
        activeProvider = null;
        if (typeof caches !== "undefined") {
          await caches.delete(CACHE_NAME).catch(() => {});
        }
        emit({ id: msg.id, type: "clear-done" });
        return;
      }

      if (msg.type === "warmup") {
        const { provider, cached } = await ensureInitialized(signal);
        emit({ id: msg.id, type: "warmup-done", provider, cached });
        return;
      }

      if (msg.type === "infer-batch") {
        const { provider, results } = await handleInferBatch(msg.posts, signal);
        emit({ id: msg.id, type: "infer-done", provider, results });
      }
    } catch (err: unknown) {
      const e = err as { name?: string; message?: string };
      const aborted = e?.name === "AbortError" || abortRequested;
      emit({
        id: msg.id,
        type: "error",
        aborted,
        message: aborted ? "Aborted" : e?.message || "Local ML inference error",
      });
    } finally {
      activeAbortController = null;
    }
  });
});
