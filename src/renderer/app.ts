import type { DetectionResult, HashCacheInfo, ScanProgress, ScanUpdate } from "../shared/types";
import PhotoSwipe from "photoswipe";
import {
  renderFolderPreviewEmptyMarkup,
  renderFolderPreviewLoadingMarkup,
  renderFolderPreviewMarkup,
  renderErrorMarkup,
  renderPartialResultsMarkup,
  renderPhaseStepperMarkup,
  renderResultsEmptyMarkup,
  renderResultsLoadingMarkup,
  renderResultsMarkup,
  renderSummaryEmptyMarkup,
  renderSummaryLoadingMarkup,
  renderSummaryMarkup
} from "./view";

type StatusTone = "idle" | "running" | "success" | "warning" | "error";

const folderInput = mustElement<HTMLInputElement>("folder-input");
const thresholdInput = mustElement<HTMLInputElement>("threshold-input");
const thresholdDisplay = mustElement<HTMLElement>("threshold-display");
const applyThresholdButton = mustElement<HTMLButtonElement>("apply-threshold-button");
const refreshCacheButton = mustElement<HTMLButtonElement>("refresh-cache-button");
const clearCacheButton = mustElement<HTMLButtonElement>("clear-cache-button");
const cacheStatusLine = mustElement<HTMLElement>("cache-status-line");
const phaseStepper = mustElement<HTMLElement>("phase-stepper");
const browseButton = mustElement<HTMLButtonElement>("browse-button");
const fastButton = mustElement<HTMLButtonElement>("fast-button");
const cancelButton = mustElement<HTMLButtonElement>("cancel-button");
const activityCount = mustElement<HTMLElement>("activity-count");
const activityList = mustElement<HTMLOListElement>("activity-list");
const logPathLine = mustElement<HTMLElement>("log-path-line");
const folderPreview = mustElement<HTMLDivElement>("folder-preview");
const progressBar = mustElement<HTMLElement>("progress-bar");
const progressText = mustElement<HTMLElement>("progress-text");
const progressPercent = mustElement<HTMLElement>("progress-percent");
const selectedFolder = mustElement<HTMLElement>("selected-folder");
const statusBadge = mustElement<HTMLElement>("status-badge");
const summaryGrid = mustElement<HTMLDivElement>("summary-grid");
const statusLine = mustElement<HTMLElement>("status-line");
const resultsPanel = mustElement<HTMLDivElement>("results-panel");
const activityEntries: Array<{ time: string; text: string }> = [];

let isScanning = false;
let activeScanFolder: string | null = null;
let lastCompletedFolder: string | null = null;
let cacheInfoRequestId = 0;
let folderPreviewRequestId = 0;
let folderPreviewTimer: number | null = null;
let unsubscribeScanUpdates: (() => void) | null = null;
let scanStartTime: number | null = null;

void initialize();

browseButton.addEventListener("click", async () => {
  updateStatus("Opening the folder picker...", "running");
  recordActivity("Browse button clicked.");
  void logUiEvent("browse.clicked");

  const selected = await window.imageDedupApi.browseFolder();
  if (selected) {
    setFolder(selected);
    updateStatus(`Ready to scan ${shortenMiddle(selected, 56)}.`, "success");
    recordActivity(`Folder selected: ${shortenMiddle(selected, 60)}.`);
    void logUiEvent("browse.completed", { selected });
    return;
  }

  updateStatus("Folder selection canceled.", "warning");
  recordActivity("Folder selection canceled.");
  void logUiEvent("browse.canceled");
});

folderInput.addEventListener("input", () => {
  folderInput.removeAttribute("aria-invalid");
  syncSelectedFolder(folderInput.value.trim());
  queueFolderPreview(folderInput.value.trim());
});

thresholdInput.addEventListener("input", () => {
  thresholdDisplay.textContent = thresholdInput.value;
  updateCacheControls();
});

thresholdInput.addEventListener("change", () => {
  if (canAutoRematchCurrentFolder()) {
    void rematchFromCache("auto");
  }
});

folderInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.shiftKey || event.repeat) {
    return;
  }

  event.preventDefault();
  void runPass();
});

window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !isScanning) {
    return;
  }

  event.preventDefault();
  void requestCancelScan();
});

