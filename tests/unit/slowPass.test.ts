import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import { discoverImages } from "../../src/main/core/imageDiscovery";
import { runSlowPass } from "../../src/main/core/slowPass";

describe("runSlowPass", () => {
  it("groups transformed variants from the same source image", async () => {
    const dir = await mkdtemp(join(tmpdir(), "imagededup-slow-"));
    const { generateFixtureSet } = await import("../../scripts/image-fixtures.mjs");
    const fixtures = await generateFixtureSet(dir);
    const files = await discoverImages(fixtures.root);

    const result = await runSlowPass(files);
    expect(result.library).toBe("ssim.js");
    expect(result.groups.length).toBeGreaterThanOrEqual(1);

    const largestGroup = result.groups[0];
    expect(largestGroup?.files).toContain(fixtures.base);
    expect(largestGroup?.files).toContain(fixtures.rotated12);
    expect(largestGroup?.files).toContain(fixtures.tinted);
    expect(largestGroup?.files.length).toBeGreaterThanOrEqual(4);
    expect(largestGroup?.files).not.toContain(fixtures.unique);
  }, 120000);
});
