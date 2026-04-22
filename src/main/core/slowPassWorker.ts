import { parentPort } from "node:worker_threads";

import { compareVariantsTiered, loadVariants } from "./slowPassShared";

interface PairTask {
  leftPath: string;
  rightPath: string;
}

interface WorkerRequest {
  pairs: PairTask[];
  taskId: number;
}

interface WorkerResponse {
  metrics: {
    similarityCompare: number;
    variantCacheHits: number;
    variantCacheMisses: number;
    variantComparisons: number;
    variantLoad: number;
  };
  outcomes: Array<{
    comparisons: number;
    leftPath: string;
    rightPath: string;
    score: ReturnType<typeof compareVariantsTiered>["score"];
  }>;
  taskId: number;
}

const variantCache = new Map<string, Promise<Awaited<ReturnType<typeof loadVariants>>>>();

if (!parentPort) {
  throw new Error("slowPassWorker requires a parentPort");
}

parentPort.on("message", async (request: WorkerRequest) => {
  const metrics = {
    similarityCompare: 0,
    variantCacheHits: 0,
    variantCacheMisses: 0,
    variantComparisons: 0,
    variantLoad: 0
  };

  const outcomes = [];

  for (const pair of request.pairs) {
    const variantLoadStartedAt = performance.now();
    const [leftVariants, rightVariants] = await Promise.all([
      getVariants(pair.leftPath, metrics),
      getVariants(pair.rightPath, metrics)
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

  const response: WorkerResponse = {
    metrics: {
      similarityCompare: Math.round(metrics.similarityCompare),
      variantCacheHits: metrics.variantCacheHits,
      variantCacheMisses: metrics.variantCacheMisses,
      variantComparisons: metrics.variantComparisons,
      variantLoad: Math.round(metrics.variantLoad)
    },
    outcomes,
    taskId: request.taskId
  };
  parentPort?.postMessage(response);
});

async function getVariants(
  filePath: string,
  metrics: {
    similarityCompare: number;
    variantCacheHits: number;
    variantCacheMisses: number;
    variantComparisons: number;
    variantLoad: number;
  }
) {
  const cached = variantCache.get(filePath);
  if (cached) {
    metrics.variantCacheHits += 1;
    return cached;
  }

  metrics.variantCacheMisses += 1;
  const next = loadVariants(filePath);
  variantCache.set(filePath, next);
  return next;
}
