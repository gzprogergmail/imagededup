import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

import { app } from "electron";
import { clearCacheById, create, type FlatCache } from "flat-cache";

import { ImghashProvider, type HashProvider, type HashedImageRecord } from "./fastPass";
import type { HashCacheInfo, ImageRecord, ScanCacheStats } from "../../shared/types";

const CACHE_DIRECTORY_NAME = "image-hash-cache";
const CACHE_LRU_SIZE = 250_000;
const HASH_CACHE_SCHEMA_VERSION = 1;
const HASH_ALGORITHM_VERSION = "dct-phash-v1-32px-8x8-rotations4";

export const HASH_CACHE_TTL_MS = 365 * 24 * 60 * 60 * 1000;
export const HASH_CACHE_TTL_DAYS = Math.round(HASH_CACHE_TTL_MS / (24 * 60 * 60 * 1000));

interface CachedImageHashRecord {
  schemaVersion: number;
  algorithmVersion: string;
  filePath: string;
  basename: string;
  hashes: string[];
  size: number;
  mtimeMs: number;
  cachedAt: string;
}

interface FolderCacheOptions {
  cacheDir?: string;
}

export interface CachedHashProviderOptions extends FolderCacheOptions {
  forceRefresh?: boolean;
}

export interface CachedHashLookupResult {
  records: HashedImageRecord[];
  missingCount: number;
  staleCount: number;
}

export class CachedHashProvider implements HashProvider {
  readonly stats: ScanCacheStats = {
    errors: 0,
    hits: 0,
    misses: 0,
    stale: 0,
    writes: 0
  };

  private cachePromise: Promise<FlatCache> | null = null;
  private readonly seenFiles = new Set<string>();

  constructor(
    private readonly folder: string,
    private readonly hashProvider: HashProvider = new ImghashProvider(),
    private readonly options: CachedHashProviderOptions = {}
  ) {}

  async getHashes(filePath: string): Promise<string[]> {
    const absolutePath = resolve(filePath);
    this.seenFiles.add(absolutePath);

    const fileStat = await stat(absolutePath);
    const cache = await this.getCache();
    const cached = cache.get<CachedImageHashRecord | undefined>(absolutePath);

    if (!this.options.forceRefresh && isValidCachedRecord(cached, absolutePath, fileStat)) {
      this.stats.hits++;
      return [...cached.hashes];
    }

    if (this.options.forceRefresh) {
      this.stats.misses++;
    } else if (cached) {
      this.stats.stale++;
    } else {
      this.stats.misses++;
    }

    try {
      const hashes = await this.hashProvider.getHashes(absolutePath);
      cache.set(absolutePath, createCacheRecord(absolutePath, hashes, fileStat), HASH_CACHE_TTL_MS);
      this.stats.writes++;
      return hashes;
    } catch (error) {
      this.stats.errors++;
      throw error;
    }
  }

  async flush(options: { pruneMissingFiles?: boolean } = {}): Promise<void> {
    if (!this.cachePromise) {
      return;
    }

    const cache = await this.cachePromise;
    if (options.pruneMissingFiles) {
      for (const key of cache.keys()) {
        if (!this.seenFiles.has(resolve(key))) {
          cache.delete(key);
        }
      }
    }

    cache.save();
  }

  private async getCache(): Promise<FlatCache> {
    this.cachePromise ??= openFolderHashCache(this.folder, this.options);
    return this.cachePromise;
  }
}

export async function readValidCachedHashes(
  folder: string,
  files: ImageRecord[],
  options: FolderCacheOptions = {}
): Promise<CachedHashLookupResult> {
  const cache = await openFolderHashCache(folder, options);
  const records: HashedImageRecord[] = [];
  let missingCount = 0;
  let staleCount = 0;

  for (const file of files) {
    const absolutePath = resolve(file.path);
    const fileStat = await stat(absolutePath);
    const cached = cache.get<CachedImageHashRecord | undefined>(absolutePath);

    if (isValidCachedRecord(cached, absolutePath, fileStat)) {
      records.push({
        basename: file.basename,
        hashes: [...cached.hashes],
        path: absolutePath
      });
    } else if (cached) {
      staleCount++;
    } else {
      missingCount++;
    }
  }

  return { missingCount, records, staleCount };
}

