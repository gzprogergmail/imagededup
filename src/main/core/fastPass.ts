import { readFile } from "node:fs/promises";
import { cpus } from "node:os";

import sharp from "sharp";

import { MIHIndex } from "./bkTree";
import { UnionFind } from "../../shared/unionFind";
import type { DetectionResult, DuplicateGroup, ImageRecord } from "../../shared/types";

const ROTATIONS = [0, 90, 180, 270] as const;
const SAMPLE_SIZE = 32;
const HASH_SIZE = 8;
const CONCURRENCY = Math.min(cpus().length * 2, 16);

/**
 * Maximum Hamming distance (in bits out of 64) at which two pHashes are
 * considered near-duplicates. Threshold of 10 catches same-photo variants
 * (recompressed, slightly brightened, etc.) while avoiding false positives
 * on visually distinct images.
 */
export const HAMMING_THRESHOLD = 10;

/**
 * Number of files to process per synchronous batch in the matching phase
 * before yielding to the event loop. Keeps IPC and progress updates
 * responsive during large scans.
 */
const YIELD_BATCH_SIZE = 1000;

/** Yield one tick to the event loop so IPC/progress messages can be dispatched. */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

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
 *
 * Uses a separable 2-pass DCT: O(H·N²+ H²·N) ≈ 10 240 ops vs the naive
 * O(H²·N²) = 65 536 ops — a ~6× reduction in multiply-adds.
 */
export function dctHash(pixels: Uint8Array): string {
  const n = SAMPLE_SIZE;
  const h = HASH_SIZE;

  // Pass 1 — row DCT: T[x][v] = Σ_y pixels[x,y] · cosTable[v][y]
  // Layout T[x * h + v] keeps each row's h coefficients contiguous.
  const T = new Float64Array(n * h);
  for (let x = 0; x < n; x++) {
    const rowOffset = x * n;
    for (let v = 0; v < h; v++) {
      const cosV = cosTable[v]!;
      let sum = 0;
      for (let y = 0; y < n; y++) {
        sum += pixels[rowOffset + y]! * cosV[y]!;
      }
      T[x * h + v] = sum;
    }
  }

  // Pass 2 — column DCT: dct[u][v] = (nu·nv / n) · Σ_x cosTable[u][x] · T[x][v]
  const dct = new Float64Array(h * h);
  for (let u = 0; u < h; u++) {
    const cosU = cosTable[u]!;
    const nu = normTable[u]!;
    for (let v = 0; v < h; v++) {
      const nv = normTable[v]!;
      let sum = 0;
      for (let x = 0; x < n; x++) {
        sum += cosU[x]! * T[x * h + v]!;
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
    // Read the file once to avoid repeated disk I/O (critical on network storage).
    // All 4 rotation pipelines decode from the same in-memory buffer concurrently.
    const fileBuffer = await readFile(filePath);

    const hashes = await Promise.all(
      ROTATIONS.map(async (rotation) => {
        const pixels = await sharp(fileBuffer)
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
  files: ImageRecord[] | AsyncIterable<ImageRecord>,
  hashProvider: HashProvider = new ImghashProvider(),
  hammingThreshold = HAMMING_THRESHOLD,
  onMatchProgress?: (done: number, total: number) => void,
  onHashProgress?: (hashedCount: number, discoveredCount: number) => void,
  onDiscoverProgress?: (discoveredCount: number) => void,
  isCancelled?: () => boolean
): Promise<DetectionResult> {
  const startedAt = performance.now();
  const semaphore = new Semaphore(CONCURRENCY);

  // ── Phase 1: Discover and hash concurrently ───────────────────────────────
  // Files are consumed one-by-one from the async iterable (stream or array).
  // A hash promise is fired immediately for each file, bounded by the semaphore,
  // so discovery and hashing run in parallel: the stream can yield the next
  // file path while a previous file's hash I/O is still in flight.
  const fileHashMap = new Map<string, string[]>();
  const allFiles: ImageRecord[] = [];
  const unionFind = new UnionFind();
  let discoveredCount = 0;
  let hashedCount = 0;

  const fileIterable: AsyncIterable<ImageRecord> = Array.isArray(files)
    ? (async function* () { for (const f of files) yield f; })()
    : files;

  const hashPromises: Promise<void>[] = [];

  for await (const file of fileIterable) {
    if (isCancelled?.()) break;
    discoveredCount++;
    allFiles.push(file);
    unionFind.add(file.path);
    onDiscoverProgress?.(discoveredCount);

    const p = (async () => {
      await semaphore.acquire();
      try {
        if (isCancelled?.()) return;
        const hashes = await hashProvider.getHashes(file.path);
        fileHashMap.set(file.path, hashes);
        hashedCount++;
        onHashProgress?.(hashedCount, discoveredCount);
      } finally {
        semaphore.release();
      }
    })();
    hashPromises.push(p);
  }

  await Promise.all(hashPromises);

  // ── Phase 2: BK-tree near-duplicate matching ──────────────────────────────
  // Sequential, but chunked: we yield to the event loop every YIELD_BATCH_SIZE
  // files so that IPC messages (progress, cancel) are never starved.
  const mihIndex = new MIHIndex();
  const firstHashByFile = new Map<string, string>();

  for (let i = 0; i < allFiles.length; i++) {
    if (i % YIELD_BATCH_SIZE === 0) {
      onMatchProgress?.(i, allFiles.length);
      await yieldToEventLoop();
    }

    if (isCancelled?.()) break;

    const file = allFiles[i]!;
    const hashes = fileHashMap.get(file.path) ?? [];
    firstHashByFile.set(file.path, hashes[0] ?? "unknown");

    // Find all near-duplicate file paths already indexed, then merge their roots.
    const matchedRoots = [...new Set(
      hashes
        .flatMap((hash) => mihIndex.query(hash, hammingThreshold))
        .map((match) => unionFind.find(match.filePath))
    )];

    let groupSeed = file.path;
    for (const matchedRoot of matchedRoots) {
      groupSeed = unionFind.union(groupSeed, matchedRoot);
    }

    // Index this file's hashes for future queries.
    for (const hash of hashes) {
      mihIndex.insert(hash, file.path);
    }
  }

  onMatchProgress?.(allFiles.length, allFiles.length);

  const groups = buildGroups(allFiles, firstHashByFile, unionFind);
  return {
    elapsedMs: Math.round(performance.now() - startedAt),
    groups,
    library: "imghash",
    mode: "fast",
    scannedFileCount: allFiles.length,
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
