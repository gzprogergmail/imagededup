export type DetectionMode = "fast";

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

export interface FolderPreview {
  folder: string;
  imageCount: number;
  samplePaths: string[];
}

export interface ScanProgress {
  type: "progress";
  currentFile: number;
  totalFiles: number;
  currentPath?: string;
  phase: "discovering" | "hashing" | "comparing" | "complete";
  percentComplete: number;
  estimatedTimeRemainingMs?: number;
}

export type ScanUpdate =
  | ScanProgress
  | { type: "complete"; result: DetectionResult }
  | { type: "error"; message: string }
  | { type: "cancelled" }
  | { type: "partial"; groups: DuplicateGroup[]; scannedSoFar: number; totalFiles: number };
