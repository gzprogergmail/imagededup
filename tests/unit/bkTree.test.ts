import { describe, expect, it } from "vitest";

import { BKTree, MIHIndex, hammingDistance } from "../../src/main/core/bkTree";
import { HAMMING_THRESHOLD } from "../../src/main/core/fastPass";

// ── hammingDistance ───────────────────────────────────────────────────────────

describe("hammingDistance", () => {
  it("returns 0 for identical hashes", () => {
    expect(hammingDistance("abcdef0123456789", "abcdef0123456789")).toBe(0);
    expect(hammingDistance("0000000000000000", "0000000000000000")).toBe(0);
  });

  it("counts 1 bit when a single bit differs", () => {
    // last nibble: 0x0 vs 0x1 → XOR = 0x1 → 1 bit
    expect(hammingDistance("0000000000000000", "0000000000000001")).toBe(1);
    // last nibble: 0x0 vs 0x8 → XOR = 0x8 = 1000 → 1 bit
    expect(hammingDistance("0000000000000000", "0000000000000008")).toBe(1);
  });

  it("returns 64 for all-zeros vs all-f hashes", () => {
    expect(hammingDistance("0000000000000000", "ffffffffffffffff")).toBe(64);
  });

  it("counts bits per nibble correctly", () => {
    // 0xf = 1111 → 4 bits; single nibble change at position 0
    expect(hammingDistance("0000000000000000", "f000000000000000")).toBe(4);
    // 0x3 = 0011 → 2 bits
    expect(hammingDistance("0000000000000000", "0000000000000003")).toBe(2);
    // 0x7 = 0111 → 3 bits
    expect(hammingDistance("0000000000000000", "0000000000000007")).toBe(3);
  });

  it("is symmetric", () => {
    const a = "a1b2c3d4e5f60718";
    const b = "1a2b3c4d5e6f8907";
    expect(hammingDistance(a, b)).toBe(hammingDistance(b, a));
  });

  it("satisfies the triangle inequality on random samples", () => {
    const hashes = ["abcdef0123456789", "123456789abcdef0", "0f0f0f0f0f0f0f0f"];
    const [h0, h1, h2] = hashes as [string, string, string];
    expect(hammingDistance(h0, h2)).toBeLessThanOrEqual(
      hammingDistance(h0, h1) + hammingDistance(h1, h2)
    );
  });
});

// ── BKTree ────────────────────────────────────────────────────────────────────

describe("BKTree", () => {
  it("starts empty", () => {
    expect(new BKTree().size).toBe(0);
  });

  it("returns empty results when querying an empty tree", () => {
    expect(new BKTree().query("abcdef0123456789", 10)).toEqual([]);
  });

  it("finds an exact match at maxDist 0", () => {
    const tree = new BKTree();
    tree.insert("abcdef0123456789", "/img/a.png");
    const results = tree.query("abcdef0123456789", 0);
    expect(results).toHaveLength(1);
    expect(results[0]!.filePath).toBe("/img/a.png");
    expect(results[0]!.dist).toBe(0);
  });

  it("does not return the exact match when maxDist is -1", () => {
    const tree = new BKTree();
    tree.insert("abcdef0123456789", "/img/a.png");
    expect(tree.query("abcdef0123456789", -1)).toHaveLength(0);
  });

  it("tracks size correctly", () => {
    const tree = new BKTree();
    tree.insert("0000000000000000", "/img/a.png");
    expect(tree.size).toBe(1);
    tree.insert("ffffffffffffffff", "/img/b.png");
    expect(tree.size).toBe(2);
    // Inserting same hash again should not grow the tree
    tree.insert("0000000000000000", "/img/c.png");
    expect(tree.size).toBe(2);
  });

  it("finds a near-match within maxDist", () => {
    const tree = new BKTree();
    // Base hash
    tree.insert("abcdef0123456789", "/img/base.png");
    // 1-bit difference (last nibble 9 → 8: XOR = 0x1 = 1 bit)
    const near = "abcdef012345678" + "8";
    expect(hammingDistance("abcdef0123456789", near)).toBe(1);

    expect(tree.query(near, 5)).toHaveLength(1);
    expect(tree.query(near, 1)).toHaveLength(1);
    expect(tree.query(near, 0)).toHaveLength(0); // not an exact match
  });

  it("does not return entries beyond maxDist", () => {
    const tree = new BKTree();
    tree.insert("0000000000000000", "/img/a.png");
    // query with a hash that differs by 32 bits (half of all bits)
    const distant = "ffffffff00000000";
    const dist = hammingDistance("0000000000000000", distant);
    expect(dist).toBe(32);

    expect(tree.query(distant, 10)).toHaveLength(0);
    expect(tree.query(distant, 31)).toHaveLength(0);
    expect(tree.query(distant, 32)).toHaveLength(1);
  });

  it("returns multiple results when several entries are within threshold", () => {
    const tree = new BKTree();
    const base = "0000000000000000";
    // 1-bit variants
    const v1 = "0000000000000001"; // dist 1
    const v2 = "0000000000000002"; // dist 1
    const v3 = "0000000000000003"; // dist 2
    const far = "ffffffffffffffff"; // dist 64
    tree.insert(base, "/img/base.png");
    tree.insert(v1, "/img/v1.png");
    tree.insert(v2, "/img/v2.png");
    tree.insert(v3, "/img/v3.png");
    tree.insert(far, "/img/far.png");

    const results = tree.query(base, 2);
    const paths = results.map((r) => r.filePath);
    expect(paths).toContain("/img/base.png");
    expect(paths).toContain("/img/v1.png");
    expect(paths).toContain("/img/v2.png");
    expect(paths).toContain("/img/v3.png");
    expect(paths).not.toContain("/img/far.png");
  });

  it("stores the first filePath for a given hash (exact duplicate insert is a no-op)", () => {
    const tree = new BKTree();
    tree.insert("abcdef0123456789", "/img/first.png");
    tree.insert("abcdef0123456789", "/img/second.png"); // same hash → skipped
    const results = tree.query("abcdef0123456789", 0);
    expect(results).toHaveLength(1);
    expect(results[0]!.filePath).toBe("/img/first.png");
  });
});

