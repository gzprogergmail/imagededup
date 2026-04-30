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

// ── BKTree ─────────────────────────────────────────────────────────────────────

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

// ── Multi-Index Hashing (MIH) ──────────────────────────────────────────────────
//
// Splits each 64-bit pHash into 4 × 16-bit chunks.
//
// Pigeonhole guarantee: if two hashes differ by ≤ T bits across 4 chunks, at
// least one chunk must differ by ≤ floor(T/4) bits. So we only enumerate
// ~137 chunk-level candidates per query (C(16,0)+C(16,1)+C(16,2)=137) and
// then verify the full 64-bit distance — giving O(1) query cost regardless of N.
//
// For HAMMING_THRESHOLD=10: floor(10/4)=2 → 137 masks per chunk × 4 chunks = 548
// lookups per query, vs O(N) for BKTree on high-entropy Hamming data.

const MIH_NUM_CHUNKS = 4;
const MIH_CHUNK_HEX = 4; // 4 hex chars = 16 bits per chunk

/**
 * Precomputed XOR masks for all 16-bit patterns within Hamming distance 0, 1, or 2
 * from 0. Apply with XOR to any chunk value to enumerate its neighbours.
 * Layout: [1 mask at d=0] [16 masks at d=1] [120 masks at d=2] — total 137.
 */
const MASKS_LE2: readonly number[] = (() => {
  const m: number[] = [0];
  for (let i = 0; i < 16; i++) m.push(1 << i);
  for (let i = 0; i < 16; i++) {
    for (let j = i + 1; j < 16; j++) {
      m.push((1 << i) | (1 << j));
    }
  }
  return m;
})();

// Slices of MASKS_LE2 indexed by the per-chunk max distance (0, 1, or 2).
const MASKS_FOR_CHUNK_DIST: readonly (readonly number[])[] = [
  MASKS_LE2.slice(0, 1),   // d≤0: 1 mask
  MASKS_LE2.slice(0, 17),  // d≤1: 17 masks
  MASKS_LE2,               // d≤2: 137 masks
];

/**
 * Multi-Index Hashing index for near-duplicate pHash search.
 *
 * Same insert/query API as BKTree. Supports Hamming thresholds 0–11
 * (floor(T/4) ≤ 2, covered by precomputed 137-mask table).
 */
export class MIHIndex {
  /** Four chunk sub-tables: chunk_value → array of full hash strings. */
  private readonly tables: Array<Map<number, string[]>> = Array.from(
    { length: MIH_NUM_CHUNKS },
    () => new Map()
  );

  /** Full hash → first filePath seen with that hash. */
  private readonly hashToFile = new Map<string, string>();

  get size(): number {
    return this.hashToFile.size;
  }

  /**
   * Index a (hash, filePath) pair. If the exact hash is already present,
   * this is a no-op — the caller will find it via query at dist=0.
   */
  insert(hash: string, filePath: string): void {
    if (this.hashToFile.has(hash)) return;
    this.hashToFile.set(hash, filePath);
    for (let c = 0; c < MIH_NUM_CHUNKS; c++) {
      const chunkVal = parseInt(hash.substring(c * MIH_CHUNK_HEX, (c + 1) * MIH_CHUNK_HEX), 16);
      const table = this.tables[c]!;
      const bucket = table.get(chunkVal);
      if (bucket) {
        bucket.push(hash);
      } else {
        table.set(chunkVal, [hash]);
      }
    }
  }

  /**
   * Return all indexed entries with Hamming distance ≤ maxDist from hash.
   * O(C(16,floor(maxDist/4)) × 4) lookups — independent of index size.
   */
  query(hash: string, maxDist: number): BKMatch[] {
    const chunkMaxDist = Math.min(Math.floor(maxDist / MIH_NUM_CHUNKS), 2);
    if (chunkMaxDist < 0) return [];
    const masks = MASKS_FOR_CHUNK_DIST[chunkMaxDist]!;

    const candidates = new Set<string>();
    for (let c = 0; c < MIH_NUM_CHUNKS; c++) {
      const chunkVal = parseInt(hash.substring(c * MIH_CHUNK_HEX, (c + 1) * MIH_CHUNK_HEX), 16);
      const table = this.tables[c]!;
      for (const mask of masks) {
        const neighbor = (chunkVal ^ mask) & 0xffff;
        const bucket = table.get(neighbor);
        if (bucket) {
          for (const h of bucket) candidates.add(h);
        }
      }
    }

    const results: BKMatch[] = [];
    for (const candidateHash of candidates) {
      const dist = hammingDistance(hash, candidateHash);
      if (dist <= maxDist) {
        results.push({ hash: candidateHash, filePath: this.hashToFile.get(candidateHash)!, dist });
      }
    }
    return results;
  }
}
