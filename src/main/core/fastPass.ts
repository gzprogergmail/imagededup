import imghash from "imghash";
import sharp from "sharp";

import { UnionFind } from "../../shared/unionFind";
import type { DetectionResult, DuplicateGroup, ImageRecord } from "../../shared/types";

const ROTATIONS = [0, 90, 180, 270] as const;

export interface HashProvider {
  getHashes(filePath: string): Promise<string[]>;
}

export class ImghashProvider implements HashProvider {
  async getHashes(filePath: string): Promise<string[]> {
    const hashes = await Promise.all(
      ROTATIONS.map(async (rotation) => {
        const buffer = await sharp(filePath).rotate(rotation).png().toBuffer();
        return imghash.hash(buffer, 8, "hex");
      })
    );

    return [...new Set(hashes)];
  }
}

export async function runFastPass(
  files: ImageRecord[],
  hashProvider: HashProvider = new ImghashProvider()
): Promise<DetectionResult> {
  const startedAt = performance.now();
  const hashIndex = new Map<string, string>();
  const fileHashes = new Map<string, string[]>();
  const unionFind = new UnionFind();

  for (const file of files) {
    unionFind.add(file.path);
    const hashes = await hashProvider.getHashes(file.path);
    fileHashes.set(file.path, hashes);

    const matchedRoots = [...new Set(hashes
      .map((hash) => hashIndex.get(hash))
      .filter((value): value is string => Boolean(value))
      .map((value) => unionFind.find(value)))];

    let groupSeed = file.path;
    for (const matchedRoot of matchedRoots) {
      groupSeed = unionFind.union(groupSeed, matchedRoot);
    }

    for (const hash of hashes) {
      hashIndex.set(hash, groupSeed);
    }
  }

  const groups = buildGroups(files, fileHashes, unionFind, "fast");
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
  fileHashes: Map<string, string[]>,
  unionFind: UnionFind,
  kind: "fast"
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
      const evidence = fileHashes.get(representative)?.[0] ?? "unknown";
      return {
        evidence,
        files: items,
        id: root,
        kind,
        representative
      } satisfies DuplicateGroup;
    })
    .sort((left, right) => right.files.length - left.files.length);
}