fastButton.addEventListener("click", async () => {
  await runPass();
});

applyThresholdButton.addEventListener("click", async () => {
  await rematchFromCache("manual");
});

refreshCacheButton.addEventListener("click", async () => {
  await runPass({ forceRefreshCache: true });
});

clearCacheButton.addEventListener("click", async () => {
  await clearCurrentCache();
});

cancelButton.addEventListener("click", async () => {
  await requestCancelScan();
});

document.addEventListener("click", (event) => {
  const target = (event.target as Element).closest<HTMLElement>("[data-action]");
  if (!target) return;
  const { action, path } = target.dataset;
  if (!path) return;

  if (action === "open-file") {
    void window.imageDedupApi.openFile(path).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : "Could not open file.";
      updateStatus(msg, "error");
    });
  } else if (action === "open-folder") {
    void window.imageDedupApi.openFolder(path).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : "Could not open folder.";
      updateStatus(msg, "error");
    });
  } else if (action === "copy-path") {
    void navigator.clipboard.writeText(path).then(() => {
      const original = target.textContent?.trim() ?? "Copy Path";
      target.textContent = "Copied!";
      setTimeout(() => { target.textContent = original; }, 1500);
    }).catch(() => {
      updateStatus("Could not copy path to clipboard.", "warning");
    });
  } else if (action === "delete-file") {
    if (!confirm("Move this file to the trash?")) return;
    const entry = target.closest<HTMLElement>(".group-file-entry");
    void window.imageDedupApi.deleteFile(path).then(() => {
      if (entry) entry.style.opacity = "0.5";
    }).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : "Could not delete file.";
      updateStatus(msg, "error");
    });
  }
});

// ── PhotoSwipe lightbox ───────────────────────────────────────────────────────
// Event-delegated: clicking any .group-thumb-item[data-pswp-file] opens a
// full-screen lightbox showing all images in that duplicate group.
resultsPanel.addEventListener("click", (event) => {
  const thumbBtn = (event.target as Element).closest<HTMLElement>(".group-thumb-item[data-pswp-file]");
  if (!thumbBtn) return;

  const groupCard = thumbBtn.closest<HTMLElement>(".group-card");
  if (!groupCard) return;

  const allThumbs = [...groupCard.querySelectorAll<HTMLElement>(".group-thumb-item[data-pswp-file]")];
  const startIndex = allThumbs.indexOf(thumbBtn);

  const dataSource = allThumbs.map((btn) => {
    const filePath = btn.dataset.pswpFile ?? "";
    const encodedPath = encodeURI(filePath.replace(/\\/g, "/"));
    const src = `file://${encodedPath}`;
    const img = btn.querySelector<HTMLImageElement>("img");
    // Use loaded thumbnail dimensions as a hint; PhotoSwipe will update once
    // the full image loads. Fall back to a landscape default so layout works.
    const width  = (img && img.naturalWidth  > 0) ? img.naturalWidth  : 3840;
    const height = (img && img.naturalHeight > 0) ? img.naturalHeight : 2160;
    return { src, width, height, alt: btn.title };
  });

  const pswp = new PhotoSwipe({
    dataSource,
    index: startIndex >= 0 ? startIndex : 0,
    bgOpacity: 0.9,
    spacing: 0.12,
    allowPanToNext: true,
    loop: true,
    pinchToClose: true,
    closeOnVerticalDrag: true,
  });
  pswp.init();
});

function handleScanUpdate(update: ScanUpdate): void {
  if (update.type === "progress") {
    updateProgressUI(update);
  } else if (update.type === "partial") {
    renderPartialResults(update.groups, update.scannedSoFar, update.totalFiles);
  } else if (update.type === "complete") {
    handleScanComplete(update.result);
  } else if (update.type === "error") {
    handleScanError(update.message);
  } else if (update.type === "cancelled") {
    handleScanCancelled();
  }
}

