import { fireEvent, waitFor } from "@testing-library/dom";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("photoswipe", () => ({
  default: vi.fn(function() { return { init: vi.fn() }; })
}));

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
  mode: "fast" as const,
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
        <input id="threshold-input" type="range" min="0" max="16" value="5" />
        <span id="threshold-display">5</span>
        <div id="phase-stepper" data-visible="false"></div>
        <button id="browse-button">Browse</button>
        <button id="fast-button">Start Fast Pass</button>
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
          openFile: vi.fn().mockResolvedValue(undefined),
          openFolder: vi.fn().mockResolvedValue(undefined),
          deleteFile: vi.fn().mockResolvedValue(undefined),
          startFastPass: vi.fn().mockResolvedValue(fastResult)
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
      expect(document.getElementById("results-panel")?.textContent).toContain("No results yet");
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
      expect(window.imageDedupApi.startFastPass).toHaveBeenCalledWith("C:\\fixtures", expect.any(Number));
      expect(document.getElementById("status-line")?.textContent).toContain("finished");
    });
  });

  it("surfaces warnings returned by a scan", async () => {
    vi.mocked(window.imageDedupApi.startFastPass).mockResolvedValueOnce(warningResult);
    await import("../../src/renderer/app");
    (document.getElementById("folder-input") as HTMLInputElement).value = "C:\\fixtures";
    fireEvent.click(document.getElementById("fast-button") as HTMLButtonElement);

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
    fireEvent.click(document.getElementById("fast-button") as HTMLButtonElement);

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
      startFastPass: vi.fn().mockResolvedValue(null)
    });

    await import("../../src/renderer/app");
    (document.getElementById("folder-input") as HTMLInputElement).value = "C:\\fixtures";
    fireEvent.click(document.getElementById("fast-button") as HTMLButtonElement);

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
      expect(document.getElementById("status-line")?.textContent).toContain("Fast Pass: comparing matches 39%");
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
      startFastPass: vi.fn().mockResolvedValue(null)
    });

    await import("../../src/renderer/app");
    (document.getElementById("folder-input") as HTMLInputElement).value = "C:\\fixtures";
    fireEvent.click(document.getElementById("fast-button") as HTMLButtonElement);
    fireEvent.keyDown(window, { key: "Escape" });
    listeners[0]?.({ type: "cancelled" });

    await waitFor(() => {
      expect(window.imageDedupApi.cancelScan).toHaveBeenCalled();
      expect(document.getElementById("status-line")?.textContent).toContain("Fast Pass cancelled.");
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

  it("calls openFile via event delegation when a file button is clicked", async () => {
    await import("../../src/renderer/app");
    (document.getElementById("folder-input") as HTMLInputElement).value = "C:\\fixtures";
    fireEvent.click(document.getElementById("fast-button") as HTMLButtonElement);

    await waitFor(() => {
      expect(document.getElementById("results-panel")?.textContent).toContain("copy.png");
    });

    const openBtn = document.querySelector('[data-action="open-file"]') as HTMLElement | null;
    expect(openBtn).not.toBeNull();
    fireEvent.click(openBtn!);

    await waitFor(() => {
      expect(window.imageDedupApi.openFile).toHaveBeenCalledWith(openBtn!.dataset.path);
    });
  });

  it("calls openFolder via event delegation when Show in Folder is clicked", async () => {
    await import("../../src/renderer/app");
    (document.getElementById("folder-input") as HTMLInputElement).value = "C:\\fixtures";
    fireEvent.click(document.getElementById("fast-button") as HTMLButtonElement);

    await waitFor(() => {
      expect(document.getElementById("results-panel")?.textContent).toContain("copy.png");
    });

    const folderBtn = document.querySelector('[data-action="open-folder"]') as HTMLElement | null;
    expect(folderBtn).not.toBeNull();
    fireEvent.click(folderBtn!);

    await waitFor(() => {
      expect(window.imageDedupApi.openFolder).toHaveBeenCalledWith(folderBtn!.dataset.path);
    });
  });

  it("calls openFile via delegation when a path with apostrophe is clicked", async () => {
    const apostropheResult = {
      elapsedMs: 10,
      groups: [
        {
          evidence: "Perceptual hash · abc",
          files: ["C:\\User's Photos\\photo.png", "C:\\User's Photos\\copy.png"],
          id: "g-apos",
          kind: "fast" as const,
          representative: "C:\\User's Photos\\photo.png",
          score: 0.95
        }
      ],
      library: "imghash",
      mode: "fast" as const,
      scannedFileCount: 2,
      warnings: []
    };
    vi.mocked(window.imageDedupApi.startFastPass).mockResolvedValueOnce(apostropheResult);
    await import("../../src/renderer/app");
    (document.getElementById("folder-input") as HTMLInputElement).value = "C:\\User's Photos";
    fireEvent.click(document.getElementById("fast-button") as HTMLButtonElement);

    await waitFor(() => {
      expect(document.getElementById("results-panel")?.textContent).toContain("photo.png");
    });

    const openBtn = document.querySelector('[data-action="open-file"]') as HTMLElement | null;
    expect(openBtn).not.toBeNull();
    fireEvent.click(openBtn!);

    await waitFor(() => {
      expect(window.imageDedupApi.openFile).toHaveBeenCalledWith("C:\\User's Photos\\photo.png");
    });
  });

  it("shows an error in the status line when openFile fails", async () => {
    vi.mocked(window.imageDedupApi.openFile).mockRejectedValueOnce(new Error("No application to open file"));
    await import("../../src/renderer/app");
    (document.getElementById("folder-input") as HTMLInputElement).value = "C:\\fixtures";
    fireEvent.click(document.getElementById("fast-button") as HTMLButtonElement);

    await waitFor(() => {
      expect(document.getElementById("results-panel")?.textContent).toContain("copy.png");
    });

    const openBtn = document.querySelector('[data-action="open-file"]') as HTMLElement | null;
    fireEvent.click(openBtn!);

    await waitFor(() => {
      expect(document.getElementById("status-line")?.textContent).toContain("No application to open file");
    });
  });

  it("shows an error in the status line when openFolder fails", async () => {
    vi.mocked(window.imageDedupApi.openFolder).mockRejectedValueOnce(new Error("Folder not found"));
    await import("../../src/renderer/app");
    (document.getElementById("folder-input") as HTMLInputElement).value = "C:\\fixtures";
    fireEvent.click(document.getElementById("fast-button") as HTMLButtonElement);

    await waitFor(() => {
      expect(document.getElementById("results-panel")?.textContent).toContain("copy.png");
    });

    const folderBtn = document.querySelector('[data-action="open-folder"]') as HTMLElement | null;
    fireEvent.click(folderBtn!);

    await waitFor(() => {
      expect(document.getElementById("status-line")?.textContent).toContain("Folder not found");
    });
  });

  it("shows Copied! feedback on the button when copy-path succeeds", async () => {
    const clipboardMock = { writeText: vi.fn().mockResolvedValue(undefined) };
    Object.defineProperty(navigator, "clipboard", { value: clipboardMock, writable: true, configurable: true });

    await import("../../src/renderer/app");
    (document.getElementById("folder-input") as HTMLInputElement).value = "C:\\fixtures";
    fireEvent.click(document.getElementById("fast-button") as HTMLButtonElement);

    await waitFor(() => {
      expect(document.getElementById("results-panel")?.textContent).toContain("copy.png");
    });

    const copyBtn = document.querySelector('[data-action="copy-path"]') as HTMLElement | null;
    expect(copyBtn).not.toBeNull();
    fireEvent.click(copyBtn!);

    await waitFor(() => {
      expect(copyBtn!.textContent).toBe("Copied!");
      expect(clipboardMock.writeText).toHaveBeenCalledWith(copyBtn!.dataset.path);
    });
  });

  it("shows a warning when copy-path clipboard write fails", async () => {
    const clipboardMock = { writeText: vi.fn().mockRejectedValue(new Error("denied")) };
    Object.defineProperty(navigator, "clipboard", { value: clipboardMock, writable: true, configurable: true });

    await import("../../src/renderer/app");
    (document.getElementById("folder-input") as HTMLInputElement).value = "C:\\fixtures";
    fireEvent.click(document.getElementById("fast-button") as HTMLButtonElement);

    await waitFor(() => {
      expect(document.getElementById("results-panel")?.textContent).toContain("copy.png");
    });

    const copyBtn = document.querySelector('[data-action="copy-path"]') as HTMLElement | null;
    fireEvent.click(copyBtn!);

    await waitFor(() => {
      expect(document.getElementById("status-line")?.textContent).toContain("Could not copy path to clipboard.");
    });
  });

  it("calls deleteFile and dims the entry when Trash is confirmed", async () => {
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
    await import("../../src/renderer/app");
    (document.getElementById("folder-input") as HTMLInputElement).value = "C:\\fixtures";
    fireEvent.click(document.getElementById("fast-button") as HTMLButtonElement);

    await waitFor(() => {
      expect(document.getElementById("results-panel")?.textContent).toContain("copy.png");
    });

    const trashBtn = document.querySelector('[data-action="delete-file"]') as HTMLElement | null;
    expect(trashBtn).not.toBeNull();
    fireEvent.click(trashBtn!);

    await waitFor(() => {
      expect(window.imageDedupApi.deleteFile).toHaveBeenCalledWith(trashBtn!.dataset.path);
      const entry = trashBtn!.closest(".group-file-entry") as HTMLElement | null;
      expect(entry?.style.opacity).toBe("0.5");
    });
  });

  it("does not call deleteFile when Trash is cancelled", async () => {
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(false));
    await import("../../src/renderer/app");
    (document.getElementById("folder-input") as HTMLInputElement).value = "C:\\fixtures";
    fireEvent.click(document.getElementById("fast-button") as HTMLButtonElement);

    await waitFor(() => {
      expect(document.getElementById("results-panel")?.textContent).toContain("copy.png");
    });

    const trashBtn = document.querySelector('[data-action="delete-file"]') as HTMLElement | null;
    fireEvent.click(trashBtn!);

    expect(window.imageDedupApi.deleteFile).not.toHaveBeenCalled();
  });

  it("shows an error when deleteFile fails", async () => {
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
    vi.mocked(window.imageDedupApi.deleteFile).mockRejectedValueOnce(new Error("Access denied"));
    await import("../../src/renderer/app");
    (document.getElementById("folder-input") as HTMLInputElement).value = "C:\\fixtures";
    fireEvent.click(document.getElementById("fast-button") as HTMLButtonElement);

    await waitFor(() => {
      expect(document.getElementById("results-panel")?.textContent).toContain("copy.png");
    });

    const trashBtn = document.querySelector('[data-action="delete-file"]') as HTMLElement | null;
    fireEvent.click(trashBtn!);

    await waitFor(() => {
      expect(document.getElementById("status-line")?.textContent).toContain("Access denied");
    });
  });

  it("opens PhotoSwipe lightbox when a thumbnail is clicked", async () => {
    const { default: PhotoSwipe } = await import("photoswipe");
    await import("../../src/renderer/app");
    (document.getElementById("folder-input") as HTMLInputElement).value = "C:\\fixtures";
    fireEvent.click(document.getElementById("fast-button") as HTMLButtonElement);

    await waitFor(() => {
      expect(document.getElementById("results-panel")?.textContent).toContain("copy.png");
    });

    const thumb = document.querySelector('[data-pswp-file]') as HTMLElement | null;
    expect(thumb).not.toBeNull();
    fireEvent.click(thumb!);

    expect(vi.mocked(PhotoSwipe)).toHaveBeenCalledWith(
      expect.objectContaining({ dataSource: expect.any(Array) })
    );
  });
});