// ── Accuracy: BK-tree vs brute force ─────────────────────────────────────────

describe("BKTree accuracy", () => {
  /** Deterministic pseudo-random 16-char hex hash for index n. */
  function deterministicHash(n: number): string {
    const a = (Math.imul(n, 0x9e3779b9) >>> 0).toString(16).padStart(8, "0");
    const b = (Math.imul(n, 0x6c62272e) >>> 0).toString(16).padStart(8, "0");
    return a + b;
  }

  /** Brute-force: linear scan over all hashes for comparison. */
  function bruteForceQuery(hashes: string[], query: string, maxDist: number): string[] {
    return hashes.filter((h) => hammingDistance(h, query) <= maxDist);
  }

  it("matches brute-force results for 200 hashes across 20 query probes (no false negatives or positives)", () => {
    const N = 200;
    const THRESHOLD = 10;
    const hashes = Array.from({ length: N }, (_, i) => deterministicHash(i));

    const tree = new BKTree();
    for (let i = 0; i < N; i++) {
      tree.insert(hashes[i]!, `/img/${i}.png`);
    }

    // Use 20 probes from a different range to get realistic hit/miss mix
    for (let probe = 0; probe < 20; probe++) {
      const queryHash = deterministicHash(N + probe * 7);
      const bfPaths = new Set(bruteForceQuery(hashes, queryHash, THRESHOLD));
      const treePaths = new Set(tree.query(queryHash, THRESHOLD).map((r) => r.filePath));

      // Map BK-tree filePaths to the hash index to compare hash sets
      const bfHashes = new Set(hashes.filter((h) => hammingDistance(h, queryHash) <= THRESHOLD));
      const treeHashes = new Set(tree.query(queryHash, THRESHOLD).map((r) => r.hash));

      // No false negatives: every brute-force match must appear in BK-tree results
      for (const h of bfHashes) {
        expect(treeHashes.has(h)).toBe(true);
      }
      // No false positives: every BK-tree result must pass the distance check
      for (const h of treeHashes) {
        expect(hammingDistance(h, queryHash)).toBeLessThanOrEqual(THRESHOLD);
      }

      // Counts must agree
      expect(treeHashes.size).toBe(bfHashes.size);
    }
  });

  it("never misses a known near-duplicate seeded exactly at the threshold boundary", () => {
    const tree = new BKTree();
    const base = "0000000000000000";

    // Build a hash that differs in exactly 10 bits (bits 0–9 all set → last 3 nibbles)
    // 0x0000000000000fff: nibbles f=4, f=4, f=4 → 12 bits. Too many.
    // 0x00000000000003ff: 0x3=2, 0xff split as f=4+f=4 → wait, let's be careful.
    // 16 chars, last 3 chars: "3ff" → 0x3=0011(2 bits)+0xf=1111(4 bits)+0xf=1111(4 bits) = 10 bits ✓
    const atThreshold = "00000000000003ff";
    expect(hammingDistance(base, atThreshold)).toBe(10);

    // 11 bits (just over): "7ff" → 0x7=0111(3)+0xf+0xf = 11 bits
    const overThreshold = "00000000000007ff";
    expect(hammingDistance(base, overThreshold)).toBe(11);

    tree.insert(base, "/img/base.png");

    expect(tree.query(atThreshold, 10)).toHaveLength(1);
    expect(tree.query(overThreshold, 10)).toHaveLength(0);
  });

  it("handles a deep chain without stack overflow (100 sequential inserts, each 1 bit away from prior)", () => {
    const tree = new BKTree();
    // Build a chain: each hash is 1 Hamming bit away from the previous
    // This can create a linear BK-tree chain — tests iterative traversal
    const hashes: string[] = [];
    let h = 0n;
    for (let i = 0; i < 100; i++) {
      const hex = h.toString(16).padStart(16, "0");
      hashes.push(hex);
      tree.insert(hex, `/img/${i}.png`);
      h = (h << 1n) | 1n; // shift left and set bit → Hamming dist grows
    }

    // The query should not throw even on a deep chain
    expect(() => tree.query("0000000000000000", 5)).not.toThrow();
    // First 5 entries differ by 0–4 bits from 0x0 (since h starts at 0, 1, 3, 7, 15, 31...)
    // Actually: h[0]=0, h[1]=1(1bit), h[2]=3(2bits), h[3]=7(3bits), h[4]=15(4bits), h[5]=31(5bits), h[6]=63(6bits)...
    const results = tree.query("0000000000000000", 5);
    expect(results.length).toBeGreaterThanOrEqual(6); // 0 through 5 bits
  });
});

