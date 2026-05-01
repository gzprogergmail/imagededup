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

  function emitProgress(
    phase: ScanProgress["phase"],
    currentFile: number,
    totalFiles: number
  ): void {
    if (callbacks.isCancelled()) return;
    const elapsed = performance.now() - startTime;
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

  // Signal immediately so the UI is never stuck on "Fast Pass is starting…"
  emitProgress("discovering", 0, 0);

  return runFastPass(
    streamImages(folder),
    new ImghashProvider(),
    undefined,
    (done, total) => {
      emitProgress("comparing", done, total);
    },
    (hashed, discovered) => {
      hashedCount = hashed;
      emitProgress("hashing", hashed, discovered);
    },
    (discovered) => {
      // Show live discovery count only while hashing hasn’t started yet.
      if (hashedCount === 0) emitProgress("discovering", 0, discovered);
    },
    callbacks.isCancelled
  );
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
