import { describe, expect, it } from "vitest";

import { UnionFind } from "../../src/shared/unionFind";

describe("UnionFind", () => {
  it("returns self roots for unseen values", () => {
    const unionFind = new UnionFind();
    expect(unionFind.find("alpha")).toBe("alpha");
    expect(unionFind.find("alpha")).toBe("alpha");
  });

  it("merges to the lexically smallest root", () => {
    const unionFind = new UnionFind();
    unionFind.add("delta");
    unionFind.add("beta");
    unionFind.add("gamma");

    expect(unionFind.union("delta", "beta")).toBe("beta");
    expect(unionFind.union("gamma", "beta")).toBe("beta");
    expect(unionFind.find("delta")).toBe("beta");
    expect(unionFind.find("gamma")).toBe("beta");
  });
});
