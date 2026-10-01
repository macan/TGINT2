export interface ListenAutoClass {
  class: string;
  confidence: number;
}

export interface ListenItem {
  id: string;
  name: string;
  isFolder: boolean;
  create_time: string;
  type?: "channel" | "keyword";
  argument?: string;
  description?: string;
  children?: ListenItem[];
  tags?: string[];
  auto_class?: ListenAutoClass;
}

export interface AutoFindingCell {
  id: number;
  logs: string[];
  analysisResult?: string;
  verificationResult?: string;
  status: "running" | "completed" | "error";
}

export interface GraphNode {
  id: string;
  name: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  color: string;
  isCenter: boolean;
  avatarImg?: HTMLImageElement | null;
  avatarLoaded?: boolean;
  displayName: string;
  isPinned?: boolean;
  fx?: number | null;
  fy?: number | null;
  metadata?: any;
  _index?: number;
  _cachedLabel?: string;
  _labelWidth?: number;
  tier?: number;
  degree?: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  type?: "in" | "out" | "both";
  targetDist?: number;
  _index?: number;
}

export type FreshnessLevel = 'today' | 'recent' | 'week' | 'month' | 'stale';

export interface ListenItemFreshness {
  timestamp: number;
  dateStr: string;
  postCount: number;
  level: FreshnessLevel;
  relativeTime: string;
  formattedDate: string;
}

export type SystemOneState = Record<string, any> | any[] | string;
export type SystemOneQuestions = Record<string, any>;

export interface SystemOnePayload {
  state: SystemOneState;
  model: 'kev-latest';
  questions: SystemOneQuestions;
}

export interface SystemOneOptions {
  headers?: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface SystemOneParams {
  state: SystemOneState;
  questions: SystemOneQuestions;
  model?: string;
}
