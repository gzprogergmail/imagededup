import { cpus } from "node:os";

import sharp from "sharp";

import { UnionFind } from "../../shared/unionFind";
import type { DetectionResult, DuplicateGroup, ImageRecord } from "../../shared/types";

const ROTATIONS = [0, 90, 180, 270] as const;
const SAMPLE_SIZE = 32;
const HASH_SIZE = 8;
const CONCURRENCY = Math.min(cpus().length * 2, 16);

// Precompute DCT cosine table: cosTable[u][x] = cos((2x+1)*u*π / (2*N))
const cosTable: number[][] = Array.from({ length: HASH_SIZE }, (_, u) =>
  Array.from({ length: SAMPLE_SIZE }, (_, x) =>
    Math.cos(((2 * x + 1) * u * Math.PI) / (2 * SAMPLE_SIZE))
  )
);

// Precompute normalization: 1/√2 for u=0, 1 otherwise
const normTable: number[] = Array.from({ length: HASH_SIZE }, (_, u) =>
  u === 0 ? 1 / Math.SQRT2 : 1
);

/**
 * Compute a 64-bit perceptual DCT hash (pHash) over a 32×32 grayscale pixel buffer.
 * Takes the top-left 8×8 DCT coefficients, computes the mean (excluding DC at [0,0]),
 * and returns a 16-char hex string where bit[i]=1 iff coeff[i] >= mean.
 */
export function dctHash(pixels: Uint8Array): string {
  const n = SAMPLE_SIZE;
  const h = HASH_SIZE;
  const dct = new Float64Array(h * h);

  for (let u = 0; u < h; u++) {
    const cosU = cosTable[u]!;
    const nu = normTable[u]!;
    for (let v = 0; v < h; v++) {
      const cosV = cosTable[v]!;
      const nv = normTable[v]!;
      let sum = 0;
      for (let x = 0; x < n; x++) {
        const cx = cosU[x]!;
        const row = x * n;
        for (let y = 0; y < n; y++) {
          sum += pixels[row + y]! * cx * cosV[y]!;
        }
      }
      dct[u * h + v] = (nu * nv * sum) / n;
    }
  }

  // Mean of non-DC coefficients (skip index 0)
  let meanSum = 0;
  for (let i = 1; i < h * h; i++) {
    meanSum += dct[i]!;
  }
  const mean = meanSum / (h * h - 1);

  // Pack 64 bits into two 32-bit integers → 16-char hex
  let high = 0;
  let low = 0;
  for (let i = 0; i < 32; i++) {
    high = ((high << 1) | (dct[i]! >= mean ? 1 : 0)) >>> 0;
  }
  for (let i = 32; i < 64; i++) {
    low = ((low << 1) | (dct[i]! >= mean ? 1 : 0)) >>> 0;
  }
  return high.toString(16).padStart(8, "0") + low.toString(16).padStart(8, "0");
}

export interface HashProvider {
  getHashes(filePath: string): Promise<string[]>;
}

export class ImghashProvider implements HashProvider {
  async getHashes(filePath: string): Promise<string[]> {
    const hashes = await Promise.all(
      ROTATIONS.map(async (rotation) => {
        const pixels = await sharp(filePath)
          .rotate(rotation)
          .resize(SAMPLE_SIZE, SAMPLE_SIZE, { fit: "fill" })
          .grayscale()
          .raw()
          .toBuffer();
        return dctHash(new Uint8Array(pixels));
      })
    );

    return [...new Set(hashes)];
  }
}

class Semaphore {
  private readonly queue: Array<() => void> = [];
  private available: number;

  constructor(max: number) {
    this.available = max;
  }

  acquire(): Promise<void> {
    if (this.available > 0) {
      this.available--;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.available++;
    }
  }
}

export async function runFastPass(
  files: ImageRecord[],
  hashProvider: HashProvider = new ImghashProvider()
): Promise<DetectionResult> {
  const startedAt = performance.now();
  const hashIndex = new Map<string, string>();
  const firstHashByFile = new Map<string, string>();
  const unionFind = new UnionFind();
  const semaphore = new Semaphore(CONCURRENCY);

  // Pre-register all paths before any async work so union-find is fully populated.
  for (const file of files) {
    unionFind.add(file.path);
  }

  await Promise.all(files.map(async (file) => {
    await semaphore.acquire();
    let hashes: string[];
    try {
      hashes = await hashProvider.getHashes(file.path);
    } finally {
      semaphore.release();
    }

    // This section is synchronous (no awaits) — safe to run without a lock
    // because JS is single-threaded and microtasks run to completion.
    firstHashByFile.set(file.path, hashes[0] ?? "unknown");

    const matchedRoots = [...new Set(
      hashes
        .map((hash) => hashIndex.get(hash))
        .filter((value): value is string => Boolean(value))
        .map((value) => unionFind.find(value))
    )];

    let groupSeed = file.path;
    for (const matchedRoot of matchedRoots) {
      groupSeed = unionFind.union(groupSeed, matchedRoot);
    }

    for (const hash of hashes) {
      hashIndex.set(hash, groupSeed);
    }
  }));

  const groups = buildGroups(files, firstHashByFile, unionFind);
  return {
    elapsedMs: Math.round(performance.now() - startedAt),
    groups,
    library: "imghash",
    mode: "fast",
    scannedFileCount: files.length,
    warnings: []
  };
}

function buildGroups(
  files: ImageRecord[],
  firstHashByFile: Map<string, string>,
  unionFind: UnionFind
): DuplicateGroup[] {
  const groups = new Map<string, string[]>();

  for (const file of files) {
    const root = unionFind.find(file.path);
    const items = groups.get(root) ?? [];
    items.push(file.path);
    groups.set(root, items);
  }

  return [...groups.entries()]
    .filter(([, items]) => items.length > 1)
    .map(([root, items]) => {
      const representative = items[0]!;
      const evidence = firstHashByFile.get(representative) ?? "unknown";
      return {
        evidence,
        files: items,
        id: root,
        kind: "fast",
        representative
      } satisfies DuplicateGroup;
    })
    .sort((left, right) => right.files.length - left.files.length);
}
