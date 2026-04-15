import { describe, expect, it } from "vitest";

import { renderGroupMarkup } from "../../src/renderer/view";
import type { DuplicateGroup } from "../../src/shared/types";

function createGroup(index: number): DuplicateGroup {
  return {
    evidence: `hash-${index}`,
    files: [`image-${index}.png`, `image-${index}-copy.png`],
    id: `group-${index}`,
    kind: "fast",
    representative: `image-${index}.png`
  };
}

describe("renderer performance", () => {
  it("renders 500 groups within an acceptable budget", () => {
    const groups = Array.from({ length: 500 }, (_, index) => createGroup(index));
    const startedAt = performance.now();
    const markup = groups.map(renderGroupMarkup).join("");
    const elapsed = performance.now() - startedAt;

    expect(markup.length).toBeGreaterThan(1000);
    expect(elapsed).toBeLessThan(150);
  });
});
