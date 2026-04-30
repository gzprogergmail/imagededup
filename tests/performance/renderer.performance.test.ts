import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import { renderGroupMarkup } from "../../src/renderer/view";
import { dctHash, ImghashProvider, HAMMING_THRESHOLD } from "../../src/main/core/fastPass";
import { BKTree, MIHIndex, hammingDistance } from "../../src/main/core/bkTree";
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

describe("MIHIndex performance", () => {
  /** Deterministic pseudo-random 16-char hex hash for index n. */
  function deterministicHash(n: number): string {
    const a = (Math.imul(n, 0x9e3779b9) >>> 0).toString(16).padStart(8, "0");
    const b = (Math.imul(n, 0x6c62272e) >>> 0).toString(16).padStart(8, "0");
    return a + b;
  }

  it("inserts 10 000 hashes in under 200 ms", () => {
    const N = 10_000;
    const idx = new MIHIndex();
    const hashes = Array.from({ length: N }, (_, i) => deterministicHash(i));

    const startedAt = performance.now();
    for (let i = 0; i < N; i++) idx.insert(hashes[i]!, `/img/${i}.png`);
    const elapsed = performance.now() - startedAt;

    console.log(`MIHIndex.insert: ${elapsed.toFixed(1)} ms for ${N.toLocaleString()} entries`);
    expect(idx.size).toBe(N);
    expect(elapsed).toBeLessThan(200);
  });

  it("queries 500 times on a 10 000-entry index in under 500 ms", () => {
    const N = 10_000;
    const QUERIES = 500;
    const idx = new MIHIndex();
    for (let i = 0; i < N; i++) idx.insert(deterministicHash(i), `/img/${i}.png`);

    const queryHashes = Array.from({ length: QUERIES }, (_, i) => deterministicHash(N + i));

    const startedAt = performance.now();
    let totalHits = 0;
    for (const h of queryHashes) totalHits += idx.query(h, HAMMING_THRESHOLD).length;
    const elapsed = performance.now() - startedAt;

    const avgMs = elapsed / QUERIES;
    console.log(
      `MIHIndex.query: ${elapsed.toFixed(1)} ms for ${QUERIES} queries on ${N.toLocaleString()}-entry index ` +
      `(avg ${avgMs.toFixed(3)} ms/query, ${totalHits} hits at threshold=${HAMMING_THRESHOLD})`
    );
    expect(elapsed).toBeLessThan(500);
  });

  it("MIH is faster than BK-tree for 2000 queries on random 64-bit Hamming data", () => {
    // On random hash data (avg pairwise dist≈32), BK-tree degrades to O(N) traversal.
    // MIH uses exactly 548 hash-map lookups per query regardless of N.
    const N = 5_000;
    const QUERIES = 200;
    const hashes = Array.from({ length: N }, (_, i) => deterministicHash(i));
    const queryHashes = Array.from({ length: QUERIES }, (_, i) => deterministicHash(N + i));

    const bkTree = new BKTree();
    for (let i = 0; i < N; i++) bkTree.insert(hashes[i]!, `/img/${i}.png`);
    const bkStart = performance.now();
    for (const h of queryHashes) bkTree.query(h, HAMMING_THRESHOLD);
    const bkElapsed = performance.now() - bkStart;

    const mihIdx = new MIHIndex();
    for (let i = 0; i < N; i++) mihIdx.insert(hashes[i]!, `/img/${i}.png`);
    const mihStart = performance.now();
    for (const h of queryHashes) mihIdx.query(h, HAMMING_THRESHOLD);
    const mihElapsed = performance.now() - mihStart;

    const speedup = bkElapsed / mihElapsed;
    console.log(
      `${QUERIES} queries on ${N.toLocaleString()} random hashes:\n` +
      `  BK-tree:  ${bkElapsed.toFixed(1)} ms (avg ${(bkElapsed / QUERIES).toFixed(2)} ms/query)\n` +
      `  MIHIndex: ${mihElapsed.toFixed(1)} ms (avg ${(mihElapsed / QUERIES).toFixed(2)} ms/query)\n` +
      `  Speedup:  ${speedup.toFixed(1)}× — MIH uses O(548 lookups) vs BK-tree O(N) on random data`
    );

    // MIH should be at least 5× faster on random high-entropy Hamming data
    expect(mihElapsed).toBeLessThan(bkElapsed / 5);
    expect(mihElapsed).toBeLessThan(200);
  });
});
