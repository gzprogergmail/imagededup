/**
 * Downloads ~100 large (≥10 MB) image files from Picsum Photos plus a
 * smaller JPEG companion of each.
 *
 * Strategy
 * --------
 *  Large  : Picsum 5000×5000 JPEG → converted to lossless PNG via sharp.
 *           A 5 000×5 000 RGB PNG is typically 15–50 MB (guaranteed >10 MB).
 *  Small  : Picsum 1920×1280 JPEG saved directly.
 *
 * Output layout
 * -------------
 *  sample-images/large-files/large/large_seed<N>_5000x5000.png
 *  sample-images/large-files/small/small_seed<N>_1920x1280.jpg
 */

import { mkdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import https from "node:https";
import sharp from "sharp";

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_DIR   = resolve(fileURLToPath(import.meta.url), "../../sample-images/large-files");
const TARGET     = 100;
const MIN_BYTES  = 10 * 1024 * 1024;   // 10 MB
const LARGE_W    = 5000;
const LARGE_H    = 5000;
const SMALL_W    = 1920;
const SMALL_H    = 1280;
const MAX_SEED   = 400;
const CONCURRENCY = 4;

const LARGE_DIR  = join(BASE_DIR, "large");
const SMALL_DIR  = join(BASE_DIR, "small");

// ── Helpers ───────────────────────────────────────────────────────────────────

async function ensureDirs() {
  await mkdir(LARGE_DIR, { recursive: true });
  await mkdir(SMALL_DIR, { recursive: true });
}

function downloadToBuffer(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 60_000 }, (res) => {
      if (res.statusCode && res.statusCode >= 400) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      // Follow a single redirect
      if (res.statusCode === 301 || res.statusCode === 302) {
        const loc = res.headers.location;
        res.resume();
        if (!loc) return reject(new Error("Redirect with no location"));
        return downloadToBuffer(loc).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end",  () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Timeout")); });
  });
}

async function fileSize(path) {
  try { return (await stat(path)).size; }
  catch { return 0; }
}

// ── Per-seed work ─────────────────────────────────────────────────────────────

async function processSeed(seed) {
  const largeName = `large_seed${seed}_${LARGE_W}x${LARGE_H}.png`;
  const smallName = `small_seed${seed}_${SMALL_W}x${SMALL_H}.jpg`;
  const largeDest = join(LARGE_DIR, largeName);
  const smallDest = join(SMALL_DIR, smallName);

  // ── Large (PNG) ──────────────────────────────────────────────────────────
  let existingSize = await fileSize(largeDest);
  if (existingSize >= MIN_BYTES) {
    return { status: "skip", seed, size: existingSize };
  }

  const srcUrl = `https://picsum.photos/seed/${seed}/${LARGE_W}/${LARGE_H}`;
  let jpegBuf;
  try {
    jpegBuf = await downloadToBuffer(srcUrl);
  } catch (err) {
    return { status: "fail-large", seed, err: err.message };
  }

  // Convert JPEG → lossless PNG (guaranteed large due to pixel count)
  let pngBuf;
  try {
    pngBuf = await sharp(jpegBuf).png({ compressionLevel: 1 }).toBuffer();
  } catch (err) {
    return { status: "fail-convert", seed, err: err.message };
  }

  if (pngBuf.length < MIN_BYTES) {
    // Extremely rare, but guard anyway
    return { status: "skip-small", seed, size: pngBuf.length };
  }

  try {
    await (await import("node:fs/promises")).writeFile(largeDest, pngBuf);
  } catch (err) {
    return { status: "fail-write", seed, err: err.message };
  }

  // ── Small (JPEG) ─────────────────────────────────────────────────────────
  if ((await fileSize(smallDest)) === 0) {
    const smUrl = `https://picsum.photos/seed/${seed}/${SMALL_W}/${SMALL_H}`;
    try {
      const smBuf = await downloadToBuffer(smUrl);
      await (await import("node:fs/promises")).writeFile(smallDest, smBuf);
    } catch (err) {
      // Large was saved — report partial success
      return { status: "fail-small", seed, size: pngBuf.length, err: err.message };
    }
  }

  return { status: "ok", seed, size: pngBuf.length };
}

// ── Main with bounded concurrency ─────────────────────────────────────────────

async function main() {
  await ensureDirs();

  console.log(`Target   : ${TARGET} pairs (large ≥ ${MIN_BYTES / 1e6} MB each)`);
  console.log(`Large    : ${LARGE_W}×${LARGE_H} → lossless PNG`);
  console.log(`Small    : ${SMALL_W}×${SMALL_H} → JPEG`);
  console.log(`Output   : ${BASE_DIR}`);
  console.log(`Workers  : ${CONCURRENCY}`);
  console.log("");

  let collected = 0;
  let tried     = 0;
  let failed    = 0;

  const seeds = Array.from({ length: MAX_SEED }, (_, i) => i + 1);
  const queue = [...seeds];

  async function worker() {
    while (queue.length > 0 && collected < TARGET) {
      const seed = queue.shift();
      if (seed === undefined || collected >= TARGET) break;
      tried++;
      const res = await processSeed(seed);

      switch (res.status) {
        case "ok":
          collected++;
          console.log(`  + seed=${String(res.seed).padEnd(4)}  ${(res.size / 1e6).toFixed(1).padStart(6)} MB  [${collected}/${TARGET}]`);
          break;
        case "skip":
          collected++;
          console.log(`  = seed=${String(res.seed).padEnd(4)}  ${(res.size / 1e6).toFixed(1).padStart(6)} MB  (exists) [${collected}/${TARGET}]`);
          break;
        case "skip-small":
          console.log(`  - seed=${String(res.seed).padEnd(4)}  ${(res.size / 1e6).toFixed(1).padStart(6)} MB  (below 10 MB after convert — skipped)`);
          break;
        case "fail-large":
        case "fail-convert":
        case "fail-write":
        case "fail-small":
          failed++;
          console.warn(`  ! seed=${res.seed}  ${res.status}: ${res.err}`);
          break;
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  // ── Summary ───────────────────────────────────────────────────────────────
  const { readdir } = await import("node:fs/promises");
  const largeFiles = (await readdir(LARGE_DIR)).filter(f => f.endsWith(".png"));
  const smallFiles = (await readdir(SMALL_DIR)).filter(f => f.endsWith(".jpg"));

  // Total disk usage
  const allFiles = [
    ...largeFiles.map(f => join(LARGE_DIR, f)),
    ...smallFiles.map(f => join(SMALL_DIR, f)),
  ];
  const totalBytes = (await Promise.all(allFiles.map(p => stat(p).then(s => s.size).catch(() => 0))))
    .reduce((a, b) => a + b, 0);

  console.log("");
  console.log("=== Summary ===");
  console.log(`Seeds tried  : ${tried}`);
  console.log(`Pairs saved  : ${collected}`);
  console.log(`Failures     : ${failed}`);
  console.log(`Large files  : ${largeFiles.length}`);
  console.log(`Small files  : ${smallFiles.length}`);
  console.log(`Total on disk: ${(totalBytes / 1e9).toFixed(2)} GB`);
}

main().catch(err => { console.error(err); process.exit(1); });
