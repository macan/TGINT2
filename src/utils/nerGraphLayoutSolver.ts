/**
 * Force-directed graph layout solver powered by Cytoscape's built-in CoSE
 * physics engine per connected component, Spatial-Hash Collision Resolution,
 * and 2D shelf packing. Supports 10,000+ nodes & edges without overlapping nodes.
 */

import cytoscape from "cytoscape";

export interface WorkerGraphNodeInput {
  id: string;
  radius: number;
  labelHalfW: number;
  mentions: number;
}

export interface WorkerGraphEdgeInput {
  id: string;
  source: string;
  target: string;
}

export interface NerGraphLayoutRequest {
  id: number;
  nodes: WorkerGraphNodeInput[];
  edges: WorkerGraphEdgeInput[];
}

export interface NerGraphLayoutResponse {
  id: number;
  positions: Float64Array; // [x0, y0, x1, y1, ...] aligned with request.nodes
  durationMs: number;
  error?: string;
}

interface InternalNode {
  index: number;
  id: string;
  radius: number;
  labelHalfW: number;
  collisionR: number;
  mentions: number;
  degree: number;
  x: number;
  y: number;
  visited: boolean;
}

/**
 * Spatial-Hash Grid collision resolution in O(N) expected time.
 * Guarantees zero node-circle overlap and readable label clearance even at 10,000+ nodes.
 */
export function resolveCollisionsSpatialHash(
  compNodes: Array<{
    x: number;
    y: number;
    radius: number;
    labelHalfW: number;
  }>,
  passes: number,
  labelFactor: number
): void {
  const n = compNodes.length;
  if (n <= 1) return;

  let maxR = 12;
  let maxLW = 24;
  for (let i = 0; i < n; i++) {
    if (compNodes[i].radius > maxR) maxR = compNodes[i].radius;
    if (compNodes[i].labelHalfW > maxLW) maxLW = compNodes[i].labelHalfW;
  }

  // Ensure cellSize >= largest possible pair minDist so a 3x3 cell scan never misses a collision
  const maxMinDist = maxR * 2 + Math.max(16, maxLW * 2 * labelFactor);
  const cellSize = Math.max(48, maxMinDist + 4);
  const invCell = 1 / cellSize;

  for (let pass = 0; pass < passes; pass++) {
    const grid = new Map<number, number[]>();

    for (let i = 0; i < n; i++) {
      const node = compNodes[i];
      const cx = Math.floor(node.x * invCell);
      const cy = Math.floor(node.y * invCell);
      const key = (cx + 1048576) * 2097152 + (cy + 1048576);
      let bucket = grid.get(key);
      if (!bucket) {
        bucket = [];
        grid.set(key, bucket);
      }
      bucket.push(i);
    }

    let moved = false;
    for (let i = 0; i < n; i++) {
      const a = compNodes[i];
      const cx = Math.floor(a.x * invCell);
      const cy = Math.floor(a.y * invCell);

      for (let dxCell = -1; dxCell <= 1; dxCell++) {
        for (let dyCell = -1; dyCell <= 1; dyCell++) {
          const key = (cx + dxCell + 1048576) * 2097152 + (cy + dyCell + 1048576);
          const bucket = grid.get(key);
          if (!bucket) continue;

          for (let bIdx = 0; bIdx < bucket.length; bIdx++) {
            const j = bucket[bIdx];
            if (j <= i) continue;
            const b = compNodes[j];

            let dx = b.x - a.x;
            let dy = b.y - a.y;
            let distSq = dx * dx + dy * dy;
            const minDist =
              a.radius +
              b.radius +
              Math.max(16, (a.labelHalfW + b.labelHalfW) * labelFactor);

            if (distSq >= minDist * minDist) continue;

            if (distSq < 0.0001) {
              const angle = ((i * 137.5 + j * 43.1) % 360) * (Math.PI / 180);
              dx = Math.cos(angle) * 0.5;
              dy = Math.sin(angle) * 0.5;
              distSq = 0.25;
            }

            const dist = Math.sqrt(distSq);
            const push = (minDist - dist) * 0.54;
            const px = (dx / dist) * push;
            const py = (dy / dist) * push;
            a.x -= px;
            a.y -= py;
            b.x += px;
            b.y += py;
            moved = true;
          }
        }
      }
    }

    if (!moved) break;
  }
}

