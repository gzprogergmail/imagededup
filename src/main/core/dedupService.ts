import { stat } from "node:fs/promises";
import { resolve } from "node:path";

import { logEvent } from "../logger";
import { discoverImages } from "./imageDiscovery";
import { runFastPass, type HashProvider } from "./fastPass";
import type { ScanProgress, ImageRecord, DetectionResult, FolderPreview } from "../../shared/types";

export interface ScanCallbacks {
  onProgress: (progress: ScanProgress) => void;
  isCancelled: () => boolean;
}

class ProgressTracker {
  private totalFiles: number;
  private currentFile: number;
  private phase: ScanProgress["phase"];
  private startTime: number;
  private callbacks: ScanCallbacks;

  constructor(totalFiles: number, callbacks: ScanCallbacks) {
    this.totalFiles = totalFiles;
    this.currentFile = 0;
    this.phase = "discovering";
    this.startTime = performance.now();
    this.callbacks = callbacks;
  }

  setPhase(phase: ScanProgress["phase"]): void {
    this.phase = phase;
    this.reportProgress();
  }

  increment(currentPath?: string): void {
    if (this.callbacks.isCancelled()) return;
    this.currentFile++;
    this.reportProgress(currentPath);
  }

  advanceTo(currentFile: number, currentPath?: string): void {
    if (this.callbacks.isCancelled()) return;
    this.currentFile = currentFile;
    this.reportProgress(currentPath);
  }

  private reportProgress(currentPath?: string): void {
    if (this.callbacks.isCancelled()) return;

    const elapsed = performance.now() - this.startTime;
    const percentComplete = this.totalFiles > 0
      ? Math.round((this.currentFile / this.totalFiles) * 100)
      : 0;

    // Estimate remaining time based on average time per file
    const estimatedTimeRemainingMs = this.currentFile > 0
      ? Math.round((elapsed / this.currentFile) * (this.totalFiles - this.currentFile))
      : undefined;

    this.callbacks.onProgress({
      type: "progress",
      currentFile: this.currentFile,
      totalFiles: this.totalFiles,
      currentPath,
      phase: this.phase,
      percentComplete,
      estimatedTimeRemainingMs
    });
  }
}

class ProgressHashProvider implements HashProvider {
  private baseProvider: HashProvider;
  private tracker: ProgressTracker;
  private filePath: string | null = null;

  constructor(baseProvider: HashProvider, tracker: ProgressTracker) {
    this.baseProvider = baseProvider;
    this.tracker = tracker;
  }

  async getHashes(filePath: string): Promise<string[]> {
    this.filePath = filePath;
    const result = await this.baseProvider.getHashes(filePath);
    this.tracker.increment(filePath);
    return result;
  }
}

export async function scanFast(folder: string, callbacks?: ScanCallbacks): Promise<DetectionResult> {
  await logEvent("scan", "fast.requested", { folder });
  const files = await listImages(folder);
  await logEvent("scan", "fast.files_discovered", {
    fileCount: files.length,
    folder
  });

  const result = callbacks
    ? await runFastPassWithProgress(files, callbacks)
    : await runFastPass(files);

  await logEvent("scan", "fast.completed", {
    elapsedMs: result.elapsedMs,
    fileCount: files.length,
    groupCount: result.groups.length,
    warnings: result.warnings
  });
  return result;
}

export async function previewFolder(folder: string): Promise<FolderPreview> {
  const files = await listImages(folder);
  return {
    folder: resolve(folder),
    imageCount: files.length,
    samplePaths: files.slice(0, 6).map((file) => file.path)
  };
}

async function runFastPassWithProgress(
  files: ImageRecord[],
  callbacks: ScanCallbacks
): Promise<DetectionResult> {
  const { ImghashProvider } = await import("./fastPass");
  const tracker = new ProgressTracker(files.length, callbacks);
  tracker.setPhase("hashing");

  const baseProvider = new ImghashProvider();
  const progressProvider = new ProgressHashProvider(baseProvider, tracker);

  const result = await runFastPass(files, progressProvider);
  tracker.setPhase("complete");
  return result;
}

async function listImages(folder: string): Promise<ImageRecord[]> {
  const absoluteFolder = resolve(folder);
  await logEvent("scan", "folder.validating", { absoluteFolder });
  const folderStat = await stat(absoluteFolder);
  if (!folderStat.isDirectory()) {
    await logEvent("scan", "folder.invalid", { absoluteFolder }, "error");
    throw new Error(`Folder does not exist: ${absoluteFolder}`);
  }

  const images = await discoverImages(absoluteFolder);
  await logEvent("scan", "folder.validated", {
    absoluteFolder,
    imageCount: images.length
  });
  return images;
}
