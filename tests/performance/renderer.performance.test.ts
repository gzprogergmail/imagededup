import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import { renderGroupMarkup } from "../../src/renderer/view";
import { dctHash, ImghashProvider } from "../../src/main/core/fastPass";
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
