/**
 * Web Worker running Cytoscape's built-in CoSE force-directed physics engine
 * per connected component, followed by Spatial-Hash Collision Resolution and
 * 2D shelf packing. Supports 10,000+ nodes & edges off the main UI thread.
 */

import {
  computeNerGraphLayout,
  type NerGraphLayoutRequest,
  type NerGraphLayoutResponse,
  type WorkerGraphEdgeInput,
  type WorkerGraphNodeInput,
} from "../utils/nerGraphLayoutSolver";

export type {
  NerGraphLayoutRequest,
  NerGraphLayoutResponse,
  WorkerGraphEdgeInput,
  WorkerGraphNodeInput,
};

self.onmessage = (ev: MessageEvent<NerGraphLayoutRequest>) => {
  const { id, nodes, edges } = ev.data;
  const t0 = performance.now();

  try {
    const outPositions = computeNerGraphLayout(nodes, edges);
    const msg: NerGraphLayoutResponse = {
      id,
      positions: outPositions,
      durationMs: performance.now() - t0,
    };
    (self as unknown as Worker).postMessage(msg, [outPositions.buffer]);
  } catch (err: unknown) {
    const empty = new Float64Array(nodes.length * 2);
    const msg: NerGraphLayoutResponse = {
      id,
      positions: empty,
      durationMs: performance.now() - t0,
      error: err instanceof Error ? err.message : String(err),
    };
    (self as unknown as Worker).postMessage(msg, [empty.buffer]);
  }
};
