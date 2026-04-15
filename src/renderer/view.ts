import type { DetectionResult, DuplicateGroup } from "../shared/types";

export function renderSummaryMarkup(result: DetectionResult, passLabel: string): string {
  const totalDuplicates = result.groups.reduce((sum, group) => sum + group.files.length, 0);
  const items = [
    { label: "Pass", value: passLabel },
    { label: "Library", value: result.library },
    { label: "Images", value: String(result.scannedFileCount) },
    { label: "Groups", value: String(result.groups.length) },
    { label: "Grouped Files", value: String(totalDuplicates) },
    { label: "Elapsed", value: `${result.elapsedMs} ms` }
  ];

  return items.map((item) => `
    <article class="summary-card">
      <div class="summary-value">${escapeHtml(item.value)}</div>
      <div class="summary-label">${escapeHtml(item.label)}</div>
    </article>
  `).join("");
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

  return `${warnings}${result.groups.map(renderGroupMarkup).join("")}`;
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
  const score = group.score === undefined ? "" : `<span class="pill">score ${group.score}</span>`;
  return `
    <article class="group-card">
      <div class="group-title">
        <strong>${escapeHtml(group.representative)}</strong>
        ${score}
      </div>
      <div class="group-meta">${escapeHtml(group.evidence)}</div>
      <ol class="group-files">
        ${group.files.map((file) => `<li>${escapeHtml(file)}</li>`).join("")}
      </ol>
    </article>
  `;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}
