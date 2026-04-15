export type DetectionMode = "fast" | "slow";

export interface DuplicateGroup {
  id: string;
  kind: DetectionMode;
  representative: string;
  files: string[];
  evidence: string;
  score?: number;
}

export interface DetectionResult {
  mode: DetectionMode;
  library: string;
  scannedFileCount: number;
  elapsedMs: number;
  groups: DuplicateGroup[];
  warnings: string[];
}

export interface ImageRecord {
  path: string;
  basename: string;
}
