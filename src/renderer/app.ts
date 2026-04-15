import type { DetectionResult } from "../shared/types";
import { renderGroupMarkup, renderSummaryMarkup } from "./view";

const folderInput = mustElement<HTMLInputElement>("folder-input");
const browseButton = mustElement<HTMLButtonElement>("browse-button");
const fastButton = mustElement<HTMLButtonElement>("fast-button");
const slowButton = mustElement<HTMLButtonElement>("slow-button");
const summaryGrid = mustElement<HTMLDivElement>("summary-grid");
const statusLine = mustElement<HTMLDivElement>("status-line");
const resultsPanel = mustElement<HTMLDivElement>("results-panel");

browseButton.addEventListener("click", async () => {
  const selected = await window.imageDedupApi.browseFolder();
  if (selected) {
    folderInput.value = selected;
  }
});

fastButton.addEventListener("click", async () => {
  await runPass("fast");
});

slowButton.addEventListener("click", async () => {
  await runPass("slow");
});

async function runPass(mode: "fast" | "slow"): Promise<void> {
  const folder = folderInput.value.trim();
  if (!folder) {
    updateStatus("Enter a folder path first.");
    return;
  }

  setBusy(true, mode);
  updateStatus(`${labelForMode(mode)} is running...`);

  try {
    const result = mode === "fast"
      ? await window.imageDedupApi.startFastPass(folder) as DetectionResult
      : await window.imageDedupApi.startSlowPass(folder) as DetectionResult;

    renderSummary(result);
    renderResults(result);
    updateStatus(
      `${labelForMode(mode)} finished in ${result.elapsedMs} ms across ${result.scannedFileCount} images.`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateStatus(`${labelForMode(mode)} failed: ${message}`);
    resultsPanel.innerHTML = "";
  } finally {
    setBusy(false, mode);
  }
}

function renderSummary(result: DetectionResult): void {
  summaryGrid.innerHTML = renderSummaryMarkup(result, labelForMode(result.mode));
}

function renderResults(result: DetectionResult): void {
  if (result.groups.length === 0) {
    resultsPanel.innerHTML = `<article class="group-card">No duplicate groups were found.</article>`;
    return;
  }

  resultsPanel.innerHTML = result.groups.map(renderGroupMarkup).join("");
}

function labelForMode(mode: "fast" | "slow"): string {
  return mode === "fast" ? "Fast Pass" : "Slow Pass";
}

function setBusy(busy: boolean, mode: "fast" | "slow"): void {
  browseButton.disabled = busy;
  fastButton.disabled = busy;
  slowButton.disabled = busy;
  folderInput.disabled = busy;
  if (busy) {
    (mode === "fast" ? fastButton : slowButton).textContent = `${labelForMode(mode)} Running`;
  } else {
    fastButton.textContent = "Start Fast Pass";
    slowButton.textContent = "Start Slow Pass";
  }
}

function updateStatus(message: string): void {
  statusLine.textContent = message;
}

function mustElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing element: ${id}`);
  }

  return element as T;
}