export async function getFolderHashCacheInfo(
  folder: string,
  files: ImageRecord[],
  options: FolderCacheOptions = {}
): Promise<HashCacheInfo> {
  const cache = await openFolderHashCache(folder, options);
  let validEntryCount = 0;
  let missingEntryCount = 0;
  let staleEntryCount = 0;

  for (const file of files) {
    const absolutePath = resolve(file.path);
    const fileStat = await stat(absolutePath);
    const cached = cache.get<CachedImageHashRecord | undefined>(absolutePath);
    if (isValidCachedRecord(cached, absolutePath, fileStat)) {
      validEntryCount++;
    } else if (cached) {
      staleEntryCount++;
    } else {
      missingEntryCount++;
    }
  }

  const cacheFile = cache.cacheFilePath;
  const cacheFileStat = await stat(cacheFile).catch(() => null);

  return {
    cacheFilePath: cacheFile,
    currentImageCount: files.length,
    folder: resolve(folder),
    missingEntryCount,
    sizeBytes: cacheFileStat?.size ?? 0,
    staleEntryCount,
    totalEntries: cache.keys().length,
    ttlDays: HASH_CACHE_TTL_DAYS,
    updatedAt: cacheFileStat ? new Date(cacheFileStat.mtimeMs).toISOString() : undefined,
    validEntryCount
  };
}

export async function clearFolderHashCache(folder: string, options: FolderCacheOptions = {}): Promise<void> {
  const cacheRoot = await getHashCacheRoot(options.cacheDir);
  clearCacheById(cacheIdForFolder(folder), cacheRoot);
}

async function openFolderHashCache(folder: string, options: FolderCacheOptions = {}): Promise<FlatCache> {
  return create({
    cacheDir: await getHashCacheRoot(options.cacheDir),
    cacheId: cacheIdForFolder(folder),
    lruSize: CACHE_LRU_SIZE,
    ttl: HASH_CACHE_TTL_MS
  });
}

async function getHashCacheRoot(cacheDir?: string): Promise<string> {
  if (cacheDir) {
    return resolve(cacheDir);
  }

  const baseDirectory = typeof app?.isReady === "function" && app.isReady()
    ? app.getPath("userData")
    : process.env.IMAGEDEDUP_CACHE_DIR ?? tmpdir();

  return join(baseDirectory, CACHE_DIRECTORY_NAME);
}

function cacheIdForFolder(folder: string): string {
  const absoluteFolder = resolve(folder);
  const digest = createHash("sha256").update(absoluteFolder.toLowerCase()).digest("hex").slice(0, 32);
  return `folder-${digest}`;
}

function createCacheRecord(filePath: string, hashes: string[], fileStat: Awaited<ReturnType<typeof stat>>): CachedImageHashRecord {
  return {
    algorithmVersion: HASH_ALGORITHM_VERSION,
    basename: basename(filePath),
    cachedAt: new Date().toISOString(),
    filePath,
    hashes: [...new Set(hashes)],
    mtimeMs: Number(fileStat.mtimeMs),
    schemaVersion: HASH_CACHE_SCHEMA_VERSION,
    size: Number(fileStat.size)
  };
}

function isValidCachedRecord(
  value: CachedImageHashRecord | undefined,
  filePath: string,
  fileStat: Awaited<ReturnType<typeof stat>>
): value is CachedImageHashRecord {
  return Boolean(
    value &&
    value.schemaVersion === HASH_CACHE_SCHEMA_VERSION &&
    value.algorithmVersion === HASH_ALGORITHM_VERSION &&
    value.filePath === filePath &&
    Array.isArray(value.hashes) &&
    value.hashes.length > 0 &&
    value.hashes.every((hash) => /^[0-9a-f]{16}$/i.test(hash)) &&
    value.size === Number(fileStat.size) &&
    Math.abs(value.mtimeMs - Number(fileStat.mtimeMs)) < 1
  );
}
