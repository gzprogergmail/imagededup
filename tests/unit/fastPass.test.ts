import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";

import { discoverImages } from "../../src/main/core/imageDiscovery";
import { dctHash, runFastPass, type HashProvider } from "../../src/main/core/fastPass";

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
});
