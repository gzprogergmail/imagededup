import type { DetectionResult } from "../shared/types";
import { renderErrorMarkup, renderResultsMarkup, renderSummaryMarkup } from "./view";

const folderInput = mustElement<HTMLInputElement>("folder-input");
const browseButton = mustElement<HTMLButtonElement>("browse-button");
const fastButton = mustElement<HTMLButtonElement>("fast-button");
const slowButton = mustElement<HTMLButtonElement>("slow-button");
const activityCount = mustElement<HTMLElement>("activity-count");
const activityList = mustElement<HTMLOListElement>("activity-list");
const logPathLine = mustElement<HTMLElement>("log-path-line");
const progressBar = mustElement<HTMLElement>("progress-bar");
const statusBadge = mustElement<HTMLElement>("status-badge");
const summaryGrid = mustElement<HTMLDivElement>("summary-grid");
const statusLine = mustElement<HTMLElement>("status-line");
const resultsPanel = mustElement<HTMLDivElement>("results-panel");
const activityEntries: Array<{ time: string; text: string }> = [];

void initialize();

browseButton.addEventListener("click", async () => {
  updateStatus("Opening the folder picker...", "running");
  recordActivity("Browse button clicked.");
  void logUiEvent("browse.clicked");

  const selected = await window.imageDedupApi.browseFolder();
  if (selected) {
    folderInput.value = selected;
    folderInput.removeAttribute("aria-invalid");
    updateStatus(`Folder selected: ${selected}`, "success");
    recordActivity(`Folder selected: ${selected}`);
    void logUiEvent("browse.completed", { selected });
    return;
  }

  updateStatus("Folder selection canceled.", "warning");
  recordActivity("Folder selection canceled.");
  void logUiEvent("browse.canceled");
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
    folderInput.setAttribute("aria-invalid", "true");
    updateStatus("Enter a folder path first.", "error");
    recordActivity(`${labelForMode(mode)} blocked because no folder was provided.`);
    void logUiEvent("scan.blocked.empty_folder", { mode }, "warn");
    return;
  }

  folderInput.removeAttribute("aria-invalid");
  setBusy(true, mode);
  updateStatus(`${labelForMode(mode)} is running...`, "running");
  recordActivity(`${labelForMode(mode)} started for ${folder}.`);
  void logUiEvent("scan.started", { folder, mode });

  try {
    const result = mode === "fast"
      ? await window.imageDedupApi.startFastPass(folder) as DetectionResult
      : await window.imageDedupApi.startSlowPass(folder) as DetectionResult;

    renderSummary(result);
    renderResults(result);
    updateStatus(
      `${labelForMode(mode)} finished in ${result.elapsedMs} ms across ${result.scannedFileCount} images.`,
      result.warnings.length === 0 ? "success" : "warning"
    );
    recordActivity(
      `${labelForMode(mode)} finished with ${result.groups.length} groups across ${result.scannedFileCount} images.`
    );
    void logUiEvent("scan.completed", {
      elapsedMs: result.elapsedMs,
      folder,
      groupCount: result.groups.length,
      mode,
      scannedFileCount: result.scannedFileCount,
      warnings: result.warnings
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateStatus(`${labelForMode(mode)} failed: ${message}`, "error");
    recordActivity(`${labelForMode(mode)} failed: ${message}`);
    void logUiEvent("scan.failed", { error: message, folder, mode }, "error");
    resultsPanel.innerHTML = renderErrorMarkup(message);
  } finally {
    setBusy(false, mode);
  }
}

function renderSummary(result: DetectionResult): void {
  summaryGrid.innerHTML = renderSummaryMarkup(result, labelForMode(result.mode));
}

function renderResults(result: DetectionResult): void {
  resultsPanel.innerHTML = renderResultsMarkup(result);
}

function labelForMode(mode: "fast" | "slow"): string {
  return mode === "fast" ? "Fast Pass" : "Slow Pass";
}

function setBusy(busy: boolean, mode: "fast" | "slow"): void {
  browseButton.disabled = busy;
  fastButton.disabled = busy;
  slowButton.disabled = busy;
  folderInput.disabled = busy;
  progressBar.dataset.visible = String(busy);
  if (busy) {
    (mode === "fast" ? fastButton : slowButton).textContent = `${labelForMode(mode)} Running`;
  } else {
    fastButton.textContent = "Start Fast Pass";
    slowButton.textContent = "Start Slow Pass";
  }
}

function updateStatus(message: string, tone: "idle" | "running" | "success" | "warning" | "error" = "idle"): void {
  statusLine.textContent = message;
  statusLine.className = `status status-${tone}`;
  statusLine.setAttribute("variant", variantForTone(tone));
  statusBadge.textContent = badgeLabelForTone(tone);
  statusBadge.setAttribute("variant", variantForTone(tone));
}

function mustElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing element: ${id}`);
  }

  return element as T;
}

async function initialize(): Promise<void> {
  recordActivity("Renderer initialized.");
  void logUiEvent("renderer.initialized");

  try {
    const { directory } = await window.imageDedupApi.getLogInfo();
    logPathLine.textContent = `JSONL logs: ${directory}`;
    recordActivity(`Log directory ready: ${directory}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logPathLine.textContent = `Could not resolve log directory: ${message}`;
    void logUiEvent("logs.info.failed", { error: message }, "warn");
  }
}

function recordActivity(text: string): void {
  activityEntries.unshift({
    text,
    time: new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    })
  });
  activityEntries.splice(8);
  activityCount.textContent = String(activityEntries.length);
  activityList.innerHTML = activityEntries.map((entry) => `
    <li>
      <span class="activity-time">${escapeHtml(entry.time)}</span>
      <span class="activity-text">${escapeHtml(entry.text)}</span>
    </li>
  `).join("");
}

function badgeLabelForTone(tone: "idle" | "running" | "success" | "warning" | "error"): string {
  switch (tone) {
    case "running":
      return "Running";
    case "success":
      return "Ready";
    case "warning":
      return "Attention";
    case "error":
      return "Failed";
    default:
      return "Idle";
  }
}

function variantForTone(tone: "idle" | "running" | "success" | "warning" | "error"): string {
  switch (tone) {
    case "running":
      return "brand";
    case "success":
      return "success";
    case "warning":
      return "warning";
    case "error":
      return "danger";
    default:
      return "neutral";
  }
}

async function logUiEvent(
  event: string,
  details?: Record<string, unknown>,
  level: "info" | "warn" | "error" = "info"
): Promise<void> {
  try {
    await window.imageDedupApi.logEvent(event, details, level);
  } catch {
    recordActivity(`Logging failed for ${event}.`);
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}
