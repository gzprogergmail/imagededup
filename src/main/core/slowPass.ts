import sharp from "sharp";
import ssim from "ssim.js";

import { UnionFind } from "../../shared/unionFind";
import type { DetectionResult, DuplicateGroup, ImageRecord } from "../../shared/types";

const ROTATION_ANGLES = [-12, 0, 12] as const;
const CROP_FACTORS = [1, 0.85, 0.75] as const;
const MATCH_THRESHOLD = 0.72;
const STAGING_SIZE = 192;
const TARGET_WIDTH = 128;
const TARGET_HEIGHT = 128;

interface ImageVariant {
  data: Uint8ClampedArray;
  height: number;
  key: string;
  width: number;
}

interface SimilarityScore {
  evidence: string;
  score: number;
}

export async function runSlowPass(files: ImageRecord[]): Promise<DetectionResult> {
  const startedAt = performance.now();
  const variants = await Promise.all(files.map(async (file) => ({
    file,
    variants: await loadVariants(file.path)
  })));
  const unionFind = new UnionFind();
  const evidence = new Map<string, SimilarityScore>();

  for (const file of files) {
    unionFind.add(file.path);
  }

  for (let leftIndex = 0; leftIndex < variants.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < variants.length; rightIndex += 1) {
      const left = variants[leftIndex];
      const right = variants[rightIndex];
      if (!left || !right) {
        continue;
      }

      const score = compareVariants(left.variants, right.variants);
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

      if (bestScore > 0.97) {
        break;
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
