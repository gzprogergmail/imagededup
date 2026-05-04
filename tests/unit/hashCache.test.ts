import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  CachedHashProvider,
  clearFolderHashCache,
  getFolderHashCacheInfo,
  readValidCachedHashes
} from "../../src/main/core/hashCache";
import type { HashProvider } from "../../src/main/core/fastPass";

describe("hash cache", () => {
  it("stores image hashes per file and reuses them without calling the provider", async () => {
    const folder = await mkdtemp(join(tmpdir(), "imagededup-cache-"));
    const cacheDir = await mkdtemp(join(tmpdir(), "imagededup-cache-store-"));
    const filePath = join(folder, "a.png");
    await writeFile(filePath, "fake image bytes");

    let callCount = 0;
    const provider: HashProvider = {
      getHashes: async () => {
        callCount++;
        return ["0000000000000000"];
      }
    };

    const first = new CachedHashProvider(folder, provider, { cacheDir });
    await expect(first.getHashes(filePath)).resolves.toEqual(["0000000000000000"]);
    await first.flush({ pruneMissingFiles: true });
    expect(callCount).toBe(1);
    expect(first.stats.writes).toBe(1);

    const second = new CachedHashProvider(folder, {
      getHashes: async () => {
        throw new Error("should not reprocess cached images");
      }
    }, { cacheDir });
    await expect(second.getHashes(filePath)).resolves.toEqual(["0000000000000000"]);
    await second.flush({ pruneMissingFiles: true });
    expect(second.stats.hits).toBe(1);

    const lookup = await readValidCachedHashes(folder, [{ path: filePath, basename: "a.png" }], { cacheDir });
    expect(lookup.records).toEqual([{ path: filePath, basename: "a.png", hashes: ["0000000000000000"] }]);
    expect(lookup.missingCount).toBe(0);
    expect(lookup.staleCount).toBe(0);
  });

  it("can force refresh cached hashes for an unchanged file", async () => {
    const folder = await mkdtemp(join(tmpdir(), "imagededup-cache-refresh-"));
    const cacheDir = await mkdtemp(join(tmpdir(), "imagededup-cache-store-refresh-"));
    const filePath = join(folder, "a.png");
    await writeFile(filePath, "fake image bytes");

    const initial = new CachedHashProvider(folder, { getHashes: async () => ["0000000000000000"] }, { cacheDir });
    await initial.getHashes(filePath);
    await initial.flush({ pruneMissingFiles: true });

    let refreshCalls = 0;
    const refreshed = new CachedHashProvider(folder, {
      getHashes: async () => {
        refreshCalls++;
        return ["0000000000000001"];
      }
    }, { cacheDir, forceRefresh: true });

    await expect(refreshed.getHashes(filePath)).resolves.toEqual(["0000000000000001"]);
    await refreshed.flush({ pruneMissingFiles: true });
    expect(refreshCalls).toBe(1);
    expect(refreshed.stats.writes).toBe(1);

    const lookup = await readValidCachedHashes(folder, [{ path: filePath, basename: "a.png" }], { cacheDir });
    expect(lookup.records[0]?.hashes).toEqual(["0000000000000001"]);
  });

  it("reports and clears cache entries for a folder", async () => {
    const folder = await mkdtemp(join(tmpdir(), "imagededup-cache-clear-"));
    const cacheDir = await mkdtemp(join(tmpdir(), "imagededup-cache-store-clear-"));
    const filePath = join(folder, "a.png");
    const files = [{ path: filePath, basename: "a.png" }];
    await writeFile(filePath, "fake image bytes");

    const provider = new CachedHashProvider(folder, { getHashes: async () => ["0000000000000000"] }, { cacheDir });
    await provider.getHashes(filePath);
    await provider.flush({ pruneMissingFiles: true });

    const before = await getFolderHashCacheInfo(folder, files, { cacheDir });
    expect(before.validEntryCount).toBe(1);
    expect(before.missingEntryCount).toBe(0);
    expect(before.totalEntries).toBe(1);

    await clearFolderHashCache(folder, { cacheDir });

    const after = await getFolderHashCacheInfo(folder, files, { cacheDir });
    expect(after.validEntryCount).toBe(0);
    expect(after.missingEntryCount).toBe(1);
  });

  it("reports stale and missing entries without reprocessing them", async () => {
    const folder = await mkdtemp(join(tmpdir(), "imagededup-cache-stale-"));
    const cacheDir = await mkdtemp(join(tmpdir(), "imagededup-cache-store-stale-"));
    const cachedPath = join(folder, "cached.png");
    const missingPath = join(folder, "missing.png");
    await writeFile(cachedPath, "initial bytes");
    await writeFile(missingPath, "missing bytes");

    const provider = new CachedHashProvider(folder, { getHashes: async () => ["0000000000000000"] }, { cacheDir });
    await provider.getHashes(cachedPath);
    await provider.flush({ pruneMissingFiles: true });

    await writeFile(cachedPath, "changed bytes with a different size");

    const files = [
      { path: cachedPath, basename: "cached.png" },
      { path: missingPath, basename: "missing.png" }
    ];
    const lookup = await readValidCachedHashes(folder, files, { cacheDir });
    expect(lookup.records).toHaveLength(0);
    expect(lookup.staleCount).toBe(1);
    expect(lookup.missingCount).toBe(1);

    const info = await getFolderHashCacheInfo(folder, files, { cacheDir });
    expect(info.staleEntryCount).toBe(1);
    expect(info.missingEntryCount).toBe(1);
  });

  it("uses the IMAGEDEDUP_CACHE_DIR fallback when no cache directory is supplied", async () => {
    const folder = await mkdtemp(join(tmpdir(), "imagededup-cache-env-"));
    const cacheDir = await mkdtemp(join(tmpdir(), "imagededup-cache-store-env-"));
    const filePath = join(folder, "a.png");
    await writeFile(filePath, "fake image bytes");

    const previous = process.env.IMAGEDEDUP_CACHE_DIR;
    process.env.IMAGEDEDUP_CACHE_DIR = cacheDir;
    try {
      const provider = new CachedHashProvider(folder, { getHashes: async () => ["0000000000000000"] });
      await provider.getHashes(filePath);
      await provider.flush({ pruneMissingFiles: true });

      const lookup = await readValidCachedHashes(folder, [{ path: filePath, basename: "a.png" }]);
      expect(lookup.records[0]?.hashes).toEqual(["0000000000000000"]);
    } finally {
      if (previous === undefined) {
        delete process.env.IMAGEDEDUP_CACHE_DIR;
      } else {
        process.env.IMAGEDEDUP_CACHE_DIR = previous;
      }
    }
  });
});
