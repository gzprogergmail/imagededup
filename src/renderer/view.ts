import type { DetectionResult, DuplicateGroup, FolderPreview, ScanProgress } from "../shared/types";

export function renderSummaryEmptyMarkup(): string {
  return `
    <article class="summary-card summary-placeholder">
      <div class="summary-value">No scan yet</div>
      <div class="summary-label">Choose a folder and run a pass to see scan metrics.</div>
    </article>
    <article class="summary-card summary-placeholder">
      <div class="summary-value">Fast Pass first</div>
      <div class="summary-label">Use the faster hash-based pass to confirm the folder looks right.</div>
    </article>
  `;
}

export function renderSummaryLoadingMarkup(passLabel: string): string {
  const placeholderLabels = [
    "Images Scanned", "Elapsed", "Throughput", "Threshold",
    "Duplicate Groups", "Grouped Files", "Unique Images", "Duplicate Rate",
    "Potentially Removable", "Largest Group", "Library"
  ];

  return `
    <article class="summary-card summary-placeholder">
      <div class="summary-value">${escapeHtml(passLabel)}</div>
      <div class="summary-label">Running now</div>
    </article>
    ${placeholderLabels.map(label => `
      <article class="summary-card summary-placeholder">
        <div class="summary-value">—</div>
        <div class="summary-label">${escapeHtml(label)}</div>
      </article>
    `).join("")}
  `;
}

export function renderSummaryMarkup(result: DetectionResult, passLabel: string, threshold?: number): string {
  const totalFilesInGroups = result.groups.reduce((sum, g) => sum + g.files.length, 0);
  const totalRemovable = result.groups.reduce((sum, g) => sum + g.files.length - 1, 0);
  const uniqueImages = result.scannedFileCount - totalFilesInGroups;
  const largestGroup = result.groups.length > 0 ? Math.max(...result.groups.map(g => g.files.length)) : 0;
  const duplicateRate = result.scannedFileCount > 0
    ? (totalFilesInGroups / result.scannedFileCount * 100).toFixed(1) + "%"
    : "0%";
  const throughput = result.elapsedMs > 0
    ? (result.scannedFileCount / (result.elapsedMs / 1000)).toFixed(1) + " img/s"
    : "—";
  const thresholdLabel = threshold !== undefined ? `${threshold} / 16` : "default";

  const items: Array<{ label: string; value: string; accent?: boolean }> = [
    { label: "Mode",                  value: passLabel },
    { label: "Images Scanned",        value: result.scannedFileCount.toLocaleString() },
    { label: "Elapsed",               value: formatDuration(result.elapsedMs) },
    { label: "Throughput",            value: throughput },
    { label: "Threshold",             value: thresholdLabel },
    { label: "Duplicate Groups",      value: result.groups.length.toLocaleString(),    accent: result.groups.length > 0 },
    { label: "Grouped Files",         value: totalFilesInGroups.toLocaleString() },
    { label: "Unique Images",         value: uniqueImages.toLocaleString() },
    { label: "Duplicate Rate",        value: duplicateRate },
    { label: "Potentially Removable", value: totalRemovable.toLocaleString(),          accent: totalRemovable > 0 },
    { label: "Largest Group",         value: largestGroup > 0 ? `${largestGroup} files` : "—" },
    { label: "Library",               value: result.library },
  ];

  return items.map((item) => `
    <article class="summary-card${item.accent ? " summary-card-accent" : ""}">
      <div class="summary-value">${escapeHtml(item.value)}</div>
      <div class="summary-label">${escapeHtml(item.label)}</div>
    </article>
  `).join("");
}

export function renderResultsEmptyMarkup(): string {
  return `
    <article class="group-card result-empty">
      <div class="results-header">
        <strong>Nothing to review yet.</strong>
        <span class="pill">waiting</span>
      </div>
      <div class="group-meta">
        Pick a folder, run Fast Pass, and this panel will fill with duplicate groups instead of blank space.
      </div>
    </article>
  `;
}

export function renderPartialResultsMarkup(
  groups: import("../shared/types").DuplicateGroup[],
  scannedSoFar: number,
  totalFiles: number
): string {
  const banner = `
    <article class="group-card result-pending">
      <div class="results-header">
        <strong>Live results — scan in progress</strong>
        <span class="pill">${groups.length} group${groups.length === 1 ? "" : "s"} so far</span>
      </div>
      <div class="group-meta">
        Processed ${scannedSoFar} of ${totalFiles} images. More groups may appear.
      </div>
    </article>
  `;

  if (groups.length === 0) {
    return banner + `
      <article class="group-card result-empty">
        <div class="results-header">
          <strong>No groups found yet</strong>
          <span class="pill">scanning</span>
        </div>
        <div class="group-meta">
          Duplicate groups will appear here as they are detected.
        </div>
      </article>
    `;
  }

  return banner + groups.map(renderGroupMarkup).join("");
}

