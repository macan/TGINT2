export interface ListenItem {
  id: string;
  name: string;
  isFolder: boolean;
  create_time: string;
  type?: "channel" | "keyword";
  argument?: string;
  description?: string;
  children?: ListenItem[];
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
}

export interface GraphEdge {
  source: string;
  target: string;
}
