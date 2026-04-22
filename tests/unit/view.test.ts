import { describe, expect, it } from "vitest";

import {
  escapeHtml,
  renderErrorMarkup,
  renderFolderPreviewEmptyMarkup,
  renderFolderPreviewLoadingMarkup,
  renderFolderPreviewMarkup,
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
      evidence: "hash deadbeef",
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
  });

  it("renders helpful placeholder summary cards", () => {
    const markup = renderSummaryEmptyMarkup();
    expect(markup).toContain("No scan yet");
    expect(markup).toContain("Fast Pass first");
  });

  it("renders loading summary cards", () => {
    const markup = renderSummaryLoadingMarkup("Slow Pass");
    expect(markup).toContain("Slow Pass");
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
    expect(markup).toContain("hash deadbeef");
    expect(markup).toContain("Same folder");
  });

  it("renders an empty-state result card", () => {
    const markup = renderResultsMarkup({ ...result, groups: [] });
    expect(markup).toContain("No duplicate groups were found.");
  });

  it("renders an empty-state placeholder before a scan starts", () => {
    const markup = renderResultsEmptyMarkup();
    expect(markup).toContain("Nothing to review yet.");
    expect(markup).toContain("run Fast Pass");
  });

  it("renders a loading-state result card", () => {
    const markup = renderResultsLoadingMarkup("Fast Pass", "C:\\fixtures\\dataset");
    expect(markup).toContain("Fast Pass is running");
    expect(markup).toContain("Existing results are cleared");
  });

  it("renders an error result card", () => {
    const markup = renderErrorMarkup("Folder does not exist.");
    expect(markup).toContain("Pass failed");
    expect(markup).toContain("Folder does not exist.");
  });
});