export function renderResultsLoadingMarkup(passLabel: string, folder: string): string {
  return `
    <article class="group-card result-pending">
      <div class="results-header">
        <strong>${escapeHtml(passLabel)} is running</strong>
        <span class="pill">working</span>
      </div>
      <div class="group-meta">Scanning ${escapeHtml(shortenMiddle(folder, 84))}</div>
      <div class="group-meta">
        Existing results are cleared so the list only reflects the most recent pass when it finishes.
      </div>
    </article>
  `;
}

export function renderFolderPreviewEmptyMarkup(message: string): string {
  return `
    <div class="folder-preview-header">
      <div>
        <p class="card-kicker">Folder Preview</p>
        <strong>See a few images before you scan</strong>
      </div>
      <span class="pill">0 images</span>
    </div>
    <div class="folder-preview-empty">${escapeHtml(message)}</div>
  `;
}

export function renderFolderPreviewLoadingMarkup(folder: string): string {
  return `
    <div class="folder-preview-header">
      <div>
        <p class="card-kicker">Folder Preview</p>
        <strong>Looking for image files</strong>
      </div>
      <span class="pill">loading</span>
    </div>
    <div class="folder-preview-empty">
      Checking ${escapeHtml(shortenMiddle(folder, 72))} for supported image files.
    </div>
  `;
}

export function renderFolderPreviewMarkup(preview: FolderPreview): string {
  if (preview.imageCount === 0) {
    return renderFolderPreviewEmptyMarkup("No supported images were found in this folder yet.");
  }

  const overflowCount = preview.imageCount - preview.samplePaths.length;
  const overflowTile = overflowCount > 0
    ? `
      <article class="folder-preview-tile folder-preview-overflow">
        <strong>+${overflowCount}</strong>
        <span>more images</span>
      </article>
    `
    : "";

  return `
    <div class="folder-preview-header">
      <div>
        <p class="card-kicker">Folder Preview</p>
        <strong>${escapeHtml(preview.imageCount === 1 ? "1 image ready to scan" : `${preview.imageCount} images ready to scan`)}</strong>
      </div>
      <span class="pill">${escapeHtml(String(preview.samplePaths.length))} shown</span>
    </div>
    <div class="folder-preview-grid">
      ${preview.samplePaths.map((filePath) => `
        <article class="folder-preview-tile" title="${escapeHtml(filePath)}">
          ${createThumbnailHtml(filePath, "folder-preview-image")}
          <span class="folder-preview-name">${escapeHtml(fileNameForPath(filePath))}</span>
        </article>
      `).join("")}
      ${overflowTile}
    </div>
  `;
}

export function renderResultsMarkup(result: DetectionResult): string {
  if (result.groups.length === 0) {
    return `
      <article class="group-card result-empty">
        <div class="results-header">
          <strong>No duplicate groups were found.</strong>
          <span class="pill">0 groups</span>
        </div>
        <div class="group-meta">The pass completed successfully, but every scanned image was unique.</div>
      </article>
    `;
  }

  const warnings = result.warnings.length === 0 ? "" : `
    <article class="group-card warnings">
      <div class="results-header">
        <strong>Warnings</strong>
        <span class="pill">${result.warnings.length}</span>
      </div>
      ${result.warnings.map((warning) => `<div class="group-meta">${escapeHtml(warning)}</div>`).join("")}
    </article>
  `;

  const sortedGroups = [...result.groups].sort((a, b) => b.files.length - a.files.length);
  const totalRemovable = sortedGroups.reduce((sum, g) => sum + g.files.length - 1, 0);

  return `
    <article class="group-card result-overview">
      <div class="results-header">
        <strong>Review duplicate groups</strong>
        <div class="overview-stats">
          <span class="pill">${result.groups.length} group${result.groups.length === 1 ? "" : "s"}</span>
          <span class="pill pill-removable">${totalRemovable} potentially removable</span>
        </div>
      </div>
      <div class="group-meta">
        Groups sorted by size — largest first. Filenames are shown first so larger scans stay readable.
      </div>
    </article>
    ${warnings}
    ${sortedGroups.map(renderGroupMarkup).join("")}
  `;
}

export function renderErrorMarkup(message: string): string {
  return `
    <article class="group-card result-error">
      <div class="results-header">
        <strong>Pass failed</strong>
        <span class="pill">error</span>
      </div>
      <div class="group-meta">${escapeHtml(message)}</div>
    </article>
  `;
}