// ── MIHIndex unit tests ───────────────────────────────────────────────────────

describe("MIHIndex", () => {
  it("starts empty", () => {
    expect(new MIHIndex().size).toBe(0);
  });

  it("returns empty results when querying an empty index", () => {
    expect(new MIHIndex().query("abcdef0123456789", 10)).toEqual([]);
  });

  it("finds an exact match at maxDist 0", () => {
    const idx = new MIHIndex();
    idx.insert("abcdef0123456789", "/img/a.png");
    const results = idx.query("abcdef0123456789", 0);
    expect(results).toHaveLength(1);
    expect(results[0]!.filePath).toBe("/img/a.png");
    expect(results[0]!.dist).toBe(0);
  });

  it("does not return entries when maxDist is -1", () => {
    const idx = new MIHIndex();
    idx.insert("abcdef0123456789", "/img/a.png");
    expect(idx.query("abcdef0123456789", -1)).toHaveLength(0);
  });

  it("tracks size correctly and ignores duplicate hash inserts", () => {
    const idx = new MIHIndex();
    idx.insert("0000000000000000", "/img/a.png");
    expect(idx.size).toBe(1);
    idx.insert("ffffffffffffffff", "/img/b.png");
    expect(idx.size).toBe(2);
    idx.insert("0000000000000000", "/img/c.png"); // same hash → no-op
    expect(idx.size).toBe(2);
  });

  it("finds a 1-bit near-match within threshold", () => {
    const idx = new MIHIndex();
    idx.insert("abcdef0123456789", "/img/base.png");
    const near = "abcdef012345678" + "8"; // last nibble 9→8: XOR=1 → 1 bit
    expect(hammingDistance("abcdef0123456789", near)).toBe(1);

    expect(idx.query(near, 5)).toHaveLength(1);
    expect(idx.query(near, 1)).toHaveLength(1);
    expect(idx.query(near, 0)).toHaveLength(0);
  });

  it("does not return entries beyond maxDist", () => {
    const idx = new MIHIndex();
    idx.insert("0000000000000000", "/img/a.png");
    const distant = "ffffffff00000000"; // dist=32
    expect(hammingDistance("0000000000000000", distant)).toBe(32);

    expect(idx.query(distant, 10)).toHaveLength(0);
    expect(idx.query(distant, 31)).toHaveLength(0);
    expect(idx.query(distant, 32)).toHaveLength(1);
  });

  it("returns multiple results within threshold", () => {
    const idx = new MIHIndex();
    const base = "0000000000000000";
    const v1 = "0000000000000001"; // dist 1
    const v2 = "0000000000000002"; // dist 1
    const v3 = "0000000000000003"; // dist 2
    const far = "ffffffffffffffff"; // dist 64
    idx.insert(base, "/img/base.png");
    idx.insert(v1, "/img/v1.png");
    idx.insert(v2, "/img/v2.png");
    idx.insert(v3, "/img/v3.png");
    idx.insert(far, "/img/far.png");

    const results = idx.query(base, 2);
    const paths = results.map((r) => r.filePath);
    expect(paths).toContain("/img/base.png");
    expect(paths).toContain("/img/v1.png");
    expect(paths).toContain("/img/v2.png");
    expect(paths).toContain("/img/v3.png");
    expect(paths).not.toContain("/img/far.png");
  });

  it("stores the first filePath for a hash (duplicate insert is a no-op)", () => {
    const idx = new MIHIndex();
    idx.insert("abcdef0123456789", "/img/first.png");
    idx.insert("abcdef0123456789", "/img/second.png");
    const results = idx.query("abcdef0123456789", 0);
    expect(results).toHaveLength(1);
    expect(results[0]!.filePath).toBe("/img/first.png");
  });

  it("respects the exact threshold boundary (dist=T included, dist=T+1 excluded)", () => {
    const idx = new MIHIndex();
    const base = "0000000000000000";
    const atThreshold = (BigInt(1) << BigInt(HAMMING_THRESHOLD)) - BigInt(1);
    const overThreshold = (BigInt(1) << BigInt(HAMMING_THRESHOLD + 1)) - BigInt(1);
    const atThresholdHash = atThreshold.toString(16).padStart(16, "0");
    const overThresholdHash = overThreshold.toString(16).padStart(16, "0");
    expect(hammingDistance(base, atThresholdHash)).toBe(HAMMING_THRESHOLD);
    expect(hammingDistance(base, overThresholdHash)).toBe(HAMMING_THRESHOLD + 1);

    idx.insert(base, "/img/base.png");

    expect(idx.query(atThresholdHash, HAMMING_THRESHOLD)).toHaveLength(1);
    expect(idx.query(overThresholdHash, HAMMING_THRESHOLD)).toHaveLength(0);
  });
});

