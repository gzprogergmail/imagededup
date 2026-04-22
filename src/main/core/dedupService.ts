import { stat } from "node:fs/promises";
import { resolve } from "node:path";

import { logEvent } from "../logger";
import { discoverImages } from "./imageDiscovery";
import { runFastPass, type HashProvider } from "./fastPass";
import { pairKeyFor, runSlowPass, type SlowPassOptions } from "./slowPass";
import type { ScanProgress, ImageRecord, DetectionResult, FolderPreview } from "../../shared/types";

export interface ScanCallbacks {
  onProgress: (progress: ScanProgress) => void;
  isCancelled: () => boolean;
}

interface CachedFastPassMatches {
  fingerprint: string;
  skipPairs: Set<string>;
}

const fastPassMatchesByFolder = new Map<string, CachedFastPassMatches>();

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
  const folderKey = resolve(folder);
  const fingerprint = fingerprintForFiles(files);
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
  fastPassMatchesByFolder.set(folderKey, {
    fingerprint,
    skipPairs: buildSkipPairs(result)
  });
  return result;
}

export async function scanSlow(folder: string, callbacks?: ScanCallbacks): Promise<DetectionResult> {
  await logEvent("scan", "slow.requested", { folder });
  const files = await listImages(folder);
  const folderKey = resolve(folder);
  const fingerprint = fingerprintForFiles(files);
  const cachedFastPass = fastPassMatchesByFolder.get(folderKey);
  const slowPassOptions: SlowPassOptions = (
    cachedFastPass && cachedFastPass.fingerprint === fingerprint
  )
    ? { skipPairs: cachedFastPass.skipPairs }
    : {};
  await logEvent("scan", "slow.files_discovered", {
    fileCount: files.length,
    folder
  });
  await logEvent("scan", "slow.fast_pass_reuse", {
    folder,
    reusedPairs: slowPassOptions.skipPairs?.size ?? 0,
    usedCachedFastPass: Boolean(slowPassOptions.skipPairs)
  });

  const result = callbacks
    ? await runSlowPassWithProgress(files, callbacks, slowPassOptions)
    : await runSlowPass(files, {}, slowPassOptions);

  await logEvent("scan", "slow.completed", {
    diagnostics: result.diagnostics,
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

async function runSlowPassWithProgress(
  files: ImageRecord[],
  callbacks: ScanCallbacks,
  options: SlowPassOptions = {}
): Promise<DetectionResult> {
  const signatureTracker = new ProgressTracker(files.length, callbacks);
  signatureTracker.setPhase("hashing");

  const comparisonTotal = (files.length * (files.length - 1)) / 2;
  const comparisonTracker = new ProgressTracker(comparisonTotal, callbacks);
  const comparisonStep = comparisonTotal <= 120 ? 1 : Math.max(1, Math.floor(comparisonTotal / 120));
  let comparisonPhaseStarted = false;

  const result = await runSlowPass(files, {
    isCancelled: callbacks.isCancelled,
    onComparison: (completed) => {
      if (!comparisonPhaseStarted) {
        return;
      }

      if (completed !== comparisonTotal && completed % comparisonStep !== 0) {
        return;
      }

      comparisonTracker.advanceTo(completed);
    },
    onComparisonStart: () => {
      comparisonPhaseStarted = true;
      comparisonTracker.setPhase("comparing");
    },
    onSignature: (filePath) => {
      signatureTracker.increment(filePath);
    }
  }, options);

  if (comparisonPhaseStarted) {
    comparisonTracker.setPhase("complete");
  }
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

function buildSkipPairs(result: DetectionResult): Set<string> {
  const skipPairs = new Set<string>();

  for (const group of result.groups) {
    for (let leftIndex = 0; leftIndex < group.files.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < group.files.length; rightIndex += 1) {
        const left = group.files[leftIndex];
        const right = group.files[rightIndex];
        if (!left || !right) {
          continue;
        }

        skipPairs.add(pairKeyFor(left, right));
      }
    }
  }

  return skipPairs;
}

function fingerprintForFiles(files: ImageRecord[]): string {
  return files.map((file) => file.path).sort().join("\n");
}
