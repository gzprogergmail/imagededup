import { existsSync } from "node:fs";
import { cpus } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";

import { UnionFind } from "../../shared/unionFind";
import type { DetectionResult, DuplicateGroup, ImageRecord, ScanDiagnostics } from "../../shared/types";
import {
  compareVariantsTiered,
  isCandidatePair,
  loadCandidateSignatures,
  loadVariants,
  MATCH_THRESHOLD,
  pairKeyFor,
  type ImageVariant,
  type SimilarityScore
} from "./slowPassShared";

const LOCAL_BATCH_SIZE = 4;
const MIN_PARALLEL_CANDIDATES = 12;
const PAIRS_PER_WORKER_TASK = 4;
const WORKER_COUNT = Math.max(1, Math.min(2, cpus().length - 1));

interface SlowPassMetrics {
  counters: ScanDiagnostics["counters"];
  phasesMs: ScanDiagnostics["phasesMs"];
}

interface CandidatePair {
  leftPath: string;
  rightPath: string;
}

interface PairOutcome {
  comparisons: number;
  leftPath: string;
  rightPath: string;
  score: SimilarityScore | null;
}

interface ComparisonBatchResult {
  metrics: {
    similarityCompare: number;
    variantCacheHits: number;
    variantCacheMisses: number;
    variantComparisons: number;
    variantLoad: number;
  };
  outcomes: PairOutcome[];
}

export interface SlowPassCallbacks {
  isCancelled?: () => boolean;
  onComparison?: (completed: number) => void;
  onComparisonStart?: (totalComparisons: number) => void;
  onSignature?: (filePath: string) => void;
}

export interface SlowPassOptions {
  skipPairs?: ReadonlySet<string>;
}

export async function runSlowPass(
  files: ImageRecord[],
  callbacks: SlowPassCallbacks = {},
  options: SlowPassOptions = {}
): Promise<DetectionResult> {
  const startedAt = performance.now();
  const metrics = createSlowPassMetrics();
  const signatureBuildStartedAt = performance.now();
  const signatures = await Promise.all(files.map(async (file) => {
    const nextSignatures = await loadCandidateSignatures(file.path);
    callbacks.onSignature?.(file.path);
    return {
      file,
      signatures: nextSignatures
    };
  }));
  metrics.phasesMs.signatureBuild += performance.now() - signatureBuildStartedAt;

  const unionFind = new UnionFind();
  const evidence = new Map<string, SimilarityScore>();
  const totalComparisons = (files.length * (files.length - 1)) / 2;
  const candidatePairs: CandidatePair[] = [];
  let comparisonsDone = 0;

  metrics.counters.totalPairs = totalComparisons;
  callbacks.onComparisonStart?.(totalComparisons);

  for (const file of files) {
    unionFind.add(file.path);
  }

  for (let leftIndex = 0; leftIndex < signatures.length; leftIndex += 1) {
    if (callbacks.isCancelled?.()) {
      break;
    }

    for (let rightIndex = leftIndex + 1; rightIndex < signatures.length; rightIndex += 1) {
      if (callbacks.isCancelled?.()) {
        break;
      }

      const left = signatures[leftIndex];
      const right = signatures[rightIndex];
      if (!left || !right) {
        comparisonsDone += 1;
        callbacks.onComparison?.(comparisonsDone);
        continue;
      }

      if (options.skipPairs?.has(pairKeyFor(left.file.path, right.file.path))) {
        metrics.counters.skippedFastPassPairs += 1;
        comparisonsDone += 1;
        callbacks.onComparison?.(comparisonsDone);
        continue;
      }

      const candidateFilterStartedAt = performance.now();
      const candidatePair = isCandidatePair(left.signatures, right.signatures);
      metrics.phasesMs.candidateFilter += performance.now() - candidateFilterStartedAt;

      if (!candidatePair) {
        metrics.counters.rejectedBySignature += 1;
        comparisonsDone += 1;
        callbacks.onComparison?.(comparisonsDone);
        continue;
      }

      metrics.counters.candidatePairs += 1;
      candidatePairs.push({
        leftPath: left.file.path,
        rightPath: right.file.path
      });
    }
  }

  const comparisonRunner = await createComparisonRunner(candidatePairs.length);
  try {
    const waveSize = comparisonRunner.parallelTaskCount * PAIRS_PER_WORKER_TASK;
    const variantCache = new Map<string, Promise<ImageVariant[]>>();

    for (let waveStart = 0; waveStart < candidatePairs.length; waveStart += waveSize) {
      if (callbacks.isCancelled?.()) {
        break;
      }

      const currentWave = candidatePairs.slice(waveStart, waveStart + waveSize);
      const pendingPairs: CandidatePair[] = [];

      for (const pair of currentWave) {
        if (unionFind.find(pair.leftPath) === unionFind.find(pair.rightPath)) {
          metrics.counters.skippedMergedPairs += 1;
          comparisonsDone += 1;
          callbacks.onComparison?.(comparisonsDone);
          continue;
        }

        pendingPairs.push(pair);
      }

      if (pendingPairs.length === 0) {
        continue;
      }

      const chunks = chunkPairs(
        pendingPairs,
        comparisonRunner.parallelTaskCount > 1 ? PAIRS_PER_WORKER_TASK : LOCAL_BATCH_SIZE
      );
      const results = await Promise.all(chunks.map((chunk) => comparisonRunner.compare(chunk, variantCache)));

      for (const result of results) {
        applyComparisonMetrics(metrics, result.metrics);

        for (const outcome of result.outcomes) {
          comparisonsDone += 1;
          callbacks.onComparison?.(comparisonsDone);

          if (!outcome.score || outcome.score.score < MATCH_THRESHOLD) {
            continue;
          }

          metrics.counters.matchedPairs += 1;
          const groupRoot = unionFind.union(outcome.leftPath, outcome.rightPath);
          const previous = evidence.get(groupRoot);
          if (!previous || outcome.score.score > previous.score) {
            evidence.set(groupRoot, outcome.score);
          }
        }
      }
    }
  } finally {
    await comparisonRunner.close();
  }

  const groupBuildStartedAt = performance.now();
  const groups = buildSlowGroups(files, unionFind, evidence);
  metrics.phasesMs.groupBuild += performance.now() - groupBuildStartedAt;

  return {
    diagnostics: roundSlowPassMetrics(metrics),
    elapsedMs: Math.round(performance.now() - startedAt),
    groups,
    library: "ssim.js",
    mode: "slow",
    scannedFileCount: files.length,
    warnings: []
  };
}

