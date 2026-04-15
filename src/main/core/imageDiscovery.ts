import fg from "fast-glob";
import { basename, resolve } from "node:path";

import type { ImageRecord } from "../../shared/types";

const IMAGE_PATTERNS = [
  "**/*.png",
  "**/*.jpg",
  "**/*.jpeg",
  "**/*.bmp",
  "**/*.gif",
  "**/*.webp",
  "**/*.tiff"
];

export async function discoverImages(folder: string): Promise<ImageRecord[]> {
  const root = resolve(folder);
  const matches = await fg(IMAGE_PATTERNS, {
    absolute: true,
    caseSensitiveMatch: false,
    cwd: root,
    onlyFiles: true,
    unique: true
  });

  return matches
    .map((filePath) => resolve(filePath))
    .sort((left, right) => left.localeCompare(right))
    .map((filePath) => ({
      basename: basename(filePath),
      path: filePath
    }));
}
