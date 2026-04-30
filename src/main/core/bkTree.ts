// Precomputed popcount for 4-bit nibbles (0–15): POPCOUNT4[n] = number of set bits in n
const POPCOUNT4 = Uint8Array.from({ length: 16 }, (_, i) => {
  let n = i;
  let count = 0;
  while (n) { count += n & 1; n >>>= 1; }
  return count;
});

/**
 * Hamming distance between two 16-character hex strings (64-bit hashes).
 * Counts differing bits via per-nibble popcount.
 */
export function hammingDistance(a: string, b: string): number {
  let dist = 0;
  for (let i = 0; i < 16; i++) {
    dist += POPCOUNT4[(parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16))]!;
  }
  return dist;
}

export interface BKMatch {
  hash: string;
  filePath: string;
  dist: number;
}

interface BKNode {
  hash: string;
  filePath: string;
  children: Map<number, BKNode>;
}

/**
 * BK-tree for efficient nearest-neighbour search over 64-bit perceptual hashes.
 *
 * Metric: Hamming distance. Average insert/query cost: O(log N).
 * Worst case (all hashes equidistant): O(N) — rare with real images.
 *
 * Each unique hash occupies one node. Exact duplicate hashes are silently
 * skipped on insert; callers detect them via query before inserting.
 */
export class BKTree {
  private root: BKNode | null = null;
  private _size = 0;

  get size(): number {
    return this._size;
  }

  /**
   * Insert a (hash, filePath) pair. If the exact hash already exists, does nothing —
   * the existing node will be returned by query with dist=0.
   */
  insert(hash: string, filePath: string): void {
    if (!this.root) {
      this.root = { hash, filePath, children: new Map() };
      this._size++;
      return;
    }
    let node = this.root;
    for (;;) {
      const dist = hammingDistance(hash, node.hash);
      if (dist === 0) return;
      const child = node.children.get(dist);
      if (!child) {
        node.children.set(dist, { hash, filePath, children: new Map() });
        this._size++;
        return;
      }
      node = child;
    }
  }

  /**
   * Return all entries whose Hamming distance from `hash` is ≤ `maxDist`.
   * Results include exact matches (dist = 0) when maxDist ≥ 0.
   * Uses iterative traversal to avoid stack overflow on large trees.
   */
  query(hash: string, maxDist: number): BKMatch[] {
    if (!this.root) return [];
    const results: BKMatch[] = [];
    const stack: BKNode[] = [this.root];
    while (stack.length > 0) {
      const node = stack.pop()!;
      const dist = hammingDistance(hash, node.hash);
      if (dist <= maxDist) {
        results.push({ hash: node.hash, filePath: node.filePath, dist });
      }
      const lo = Math.max(0, dist - maxDist);
      const hi = dist + maxDist;
      for (const [key, child] of node.children) {
        if (key >= lo && key <= hi) {
          stack.push(child);
        }
      }
    }
    return results;
  }
}
