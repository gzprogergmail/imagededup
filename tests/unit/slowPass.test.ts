import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import { discoverImages } from "../../src/main/core/imageDiscovery";
import { pairKeyFor, runSlowPass } from "../../src/main/core/slowPass";

describe("runSlowPass", () => {
  it("groups transformed variants from the same source image", async () => {
    const dir = await mkdtemp(join(tmpdir(), "imagededup-slow-"));
    const { generateFixtureSet } = await import("../../scripts/image-fixtures.mjs");
    const fixtures = await generateFixtureSet(dir);
    const files = await discoverImages(fixtures.root);

    const result = await runSlowPass(files);
    expect(result.library).toBe("ssim.js");
    expect(result.groups.length).toBeGreaterThanOrEqual(1);
    expect(result.diagnostics?.phasesMs.signatureBuild).toBeGreaterThan(0);
    expect(result.diagnostics?.phasesMs.similarityCompare).toBeGreaterThan(0);
    expect(result.diagnostics?.counters.totalPairs).toBeGreaterThan(0);

    const largestGroup = result.groups[0];
    expect(largestGroup?.files).toContain(fixtures.base);
    expect(largestGroup?.files).toContain(fixtures.rotated12);
    expect(largestGroup?.files).toContain(fixtures.tinted);
    expect(largestGroup?.files.length).toBeGreaterThanOrEqual(4);
    expect(largestGroup?.files).not.toContain(fixtures.unique);
  }, 120000);

  it("skips pairs that were already matched by the fast pass", async () => {
    const dir = await mkdtemp(join(tmpdir(), "imagededup-slow-skip-"));
    const { generateFixtureSet } = await import("../../scripts/image-fixtures.mjs");
    const fixtures = await generateFixtureSet(dir);
    const files = (await discoverImages(fixtures.root)).filter((file) =>
      file.path === fixtures.base || file.path === fixtures.resized
    );

    const withoutSkip = await runSlowPass(files);
    expect(withoutSkip.groups).toHaveLength(1);

    const withSkip = await runSlowPass(files, {}, {
      skipPairs: new Set([pairKeyFor(fixtures.base, fixtures.resized)])
    });
    expect(withSkip.groups).toHaveLength(0);
    expect(withSkip.diagnostics?.counters.skippedFastPassPairs).toBe(1);
  }, 120000);
});
