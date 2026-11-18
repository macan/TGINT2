/**
 * Web Worker for offloading Listen Tab Hot Intelligence and Topic Clustering.
 * Supports:
 *   1. `compute`: Fast channel scanning + Stage-1 multilingual TF-IDF/SimHash clustering (or Gemini AI)
 *   2. `refine-clusters`: Stage-2 hybrid ONNX vector clustering + medoid synthesis + translations
 */

import {
  attachChineseTranslationsForForeignTitles,
  clusterPostsWithEmbeddings,
  processListenHotsData,
  type HotPostItem,
  type HotTopicCluster,
  type HotsAnalysisResult,
  type HotsClusterMode,
  type HotsDateRange,
  type HotsEngineProgress,
} from '../utils/hotsEngine';

export interface HotsWorkerRequestPayload {
  cachedChannels: { nodeId: string; posts: any[] }[];
  dateRange: HotsDateRange;
  geminiApiKey?: string;
  useAiMode?: boolean;
  clusterMode?: HotsClusterMode;
  listenItems?: any[];
  channelMetadataCache?: Record<string, any>;
}

export interface HotsWorkerRefinePayload {
  substantivePosts: HotPostItem[];
  vectors: Array<{ postKey: string; vector: Float32Array }>;
  dateRange: HotsDateRange;
}

export type HotsWorkerRequest =
  | {
      id: number;
      action: 'compute';
      payload: HotsWorkerRequestPayload;
    }
  | {
      id: number;
      action: 'refine-clusters';
      payload: HotsWorkerRefinePayload;
    };

export type HotsWorkerResponse =
  | { type: 'progress'; id: number; data: HotsEngineProgress }
  | { type: 'partial_result'; id: number; data: any }
  | { type: 'success'; id: number; data: HotsAnalysisResult }
  | { type: 'refine_success'; id: number; hotTopics: HotTopicCluster[] }
  | { type: 'error'; id: number; error: string };

self.onmessage = async (e: MessageEvent<HotsWorkerRequest>) => {
  const msg = e.data;
  if (!msg) return;
  const { id, action } = msg;

  if (action === 'compute') {
    try {
      const result = await processListenHotsData({
        ...msg.payload,
        onProgress: (p: HotsEngineProgress) => {
          self.postMessage({ type: 'progress', id, data: p });
        },
        onPartialResult: (partial: any) => {
          self.postMessage({ type: 'partial_result', id, data: partial });
        },
      });

      self.postMessage({ type: 'success', id, data: result });
    } catch (err: any) {
      self.postMessage({
        type: 'error',
        id,
        error: err?.message || String(err),
      });
    }
    return;
  }

  if (action === 'refine-clusters') {
    try {
      const { substantivePosts, vectors, dateRange } = msg.payload;
      self.postMessage({
        type: 'progress',
        id,
        data: {
          step: 'clustering',
          stage: 'stage2',
          percent: 88,
          message: 'Consolidating neural semantic clusters...',
        } satisfies HotsEngineProgress,
      });

      const vectorsMap = new Map<string, Float32Array>();
      if (Array.isArray(vectors)) {
        for (const v of vectors) {
          if (v?.postKey && v?.vector) {
            vectorsMap.set(v.postKey, v.vector instanceof Float32Array ? v.vector : new Float32Array(v.vector));
          }
        }
      }

      const refinedTopics = await clusterPostsWithEmbeddings(
        substantivePosts,
        vectorsMap,
        dateRange
      );

      if (refinedTopics.length > 0) {
        self.postMessage({
          type: 'progress',
          id,
          data: {
            step: 'clustering',
            stage: 'stage2',
            percent: 96,
            message: 'Translating foreign topic titles into Chinese...',
          } satisfies HotsEngineProgress,
        });
        await attachChineseTranslationsForForeignTitles(refinedTopics);
      }

      self.postMessage({
        type: 'refine_success',
        id,
        hotTopics: refinedTopics,
      });
    } catch (err: any) {
      self.postMessage({
        type: 'error',
        id,
        error: err?.message || String(err),
      });
    }
  }
};
