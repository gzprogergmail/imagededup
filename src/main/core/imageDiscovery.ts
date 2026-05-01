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

/**
 * Async generator that yields ImageRecord entries one-by-one as fast-glob
 * discovers them. Allows callers to begin processing files immediately
 * instead of waiting for the full directory walk to complete — especially
 * useful for large or network-mounted folders.
 */
export async function* streamImages(folder: string): AsyncGenerator<ImageRecord> {
  const stream = fg.stream(IMAGE_PATTERNS, {
    absolute: true,
    caseSensitiveMatch: false,
    cwd: folder,
    onlyFiles: true,
    unique: true
  });
  for await (const entry of stream) {
    const filePath = resolve(entry as string);
    yield { path: filePath, basename: basename(filePath) };
  }
}
