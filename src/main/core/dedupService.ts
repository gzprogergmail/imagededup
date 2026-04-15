import { stat } from "node:fs/promises";
import { resolve } from "node:path";

import { logEvent } from "../logger";
import { discoverImages } from "./imageDiscovery";
import { runFastPass } from "./fastPass";
import { runSlowPass } from "./slowPass";

export async function scanFast(folder: string) {
  await logEvent("scan", "fast.requested", { folder });
  const files = await listImages(folder);
  await logEvent("scan", "fast.files_discovered", {
    fileCount: files.length,
    folder
  });
  const result = await runFastPass(files);
  await logEvent("scan", "fast.completed", {
    elapsedMs: result.elapsedMs,
    fileCount: files.length,
    groupCount: result.groups.length,
    warnings: result.warnings
  });
  return result;
}

export async function scanSlow(folder: string) {
  await logEvent("scan", "slow.requested", { folder });
  const files = await listImages(folder);
  await logEvent("scan", "slow.files_discovered", {
    fileCount: files.length,
    folder
  });
  const result = await runSlowPass(files);
  await logEvent("scan", "slow.completed", {
    elapsedMs: result.elapsedMs,
    fileCount: files.length,
    groupCount: result.groups.length,
    warnings: result.warnings
  });
  return result;
}

async function listImages(folder: string) {
  const absoluteFolder = resolve(folder);
  await logEvent("scan", "folder.validating", { absoluteFolder });
  const folderStat = await stat(absoluteFolder);
  if (!folderStat.isDirectory()) {
    await logEvent("scan", "folder.invalid", { absoluteFolder }, "error");
    throw new Error(`Folder does not exist: ${absoluteFolder}`);
  }

  const images = await discoverImages(absoluteFolder);
  await logEvent("scan", "folder.validated", {
    absoluteFolder,
    imageCount: images.length
  });
  return images;
}
