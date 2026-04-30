import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import { renderGroupMarkup } from "../../src/renderer/view";
import { dctHash, ImghashProvider, HAMMING_THRESHOLD } from "../../src/main/core/fastPass";
import { BKTree, hammingDistance } from "../../src/main/core/bkTree";
import type { DuplicateGroup } from "../../src/shared/types";

function createGroup(index: number): DuplicateGroup {
  return {
    evidence: `hash-${index}`,
    files: [`image-${index}.png`, `image-${index}-copy.png`],
    id: `group-${index}`,
    kind: "fast",
    representative: `image-${index}.png`
  };
}

describe("renderer performance", () => {
  it("renders 500 groups within an acceptable budget", () => {
    const groups = Array.from({ length: 500 }, (_, index) => createGroup(index));
    const startedAt = performance.now();
    const markup = groups.map(renderGroupMarkup).join("");
    const elapsed = performance.now() - startedAt;

    expect(markup.length).toBeGreaterThan(1000);
    expect(elapsed).toBeLessThan(150);
  });
});

describe("dctHash performance", () => {
  it("hashes 1000 synthetic 32×32 pixel buffers under 200 ms", () => {
    const RUNS = 1000;
    // Use a variety of synthetic images to avoid branch prediction optimisation
    const buffers = Array.from({ length: RUNS }, (_, i) =>
      Uint8Array.from({ length: 32 * 32 }, (_, j) => (i * 7 + j * 3) % 256)
    );

    const startedAt = performance.now();
    for (const buf of buffers) {
      dctHash(buf);
    }
    const elapsed = performance.now() - startedAt;

    // 1000 hashes / elapsed ms → ops/sec
    const opsPerSec = Math.round(1000 / elapsed * 1000);
    console.log(`dctHash: ${elapsed.toFixed(1)} ms for 1000 hashes (${opsPerSec.toLocaleString()} ops/sec)`);

    expect(elapsed).toBeLessThan(200);
  });

  it("hashes a real image file in under 100 ms (ImghashProvider, all 4 rotations)", async () => {
    const { generateFixtureSet } = await import("../../scripts/image-fixtures.mjs");
    const dir = await mkdtemp(join(tmpdir(), "imagededup-perf-"));
    const fixtures = await generateFixtureSet(dir);

    const provider = new ImghashProvider();

    // Warm up
    await provider.getHashes(fixtures.base);

    const startedAt = performance.now();
    const RUNS = 10;
    for (let i = 0; i < RUNS; i++) {
      await provider.getHashes(fixtures.base);
    }
    const avgMs = (performance.now() - startedAt) / RUNS;

    const projectedMins1M = Math.round(avgMs * 1_000_000 / 16 / 60_000);
    console.log(`ImghashProvider: ${avgMs.toFixed(1)} ms/file → ~${projectedMins1M} min for 1M files at concurrency=16`);

    expect(avgMs).toBeLessThan(100);
  }, 30000);
});

describe("BKTree performance", () => {
  /** Deterministic pseudo-random 16-char hex hash for index n. */
  function deterministicHash(n: number): string {
    const a = (Math.imul(n, 0x9e3779b9) >>> 0).toString(16).padStart(8, "0");
    const b = (Math.imul(n, 0x6c62272e) >>> 0).toString(16).padStart(8, "0");
    return a + b;
  }

  it("inserts 10 000 hashes in under 500 ms", () => {
    const N = 10_000;
    const tree = new BKTree();
    const hashes = Array.from({ length: N }, (_, i) => deterministicHash(i));

    const startedAt = performance.now();
    for (let i = 0; i < N; i++) {
      tree.insert(hashes[i]!, `/img/${i}.png`);
    }
    const elapsed = performance.now() - startedAt;

    console.log(`BKTree.insert: ${elapsed.toFixed(1)} ms for ${N.toLocaleString()} entries (tree size=${tree.size})`);
    expect(tree.size).toBeLessThanOrEqual(N);
    expect(elapsed).toBeLessThan(500);
  });

  it("queries 500 times on a 10 000-entry tree in under 10 000 ms", () => {
    const N = 10_000;
    const QUERIES = 500;
    const tree = new BKTree();
    for (let i = 0; i < N; i++) {
      tree.insert(deterministicHash(i), `/img/${i}.png`);
    }

    const queryHashes = Array.from({ length: QUERIES }, (_, i) => deterministicHash(N + i));

    const startedAt = performance.now();
    let totalHits = 0;
    for (const h of queryHashes) {
      totalHits += tree.query(h, HAMMING_THRESHOLD).length;
    }
    const elapsed = performance.now() - startedAt;

    const avgMs = elapsed / QUERIES;
    console.log(
      `BKTree.query: ${elapsed.toFixed(1)} ms for ${QUERIES} queries on ${N.toLocaleString()}-entry tree ` +
      `(avg ${avgMs.toFixed(2)} ms/query, ${totalHits} hits at threshold=${HAMMING_THRESHOLD})\n` +
      `  NOTE: BK-trees degrade toward O(N) for random 64-bit Hamming data (avg pairwise dist≈32). ` +
      `For 1M+ files, Multi-Index Hashing (MIH) would reduce this to O(548) lookups/query.`
    );
    // Sanity bound: must complete in finite time; correctness is validated in unit tests
    expect(elapsed).toBeLessThan(10_000);
  });

  it("reports BK-tree vs brute-force timing for 2000 files (observation only)", () => {
    // Build a dataset where we know some near-duplicates exist
    const N = 2000;
    const hashes = Array.from({ length: N }, (_, i) => deterministicHash(i));

    // BK-tree matching
    const treeStart = performance.now();
    const tree = new BKTree();
    for (let i = 0; i < N; i++) {
      const matches = tree.query(hashes[i]!, HAMMING_THRESHOLD);
      tree.insert(hashes[i]!, `/img/${i}.png`);
      void matches;
    }
    const treeElapsed = performance.now() - treeStart;

    // Brute-force O(N²) comparison
    const bruteStart = performance.now();
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < i; j++) {
        void (hammingDistance(hashes[i]!, hashes[j]!) <= HAMMING_THRESHOLD);
      }
    }
    const bruteElapsed = performance.now() - bruteStart;

    console.log(
      `Matching ${N} files:\n` +
      `  BK-tree (incremental): ${treeElapsed.toFixed(1)} ms\n` +
      `  Brute-force O(N²):     ${bruteElapsed.toFixed(1)} ms\n` +
      `  NOTE: BK-tree can be slower than brute-force on random 64-bit Hamming data because the\n` +
      `  tree degenerates toward O(N) traversal. Real image hashes cluster better, but for\n` +
      `  guaranteed O(1) queries at 1M scale, Multi-Index Hashing (MIH) is the right approach.`
    );

    // Both must complete in finite time — the real value is correctness (near-duplicate detection)
    expect(treeElapsed).toBeLessThan(10_000);
    expect(bruteElapsed).toBeLessThan(10_000);
  });
});