// ── MIHIndex accuracy: cross-validate against brute force ────────────────────

describe("MIHIndex accuracy", () => {
  function deterministicHash(n: number): string {
    const a = (Math.imul(n, 0x9e3779b9) >>> 0).toString(16).padStart(8, "0");
    const b = (Math.imul(n, 0x6c62272e) >>> 0).toString(16).padStart(8, "0");
    return a + b;
  }

  function bruteForceQuery(hashes: string[], query: string, maxDist: number): Set<string> {
    return new Set(hashes.filter((h) => hammingDistance(h, query) <= maxDist));
  }

  it("matches brute-force results exactly for 200 hashes × 20 query probes (no false negatives or positives)", () => {
    const N = 200;
    const hashes = Array.from({ length: N }, (_, i) => deterministicHash(i));
    const idx = new MIHIndex();
    for (let i = 0; i < N; i++) idx.insert(hashes[i]!, `/img/${i}.png`);

    for (let probe = 0; probe < 20; probe++) {
      const queryHash = deterministicHash(N + probe * 7);
      const bfHashes = bruteForceQuery(hashes, queryHash, HAMMING_THRESHOLD);
      const mihHashes = new Set(idx.query(queryHash, HAMMING_THRESHOLD).map((r) => r.hash));

      // No false negatives
      for (const h of bfHashes) {
        expect(mihHashes.has(h)).toBe(true);
      }
      // No false positives — every MIH result must be within threshold
      for (const h of mihHashes) {
        expect(hammingDistance(h, queryHash)).toBeLessThanOrEqual(HAMMING_THRESHOLD);
      }
      expect(mihHashes.size).toBe(bfHashes.size);
    }
  });

  it("produces identical groups to BKTree when both index the same hashes", () => {
    const N = 100;
    const hashes = Array.from({ length: N }, (_, i) => deterministicHash(i));

    const bkTree = new BKTree();
    const mihIdx = new MIHIndex();
    for (let i = 0; i < N; i++) {
      bkTree.insert(hashes[i]!, `/img/${i}.png`);
      mihIdx.insert(hashes[i]!, `/img/${i}.png`);
    }

    // For each query, MIH and BK-tree must return the same set of hashes
    for (let probe = 0; probe < 30; probe++) {
      const q = deterministicHash(N + probe);
      const bkHashes = new Set(bkTree.query(q, HAMMING_THRESHOLD).map((r) => r.hash));
      const mihHashes = new Set(mihIdx.query(q, HAMMING_THRESHOLD).map((r) => r.hash));

      expect(mihHashes.size).toBe(bkHashes.size);
      for (const h of bkHashes) {
        expect(mihHashes.has(h)).toBe(true);
      }
    }
  });

  it("never misses a known near-duplicate at the threshold boundary", () => {
    const idx = new MIHIndex();
    const base = "0000000000000000";
    const atThreshold = "00000000000003ff"; // dist=10
    const overThreshold = "00000000000007ff"; // dist=11
    idx.insert(base, "/img/base.png");

    expect(idx.query(atThreshold, 10)).toHaveLength(1);
    expect(idx.query(overThreshold, 10)).toHaveLength(0);
  });
});
