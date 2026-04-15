import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import { discoverImages } from "../../src/main/core/imageDiscovery";
import { runFastPass } from "../../src/main/core/fastPass";

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
});