function updateProgressUI(progress: ScanProgress): void {
  const percent = progress.percentComplete;
  progressPercent.textContent = `${percent}%`;
  progressText.textContent = formatProgressText(progress);
  phaseStepper.innerHTML = renderPhaseStepperMarkup(progress);

  // Update progress bar if it supports value
  const progressBarElement = progressBar as unknown as HTMLProgressElement;
  if ("value" in progressBarElement) {
    progressBarElement.value = percent;
    progressBarElement.max = 100;
  }

  // Update status line with current file
  if (progress.currentPath) {
    const fileName = progress.currentPath.split(/[/\\]/).pop() || progress.currentPath;
    updateStatus(
      `Fast Pass: ${labelForPhase(progress.phase)} ${percent}% (${progress.currentFile}/${progress.totalFiles} ${progress.phase === "comparing" ? "comparisons" : "images"}) - ${shortenMiddle(fileName, 40)}`,
      "running"
    );
  } else {
    updateStatus(
      `Fast Pass: ${labelForPhase(progress.phase)} ${percent}% (${progress.currentFile}/${progress.totalFiles} ${progress.phase === "comparing" ? "comparisons" : "images"})`,
      "running"
    );
  }
}

function formatProgressText(progress: ScanProgress): string {
  const parts: string[] = [];
  const unitLabel = progress.phase === "comparing" ? "comparisons" : "images";
  parts.push(`${progress.currentFile}/${progress.totalFiles} ${unitLabel}`);

  if (progress.phase === "hashing" && scanStartTime !== null && progress.currentFile > 0) {
    const elapsed = Date.now() - scanStartTime;
    if (elapsed > 500) {
      const imgPerSec = (progress.currentFile / (elapsed / 1000)).toFixed(1);
      parts.push(`${imgPerSec} img/s`);
    }
  }

  if (progress.estimatedTimeRemainingMs && progress.estimatedTimeRemainingMs > 0) {
    const seconds = Math.ceil(progress.estimatedTimeRemainingMs / 1000);
    if (seconds < 60) {
      parts.push(`~${seconds}s remaining`);
    } else {
      const minutes = Math.ceil(seconds / 60);
      parts.push(`~${minutes}m remaining`);
    }
  }

  return parts.join(" • ");
}

function handleScanComplete(result: DetectionResult): void {
  isScanning = false;
  lastCompletedFolder = activeScanFolder ?? folderInput.value.trim();
  activeScanFolder = null;

  if (unsubscribeScanUpdates) {
    unsubscribeScanUpdates();
    unsubscribeScanUpdates = null;
  }

  renderSummary(result);
  renderResults(result);
  updateStatus(
    `Fast Pass finished in ${result.elapsedMs} ms across ${result.scannedFileCount} images.`,
    result.warnings.length === 0 ? "success" : "warning"
  );
  recordActivity(
    `Fast Pass finished with ${result.groups.length} groups across ${result.scannedFileCount} images.`
  );
  void logUiEvent("scan.completed", {
    elapsedMs: result.elapsedMs,
    groupCount: result.groups.length,
    mode: result.mode,
    scannedFileCount: result.scannedFileCount,
    warnings: result.warnings
  });

  setBusy(false);
  void refreshCacheInfo(lastCompletedFolder);
}

function handleScanError(message: string): void {
  isScanning = false;
  activeScanFolder = null;

  if (unsubscribeScanUpdates) {
    unsubscribeScanUpdates();
    unsubscribeScanUpdates = null;
  }

  summaryGrid.innerHTML = renderSummaryEmptyMarkup();
  resultsPanel.innerHTML = renderErrorMarkup(message);
  updateStatus(`Fast Pass failed: ${message}`, "error");
  recordActivity(`Fast Pass failed: ${message}`);
  void logUiEvent("scan.failed", { error: message, mode: "fast" }, "error");

  setBusy(false);
}

function handleScanCancelled(): void {
  isScanning = false;
  activeScanFolder = null;

  if (unsubscribeScanUpdates) {
    unsubscribeScanUpdates();
    unsubscribeScanUpdates = null;
  }

  updateStatus("Fast Pass cancelled.", "warning");
  setBusy(false);
}

