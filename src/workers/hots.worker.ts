/**
 * Web Worker for offloading Listen Tab Hot Intelligence and Topic Clustering.
 * Runs heavy data scanning, semantic clustering, and statistical calculations
 * completely off the browser main thread to guarantee 60fps UI responsiveness.
 */

import {
  processListenHotsData,
  HotsAnalysisResult,
  HotsDateRange,
  HotsEngineProgress
} from '../utils/hotsEngine';

export interface HotsWorkerRequestPayload {
  cachedChannels: { nodeId: string; posts: any[] }[];
  dateRange: HotsDateRange;
  geminiApiKey?: string;
  useAiMode?: boolean;
  listenItems?: any[];
  channelMetadataCache?: Record<string, any>;
}

export interface HotsWorkerRequest {
  id: number;
  action: 'compute';
  payload: HotsWorkerRequestPayload;
}

export type HotsWorkerResponse =
  | { type: 'progress'; id: number; data: HotsEngineProgress }
  | { type: 'partial_result'; id: number; data: any }
  | { type: 'success'; id: number; data: HotsAnalysisResult }
  | { type: 'error'; id: number; error: string };

self.onmessage = async (e: MessageEvent<HotsWorkerRequest>) => {
  const { id, action, payload } = e.data;
  if (action === 'compute') {
    try {
      const result = await processListenHotsData({
        ...payload,
        onProgress: (p: HotsEngineProgress) => {
          self.postMessage({ type: 'progress', id, data: p });
        },
        onPartialResult: (partial: any) => {
          self.postMessage({ type: 'partial_result', id, data: partial });
        }
      });

      self.postMessage({ type: 'success', id, data: result });
    } catch (err: any) {
      self.postMessage({
        type: 'error',
        id,
        error: err?.message || String(err)
      });
    }
  }
};
