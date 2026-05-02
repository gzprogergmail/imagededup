import { describe, expect, it } from "vitest";

import {
  escapeHtml,
  renderErrorMarkup,
  renderFolderPreviewEmptyMarkup,
  renderFolderPreviewLoadingMarkup,
  renderFolderPreviewMarkup,
  renderPartialResultsMarkup,
  renderResultsEmptyMarkup,
  renderResultsLoadingMarkup,
  renderGroupMarkup,
  renderResultsMarkup,
  renderSummaryEmptyMarkup,
  renderSummaryLoadingMarkup,
  renderSummaryMarkup
} from "../../src/renderer/view";
import type { DetectionResult } from "../../src/shared/types";

const preview = {
  folder: "C:\\fixtures",
  imageCount: 3,
  samplePaths: [
    "C:\\fixtures\\a.png",
    "C:\\fixtures\\b.png"
  ]
};

const result: DetectionResult = {
  elapsedMs: 120,
  groups: [
    {
      evidence: "Perceptual hash · deadbeef",
      files: ["C:\\fixtures\\a.png", "C:\\fixtures\\b.png"],
      id: "1",
      kind: "fast",
      representative: "C:\\fixtures\\a.png",
      score: 0.91
    }
  ],
  library: "imghash",
  mode: "fast",
  scannedFileCount: 2,
  warnings: []
};

describe("renderer view", () => {
  it("escapes html-sensitive text", () => {
    expect(escapeHtml("<tag>'\"")).toBe("&lt;tag&gt;&#39;&quot;");
  });

  it("renders summary cards", () => {
    const markup = renderSummaryMarkup(result, "Fast Pass");
    expect(markup).toContain("Fast Pass");
    expect(markup).toContain("Grouped Files");
    expect(markup).toContain("Unique Images");
    expect(markup).toContain("Duplicate Rate");
    expect(markup).toContain("Throughput");
    expect(markup).toContain("Potentially Removable");
  });

  it("renders helpful placeholder summary cards", () => {
    const markup = renderSummaryEmptyMarkup();
    expect(markup).toContain("No scan yet");
    expect(markup).toContain("perceptual hashing");
  });

  it("renders loading summary cards", () => {
    const markup = renderSummaryLoadingMarkup("Fast Pass");
    expect(markup).toContain("Fast Pass");
    expect(markup).toContain("Running now");
  });

  it("renders a folder preview grid", () => {
    const markup = renderFolderPreviewMarkup(preview);
    expect(markup).toContain("images ready to scan");
    expect(markup).toContain("a.png");
    expect(markup).toContain("+1");
  });

  it("renders folder preview helper states", () => {
    expect(renderFolderPreviewLoadingMarkup("C:\\fixtures")).toContain("Looking for image files");
    expect(renderFolderPreviewEmptyMarkup("Choose a folder")).toContain("Choose a folder");
  });

  it("renders group cards with scores", () => {
    const markup = renderGroupMarkup(result.groups[0]!);
    expect(markup).toContain("score 0.91");
    expect(markup).toContain("Perceptual hash · deadbeef");
    expect(markup).toContain("Same folder");
  });

  it("renders an empty-state result card", () => {
    const markup = renderResultsMarkup({ ...result, groups: [] });
    expect(markup).toContain("No duplicate groups were found.");
  });

  it("renders an empty-state placeholder before a scan starts", () => {
    const markup = renderResultsEmptyMarkup();
    expect(markup).toContain("No results yet");
    expect(markup).toContain("Choose a folder and run a scan");
  });

  it("renders a loading-state result card", () => {
    const markup = renderResultsLoadingMarkup("Fast Pass", "C:\\fixtures\\dataset");
    expect(markup).toContain("Fast Pass is running");
    expect(markup).toContain("Results from previous scans are cleared");
  });

  it("renders an error result card", () => {
    const markup = renderErrorMarkup("Folder does not exist.");
    expect(markup).toContain("Pass failed");
    expect(markup).toContain("Folder does not exist.");
  });

  it("renders partial-results banner with groups", () => {
    const groups = [
      {
        evidence: "hash-partial",
        files: ["C:\\fixtures\\a.png", "C:\\fixtures\\b.png"],
        id: "group-partial",
        kind: "fast" as const,
        representative: "C:\\fixtures\\a.png",
        score: 0.95
      }
    ];
    const markup = renderPartialResultsMarkup(groups, 10, 20);
    expect(markup).toContain("Live results");
    expect(markup).toContain("1 group so far");
    expect(markup).toContain("Processed 10 of 20 images");
    expect(markup).toContain("a.png");
    expect(markup).not.toContain("No duplicate groups were found");
    expect(markup).not.toContain("No groups found yet");
  });

  it("renders partial-results banner with no groups yet", () => {
    const markup = renderPartialResultsMarkup([], 5, 20);
    expect(markup).toContain("Live results");
    expect(markup).toContain("0 groups so far");
    expect(markup).toContain("Processed 5 of 20 images");
    expect(markup).toContain("No groups found yet");
    expect(markup).not.toContain("No duplicate groups were found");
    expect(markup).not.toContain("Nothing to review yet");
  });

  it("renders plural group count in partial banner", () => {
    const makeGroup = (id: string, fileA: string, fileB: string) => ({
      evidence: "h",
      files: [fileA, fileB],
      id,
      kind: "fast" as const,
      representative: fileA,
      score: 0.9
    });
    const groups = [
      makeGroup("g1", "C:\\a.png", "C:\\b.png"),
      makeGroup("g2", "C:\\c.png", "C:\\d.png")
    ];
    const markup = renderPartialResultsMarkup(groups, 15, 30);
    expect(markup).toContain("2 groups so far");
  });

  // Regression tests: ensure no inline onclick handlers (injection bug prevention)
  it("renders group markup without any inline onclick handlers", () => {
    const markup = renderGroupMarkup(result.groups[0]!);
    expect(markup).not.toContain("onclick=");
  });

  it("renders group markup with data-action attributes for file actions", () => {
    const markup = renderGroupMarkup(result.groups[0]!);
    expect(markup).toContain('data-action="open-file"');
    expect(markup).toContain('data-action="open-folder"');
    expect(markup).toContain('data-action="copy-path"');
  });

  it("handles paths with apostrophes without breaking markup", () => {
    const groupWithApostrophe = {
      ...result.groups[0]!,
      files: ["C:\\User's Photos\\photo.png", "C:\\User's Photos\\copy.png"],
      representative: "C:\\User's Photos\\photo.png"
    };
    const markup = renderGroupMarkup(groupWithApostrophe);
    // The apostrophe must be HTML-escaped in data-path, never as a raw ' in attribute value
    expect(markup).not.toContain("data-path=\"C:\\User's");
    expect(markup).toContain("&#39;");
    expect(markup).not.toContain("onclick=");
  });
});
