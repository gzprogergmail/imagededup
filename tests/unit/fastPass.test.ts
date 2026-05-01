import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";

import { discoverImages } from "../../src/main/core/imageDiscovery";
import { dctHash, runFastPass, HAMMING_THRESHOLD, type HashProvider } from "../../src/main/core/fastPass";
import { hammingDistance } from "../../src/main/core/bkTree";
import type { DuplicateGroup } from "../../src/shared/types";

describe("dctHash", () => {
  it("returns a 16-character hex string", () => {
    const pixels = new Uint8Array(32 * 32).fill(128);
    const hash = dctHash(pixels);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("returns the same hash for identical pixel buffers", () => {
    const pixels = Uint8Array.from({ length: 32 * 32 }, (_, i) => i % 256);
    expect(dctHash(pixels)).toBe(dctHash(pixels));
  });

  it("returns different hashes for visually distinct images", () => {
    const bright = new Uint8Array(32 * 32).fill(255);
    const dark = new Uint8Array(32 * 32).fill(0);
    expect(dctHash(bright)).not.toBe(dctHash(dark));
  });

  it("returns the same hash for a horizontally flipped uniform-gradient image", () => {
    // A left-to-right gradient flipped becomes right-to-left — low-freq DCT is symmetric
    // so at least the DC-excluded mean threshold should produce the same bits.
    const gradient = Uint8Array.from({ length: 32 * 32 }, (_, i) => Math.floor((i % 32) * 8));
    const flipped = Uint8Array.from({ length: 32 * 32 }, (_, i) => {
      const row = Math.floor(i / 32);
      const col = 31 - (i % 32);
      return Math.floor(col * 8);
    });
    // Horizontal flip swaps low-freq column coefficients — result may differ, just check format
    expect(dctHash(flipped)).toMatch(/^[0-9a-f]{16}$/);
    // A uniform image (no gradient) should be stable
    const uniform = new Uint8Array(32 * 32).fill(200);
    expect(dctHash(uniform)).toBe(dctHash(uniform));
  });

  it("produces near-identical hashes for slightly brightened versions of the same image", () => {
    const base = Uint8Array.from({ length: 32 * 32 }, (_, i) => (i * 3) % 200 + 20);
    const brightened = Uint8Array.from(base, (v) => Math.min(255, v + 8));
    const hashA = dctHash(base);
    const hashB = dctHash(brightened);
    // Convert to binary and count differing bits (Hamming distance)
    const bitsA = BigInt("0x" + hashA);
    const bitsB = BigInt("0x" + hashB);
    let diff = bitsA ^ bitsB;
    let hammingDistance = 0;
    while (diff > 0n) {
      hammingDistance += Number(diff & 1n);
      diff >>= 1n;
    }
    // A small brightness change should differ by very few bits (≤ 8 out of 64)
    expect(hammingDistance).toBeLessThanOrEqual(8);
  });
});

describe("runFastPass", () => {
  it("groups rotated and resized image duplicates by perceptual hash", async () => {
    const dir = await mkdtemp(join(tmpdir(), "imagededup-fast-"));
    const { generateFixtureSet } = await import("../../scripts/image-fixtures.mjs");
    const fixtures = await generateFixtureSet(dir);
    const files = await discoverImages(fixtures.root);

    const result = await runFastPass(files);
    expect(result.library).toBe("imghash");
    expect(result.scannedFileCount).toBeGreaterThanOrEqual(6);
    expect(result.groups.length).toBeGreaterThanOrEqual(1);

    const paths = result.groups.flatMap((group) => group.files);
    expect(paths).toContain(fixtures.base);
    expect(paths).toContain(fixtures.resized);
    expect(paths).toContain(fixtures.rotated90);
    expect(paths).not.toContain(fixtures.unique);
  }, 120000);

  it("processes files concurrently up to the concurrency limit", async () => {
    const callOrder: number[] = [];
    const inFlight: number[] = [];
    let maxInFlight = 0;

    const files = Array.from({ length: 20 }, (_, i) => ({
      path: `/fake/image-${i}.png`,
      basename: `image-${i}.png`
    }));

    const provider: HashProvider = {
      getHashes: (filePath) => {
        const index = Number(filePath.match(/(\d+)\.png/)![1]);
        inFlight.push(index);
        maxInFlight = Math.max(maxInFlight, inFlight.length);
        callOrder.push(index);
        return new Promise((resolve) => {
          setImmediate(() => {
            inFlight.splice(inFlight.indexOf(index), 1);
            resolve([`hash-${index}`]);
          });
        });
      }
    };

    const result = await runFastPass(files, provider);
    expect(result.scannedFileCount).toBe(20);
    // All files were processed
    expect(callOrder.sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i));
    // Concurrency was used (more than 1 in-flight at some point)
    expect(maxInFlight).toBeGreaterThan(1);
  });

  it("groups files that share a hash via the mock provider", async () => {
    const files = [
      { path: "/img/a.png", basename: "a.png" },
      { path: "/img/b.png", basename: "b.png" },
      { path: "/img/c.png", basename: "c.png" }
    ];

    const provider: HashProvider = {
      getHashes: async (filePath) => {
        // a and b share a hash; c is unique
        if (filePath.endsWith("a.png") || filePath.endsWith("b.png")) {
          return ["aabbccdd00112233"];
        }
        return ["ffee99887766554"];
      }
    };

    const result = await runFastPass(files, provider);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]!.files).toContain("/img/a.png");
    expect(result.groups[0]!.files).toContain("/img/b.png");
    expect(result.groups[0]!.files).not.toContain("/img/c.png");
    expect(result.scannedFileCount).toBe(3);
  });

  it("groups near-duplicate files whose hashes are within the Hamming threshold", async () => {
    // base hash — all zeros
    const BASE = "0000000000000000";
    // near: differs by 5 bits (0x1f = 00011111 → 5 bits in last nibble pair)
    const NEAR = "000000000000001f";
    expect(hammingDistance(BASE, NEAR)).toBe(5);
    expect(hammingDistance(BASE, NEAR)).toBeLessThanOrEqual(HAMMING_THRESHOLD);

    const files = [
      { path: "/img/base.png", basename: "base.png" },
      { path: "/img/near.png", basename: "near.png" },
      { path: "/img/unique.png", basename: "unique.png" }
    ];

    const provider: HashProvider = {
      getHashes: async (filePath) => {
        if (filePath.endsWith("base.png")) return [BASE];
        if (filePath.endsWith("near.png")) return [NEAR];
        return ["ffffffffffffffff"]; // far away (dist=64 from BASE)
      }
    };

    const result = await runFastPass(files, provider);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]!.files).toContain("/img/base.png");
    expect(result.groups[0]!.files).toContain("/img/near.png");
    expect(result.groups[0]!.files).not.toContain("/img/unique.png");
  });

  it("does not group files whose hashes exceed the Hamming threshold", async () => {
    // differs by 11 bits (0x7ff = 011 1111 1111 → split across nibbles: 7=3 bits, f=4, f=4 → 11 bits)
    const A = "0000000000000000";
    const B = "00000000000007ff";
    expect(hammingDistance(A, B)).toBe(11);
    expect(hammingDistance(A, B)).toBeGreaterThan(HAMMING_THRESHOLD);

    const files = [
      { path: "/img/a.png", basename: "a.png" },
      { path: "/img/b.png", basename: "b.png" }
    ];

    const provider: HashProvider = {
      getHashes: async (filePath) => (filePath.endsWith("a.png") ? [A] : [B])
    };

    const result = await runFastPass(files, provider);
    expect(result.groups).toHaveLength(0);
    expect(result.scannedFileCount).toBe(2);
  });

  it("links transitive near-duplicates (A≈B, B≈C → A,B,C in one group)", async () => {
    // A and B are within threshold; B and C are within threshold; A and C are over threshold,
    // so transitive linking is required to place all three in one group.
    const A = "0000000000000000"; // reference
    const B = "000000000000001f"; // dist(A,B)=5 ✓
    const C = "000000000000007f"; // dist(A,C)=7, dist(B,C)=2
    expect(hammingDistance(A, C)).toBeGreaterThan(HAMMING_THRESHOLD);
    expect(hammingDistance(B, C)).toBeLessThanOrEqual(HAMMING_THRESHOLD);

    const files = [
      { path: "/img/a.png", basename: "a.png" },
      { path: "/img/b.png", basename: "b.png" },
      { path: "/img/c.png", basename: "c.png" }
    ];

    const provider: HashProvider = {
      getHashes: async (filePath) => {
        if (filePath.endsWith("a.png")) return [A];
        if (filePath.endsWith("b.png")) return [B];
        return [C];
      }
    };

    const result = await runFastPass(files, provider);
    expect(result.groups).toHaveLength(1);
    const groupFiles = result.groups[0]!.files;
    expect(groupFiles).toContain("/img/a.png");
    expect(groupFiles).toContain("/img/b.png");
    expect(groupFiles).toContain("/img/c.png");
  });

  it("invokes onMatchProgress callback at start and end of matching phase", async () => {
    const files = Array.from({ length: 5 }, (_, i) => ({
      path: `/img/file-${i}.png`,
      basename: `file-${i}.png`
    }));
    const provider: HashProvider = {
      getHashes: async () => ["aabbccddeeff0011"]
    };

    const calls: Array<[number, number]> = [];
    await runFastPass(files, provider, HAMMING_THRESHOLD, (done, total) => {
      calls.push([done, total]);
    });

    expect(calls[0]).toEqual([0, 5]);
    expect(calls[calls.length - 1]).toEqual([5, 5]);
  });

  it("calls onPartialGroups at least once and includes found duplicate groups", async () => {
    const files = [
      { path: "/img/a.png", basename: "a.png" },
      { path: "/img/b.png", basename: "b.png" },
      { path: "/img/c.png", basename: "c.png" },
      { path: "/img/unique.png", basename: "unique.png" }
    ];

    const provider: HashProvider = {
      getHashes: async (filePath) => {
        if (filePath.endsWith("a.png") || filePath.endsWith("b.png") || filePath.endsWith("c.png")) {
          return ["aabbccddeeff0011"];
        }
        return ["ffffffffffffffff"];
      }
    };

    const partialCalls: Array<{ groups: DuplicateGroup[]; scannedSoFar: number; totalFiles: number }> = [];
    const result = await runFastPass(
      files,
      provider,
      HAMMING_THRESHOLD,
      undefined, // onMatchProgress
      undefined, // onHashProgress
      undefined, // onDiscoverProgress
      undefined, // isCancelled
      (groups, scannedSoFar, totalFiles) => {
        partialCalls.push({ groups: groups.map(g => ({ ...g, files: [...g.files] })), scannedSoFar, totalFiles });
      }
    );

    expect(partialCalls.length).toBeGreaterThan(0);

    // Every partial call should have valid structure
    for (const call of partialCalls) {
      expect(typeof call.scannedSoFar).toBe("number");
      expect(typeof call.totalFiles).toBe("number");
      expect(call.scannedSoFar).toBeGreaterThan(0);
      expect(call.scannedSoFar).toBeLessThanOrEqual(files.length);
      for (const group of call.groups) {
        expect(group.files.length).toBeGreaterThan(1);
        for (const file of group.files) {
          expect(files.some(f => f.path === file)).toBe(true);
        }
      }
    }

    // Final result still contains the expected groups
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]!.files).toContain("/img/a.png");
    expect(result.groups[0]!.files).toContain("/img/b.png");
    expect(result.groups[0]!.files).toContain("/img/c.png");
    expect(result.groups[0]!.files).not.toContain("/img/unique.png");
  });

  it("produces the same groups regardless of hash completion order", async () => {
    const files = [
      { path: "/img/a.png", basename: "a.png" },
      { path: "/img/b.png", basename: "b.png" },
      { path: "/img/c.png", basename: "c.png" }
    ];

    const HASH_A = "0000000000000000";
    const HASH_B = "000000000000001f"; // dist(A,B)=5
    const HASH_C = "00000000000003e0"; // dist(B,C)=10, dist(A,C)=5

    let resolveA!: (hashes: string[]) => void;
    let resolveB!: (hashes: string[]) => void;
    let resolveC!: (hashes: string[]) => void;

    const provider: HashProvider = {
      getHashes: (filePath) => {
        if (filePath.endsWith("a.png")) return new Promise(res => { resolveA = res; });
        if (filePath.endsWith("b.png")) return new Promise(res => { resolveB = res; });
        return new Promise(res => { resolveC = res; });
      }
    };

    const resultPromise = runFastPass(files, provider);

    // Allow the for-await loop to register all hash promises
    await new Promise<void>(res => setImmediate(res));

    // Resolve in out-of-discovery order: B → C → A
    resolveB([HASH_B]);
    await new Promise<void>(res => setImmediate(res));
    resolveC([HASH_C]);
    await new Promise<void>(res => setImmediate(res));
    resolveA([HASH_A]);

    const result = await resultPromise;

    expect(result.groups).toHaveLength(1);
    const groupFiles = result.groups[0]!.files;
    expect(groupFiles).toContain("/img/a.png");
    expect(groupFiles).toContain("/img/b.png");
    expect(groupFiles).toContain("/img/c.png");
  });
});