function buildSlowGroups(
  files: ImageRecord[],
  unionFind: UnionFind,
  evidenceByGroup: Map<string, SimilarityScore>
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
    .map(([root, items]) => ({
      evidence: evidenceByGroup.get(root)?.evidence ?? "feature similarity",
      files: items,
      id: root,
      kind: "slow" as const,
      representative: items[0]!,
      score: evidenceByGroup.get(root)?.score
    }))
    .sort((left, right) => (right.score ?? 0) - (left.score ?? 0));
}

interface ComparisonRunner {
  close: () => Promise<void>;
  compare: (pairs: CandidatePair[], variantCache: Map<string, Promise<ImageVariant[]>>) => Promise<ComparisonBatchResult>;
  parallelTaskCount: number;
}

async function createComparisonRunner(candidatePairCount: number): Promise<ComparisonRunner> {
  const workerScriptPath = join(__dirname, "slowPassWorker.js");
  const shouldUseWorkers = candidatePairCount >= MIN_PARALLEL_CANDIDATES
    && WORKER_COUNT > 1
    && existsSync(workerScriptPath);

  if (!shouldUseWorkers) {
    return {
      close: async () => undefined,
      compare: async (pairs, variantCache) => compareLocally(pairs, variantCache),
      parallelTaskCount: 1
    };
  }

  /* c8 ignore start */
  const pool = new SlowPassWorkerPool(workerScriptPath, WORKER_COUNT);
  return {
    close: async () => pool.close(),
    compare: async (pairs) => pool.compare(pairs),
    parallelTaskCount: WORKER_COUNT
  };
  /* c8 ignore stop */
}

async function compareLocally(
  pairs: CandidatePair[],
  variantCache: Map<string, Promise<ImageVariant[]>>
): Promise<ComparisonBatchResult> {
  const metrics = {
    similarityCompare: 0,
    variantCacheHits: 0,
    variantCacheMisses: 0,
    variantComparisons: 0,
    variantLoad: 0
  };
  const outcomes: PairOutcome[] = [];

  for (const pair of pairs) {
    const variantLoadStartedAt = performance.now();
    const [leftVariants, rightVariants] = await Promise.all([
      getVariants(pair.leftPath, variantCache, metrics),
      getVariants(pair.rightPath, variantCache, metrics)
    ]);
    metrics.variantLoad += performance.now() - variantLoadStartedAt;

    const similarityStartedAt = performance.now();
    const comparison = compareVariantsTiered(leftVariants, rightVariants);
    metrics.similarityCompare += performance.now() - similarityStartedAt;
    metrics.variantComparisons += comparison.comparisons;

    outcomes.push({
      comparisons: comparison.comparisons,
      leftPath: pair.leftPath,
      rightPath: pair.rightPath,
      score: comparison.score
    });
  }

  return {
    metrics: {
      similarityCompare: Math.round(metrics.similarityCompare),
      variantCacheHits: metrics.variantCacheHits,
      variantCacheMisses: metrics.variantCacheMisses,
      variantComparisons: metrics.variantComparisons,
      variantLoad: Math.round(metrics.variantLoad)
    },
    outcomes
  };
}

