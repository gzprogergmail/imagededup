import { stat } from "node:fs/promises";
import { resolve } from "node:path";

import { logEvent } from "../logger";
import { discoverImages, streamImages } from "./imageDiscovery";
import { buildDuplicateGroupsFromHashes, ImghashProvider, runFastPass } from "./fastPass";
import {
  CachedHashProvider,
  clearFolderHashCache,
  getFolderHashCacheInfo,
  readValidCachedHashes
} from "./hashCache";
import type {
  ScanProgress,
  ImageRecord,
  DetectionResult,
  DuplicateGroup,
  FolderPreview,
  HashCacheInfo,
  ScanCacheStats
} from "../../shared/types";

export interface ScanCallbacks {
  onProgress: (progress: ScanProgress) => void;
  onPartialGroups?: (groups: DuplicateGroup[], scannedSoFar: number, totalFiles: number) => void;
  isCancelled: () => boolean;
}

export interface ScanFastOptions {
  forceRefreshCache?: boolean;
}

export async function scanFast(
  folder: string,
  callbacks?: ScanCallbacks,
  hammingThreshold?: number,
  options: ScanFastOptions = {}
): Promise<DetectionResult> {
  await logEvent("scan", "fast.requested", { folder, forceRefreshCache: options.forceRefreshCache === true });
  const absoluteFolder = await validateFolder(folder);

  const result = callbacks
    ? await runFastPassWithProgress(absoluteFolder, callbacks, hammingThreshold, options)
    : await runFastPassCached(absoluteFolder, hammingThreshold, options);

  await logEvent("scan", "fast.completed", {
    cacheStats: result.cacheStats,
    elapsedMs: result.elapsedMs,
    fileCount: result.scannedFileCount,
    groupCount: result.groups.length,
    warnings: result.warnings
  });
  return result;
}

export async function rematchFastFromCache(folder: string, hammingThreshold?: number): Promise<DetectionResult> {
  await logEvent("scan", "fast.rematch.requested", { folder, hammingThreshold });
  const absoluteFolder = await validateFolder(folder);
  const files = await discoverImages(absoluteFolder);
  const startedAt = performance.now();
  const cached = await readValidCachedHashes(absoluteFolder, files);

  if (cached.missingCount > 0 || cached.staleCount > 0) {
    const totalUnavailable = cached.missingCount + cached.staleCount;
    throw new Error(
      `Cache is missing or stale for ${totalUnavailable} of ${files.length} images. Run Fast Pass or Force Update Cache first.`
    );
  }

  const groups = buildDuplicateGroupsFromHashes(cached.records, hammingThreshold);
  const result: DetectionResult = {
    cacheStats: {
      errors: 0,
      hits: cached.records.length,
      misses: cached.missingCount,
      stale: cached.staleCount,
      writes: 0
    },
    elapsedMs: Math.round(performance.now() - startedAt),
    groups,
    library: "imghash + flat-cache",
    mode: "fast",
    scannedFileCount: files.length,
    warnings: []
  };

  await logEvent("scan", "fast.rematch.completed", {
    elapsedMs: result.elapsedMs,
    fileCount: result.scannedFileCount,
    groupCount: result.groups.length
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

export async function inspectHashCache(folder: string): Promise<HashCacheInfo> {
  const files = await listImages(folder);
  return getFolderHashCacheInfo(resolve(folder), files);
}

export async function clearHashCache(folder: string): Promise<HashCacheInfo> {
  const absoluteFolder = await validateFolder(folder);
  await clearFolderHashCache(absoluteFolder);
  await logEvent("scan", "cache.cleared", { folder: absoluteFolder });
  const files = await discoverImages(absoluteFolder);
  return getFolderHashCacheInfo(absoluteFolder, files);
}

async function runFastPassWithProgress(
  folder: string,
  callbacks: ScanCallbacks,
  hammingThreshold?: number,
  options: ScanFastOptions = {}
): Promise<DetectionResult> {
  const startTime = performance.now();
  const hashProvider = new CachedHashProvider(folder, new ImghashProvider(), {
    forceRefresh: options.forceRefreshCache === true
  });
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
    hashProvider,
    hammingThreshold,
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
    callbacks.isCancelled,
    (groups, scannedSoFar, totalFiles) => {
      callbacks.onPartialGroups?.(groups, scannedSoFar, totalFiles);
    }
  ).finally(async () => {
    await hashProvider.flush({ pruneMissingFiles: !callbacks.isCancelled() });
  });

  await logEvent("scan", "fast.timing", {
    cacheStats: hashProvider.stats,
    totalMs: Math.round(ms()),
    filesDiscovered: discoveredCount,
    timeToFirstFile_ms: timeToFirstFileMs !== null ? Math.round(timeToFirstFileMs) : null,
    timeToFirstHash_ms: timeToFirstHashMs !== null ? Math.round(timeToFirstHashMs) : null,
    hashingPhase_ms: timeToFirstHashMs !== null ? Math.round(ms() - timeToFirstHashMs) : null,
    note: "timeToFirstFile=glob/network latency; hashingPhase=per-file I/O cost x files/concurrency"
  });

  return withCacheStats(result, hashProvider.stats);
}

async function runFastPassCached(
  folder: string,
  hammingThreshold?: number,
  options: ScanFastOptions = {}
): Promise<DetectionResult> {
  const hashProvider = new CachedHashProvider(folder, new ImghashProvider(), {
    forceRefresh: options.forceRefreshCache === true
  });

  const result = await runFastPass(
    streamImages(folder),
    hashProvider,
    hammingThreshold
  ).finally(async () => {
    await hashProvider.flush({ pruneMissingFiles: true });
  });

  return withCacheStats(result, hashProvider.stats);
}

function withCacheStats(result: DetectionResult, cacheStats: ScanCacheStats): DetectionResult {
  return {
    ...result,
    cacheStats,
    library: "imghash + flat-cache"
  };
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