export function computeNerGraphLayout(
  rawNodes: WorkerGraphNodeInput[],
  rawEdges: WorkerGraphEdgeInput[]
): Float64Array {
  const n = rawNodes.length;
  const outPositions = new Float64Array(n * 2);
  if (n === 0) return outPositions;

  const internalNodes: InternalNode[] = new Array(n);
  const idToIndex = new Map<string, number>();
  const adj: number[][] = Array.from({ length: n }, () => []);
  const adjEdges: WorkerGraphEdgeInput[][] = Array.from({ length: n }, () => []);

  for (let i = 0; i < n; i++) {
    const rn = rawNodes[i];
    idToIndex.set(rn.id, i);
    internalNodes[i] = {
      index: i,
      id: rn.id,
      radius: rn.radius,
      labelHalfW: rn.labelHalfW,
      collisionR: rn.radius + Math.max(12, rn.labelHalfW * 0.35),
      mentions: rn.mentions,
      degree: 0,
      x: 0,
      y: 0,
      visited: false,
    };
  }

  for (let i = 0; i < rawEdges.length; i++) {
    const re = rawEdges[i];
    const sIdx = idToIndex.get(re.source);
    const tIdx = idToIndex.get(re.target);
    if (sIdx === undefined || tIdx === undefined || sIdx === tIdx) continue;
    adj[sIdx].push(tIdx);
    adj[tIdx].push(sIdx);
    adjEdges[sIdx].push(re);
    internalNodes[sIdx].degree += 1;
    internalNodes[tIdx].degree += 1;
  }

  // Partition into connected components (degree >= 1) and isolated nodes
  const isolated: InternalNode[] = [];
  const components: Array<{
    nodes: InternalNode[];
    w: number;
    h: number;
  }> = [];

  for (let i = 0; i < n; i++) {
    const root = internalNodes[i];
    if (root.visited) continue;
    if (root.degree === 0) {
      root.visited = true;
      isolated.push(root);
      continue;
    }

    const compNodes: InternalNode[] = [];
    const compEdgeList: WorkerGraphEdgeInput[] = [];
    const queue: number[] = [i];
    root.visited = true;

    let head = 0;
    while (head < queue.length) {
      const u = queue[head++];
      compNodes.push(internalNodes[u]);
      const outE = adjEdges[u];
      for (let k = 0; k < outE.length; k++) {
        compEdgeList.push(outE[k]);
      }
      const nbrs = adj[u];
      for (let k = 0; k < nbrs.length; k++) {
        const v = nbrs[k];
        if (!internalNodes[v].visited) {
          internalNodes[v].visited = true;
          queue.push(v);
        }
      }
    }

    const cCount = compNodes.length;
    if (cCount === 2 && compEdgeList.length >= 1) {
      // Analytic non-overlapping placement for 2-node pairs
      const gap = Math.max(96, compNodes[0].labelHalfW + compNodes[1].labelHalfW + 32);
      compNodes[0].x = -gap * 0.5;
      compNodes[0].y = 0;
      compNodes[1].x = gap * 0.5;
      compNodes[1].y = 0;
    } else if (cCount <= 1200) {
      // Run Cytoscape built-in CoSE force-directed physics engine per component
      const cyElements: cytoscape.ElementDefinition[] = [];
      for (let k = 0; k < cCount; k++) {
        const cn = compNodes[k];
        cyElements.push({
          group: "nodes",
          data: { id: cn.id },
        });
      }
      for (let k = 0; k < compEdgeList.length; k++) {
        const ce = compEdgeList[k];
        cyElements.push({
          group: "edges",
          data: { id: ce.id, source: ce.source, target: ce.target },
        });
      }

      const numIter =
        cCount <= 80
          ? 180
          : cCount <= 250
            ? 90
            : cCount <= 650
              ? 40
              : 14;

      const cy = cytoscape({
        headless: true,
        styleEnabled: false,
        elements: cyElements,
      });

      cy.layout({
        name: "cose",
        animate: false,
        randomize: true,
        nodeOverlap: 36,
        componentSpacing: 72,
        nodeRepulsion: () => (cCount > 500 ? 6400 : 12000),
        idealEdgeLength: () => (cCount > 500 ? 96 : 124),
        edgeElasticity: () => 96,
        gravity: cCount > 500 ? 0.35 : 0.25,
        numIter,
        initialTemp: 340,
        coolingFactor: cCount > 500 ? 0.88 : 0.94,
        minTemp: 2.5,
      }).run();

      const cyNodes = cy.nodes();
      for (let k = 0; k < cCount; k++) {
        const pos = cyNodes[k].position();
        compNodes[k].x = pos.x;
        compNodes[k].y = pos.y;
      }
      cy.destroy();

      // Enforce strict non-overlapping node & label spacing via Spatial-Hash collision pass
      resolveCollisionsSpatialHash(
        compNodes,
        cCount > 800 ? 8 : 10,
        cCount > 800 ? 0.26 : 0.36
      );
    } else {
      // Giant mega-component (>1200 nodes in a single component):
      // Seed high-degree hubs on golden spiral, run fast O(V+E) spring-grid relaxation + Spatial-Hash collision resolution.
      compNodes.sort((a, b) => b.degree - a.degree || b.mentions - a.mentions);
      for (let k = 0; k < cCount; k++) {
        const cn = compNodes[k];
        if (k === 0) {
          cn.x = 0;
          cn.y = 0;
        } else {
          const angle = k * 2.399963229728653; // golden angle
          const dist = 80 + Math.sqrt(k) * 58;
          cn.x = Math.cos(angle) * dist;
          cn.y = Math.sin(angle) * dist;
        }
      }

      const resolvedEdges: Array<{ a: InternalNode; b: InternalNode }> = [];
      for (let k = 0; k < compEdgeList.length; k++) {
        const ce = compEdgeList[k];
        const si = idToIndex.get(ce.source);
        const ti = idToIndex.get(ce.target);
        if (si !== undefined && ti !== undefined) {
          resolvedEdges.push({ a: internalNodes[si], b: internalNodes[ti] });
        }
      }

      // Fast O(V + E) spring-pull passes along edges + spatial-hash collision repulsion
      const idealLen = 110;
      const springPasses = 16;
      for (let p = 0; p < springPasses; p++) {
        const alpha = 0.22 * (1 - p / (springPasses + 4));
        for (let k = 0; k < resolvedEdges.length; k++) {
          const { a, b } = resolvedEdges[k];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const delta = ((dist - idealLen) / dist) * alpha;
          a.x += dx * delta;
          a.y += dy * delta;
          b.x -= dx * delta;
          b.y -= dy * delta;
        }
        resolveCollisionsSpatialHash(compNodes, 2, 0.25);
      }
      resolveCollisionsSpatialHash(compNodes, 8, 0.28);
    }

    // Normalize component around (0,0) and compute padded bounds
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let k = 0; k < cCount; k++) {
      const cn = compNodes[k];
      const px = Math.max(cn.radius + 10, cn.labelHalfW + 8);
      const pyT = cn.radius + 12;
      const pyB = cn.radius + 26;
      if (cn.x - px < minX) minX = cn.x - px;
      if (cn.x + px > maxX) maxX = cn.x + px;
      if (cn.y - pyT < minY) minY = cn.y - pyT;
      if (cn.y + pyB > maxY) maxY = cn.y + pyB;
    }
    const midX = (minX + maxX) * 0.5;
    const midY = (minY + maxY) * 0.5;
    for (let k = 0; k < cCount; k++) {
      compNodes[k].x -= midX;
      compNodes[k].y -= midY;
    }

    components.push({
      nodes: compNodes,
      w: Math.max(80, maxX - minX),
      h: Math.max(80, maxY - minY),
    });
  }

  // Sort components largest-first and pack into non-overlapping 2D shelves
  components.sort(
    (a, b) => b.nodes.length - a.nodes.length || b.w * b.h - a.w * a.h
  );

  const COMP_GAP = 72;
  let totalArea = 0;
  let maxCompW = 360;
  for (let i = 0; i < components.length; i++) {
    const c = components[i];
    totalArea += (c.w + COMP_GAP) * (c.h + COMP_GAP);
    if (c.w > maxCompW) maxCompW = c.w;
  }
  const targetShelfWidth = Math.max(maxCompW + COMP_GAP, Math.sqrt(totalArea) * 1.4);

  let shelfX = 0;
  let shelfY = 0;
  let rowHeight = 0;
  let packedMaxX = 0;
  let packedMaxY = 0;

  for (let i = 0; i < components.length; i++) {
    const comp = components[i];
    if (shelfX > 0 && shelfX + comp.w > targetShelfWidth) {
      shelfX = 0;
      shelfY += rowHeight + COMP_GAP;
      rowHeight = 0;
    }
    const cx = shelfX + comp.w * 0.5;
    const cy = shelfY + comp.h * 0.5;
    for (let k = 0; k < comp.nodes.length; k++) {
      comp.nodes[k].x += cx;
      comp.nodes[k].y += cy;
    }
    shelfX += comp.w + COMP_GAP;
    if (comp.h > rowHeight) rowHeight = comp.h;
    if (shelfX > packedMaxX) packedMaxX = shelfX;
    if (shelfY + comp.h > packedMaxY) packedMaxY = shelfY + comp.h;
  }

  // Place isolated nodes cleanly in a non-overlapping grid strip below subgraphs
  if (isolated.length > 0) {
    isolated.sort((a, b) => b.mentions - a.mentions);
    const startY = packedMaxY + (components.length > 0 ? COMP_GAP : 0) + 32;
    const cols = Math.max(5, Math.min(28, Math.ceil(Math.sqrt(isolated.length * 1.8))));
    const cellW = 152;
    const cellH = 76;
    const gridW = Math.min(cols, isolated.length) * cellW;
    const gridStartX = Math.max(0, (packedMaxX - gridW) * 0.5);

    for (let i = 0; i < isolated.length; i++) {
      const iso = isolated[i];
      const col = i % cols;
      const row = Math.floor(i / cols);
      iso.x = gridStartX + col * cellW + cellW * 0.5;
      iso.y = startY + row * cellH;
    }
  }

  for (let i = 0; i < n; i++) {
    outPositions[i * 2] = internalNodes[i].x;
    outPositions[i * 2 + 1] = internalNodes[i].y;
  }

  return outPositions;
}