async function getVariants(
  filePath: string,
  cache: Map<string, Promise<ImageVariant[]>>,
  metrics: {
    similarityCompare: number;
    variantCacheHits: number;
    variantCacheMisses: number;
    variantComparisons: number;
    variantLoad: number;
  }
): Promise<ImageVariant[]> {
  const cached = cache.get(filePath);
  if (cached) {
    metrics.variantCacheHits += 1;
    return cached;
  }

  metrics.variantCacheMisses += 1;
  const next = loadVariants(filePath);
  cache.set(filePath, next);
  return next;
}

/* c8 ignore start */
class SlowPassWorkerPool {
  private readonly workers: Array<{
    pending: Map<number, {
      reject: (error: unknown) => void;
      resolve: (value: ComparisonBatchResult) => void;
    }>;
    worker: Worker;
  }>;
  private nextTaskId = 1;
  private nextWorkerIndex = 0;

  constructor(workerScriptPath: string, workerCount: number) {
    this.workers = Array.from({ length: workerCount }, () => {
      const worker = new Worker(workerScriptPath);
      const record = {
        pending: new Map<number, {
          reject: (error: unknown) => void;
          resolve: (value: ComparisonBatchResult) => void;
        }>(),
        worker
      };

      worker.on("message", (message: ComparisonBatchResult & { taskId: number }) => {
        const pending = record.pending.get(message.taskId);
        if (!pending) {
          return;
        }

        record.pending.delete(message.taskId);
        pending.resolve({
          metrics: message.metrics,
          outcomes: message.outcomes
        });
      });

      worker.on("error", (error) => {
        for (const pending of record.pending.values()) {
          pending.reject(error);
        }
        record.pending.clear();
      });

      worker.on("exit", (code) => {
        if (code === 0) {
          return;
        }

        const error = new Error(`slowPassWorker exited with code ${code}`);
        for (const pending of record.pending.values()) {
          pending.reject(error);
        }
        record.pending.clear();
      });

      return record;
    });
  }

  compare(pairs: CandidatePair[]): Promise<ComparisonBatchResult> {
    const taskId = this.nextTaskId;
    this.nextTaskId += 1;

    const workerRecord = this.workers[this.nextWorkerIndex]!;
    this.nextWorkerIndex = (this.nextWorkerIndex + 1) % this.workers.length;

    return new Promise<ComparisonBatchResult>((resolve, reject) => {
      workerRecord.pending.set(taskId, { reject, resolve });
      workerRecord.worker.postMessage({
        pairs,
        taskId
      });
    });
  }

  async close(): Promise<void> {
    await Promise.all(this.workers.map(async (record) => {
      for (const pending of record.pending.values()) {
        pending.reject(new Error("slowPassWorkerPool closed before the task completed"));
      }
      record.pending.clear();
      await record.worker.terminate();
    }));
  }
}
/* c8 ignore stop */

function chunkPairs(pairs: CandidatePair[], size: number): CandidatePair[][] {
  const chunks: CandidatePair[][] = [];

  for (let index = 0; index < pairs.length; index += size) {
    chunks.push(pairs.slice(index, index + size));
  }

  return chunks;
}

function applyComparisonMetrics(
  metrics: SlowPassMetrics,
  comparisonMetrics: ComparisonBatchResult["metrics"]
): void {
  metrics.counters.variantCacheHits += comparisonMetrics.variantCacheHits;
  metrics.counters.variantCacheMisses += comparisonMetrics.variantCacheMisses;
  metrics.counters.variantComparisons += comparisonMetrics.variantComparisons;
  metrics.phasesMs.similarityCompare += comparisonMetrics.similarityCompare;
  metrics.phasesMs.variantLoad += comparisonMetrics.variantLoad;
}

function createSlowPassMetrics(): SlowPassMetrics {
  return {
    counters: {
      candidatePairs: 0,
      matchedPairs: 0,
      rejectedBySignature: 0,
      skippedFastPassPairs: 0,
      skippedMergedPairs: 0,
      totalPairs: 0,
      variantCacheHits: 0,
      variantCacheMisses: 0,
      variantComparisons: 0
    },
    phasesMs: {
      candidateFilter: 0,
      groupBuild: 0,
      signatureBuild: 0,
      similarityCompare: 0,
      variantLoad: 0
    }
  };
}

function roundSlowPassMetrics(metrics: SlowPassMetrics): ScanDiagnostics {
  return {
    counters: { ...metrics.counters },
    phasesMs: Object.fromEntries(
      Object.entries(metrics.phasesMs).map(([key, value]) => [key, Math.round(value)])
    ) as ScanDiagnostics["phasesMs"]
  };
}

export { pairKeyFor };
