import { stat } from "node:fs/promises";
import { resolve } from "node:path";

import { logEvent } from "../logger";
import { discoverImages, streamImages } from "./imageDiscovery";
import { runFastPass } from "./fastPass";
import type { ScanProgress, ImageRecord, DetectionResult, FolderPreview } from "../../shared/types";

export interface ScanCallbacks {
  onProgress: (progress: ScanProgress) => void;
  isCancelled: () => boolean;
}

export async function scanFast(folder: string, callbacks?: ScanCallbacks): Promise<DetectionResult> {
  await logEvent("scan", "fast.requested", { folder });
  const absoluteFolder = await validateFolder(folder);

  const result = callbacks
    ? await runFastPassWithProgress(absoluteFolder, callbacks)
    : await runFastPass(streamImages(absoluteFolder));

  await logEvent("scan", "fast.completed", {
    elapsedMs: result.elapsedMs,
    fileCount: result.scannedFileCount,
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
  folder: string,
  callbacks: ScanCallbacks
): Promise<DetectionResult> {
  const { ImghashProvider } = await import("./fastPass");

  const startTime = performance.now();
  let hashedCount = 0;
  let discoveredCount = 0;
  let timeToFirstFileMs: number | null = null;
  let timeToFirstHashMs: number | null = null;

  function ms(): number { return performance.now() - startTime; }

  function emitProgress(
    phase: ScanProgress["phase"],
    currentFile: number,
    totalFiles: number
  ): void {
    if (callbacks.isCancelled()) return;
    const elapsed = ms();
    const percentComplete = totalFiles > 0 ? Math.round((currentFile / totalFiles) * 100) : 0;
    const estimatedTimeRemainingMs =
      currentFile > 0 && totalFiles > currentFile
        ? Math.round((elapsed / currentFile) * (totalFiles - currentFile))
        : undefined;
    callbacks.onProgress({
      type: "progress",
      currentFile,
      totalFiles,
      phase,
      percentComplete,
      estimatedTimeRemainingMs
    });
  }

  // Signal immediately so the UI is never stuck on "Fast Pass is starting..."
  emitProgress("discovering", 0, 0);

  const result = await runFastPass(
    streamImages(folder),
    new ImghashProvider(),
    undefined,
    (done, total) => {
      emitProgress("comparing", done, total);
    },
    (hashed, discovered) => {
      if (timeToFirstHashMs === null) timeToFirstHashMs = ms();
      hashedCount = hashed;
      emitProgress("hashing", hashed, discovered);
    },
    (discovered) => {
      if (timeToFirstFileMs === null) timeToFirstFileMs = ms();
      discoveredCount = discovered;
      // Show live discovery count only while hashing has not started yet.
      if (hashedCount === 0) emitProgress("discovering", 0, discovered);
    },
    callbacks.isCancelled
  );

  await logEvent("scan", "fast.timing", {
    totalMs: Math.round(ms()),
    filesDiscovered: discoveredCount,
    timeToFirstFile_ms: timeToFirstFileMs !== null ? Math.round(timeToFirstFileMs) : null,
    timeToFirstHash_ms: timeToFirstHashMs !== null ? Math.round(timeToFirstHashMs) : null,
    hashingPhase_ms: timeToFirstHashMs !== null ? Math.round(ms() - timeToFirstHashMs) : null,
    note: "timeToFirstFile=glob/network latency; hashingPhase=per-file I/O cost x files/concurrency"
  });

  return result;
}

async function validateFolder(folder: string): Promise<string> {
  const absoluteFolder = resolve(folder);
  await logEvent("scan", "folder.validating", { absoluteFolder });
  const folderStat = await stat(absoluteFolder);
  if (!folderStat.isDirectory()) {
    await logEvent("scan", "folder.invalid", { absoluteFolder }, "error");
    throw new Error(`Folder does not exist: ${absoluteFolder}`);
  }
  return absoluteFolder;
}

async function listImages(folder: string): Promise<ImageRecord[]> {
  const absoluteFolder = await validateFolder(folder);
  const images = await discoverImages(absoluteFolder);
  await logEvent("scan", "folder.validated", {
    absoluteFolder,
    imageCount: images.length
  });
  return images;
}
