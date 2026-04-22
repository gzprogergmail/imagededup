import sharp from "sharp";
import ssim from "ssim.js";

import { UnionFind } from "../../shared/unionFind";
import type { DetectionResult, DuplicateGroup, ImageRecord } from "../../shared/types";

const ROTATION_ANGLES = [0, -12, 12] as const;
const CROP_FACTORS = [1, 0.85, 0.75] as const;
const EARLY_EXIT_THRESHOLD = 0.97;
const HASH_DIMENSION = 16;
const HASH_DISTANCE_THRESHOLD = 64;
const MATCH_THRESHOLD = 0.72;
const STAGING_SIZE = 192;
const TARGET_WIDTH = 128;
const TARGET_HEIGHT = 128;
const HASH_TRANSFORMS = [
  { flipped: false, rotation: 0 },
  { flipped: false, rotation: -12 },
  { flipped: false, rotation: 12 },
  { flipped: true, rotation: 0 },
  { flipped: true, rotation: -12 },
  { flipped: true, rotation: 12 }
] as const;

interface ImageVariant {
  data: Uint8ClampedArray;
  height: number;
  key: string;
  width: number;
}

interface CandidateSignature {
  bits: Uint8Array;
  key: string;
}

interface SimilarityScore {
  evidence: string;
  score: number;
}

export interface SlowPassCallbacks {
  isCancelled?: () => boolean;
  onComparison?: (completed: number) => void;
  onComparisonStart?: (totalComparisons: number) => void;
  onSignature?: (filePath: string) => void;
}

export async function runSlowPass(
  files: ImageRecord[],
  callbacks: SlowPassCallbacks = {}
): Promise<DetectionResult> {
  const startedAt = performance.now();
  const signatures = await Promise.all(files.map(async (file) => {
    const nextSignatures = await loadCandidateSignatures(file.path);
    callbacks.onSignature?.(file.path);
    return {
      file,
      signatures: nextSignatures
    };
  }));

  const unionFind = new UnionFind();
  const evidence = new Map<string, SimilarityScore>();
  const variantCache = new Map<string, Promise<ImageVariant[]>>();
  const totalComparisons = (files.length * (files.length - 1)) / 2;
  let comparisonsDone = 0;

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
        continue;
      }

      comparisonsDone += 1;
      callbacks.onComparison?.(comparisonsDone);

      if (!isCandidatePair(left.signatures, right.signatures)) {
        continue;
      }

      const [leftVariants, rightVariants] = await Promise.all([
        getVariants(left.file.path, variantCache),
        getVariants(right.file.path, variantCache)
      ]);
      const score = compareVariants(leftVariants, rightVariants);
      if (!score || score.score < MATCH_THRESHOLD) {
        continue;
      }

      const groupRoot = unionFind.union(left.file.path, right.file.path);
      const previous = evidence.get(groupRoot);
      if (!previous || score.score > previous.score) {
        evidence.set(groupRoot, score);
      }
    }
  }

  return {
    elapsedMs: Math.round(performance.now() - startedAt),
    groups: buildSlowGroups(files, unionFind, evidence),
    library: "ssim.js",
    mode: "slow",
    scannedFileCount: files.length,
    warnings: []
  };
}

async function getVariants(
  filePath: string,
  cache: Map<string, Promise<ImageVariant[]>>
): Promise<ImageVariant[]> {
  const cached = cache.get(filePath);
  if (cached) {
    return cached;
  }

  const next = loadVariants(filePath);
  cache.set(filePath, next);
  return next;
}

async function loadCandidateSignatures(filePath: string): Promise<CandidateSignature[]> {
  return Promise.all(HASH_TRANSFORMS.map(async ({ flipped, rotation }) => {
    const pipeline = sharp(filePath)
      .rotate(rotation, { background: "#fbf7ef" })
      .normalise()
      .resize(HASH_DIMENSION, HASH_DIMENSION, { background: "#fbf7ef", fit: "contain" })
      .grayscale();

    const transformed = flipped ? pipeline.flop() : pipeline;
    const data = await transformed.raw().toBuffer();
    const average = data.reduce((sum, value) => sum + value, 0) / data.length;

    return {
      bits: Uint8Array.from(data, (value) => (value >= average ? 1 : 0)),
      key: `${rotation}:${flipped ? "flipped" : "plain"}`
    };
  }));
}

async function loadVariants(filePath: string): Promise<ImageVariant[]> {
  const variants = await Promise.all(
    ROTATION_ANGLES.flatMap(async (angle) => {
      const normalized = await sharp(filePath)
        .rotate(angle, { background: "#fbf7ef" })
        .normalise()
        .resize(STAGING_SIZE, STAGING_SIZE, { background: "#fbf7ef", fit: "contain" })
        .png()
        .toBuffer();

      return Promise.all(CROP_FACTORS.map(async (cropFactor) => {
        const cropSize = Math.max(Math.round(STAGING_SIZE * cropFactor), TARGET_WIDTH);
        const offset = Math.max(Math.round((STAGING_SIZE - cropSize) / 2), 0);
        const { data, info } = await sharp(normalized)
          .extract({
            height: cropSize,
            left: offset,
            top: offset,
            width: cropSize
          })
          .resize(TARGET_WIDTH, TARGET_HEIGHT, { background: "#fbf7ef", fit: "fill" })
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });

        return {
          data: new Uint8ClampedArray(data),
          height: info.height,
          key: `${angle}:${cropFactor}`,
          width: info.width
        } satisfies ImageVariant;
      }));
    })
  );

  return variants.flat();
}

function isCandidatePair(left: CandidateSignature[], right: CandidateSignature[]): boolean {
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const leftSignature of left) {
    for (const rightSignature of right) {
      const distance = hammingDistance(leftSignature.bits, rightSignature.bits);
      if (distance < bestDistance) {
        bestDistance = distance;
      }

      if (bestDistance <= HASH_DISTANCE_THRESHOLD) {
        return true;
      }
    }
  }

  return false;
}

function hammingDistance(left: Uint8Array, right: Uint8Array): number {
  let distance = 0;

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      distance += 1;
    }
  }

  return distance;
}

function compareVariants(left: ImageVariant[], right: ImageVariant[]): SimilarityScore | null {
  let bestScore = 0;
  let bestKey = "";

  for (const leftVariant of left) {
    for (const rightVariant of right) {
      const { mssim } = ssim(leftVariant, rightVariant);
      if (mssim > bestScore) {
        bestScore = mssim;
        bestKey = `${leftVariant.key} x ${rightVariant.key}`;
      }

      if (bestScore > EARLY_EXIT_THRESHOLD) {
        return {
          evidence: `best SSIM ${bestScore.toFixed(4)} at ${bestKey}`,
          score: Number(bestScore.toFixed(4))
        };
      }
    }
  }

  if (bestScore === 0) {
    return null;
  }

  return {
    evidence: `best SSIM ${bestScore.toFixed(4)} at ${bestKey}`,
    score: Number(bestScore.toFixed(4))
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
