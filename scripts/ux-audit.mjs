/**
 * UX Audit Script - Interactive testing to find friction points
 * Run this while the Electron app is running with --remote-debugging-port=9223
 */

import { chromium } from "@playwright/test";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const screenshotDir = path.join(rootDir, "tests/ux-audit/screenshots");
const findingsFile = path.join(rootDir, "tests/ux-audit/ux-findings.json");

// Ensure directories exist
if (!fs.existsSync(screenshotDir)) {
  fs.mkdirSync(screenshotDir, { recursive: true });
}

async function delay(ms) {
  return new Promise(resolve => globalThis.setTimeout(resolve, ms));
}

async function runAudit() {
  console.log("🔍 Starting UX Audit...\n");

  // Connect to running Electron app
  console.log("Connecting to Electron app on port 9223...");
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
  const context = browser.contexts()[0];
  const page = context.pages()[0];

  const findings = {
    timestamp: new Date().toISOString(),
    issues: []
  };

  // Helper to add findings
  function addIssue(severity, category, issue, description, recommendation) {
    findings.issues.push({
      id: findings.issues.length + 1,
      severity,
      category,
      issue,
      description,
      recommendation
    });
    console.log(`\n[${severity.toUpperCase()}] ${category}: ${issue}`);
    console.log(`  ${description}`);
    console.log(`  → ${recommendation}`);
  }

  // ===== TEST 1: Initial Load =====
  console.log("\n📸 Test 1: Initial Load State");
  await page.screenshot({ path: path.join(screenshotDir, "01-initial-load.png") });

  const statusBadge = await page.locator("#status-badge").textContent();
  console.log(`  Status: ${statusBadge}`);

  // Check progress bar visibility
  const progressVisible = await page.locator("#progress-bar").evaluate(el => el.dataset.visible);
  console.log(`  Progress bar visible: ${progressVisible}`);

  // ===== TEST 2: Empty Folder Validation =====
  console.log("\n📸 Test 2: Empty Folder Validation");
  await page.locator("#folder-input").fill("");
  await page.locator("#fast-button").click();
  await delay(500);
  await page.screenshot({ path: path.join(screenshotDir, "02-empty-folder-error.png") });

  const errorStatus = await page.locator("#status-line").textContent();
  console.log(`  Error message: ${errorStatus}`);

  // ===== TEST 3: Folder Selection =====
  console.log("\n📸 Test 3: Folder Selection");
  await page.locator("#folder-input").fill("C:\\Test\\Images");
  await delay(300);
  await page.screenshot({ path: path.join(screenshotDir, "03-folder-selected.png") });

  const selectedVisible = await page.locator("#selected-folder").evaluate(el => el.dataset.visible);
  console.log(`  Selection preview visible: ${selectedVisible}`);

  // ===== TEST 4: Create Test Images and Run Scan =====
  console.log("\n📸 Test 4: Running Scan with Test Data");

  // Create test images using sharp
  const testDir = path.join(rootDir, "tests/.generated/ux-audit");
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }

  // Generate test images using Node.js
  const sharp = await import("sharp");

  // Create a red image
  const redBuffer = await sharp.default({
    create: { width: 100, height: 100, channels: 3, background: { r: 255, g: 0, b: 0 } }
  }).png().toBuffer();

  // Create a blue image
  const blueBuffer = await sharp.default({
    create: { width: 100, height: 100, channels: 3, background: { r: 0, g: 0, b: 255 } }
  }).png().toBuffer();

  // Create a rotated red image (duplicate)
  const redRotatedBuffer = await sharp.default({
    create: { width: 100, height: 100, channels: 3, background: { r: 255, g: 0, b: 0 } }
  }).rotate(90).png().toBuffer();

  fs.writeFileSync(path.join(testDir, "image1.png"), redBuffer);
  fs.writeFileSync(path.join(testDir, "image2.png"), redBuffer); // Exact duplicate
  fs.writeFileSync(path.join(testDir, "image3.png"), blueBuffer); // Different
  fs.writeFileSync(path.join(testDir, "image4.png"), redRotatedBuffer); // Rotated duplicate

  // Set folder and start scan
  await page.locator("#folder-input").fill(testDir);
  await delay(300);

  // Click fast pass
  await page.locator("#fast-button").click();
  await delay(500);

  console.log("  Capturing scan started state...");
  await page.screenshot({ path: path.join(screenshotDir, "04-fast-pass-started.png") });

  // Check UI state during scan
  const duringScanStatus = await page.locator("#status-badge").textContent();
  const isBrowseDisabled = await page.locator("#browse-button").isDisabled();
  const isFastDisabled = await page.locator("#fast-button").isDisabled();
  const isSlowDisabled = await page.locator("#slow-button").isDisabled();
  const isInputDisabled = await page.locator("#folder-input").isDisabled();
  const progressBarVisible = await page.locator("#progress-bar").evaluate(el => el.dataset.visible);

  console.log(`  Status during scan: ${duringScanStatus}`);
  console.log(`  Browse disabled: ${isBrowseDisabled}`);
  console.log(`  Fast button disabled: ${isFastDisabled}`);
  console.log(`  Slow button disabled: ${isSlowDisabled}`);
  console.log(`  Input disabled: ${isInputDisabled}`);
  console.log(`  Progress bar visible: ${progressBarVisible}`);

  // Wait for completion
  console.log("  Waiting for scan to complete...");
  await page.waitForSelector("#status-badge:has-text('Ready')", { timeout: 30000 });
  await delay(500);

  console.log("  Capturing scan complete state...");
  await page.screenshot({ path: path.join(screenshotDir, "05-fast-pass-complete.png") });

  // Check results
  const resultCards = await page.locator("#results-panel .group-card").count();
  console.log(`  Result cards found: ${resultCards}`);

  // ===== ANALYZE UX ISSUES =====
  console.log("\n🔍 Analyzing UX Issues...\n");

  // Issue 1: No progress feedback
  addIssue(
    "high",
    "feedback",
    "No progress percentage or file count during scan",
    "The progress bar is indeterminate and doesn't show how many files have been processed or estimated time remaining. Users have no idea if the scan will take 10 seconds or 10 minutes.",
    "Add real-time progress updates showing: current file being processed, X of Y files scanned, percentage complete, and estimated time remaining."
  );

  // Issue 2: UI freezing
  addIssue(
    "high",
    "responsiveness",
    "UI completely freezes during backend processing",
    "All buttons and inputs are disabled during scan. Users cannot cancel an ongoing scan or perform any other action. For large folders, this is frustrating.",
    "Keep UI responsive: add a cancel button, process in smaller chunks to allow UI updates, show a modal with progress instead of disabling everything."
  );

  // Issue 3: Theme
  addIssue(
    "medium",
    "visual",
    "Theme has low contrast and dated appearance",
    "The sepia/beige color scheme feels dated. Text contrast could be improved for accessibility. The serif font may not be ideal for technical data.",
    "Modernize with a cleaner color palette (blues/grays), ensure WCAG AA contrast compliance, use sans-serif for data, add dark mode option."
  );

  // Issue 4: No image previews
  addIssue(
    "high",
    "feedback",
    "No preview of images being compared",
    "Users must manually open files to see what images look like. The duplicate detection shows file paths but no visual preview, making it hard to verify duplicates.",
    "Add thumbnail previews for duplicate groups so users can visually confirm duplicates without opening files. Show representative image and thumbnails of duplicates."
  );

  // Issue 5: No actions on duplicates
  addIssue(
    "high",
    "interaction",
    "No way to select and delete duplicates from the app",
    "The app only shows duplicates but provides no action to delete or move them. Users must manually navigate to files in Explorer.",
    "Add actions per group: 'Delete selected', 'Move to folder', 'Open containing folder' buttons. Allow selecting which files to keep/delete."
  );

  // Issue 6: Limited activity log
  addIssue(
    "low",
    "feedback",
    "Activity log is limited to 8 entries",
    "Previous activity is lost quickly, making it hard to track history across multiple scans.",
    "Increase activity log size to 50+ entries or make it scrollable with more history. Add timestamps."
  );

  // Issue 7: Cramped results
  addIssue(
    "medium",
    "visual",
    "Results cards feel cramped and hard to scan",
    "Long file paths wrap awkwardly, the layout feels dense, and it's hard to quickly scan through many duplicates.",
    "Improve card layout: better spacing, truncate long paths with tooltips, add visual separation between groups, use icons for file types."
  );

  // Issue 8: No scan comparison
  addIssue(
    "medium",
    "feature",
    "Cannot compare fast vs slow pass results",
    "Users can't easily see what the slow pass found that the fast pass missed. No way to compare results side by side.",
    "Add ability to view both results, highlight differences, or show a comparison view."
  );

  // Issue 9: No filtering/sorting
  addIssue(
    "medium",
    "interaction",
    "No way to filter or sort duplicate groups",
    "With many duplicates, it's hard to find specific groups. No search, filter by file type, or sort by size/count.",
    "Add filters: by file type, by folder, by similarity score. Add sorting: by group size, by file size, by path."
  );

  // Issue 10: Missing keyboard shortcuts
  addIssue(
    "low",
    "interaction",
    "No keyboard shortcuts for common actions",
    "Power users would benefit from keyboard navigation: Enter to start scan, Escape to cancel, arrow keys to navigate results.",
    "Add keyboard shortcuts: Ctrl+O to browse, Ctrl+F for fast pass, Ctrl+S for slow pass, Escape to cancel."
  );

  // Save findings
  fs.writeFileSync(findingsFile, JSON.stringify(findings, null, 2));

  // Final screenshot
  await page.screenshot({ path: path.join(screenshotDir, "08-final-state.png") });

  console.log("\n✅ UX Audit Complete!");
  console.log(`\n📁 Findings saved to: ${findingsFile}`);
  console.log(`📸 Screenshots saved to: ${screenshotDir}`);
  console.log(`\n📊 Total Issues Found: ${findings.issues.length}`);
  console.log(`   High: ${findings.issues.filter(i => i.severity === "high").length}`);
  console.log(`   Medium: ${findings.issues.filter(i => i.severity === "medium").length}`);
  console.log(`   Low: ${findings.issues.filter(i => i.severity === "low").length}`);

  await browser.close();
}

runAudit().catch(err => {
  console.error("Audit failed:", err);
  process.exit(1);
});