export function renderGroupMarkup(group: DuplicateGroup): string {
  const score = group.score === undefined ? "" : `<span class="pill">score ${group.score.toFixed(2)}</span>`;
  const representativeName = fileNameForPath(group.representative);
  const representativeDirectory = directoryForPath(group.representative);
  const representativePathLabel = representativeDirectory.length === 0
    ? "Path unavailable"
    : shortenMiddle(representativeDirectory, 72);

  const removable = group.files.length - 1;

  // Comparison thumbnail grid — all files shown side-by-side
  const thumbGrid = group.files.map((file) => `
    <button
      class="group-thumb-item"
      title="${escapeHtml(fileNameForPath(file))}"
      onclick="window.imageDedupApi.openFile('${escapeHtml(file)}')"
      type="button"
    >
      ${createThumbnailHtml(file, "group-thumb-image")}
      <span class="group-thumb-name">${escapeHtml(fileNameForPath(file))}</span>
    </button>
  `).join("");

  const fileListItems = group.files.map((file) => renderFileMarkup(file, representativeDirectory)).join("");
  const useCollapse = group.files.length > 4;
  const fileListHtml = useCollapse
    ? `<details class="group-files-collapse">
        <summary class="group-files-summary">▸ Show all ${group.files.length} files</summary>
        <ol class="group-files">${fileListItems}</ol>
      </details>`
    : `<ol class="group-files">${fileListItems}</ol>`;

  return `
    <article class="group-card" data-group-id="${escapeHtml(group.id)}">
      <div class="group-header">
        <div class="group-heading">
          <strong class="group-file-name" title="${escapeHtml(group.representative)}">
            ${escapeHtml(representativeName)}
          </strong>
          <div class="group-path" title="${escapeHtml(group.representative)}">
            ${escapeHtml(representativePathLabel)}
          </div>
        </div>
        <div class="group-stats-row">
          ${score}
          <span class="pill pill-count">${group.files.length} files</span>
          <span class="pill pill-removable">${removable} removable</span>
        </div>
      </div>
      <div class="group-meta">${escapeHtml(group.evidence)}</div>
      <div class="group-thumb-strip">${thumbGrid}</div>
      ${fileListHtml}
      <div class="group-actions">
        <button class="btn-secondary btn-sm" onclick="window.imageDedupApi.openFolder('${escapeHtml(group.representative)}')">
          Open Folder
        </button>
      </div>
    </article>
  `;
}

function createThumbnailHtml(filePath: string, className = "group-thumbnail"): string {
  const encodedPath = encodeURI(filePath.replace(/\\/g, "/"));
  return `
    <img
      class="${escapeHtml(className)}"
      src="file://${encodedPath}"
      alt="Thumbnail"
      loading="lazy"
      onerror="this.style.display='none'"
    />
  `;
}

function renderFileMarkup(file: string, representativeDirectory: string): string {
  const fileName = fileNameForPath(file);
  const directory = directoryForPath(file);
  const pathLabel = directory.length === 0
    ? "Path unavailable"
    : directory === representativeDirectory
      ? "Same folder"
      : shortenMiddle(directory, 50);

  const thumbnail = createThumbnailHtml(file);

  return `
    <li class="group-file-entry" data-file-path="${escapeHtml(file)}">
      ${thumbnail}
      <div class="group-file-info">
        <span class="group-file-name" title="${escapeHtml(file)}">${escapeHtml(fileName)}</span>
        <span class="group-file-path" title="${escapeHtml(file)}">${escapeHtml(pathLabel)}</span>
        <div class="group-file-actions">
          <button class="btn-secondary btn-sm" onclick="window.imageDedupApi.openFile('${escapeHtml(file)}')">Open</button>
          <button class="btn-secondary btn-sm" onclick="window.imageDedupApi.openFolder('${escapeHtml(file)}')">Show in Folder</button>
          <button class="btn-secondary btn-sm btn-copy" onclick="navigator.clipboard.writeText('${escapeHtml(file)}').catch(()=>{})" title="Copy full path">Copy Path</button>
        </div>
      </div>
    </li>
  `;
}

function fileNameForPath(value: string): string {
  const normalized = value.replaceAll("/", "\\");
  const parts = normalized.split("\\").filter(Boolean);
  return parts.at(-1) ?? value;
}

function directoryForPath(value: string): string {
  const normalized = value.replaceAll("/", "\\");
  const separatorIndex = normalized.lastIndexOf("\\");
  return separatorIndex === -1 ? "" : normalized.slice(0, separatorIndex);
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

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

const SCAN_PHASES: Array<{ key: ScanProgress["phase"]; label: string }> = [
  { key: "discovering", label: "Discover" },
  { key: "hashing",     label: "Hash" },
  { key: "comparing",   label: "Compare" },
];

export function renderPhaseStepperMarkup(progress: ScanProgress): string {
  const currentIndex = progress.phase === "complete"
    ? SCAN_PHASES.length
    : SCAN_PHASES.findIndex(p => p.key === progress.phase);

  return SCAN_PHASES.map((p, i) => {
    const state = i < currentIndex ? "completed" : i === currentIndex ? "active" : "pending";
    const dotContent = state === "completed" ? "✓" : String(i + 1);
    const subText = state === "active" && progress.totalFiles > 0
      ? `<span class="phase-sub">${progress.currentFile.toLocaleString()} / ${progress.totalFiles.toLocaleString()}</span>`
      : "";
    const connector = i < SCAN_PHASES.length - 1
      ? `<div class="phase-connector${i < currentIndex ? " phase-connector-done" : ""}"></div>`
      : "";

    return `<div class="phase-step phase-${state}">
      <div class="phase-dot">${dotContent}</div>
      <span class="phase-label">${escapeHtml(p.label)}</span>
      ${subText}
    </div>${connector}`;
  }).join("");
}
