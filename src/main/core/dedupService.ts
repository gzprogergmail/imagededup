import { stat } from "node:fs/promises";
import { resolve } from "node:path";

import { discoverImages } from "./imageDiscovery";
import { runFastPass } from "./fastPass";
import { runSlowPass } from "./slowPass";

export async function scanFast(folder: string) {
  const files = await listImages(folder);
  return runFastPass(files);
}

export async function scanSlow(folder: string) {
  const files = await listImages(folder);
  return runSlowPass(files);
}

async function listImages(folder: string) {
  const absoluteFolder = resolve(folder);
  const folderStat = await stat(absoluteFolder);
  if (!folderStat.isDirectory()) {
    throw new Error(`Folder does not exist: ${absoluteFolder}`);
  }

  return discoverImages(absoluteFolder);
}
