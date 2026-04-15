import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import { discoverImages } from "../../src/main/core/imageDiscovery";

describe("discoverImages", () => {
  it("returns only supported image files in sorted order", async () => {
    const dir = await mkdtemp(join(tmpdir(), "imagededup-discovery-"));
    await writeFile(join(dir, "a.png"), "a");
    await writeFile(join(dir, "b.JPG"), "b");
    await writeFile(join(dir, "notes.txt"), "c");

    const images = await discoverImages(dir);
    expect(images.map((file) => file.basename)).toEqual(["a.png", "b.JPG"]);
  });
});
