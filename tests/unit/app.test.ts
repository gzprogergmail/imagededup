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

const warningResult = {
  ...fastResult,
  mode: "slow" as const,
  warnings: ["Skipped unreadable image"]
};

describe("renderer app", () => {
  beforeEach(() => {
    const dom = new JSDOM(`
      <main>
        <input id="folder-input" />
        <button id="browse-button">Browse</button>
        <button id="fast-button">Start Fast Pass</button>
        <button id="slow-button">Start Slow Pass</button>
        <div id="activity-count"></div>
        <ol id="activity-list"></ol>
        <div id="log-path-line"></div>
        <div id="progress-bar"></div>
        <div id="status-badge"></div>
        <div id="summary-grid"></div>
        <div id="status-line" class="status status-idle"></div>
        <div id="results-panel"></div>
      </main>
    `, { url: "http://localhost" });

    vi.resetModules();
    Object.assign(globalThis, {
      document: dom.window.document,
      window: Object.assign(dom.window, {
        imageDedupApi: {
          browseFolder: vi.fn().mockResolvedValue("C:\\fixtures"),
          getLogInfo: vi.fn().mockResolvedValue({ directory: "C:\\logs" }),
          logEvent: vi.fn().mockResolvedValue(undefined),
          startFastPass: vi.fn().mockResolvedValue(fastResult),
          startSlowPass: vi.fn().mockResolvedValue(warningResult)
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

  it("shows a canceled browse operation", async () => {
    await import("../../src/renderer/app");
    vi.mocked(window.imageDedupApi.browseFolder).mockResolvedValueOnce(null);
    fireEvent.click(document.getElementById("browse-button") as HTMLButtonElement);

    await waitFor(() => {
      expect(document.getElementById("status-line")?.textContent).toContain("Folder selection canceled.");
      expect(document.getElementById("status-badge")?.textContent).toContain("Attention");
    });
  });

  it("runs the fast pass and renders results", async () => {
    await import("../../src/renderer/app");
    (document.getElementById("folder-input") as HTMLInputElement).value = "C:\\fixtures";
    fireEvent.click(document.getElementById("fast-button") as HTMLButtonElement);

    await waitFor(() => {
      expect(document.getElementById("status-line")?.textContent).toContain("finished");
      expect(document.getElementById("results-panel")?.textContent).toContain("copy.png");
      expect(document.getElementById("status-badge")?.textContent).toContain("Ready");
      expect(document.getElementById("activity-list")?.textContent).toContain("Fast Pass finished");
    });
  });

  it("surfaces warnings returned by a scan", async () => {
    await import("../../src/renderer/app");
    (document.getElementById("folder-input") as HTMLInputElement).value = "C:\\fixtures";
    fireEvent.click(document.getElementById("slow-button") as HTMLButtonElement);

    await waitFor(() => {
      expect(document.getElementById("status-badge")?.textContent).toContain("Attention");
      expect(document.getElementById("results-panel")?.textContent).toContain("Skipped unreadable image");
    });
  });

  it("renders a failure card when the scan throws", async () => {
    vi.mocked(window.imageDedupApi.startFastPass).mockRejectedValueOnce(new Error("Boom"));
    await import("../../src/renderer/app");
    (document.getElementById("folder-input") as HTMLInputElement).value = "C:\\fixtures";
    fireEvent.click(document.getElementById("fast-button") as HTMLButtonElement);

    await waitFor(() => {
      expect(document.getElementById("status-line")?.textContent).toContain("Fast Pass failed: Boom");
      expect(document.getElementById("results-panel")?.textContent).toContain("Pass failed");
    });
  });

  it("shows a validation error when no folder is provided", async () => {
    await import("../../src/renderer/app");
    fireEvent.click(document.getElementById("slow-button") as HTMLButtonElement);

    await waitFor(() => {
      expect(document.getElementById("status-line")?.textContent).toContain("Enter a folder path first.");
      expect(document.getElementById("status-badge")?.textContent).toContain("Failed");
      expect((document.getElementById("folder-input") as HTMLInputElement).getAttribute("aria-invalid")).toBe("true");
    });
  });

  it("shows a log directory failure when the lookup rejects", async () => {
    vi.mocked(window.imageDedupApi.getLogInfo).mockRejectedValueOnce(new Error("No logs"));
    await import("../../src/renderer/app");

    await waitFor(() => {
      expect(document.getElementById("log-path-line")?.textContent).toContain("Could not resolve log directory: No logs");
    });
  });

  it("keeps the UI usable when renderer log writes fail", async () => {
    vi.mocked(window.imageDedupApi.logEvent).mockRejectedValue(new Error("write failed"));
    await import("../../src/renderer/app");

    await waitFor(() => {
      expect(document.getElementById("activity-list")?.textContent).toContain("Logging failed");
    });
  });
});
