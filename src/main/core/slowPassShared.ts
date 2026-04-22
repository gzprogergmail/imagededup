import sharp from "sharp";
import ssim from "ssim.js";

export const ROTATION_ANGLES = [0, -12, 12] as const;
export const CROP_FACTORS = [1, 0.85, 0.75] as const;
export const EARLY_EXIT_THRESHOLD = 0.97;
export const HASH_DIMENSION = 16;
export const MATCH_THRESHOLD = 0.72;
export const STAGING_SIZE = 192;
export const TARGET_WIDTH = 128;
export const TARGET_HEIGHT = 128;
export const HASH_TRANSFORMS = [
  { flipped: false, rotation: 0 },
  { flipped: false, rotation: -12 },
  { flipped: false, rotation: 12 },
  { flipped: true, rotation: 0 },
  { flipped: true, rotation: -12 },
  { flipped: true, rotation: 12 }
] as const;

const STRONG_HASH_DISTANCE_THRESHOLD = 56;
const SECONDARY_HASH_DISTANCE_THRESHOLD = 60;
const SECONDARY_CLOSE_MATCH_COUNT = 2;
const SECOND_STAGE_TRIGGER = 0.58;
const THIRD_STAGE_TRIGGER = 0.66;

export interface ImageVariant {
  cropFactor: number;
  data: Uint8ClampedArray;
  height: number;
  key: string;
  rotation: number;
  width: number;
}

export interface CandidateSignature {
  bits: Uint8Array;
  key: string;
}

export interface SimilarityScore {
  evidence: string;
  score: number;
}

export interface VariantComparisonResult {
  comparisons: number;
  score: SimilarityScore | null;
}

type VariantPair = [ImageVariant, ImageVariant];

export async function loadCandidateSignatures(filePath: string): Promise<CandidateSignature[]> {
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

export async function loadVariants(filePath: string): Promise<ImageVariant[]> {
  const variants = await Promise.all(
    ROTATION_ANGLES.flatMap(async (rotation) => {
      const normalized = await sharp(filePath)
        .rotate(rotation, { background: "#fbf7ef" })
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
          cropFactor,
          data: new Uint8ClampedArray(data),
          height: info.height,
          key: `${rotation}:${cropFactor}`,
          rotation,
          width: info.width
        } satisfies ImageVariant;
      }));
    })
  );

  return variants.flat();
}

export function isCandidatePair(left: CandidateSignature[], right: CandidateSignature[]): boolean {
  let bestDistance = Number.POSITIVE_INFINITY;
  let closeMatchCount = 0;

  for (const leftSignature of left) {
    for (const rightSignature of right) {
      const distance = hammingDistance(leftSignature.bits, rightSignature.bits);
      if (distance < bestDistance) {
        bestDistance = distance;
      }

      if (distance <= SECONDARY_HASH_DISTANCE_THRESHOLD) {
        closeMatchCount += 1;
      }

      if (
        bestDistance <= STRONG_HASH_DISTANCE_THRESHOLD
        || (bestDistance <= SECONDARY_HASH_DISTANCE_THRESHOLD && closeMatchCount >= SECONDARY_CLOSE_MATCH_COUNT)
      ) {
        return true;
      }
    }
  }

  return false;
}

export function compareVariantsTiered(left: ImageVariant[], right: ImageVariant[]): VariantComparisonResult {
  const sameCropPairs: VariantPair[] = [];
  const sameRotationCrossCropPairs: VariantPair[] = [];
  const remainingPairs: VariantPair[] = [];

  for (const leftVariant of left) {
    for (const rightVariant of right) {
      if (leftVariant.cropFactor === rightVariant.cropFactor) {
        sameCropPairs.push([leftVariant, rightVariant]);
        continue;
      }

      if (leftVariant.rotation === rightVariant.rotation) {
        sameRotationCrossCropPairs.push([leftVariant, rightVariant]);
        continue;
      }

      remainingPairs.push([leftVariant, rightVariant]);
    }
  }

  let bestScore = 0;
  let bestKey = "";
  let comparisons = 0;

  const tierOne = comparePairSet(sameCropPairs, bestScore, bestKey, comparisons);
  bestScore = tierOne.bestScore;
  bestKey = tierOne.bestKey;
  comparisons = tierOne.comparisons;
  if (tierOne.earlyExit || bestScore < SECOND_STAGE_TRIGGER) {
    return finalizeComparison(bestScore, bestKey, comparisons);
  }

  const tierTwo = comparePairSet(sameRotationCrossCropPairs, bestScore, bestKey, comparisons);
  bestScore = tierTwo.bestScore;
  bestKey = tierTwo.bestKey;
  comparisons = tierTwo.comparisons;
  if (tierTwo.earlyExit || bestScore < THIRD_STAGE_TRIGGER) {
    return finalizeComparison(bestScore, bestKey, comparisons);
  }

  const tierThree = comparePairSet(remainingPairs, bestScore, bestKey, comparisons);
  return finalizeComparison(tierThree.bestScore, tierThree.bestKey, tierThree.comparisons);
}

export function pairKeyFor(left: string, right: string): string {
  return left < right ? `${left}\n${right}` : `${right}\n${left}`;
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

function comparePairSet(
  pairs: VariantPair[],
  initialScore: number,
  initialKey: string,
  initialComparisons: number
): { bestScore: number; bestKey: string; comparisons: number; earlyExit: boolean } {
  let bestScore = initialScore;
  let bestKey = initialKey;
  let comparisons = initialComparisons;

  for (const [leftVariant, rightVariant] of pairs) {
    comparisons += 1;
    const { mssim } = ssim(leftVariant, rightVariant);
    if (mssim > bestScore) {
      bestScore = mssim;
      bestKey = `${leftVariant.key} x ${rightVariant.key}`;
    }

    if (bestScore > EARLY_EXIT_THRESHOLD) {
      return {
        bestScore,
        bestKey,
        comparisons,
        earlyExit: true
      };
    }
  }

  return {
    bestScore,
    bestKey,
    comparisons,
    earlyExit: false
  };
}

function finalizeComparison(bestScore: number, bestKey: string, comparisons: number): VariantComparisonResult {
  if (bestScore === 0) {
    return {
      comparisons,
      score: null
    };
  }

  return {
    comparisons,
    score: {
      evidence: `best SSIM ${bestScore.toFixed(4)} at ${bestKey}`,
      score: Number(bestScore.toFixed(4))
    }
  };
}
