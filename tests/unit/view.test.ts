import { describe, expect, it } from "vitest";

import {
  escapeHtml,
  renderErrorMarkup,
  renderGroupMarkup,
  renderResultsMarkup,
  renderSummaryMarkup
} from "../../src/renderer/view";
import type { DetectionResult } from "../../src/shared/types";

const result: DetectionResult = {
  elapsedMs: 120,
  groups: [
    {
      evidence: "hash deadbeef",
      files: ["a.png", "b.png"],
      id: "1",
      kind: "fast",
      representative: "a.png",
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

  it("renders group cards with scores", () => {
    const markup = renderGroupMarkup(result.groups[0]!);
    expect(markup).toContain("score 0.91");
    expect(markup).toContain("hash deadbeef");
  });

  it("renders an empty-state result card", () => {
    const markup = renderResultsMarkup({ ...result, groups: [] });
    expect(markup).toContain("No duplicate groups were found.");
  });

  it("renders an error result card", () => {
    const markup = renderErrorMarkup("Folder does not exist.");
    expect(markup).toContain("Pass failed");
    expect(markup).toContain("Folder does not exist.");
  });
});
