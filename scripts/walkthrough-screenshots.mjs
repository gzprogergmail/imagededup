/**
 * End-to-end walkthrough screenshot script.
 *
 * Connects to a running Electron app via CDP (port 9223) and captures a
 * narrated sequence of screenshots that demonstrate how Hamming distance
 * affects duplicate-detection results.
 *
 * Usage:
 *   1. Start Electron with remote debugging:
 *        npx electron . --remote-debugging-port=9223
 *   2. In a second terminal:
 *        node scripts/walkthrough-screenshots.mjs
 *
 * Screenshots land in:  manual-ui-artifacts/walkthrough/
 */

import { chromium } from "@playwright/test";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const outDir = path.join(rootDir, "manual-ui-artifacts", "walkthrough");

fs.mkdirSync(outDir, { recursive: true });

const SAMPLE_FOLDER = path.join(rootDir, "sample-images", "cats");
const CDP_URL = "http://127.0.0.1:9223";

/** ms → promise */
function delay(ms) {
  return new Promise(r => globalThis.setTimeout(r, ms));
}

/**
 * Set a range input value and fire both 'input' and 'change' events so the
 * app's event listeners pick up the new value.
 */
async function setSlider(page, selector, value) {
  await page.locator(selector).evaluate((el, v) => {
    el.value = String(v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

async function screenshot(page, filename, label) {
  const fullPath = path.join(outDir, filename);
  await page.screenshot({ path: fullPath, fullPage: false });
  console.log(`  ✓  ${filename}  —  ${label}`);
  return fullPath;
}

async function waitForScanIdle(page, timeoutMs = 90_000) {
  // The scan-busy state hides cancel button when done; wait for fast-button to be enabled
  await page.waitForFunction(
    () => {
      const btn = document.getElementById("fast-button");
      return btn && !btn.disabled;
    },
    { timeout: timeoutMs }
  );
  await delay(600); // let UI settle / animations finish
}

async function run() {
  console.log("\n=== Duplicate Image Finder — Walkthrough Screenshot Capture ===\n");
  console.log(`Connecting to Electron app at ${CDP_URL} …`);

  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
  } catch (err) {
    console.error(
      `\nCould not connect to Electron on ${CDP_URL}.\n` +
      "Make sure the app is running with --remote-debugging-port=9223.\n" +
      `  npx electron . --remote-debugging-port=9223\n\n` +
      err.message
    );
    process.exit(1);
  }

  const context = browser.contexts()[0];
  const page = context.pages()[0];

  // Give Web Awesome components time to hydrate on first load
  await delay(1500);

  // ── 01 · Initial state ──────────────────────────────────────────────────
  console.log("\n[01] Initial app state");
  await screenshot(page, "01-initial-state.png", "App freshly opened, no folder selected");

  // ── 02 · Enter the cats sample folder ──────────────────────────────────
  console.log("\n[02] Select sample folder");
  await page.locator("#folder-input").fill(SAMPLE_FOLDER);
  await page.locator("#folder-input").dispatchEvent("input");
  await delay(1200); // folder preview debounce + fetch
  await screenshot(page, "02-folder-selected.png", "Sample folder entered, preview loaded");

  // ── 03 · Set threshold = 0, start scan ─────────────────────────────────
  console.log("\n[03] Start scan — threshold 0 (exact duplicates only)");
  await setSlider(page, "#threshold-input", 0);
  await delay(200);
  await screenshot(page, "03-threshold-0-before-scan.png", "Threshold set to 0 / 16 (exact matches only)");

  await page.locator("#fast-button").click();
  await delay(800); // let scan start & progress appear

  // ── 04 · Scan in progress ───────────────────────────────────────────────
  console.log("\n[04] Scan in progress");
  await screenshot(page, "04-scan-in-progress.png", "Scan running — progress bar visible");

  // ── 05 · Results at threshold 0 ─────────────────────────────────────────
  console.log("\n[05] Waiting for scan to finish …");
  await waitForScanIdle(page);
  await screenshot(page, "05-results-threshold-0.png", "Results at threshold 0 — exact duplicates only");

  // Scroll to results panel for a focused shot
  await page.locator("#results-panel").scrollIntoViewIfNeeded();
  await delay(300);
  await screenshot(page, "05b-results-threshold-0-scrolled.png", "Results panel at threshold 0 (scrolled into view)");

  // ── 06 · Threshold = 5 (default, near-matches) ──────────────────────────
  console.log("\n[06] Apply threshold 5 (default — near-matches)");
  await page.locator("#folder-input").scrollIntoViewIfNeeded();
  await delay(300);
  await setSlider(page, "#threshold-input", 5);
  await delay(200);
  await screenshot(page, "06a-threshold-5-slider.png", "Threshold slider at 5 / 16");
  await page.locator("#apply-threshold-button").click();
  await waitForScanIdle(page);
  await screenshot(page, "06b-results-threshold-5.png", "Results at threshold 5 — includes near-duplicates");

  await page.locator("#results-panel").scrollIntoViewIfNeeded();
  await delay(300);
  await screenshot(page, "06c-results-threshold-5-scrolled.png", "Results panel at threshold 5 (scrolled)");

  // ── 07 · Threshold = 10 (aggressive) ────────────────────────────────────
  console.log("\n[07] Apply threshold 10 (aggressive — crops / re-saves)");
  await page.locator("#folder-input").scrollIntoViewIfNeeded();
  await delay(300);
  await setSlider(page, "#threshold-input", 10);
  await delay(200);
  await screenshot(page, "07a-threshold-10-slider.png", "Threshold slider at 10 / 16");
  await page.locator("#apply-threshold-button").click();
  await waitForScanIdle(page);
  await screenshot(page, "07b-results-threshold-10.png", "Results at threshold 10 — aggressive matching");

  await page.locator("#results-panel").scrollIntoViewIfNeeded();
  await delay(300);
  await screenshot(page, "07c-results-threshold-10-scrolled.png", "Results panel at threshold 10 (scrolled)");

  // ── 08 · Threshold = 16 (maximum sensitivity) ───────────────────────────
  console.log("\n[08] Apply threshold 16 (maximum — many false positives expected)");
  await page.locator("#folder-input").scrollIntoViewIfNeeded();
  await delay(300);
  await setSlider(page, "#threshold-input", 16);
  await delay(200);
  await screenshot(page, "08a-threshold-16-slider.png", "Threshold slider at 16 / 16 (maximum)");
  await page.locator("#apply-threshold-button").click();
  await waitForScanIdle(page);
  await screenshot(page, "08b-results-threshold-16.png", "Results at threshold 16 — maximum sensitivity");

  await page.locator("#results-panel").scrollIntoViewIfNeeded();
  await delay(300);
  await screenshot(page, "08c-results-threshold-16-scrolled.png", "Results panel at threshold 16 (scrolled)");

  // ── 09 · Summary stats comparison ───────────────────────────────────────
  console.log("\n[09] Summary grid at threshold 16");
  await page.locator("#summary-grid").scrollIntoViewIfNeeded();
  await delay(400);
  await screenshot(page, "09-summary-threshold-16.png", "Summary statistics card at threshold 16");

  // ── 10 · Reset to threshold 5, scroll to top for final overview ─────────
  console.log("\n[10] Final overview — threshold 5 (recommended default)");
  await page.locator("#folder-input").scrollIntoViewIfNeeded();
  await delay(300);
  await setSlider(page, "#threshold-input", 5);
  await delay(200);
  await page.locator("#apply-threshold-button").click();
  await waitForScanIdle(page);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await delay(500);
  await screenshot(page, "10-overview-threshold-5.png", "Full-page overview — threshold 5 (recommended)");

  await browser.close();

  console.log(`\n✅  All screenshots saved to:\n   ${outDir}\n`);

  // Print manifest
  const files = fs.readdirSync(outDir)
    .filter(f => f.endsWith(".png"))
    .sort();
  console.log("Files:");
  files.forEach(f => console.log(`  ${f}`));
}

run().catch(err => {
  console.error("\n❌  Walkthrough failed:", err.message);
  process.exit(1);
});
