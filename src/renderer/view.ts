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
