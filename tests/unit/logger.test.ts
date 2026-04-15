import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { beforeEach, describe, expect, it, vi } from "vitest";

const getPath = vi.fn();
const isReady = vi.fn();

vi.mock("electron", () => ({
  app: {
    getPath,
    isReady
  }
}));

describe("main logger", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("writes JSONL entries to the Electron userData log directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "imagededup-logs-"));
    isReady.mockReturnValue(true);
    getPath.mockReturnValue(root);

    const { getLogDirectory, logEvent } = await import("../../src/main/logger");
    const directory = await getLogDirectory();
    await logEvent("renderer", "scan.completed", { mode: "fast" });

    const content = await readFile(join(directory, "renderer.jsonl"), "utf8");
    expect(content).toContain("\"event\":\"scan.completed\"");
    expect(content).toContain("\"mode\":\"fast\"");
  });
});
