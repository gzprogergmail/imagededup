import { fireEvent, waitFor } from "@testing-library/dom";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const previewResult = {
  folder: "C:\\fixtures",
  imageCount: 2,
  samplePaths: ["C:\\fixtures\\base.png", "C:\\fixtures\\copy.png"]
};

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
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    const dom = new JSDOM(`
      <main>
        <input id="folder-input" />
        <button id="browse-button">Browse</button>
        <button id="fast-button">Start Fast Pass</button>
        <button id="slow-button">Start Slow Pass</button>
        <button id="cancel-button">Cancel</button>
        <div id="activity-count"></div>
        <ol id="activity-list"></ol>
        <div id="log-path-line"></div>
        <div id="progress-bar"></div>
        <div id="progress-text"></div>
        <div id="progress-percent"></div>
        <div id="selected-folder"></div>
        <div id="folder-preview"></div>
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
          cancelScan: vi.fn().mockResolvedValue(undefined),
          getFolderPreview: vi.fn().mockResolvedValue(previewResult),
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
      expect(document.getElementById("selected-folder")?.textContent).toContain("Selected folder:");
      expect(document.getElementById("folder-preview")?.textContent).toContain("images ready to scan");
    });
  });

  it("renders guided empty states on startup", async () => {
    await import("../../src/renderer/app");

    await waitFor(() => {
      expect(document.getElementById("summary-grid")?.textContent).toContain("No scan yet");
      expect(document.getElementById("results-panel")?.textContent).toContain("Nothing to review yet.");
      expect(document.getElementById("status-line")?.textContent).toContain("Choose a folder");
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
      expect(document.getElementById("summary-grid")?.textContent).toContain("Grouped Files");
      expect(document.getElementById("results-panel")?.textContent).toContain("Review duplicate groups");
      expect(document.getElementById("results-panel")?.textContent).toContain("copy.png");
      expect(document.getElementById("status-badge")?.textContent).toContain("Ready");
      expect(document.getElementById("activity-list")?.textContent).toContain("Fast Pass finished");
    });
  });

  it("starts a fast pass when enter is pressed in the folder field", async () => {
    await import("../../src/renderer/app");
    const input = document.getElementById("folder-input") as HTMLInputElement;
    input.value = "C:\\fixtures";
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(window.imageDedupApi.startFastPass).toHaveBeenCalledWith("C:\\fixtures");
      expect(document.getElementById("status-line")?.textContent).toContain("finished");
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
      expect(document.activeElement).toBe(document.getElementById("folder-input"));
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

  it("renders scan-update progress and keeps folder controls active", async () => {
    const listeners: Array<(update: unknown) => void> = [];
    const unsubscribe = vi.fn();
    Object.assign(window.imageDedupApi, {
      onScanUpdate: vi.fn((callback: (update: unknown) => void) => {
        listeners.push(callback);
        return unsubscribe;
      }),
      startSlowPass: vi.fn().mockResolvedValue(null)
    });

    await import("../../src/renderer/app");
    (document.getElementById("folder-input") as HTMLInputElement).value = "C:\\fixtures";
    fireEvent.click(document.getElementById("slow-button") as HTMLButtonElement);

    listeners[0]?.({
      currentFile: 1,
      currentPath: "C:\\fixtures\\first.png",
      estimatedTimeRemainingMs: 3000,
      percentComplete: 5,
      phase: "discovering",
      totalFiles: 20,
      type: "progress"
    });
    listeners[0]?.({
      currentFile: 75,
      estimatedTimeRemainingMs: 61000,
      percentComplete: 39,
      phase: "comparing",
      totalFiles: 190,
      type: "progress"
    });

    await waitFor(() => {
      expect(document.getElementById("status-line")?.textContent).toContain("Slow Pass: comparing matches 39%");
      expect(document.getElementById("progress-text")?.textContent).toContain("75/190 comparisons");
      expect(document.getElementById("progress-text")?.textContent).toContain("~2m remaining");
      expect(document.getElementById("progress-percent")?.textContent).toBe("39%");
      expect((document.getElementById("folder-input") as HTMLInputElement).disabled).toBe(false);
      expect((document.getElementById("browse-button") as HTMLButtonElement).disabled).toBe(false);
      expect(document.getElementById("cancel-button")?.getAttribute("data-visible")).toBe("true");
      expect(unsubscribe).not.toHaveBeenCalled();
    });
  });

  it("handles scan completion from update events", async () => {
    const listeners: Array<(update: unknown) => void> = [];
    const unsubscribe = vi.fn();
    Object.assign(window.imageDedupApi, {
      onScanUpdate: vi.fn((callback: (update: unknown) => void) => {
        listeners.push(callback);
        return unsubscribe;
      }),
      startFastPass: vi.fn().mockResolvedValue(null)
    });

    await import("../../src/renderer/app");
    (document.getElementById("folder-input") as HTMLInputElement).value = "C:\\fixtures";
    fireEvent.click(document.getElementById("fast-button") as HTMLButtonElement);
    listeners[0]?.({ type: "complete", result: fastResult });

    await waitFor(() => {
      expect(document.getElementById("status-line")?.textContent).toContain("Fast Pass finished");
      expect(document.getElementById("status-badge")?.textContent).toContain("Ready");
      expect(document.getElementById("cancel-button")?.getAttribute("data-visible")).toBe("false");
      expect(unsubscribe).toHaveBeenCalled();
    });
  });

  it("cancels an in-flight scan from Escape", async () => {
    const listeners: Array<(update: unknown) => void> = [];
    Object.assign(window.imageDedupApi, {
      onScanUpdate: vi.fn((callback: (update: unknown) => void) => {
        listeners.push(callback);
        return () => undefined;
      }),
      startSlowPass: vi.fn().mockResolvedValue(null)
    });

    await import("../../src/renderer/app");
    (document.getElementById("folder-input") as HTMLInputElement).value = "C:\\fixtures";
    fireEvent.click(document.getElementById("slow-button") as HTMLButtonElement);
    fireEvent.keyDown(window, { key: "Escape" });
    listeners[0]?.({ type: "cancelled" });

    await waitFor(() => {
      expect(window.imageDedupApi.cancelScan).toHaveBeenCalled();
      expect(document.getElementById("status-line")?.textContent).toContain("Slow Pass cancelled.");
      expect(document.getElementById("status-badge")?.textContent).toContain("Attention");
      expect(document.getElementById("cancel-button")?.getAttribute("data-visible")).toBe("false");
    });
  });

  it("shows folder preview loading and invalid-folder feedback", async () => {
    vi.useFakeTimers();
    vi.mocked(window.imageDedupApi.getFolderPreview).mockRejectedValueOnce(new Error("missing"));
    await import("../../src/renderer/app");

    const input = document.getElementById("folder-input") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "C:\\missing" } });
    expect(document.getElementById("folder-preview")?.textContent).toContain("Looking for image files");

    await vi.advanceTimersByTimeAsync(200);

    await waitFor(() => {
      expect(document.getElementById("folder-preview")?.textContent).toContain("Use an existing folder path to preview its image files.");
    });
  });
});
