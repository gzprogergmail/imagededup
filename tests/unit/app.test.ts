import { fireEvent, waitFor } from "@testing-library/dom";
import { JSDOM } from "jsdom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fastResult = {
  elapsedMs: 44,
  groups: [
    {
      evidence: "hash group",
      files: ["base.png", "copy.png"],
      id: "group-1",
      kind: "fast" as const,
      representative: "base.png"
    }
  ],
  library: "imghash",
  mode: "fast" as const,
  scannedFileCount: 2,
  warnings: []
};

describe("renderer app", () => {
  beforeEach(() => {
    const dom = new JSDOM(`
      <main>
        <input id="folder-input" />
        <button id="browse-button">Browse</button>
        <button id="fast-button">Start Fast Pass</button>
        <button id="slow-button">Start Slow Pass</button>
        <div id="summary-grid"></div>
        <div id="status-line"></div>
        <div id="results-panel"></div>
      </main>
    `, { url: "http://localhost" });

    vi.resetModules();
    Object.assign(globalThis, {
      document: dom.window.document,
      window: Object.assign(dom.window, {
        imageDedupApi: {
          browseFolder: vi.fn().mockResolvedValue("C:\\fixtures"),
          startFastPass: vi.fn().mockResolvedValue(fastResult),
          startSlowPass: vi.fn().mockResolvedValue(fastResult)
        }
      })
    });
  });

  it("fills the folder input from browse", async () => {
    await import("../../src/renderer/app");
    const button = document.getElementById("browse-button") as HTMLButtonElement;
    fireEvent.click(button);

    await waitFor(() => {
      expect((document.getElementById("folder-input") as HTMLInputElement).value).toBe("C:\\fixtures");
    });
  });

  it("runs the fast pass and renders results", async () => {
    await import("../../src/renderer/app");
    (document.getElementById("folder-input") as HTMLInputElement).value = "C:\\fixtures";
    fireEvent.click(document.getElementById("fast-button") as HTMLButtonElement);

    await waitFor(() => {
      expect(document.getElementById("status-line")?.textContent).toContain("finished");
      expect(document.getElementById("results-panel")?.textContent).toContain("copy.png");
    });
  });
});