async function runPass(options: { forceRefreshCache?: boolean } = {}): Promise<void> {
  const folder = folderInput.value.trim();
  if (!folder) {
    folderInput.setAttribute("aria-invalid", "true");
    folderInput.focus();
    updateStatus("Enter a folder path first.", "error");
    recordActivity("Fast Pass blocked because no folder was provided.");
    void logUiEvent("scan.blocked.empty_folder", { mode: "fast" }, "warn");
    return;
  }

  // Subscribe to scan updates
  const supportsScanUpdates = typeof window.imageDedupApi.onScanUpdate === "function";

  if (unsubscribeScanUpdates) {
    unsubscribeScanUpdates();
  }
  unsubscribeScanUpdates = supportsScanUpdates ? window.imageDedupApi.onScanUpdate(handleScanUpdate) : null;

  isScanning = true;
  activeScanFolder = folder;

  folderInput.removeAttribute("aria-invalid");
  syncSelectedFolder(folder);
  renderPendingScanState(folder);
  scanStartTime = Date.now();
  setBusy(true);
  updateStatus(options.forceRefreshCache ? "Fast Pass is refreshing the hash cache..." : "Fast Pass is starting...", "running");
  recordActivity(
    options.forceRefreshCache
      ? `Cache refresh started for ${shortenMiddle(folder, 60)}.`
      : `Fast Pass started for ${shortenMiddle(folder, 60)}.`
  );
  void logUiEvent("scan.started", { folder, forceRefreshCache: options.forceRefreshCache === true, mode: "fast" });

  try {
    const scanOptions = options.forceRefreshCache ? { forceRefreshCache: true } : undefined;
    const result = await window.imageDedupApi.startFastPass(folder, Number(thresholdInput.value), scanOptions) as DetectionResult | null;

    if (!supportsScanUpdates) {
      if (result) {
        handleScanComplete(result);
      } else {
        handleScanCancelled();
      }
    }
  } catch (error) {
    if (supportsScanUpdates) {
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    handleScanError(message);
  }
}

async function rematchFromCache(source: "auto" | "manual"): Promise<void> {
  const folder = folderInput.value.trim();
  if (!folder || isScanning) {
    return;
  }

  folderInput.removeAttribute("aria-invalid");
  setCacheActionsBusy(true);
  activeScanFolder = folder;
  updateStatus("Applying threshold from cached hashes...", "running");
  recordActivity(`Threshold rematch started for ${shortenMiddle(folder, 60)}.`);
  void logUiEvent("scan.rematch.started", {
    folder,
    hammingThreshold: Number(thresholdInput.value),
    source
  });

  try {
    const result = await window.imageDedupApi.rematchFastPass(folder, Number(thresholdInput.value)) as DetectionResult;
    lastCompletedFolder = folder;
    activeScanFolder = null;
    renderSummary(result);
    renderResults(result);
    updateStatus(
      `Threshold applied from cache in ${result.elapsedMs} ms across ${result.scannedFileCount} images.`,
      result.warnings.length === 0 ? "success" : "warning"
    );
    recordActivity(`Threshold rematch finished with ${result.groups.length} groups.`);
    void logUiEvent("scan.rematch.completed", {
      elapsedMs: result.elapsedMs,
      groupCount: result.groups.length,
      scannedFileCount: result.scannedFileCount
    });
    void refreshCacheInfo(folder);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    activeScanFolder = null;
    updateStatus(`Cached threshold rematch failed: ${message}`, "warning");
    recordActivity(`Cached threshold rematch failed: ${message}`);
    void logUiEvent("scan.rematch.failed", { error: message }, "warn");
  } finally {
    setCacheActionsBusy(false);
  }
}

function renderSummary(result: DetectionResult): void {
  summaryGrid.innerHTML = renderSummaryMarkup(result, "Fast Pass", Number(thresholdInput.value));
}

function renderResults(result: DetectionResult): void {
  resultsPanel.innerHTML = renderResultsMarkup(result);
}

function renderPartialResults(
  groups: DetectionResult["groups"],
  scannedSoFar: number,
  totalFiles: number
): void {
  resultsPanel.innerHTML = renderPartialResultsMarkup(groups, scannedSoFar, totalFiles);
}

function renderPendingScanState(folder: string): void {
  summaryGrid.innerHTML = renderSummaryLoadingMarkup("Fast Pass");
  resultsPanel.innerHTML = renderResultsLoadingMarkup("Fast Pass", folder);
}

async function requestCancelScan(): Promise<void> {
  if (!isScanning) {
    return;
  }

  await window.imageDedupApi.cancelScan();
  updateStatus("Scan cancelled by user.", "warning");
  recordActivity("Scan cancelled.");
  void logUiEvent("scan.cancelled");
}

function labelForPhase(phase: ScanProgress["phase"]): string {
  switch (phase) {
    case "hashing":
      return "preparing images";
    case "comparing":
      return "comparing matches";
    case "complete":
      return "wrapping up";
    default:
      return "discovering files";
  }
}


function setBusy(busy: boolean): void {
  browseButton.disabled = false;
  fastButton.disabled = busy;
  folderInput.disabled = false;
  cancelButton.disabled = !busy;
  cancelButton.dataset.visible = String(busy);
  progressBar.dataset.visible = String(busy);
  progressText.dataset.visible = String(busy);
  progressPercent.dataset.visible = String(busy);
  phaseStepper.dataset.visible = String(busy);
  updateCacheControls();

  if (busy) {
    fastButton.textContent = "Fast Pass Running";
  } else {
    fastButton.textContent = "Start Fast Pass";
    // Reset progress display
    progressPercent.textContent = "0%";
    progressText.textContent = "";
    phaseStepper.innerHTML = "";
  }
}

function updateStatus(message: string, tone: StatusTone = "idle"): void {
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
  folderPreview.dataset.state = "empty";
  folderPreview.innerHTML = renderFolderPreviewEmptyMarkup("Choose a folder to preview a few images before scanning.");
  summaryGrid.innerHTML = renderSummaryEmptyMarkup();
  resultsPanel.innerHTML = renderResultsEmptyMarkup();
  syncSelectedFolder(folderInput.value.trim());
  updateStatus("Choose a folder, then start with Fast Pass.", "idle");
  recordActivity("Ready to scan.");
  void logUiEvent("renderer.initialized");
  updateCacheControls();

  try {
    const { directory } = await window.imageDedupApi.getLogInfo();
    logPathLine.textContent = `JSONL logs: ${shortenMiddle(directory, 56)}`;
    logPathLine.title = directory;
    recordActivity(`Log directory ready: ${shortenMiddle(directory, 60)}.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logPathLine.textContent = `Could not resolve log directory: ${message}`;
    logPathLine.removeAttribute("title");
    void logUiEvent("logs.info.failed", { error: message }, "warn");
  }
}

function setFolder(folder: string): void {
  folderInput.value = folder;
  folderInput.removeAttribute("aria-invalid");
  syncSelectedFolder(folder);
  queueFolderPreview(folder);
}

function syncSelectedFolder(folder: string): void {
  if (!folder) {
    selectedFolder.dataset.visible = "false";
    selectedFolder.textContent = "Paste a folder path or use Browse to pick one.";
    selectedFolder.removeAttribute("title");
    folderPreview.dataset.state = "empty";
    folderPreview.innerHTML = renderFolderPreviewEmptyMarkup("Choose a folder to preview a few images before scanning.");
    cacheStatusLine.textContent = "Cache is ready after a folder is scanned.";
    updateCacheControls();
    return;
  }

  selectedFolder.dataset.visible = "true";
  selectedFolder.textContent = `Selected folder: ${shortenMiddle(folder, 76)}`;
  selectedFolder.title = folder;
  updateCacheControls();
}

function queueFolderPreview(folder: string): void {
  folderPreviewRequestId += 1;
  const requestId = folderPreviewRequestId;

  if (folderPreviewTimer !== null) {
    window.clearTimeout(folderPreviewTimer);
    folderPreviewTimer = null;
  }

  if (!folder) {
    folderPreview.dataset.state = "empty";
    folderPreview.innerHTML = renderFolderPreviewEmptyMarkup("Choose a folder to preview a few images before scanning.");
    return;
  }

  folderPreview.dataset.state = "loading";
  folderPreview.innerHTML = renderFolderPreviewLoadingMarkup(folder);
  folderPreviewTimer = window.setTimeout(() => {
    void loadFolderPreview(folder, requestId);
  }, 180);
}

async function loadFolderPreview(folder: string, requestId: number): Promise<void> {
  try {
    const preview = await window.imageDedupApi.getFolderPreview(folder);
    if (requestId !== folderPreviewRequestId) {
      return;
    }

    folderPreview.dataset.state = preview.imageCount === 0 ? "empty" : "ready";
    folderPreview.innerHTML = renderFolderPreviewMarkup(preview);
    void refreshCacheInfo(folder);
  } catch {
    if (requestId !== folderPreviewRequestId) {
      return;
    }

    folderPreview.dataset.state = "empty";
    folderPreview.innerHTML = renderFolderPreviewEmptyMarkup("Use an existing folder path to preview its image files.");
    cacheStatusLine.textContent = "Cache unavailable until the folder path is valid.";
  }
}

async function clearCurrentCache(): Promise<void> {
  const folder = folderInput.value.trim();
  if (!folder || isScanning) {
    return;
  }

  if (!confirm("Clear cached image hashes for this folder?")) {
    return;
  }

  setCacheActionsBusy(true);
  updateStatus("Clearing hash cache...", "running");
  try {
    const info = await window.imageDedupApi.clearCache(folder);
    cacheStatusLine.textContent = formatCacheInfo(info);
    updateStatus("Hash cache cleared for the selected folder.", "success");
    recordActivity(`Cache cleared for ${shortenMiddle(folder, 60)}.`);
    void logUiEvent("cache.cleared", { folder });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateStatus(`Could not clear cache: ${message}`, "error");
    recordActivity(`Cache clear failed: ${message}`);
    void logUiEvent("cache.clear.failed", { error: message }, "error");
  } finally {
    setCacheActionsBusy(false);
  }
}

async function refreshCacheInfo(folder = folderInput.value.trim()): Promise<void> {
  cacheInfoRequestId += 1;
  const requestId = cacheInfoRequestId;
  if (!folder) {
    cacheStatusLine.textContent = "Cache is ready after a folder is scanned.";
    updateCacheControls();
    return;
  }

  try {
    const info = await window.imageDedupApi.getCacheInfo(folder);
    if (requestId !== cacheInfoRequestId) {
      return;
    }
    cacheStatusLine.textContent = formatCacheInfo(info);
  } catch {
    if (requestId !== cacheInfoRequestId) {
      return;
    }
    cacheStatusLine.textContent = "Cache unavailable until the folder path is valid.";
  } finally {
    updateCacheControls();
  }
}

function formatCacheInfo(info: HashCacheInfo): string {
  if (info.currentImageCount === 0) {
    return `Cache: no images in selected folder. TTL ${info.ttlDays} days.`;
  }

  const missing = info.missingEntryCount > 0 ? `, ${info.missingEntryCount} missing` : "";
  const stale = info.staleEntryCount > 0 ? `, ${info.staleEntryCount} stale` : "";
  return `Cache: ${info.validEntryCount}/${info.currentImageCount} image hashes ready${missing}${stale}. TTL ${info.ttlDays} days.`;
}

function canAutoRematchCurrentFolder(): boolean {
  const folder = folderInput.value.trim();
  return Boolean(folder && !isScanning && lastCompletedFolder === folder);
}

function setCacheActionsBusy(busy: boolean): void {
  applyThresholdButton.disabled = busy;
  refreshCacheButton.disabled = busy;
  clearCacheButton.disabled = busy;
  if (!busy) {
    updateCacheControls();
  }
}

function updateCacheControls(): void {
  const hasFolder = folderInput.value.trim().length > 0;
  applyThresholdButton.disabled = isScanning || !hasFolder;
  refreshCacheButton.disabled = isScanning || !hasFolder;
  clearCacheButton.disabled = isScanning || !hasFolder;
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
  activityEntries.splice(24);
  activityCount.textContent = String(activityEntries.length);
  activityList.innerHTML = activityEntries.map((entry) => `
    <li>
      <span class="activity-time">${escapeHtml(entry.time)}</span>
      <span class="activity-text">${escapeHtml(entry.text)}</span>
    </li>
  `).join("");
}

function badgeLabelForTone(tone: StatusTone): string {
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

function variantForTone(tone: StatusTone): string {
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

function shortenMiddle(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  const remaining = maxLength - 1;
  const prefixLength = Math.ceil(remaining * 0.58);
  const suffixLength = remaining - prefixLength;
  return `${value.slice(0, prefixLength)}…${value.slice(value.length - suffixLength)}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}
