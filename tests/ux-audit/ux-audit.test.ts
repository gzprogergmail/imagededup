import { test, expect, chromium, type Page, type Browser } from "@playwright/test";
import path from "path";
import fs from "fs";
import sharp from "sharp";

// UX Audit Test - Interactive exploration to find friction points

test.describe("UX Audit - Interactive Testing", () => {
  let browser: Browser;
  let page: Page;

  test.beforeAll(async () => {
    // Connect to the running Electron app via CDP
    browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
    const context = browser.contexts()[0];
    page = context.pages()[0];
  });

  test.afterAll(async () => {
    await browser.close();
  });

  test("audit: initial load and visual state", async () => {
    // Take screenshot of initial state
    await page.screenshot({ path: "tests/ux-audit/screenshots/01-initial-load.png" });

    // Check initial UI elements
    const statusBadge = page.locator("#status-badge");
    const folderInput = page.locator("#folder-input");
    const fastButton = page.locator("#fast-button");
    const slowButton = page.locator("#slow-button");
    const progressBar = page.locator("#progress-bar");

    // Verify initial state
    await expect(statusBadge).toHaveText("Idle");
    await expect(folderInput).toBeEnabled();
    await expect(fastButton).toBeEnabled();
    await expect(slowButton).toBeEnabled();

    // Check progress bar is hidden initially
    const progressVisible = await progressBar.evaluate(el => el.dataset.visible);
    expect(progressVisible).toBe("false");

    console.log("✓ Initial state: Idle, inputs enabled, progress hidden");
  });

  test("audit: empty folder validation", async () => {
    const fastButton = page.locator("#fast-button");
    const folderInput = page.locator("#folder-input");

    // Clear input and try to start scan
    await folderInput.fill("");
    await fastButton.click();

    await page.screenshot({ path: "tests/ux-audit/screenshots/02-empty-folder-error.png" });

    // Check error state
    const statusLine = page.locator("#status-line");
    await expect(statusLine).toContainText("Enter a folder path first");
    const hasInvalid = await folderInput.evaluate(el => el.hasAttribute("aria-invalid"));
    expect(hasInvalid).toBe(true);

    console.log("✓ Empty folder validation works");
  });

  test("audit: folder input interaction", async () => {
    const folderInput = page.locator("#folder-input");
    const selectedFolder = page.locator("#selected-folder");

    // Type a test path
    await folderInput.fill("C:\\Test\\Images");

    // Check if selection preview appears
    const isVisible = await selectedFolder.evaluate(el => el.dataset.visible);
    expect(isVisible).toBe("true");

    await page.screenshot({ path: "tests/ux-audit/screenshots/03-folder-selected.png" });

    console.log("✓ Folder selection preview works");
  });

  test("audit: scan with test fixtures and observe UX", async () => {
    // Create test fixtures if they don't exist
    const testDir = path.join(process.cwd(), "tests/.generated/ux-audit");
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }

    // Create simple test images
    const redBuffer = await sharp({ create: { width: 100, height: 100, channels: 3, background: { r: 255, g: 0, b: 0 } } })
      .png().toBuffer();
    const blueBuffer = await sharp({ create: { width: 100, height: 100, channels: 3, background: { r: 0, g: 0, b: 255 } } })
      .png().toBuffer();

    fs.writeFileSync(path.join(testDir, "image1.png"), redBuffer);
    fs.writeFileSync(path.join(testDir, "image2.png"), redBuffer); // Duplicate
    fs.writeFileSync(path.join(testDir, "image3.png"), blueBuffer);

    const folderInput = page.locator("#folder-input");
    const fastButton = page.locator("#fast-button");
    const slowButton = page.locator("#slow-button");
    const browseButton = page.locator("#browse-button");
    const progressBar = page.locator("#progress-bar");
    const statusBadge = page.locator("#status-badge");
    const activityList = page.locator("#activity-list");

    // Set folder path
    await folderInput.fill(testDir);

    // Click fast pass and observe UX
    await fastButton.click();

    // Capture state immediately after click
    await page.screenshot({ path: "tests/ux-audit/screenshots/04-fast-pass-started.png" });

    // Check UI is in "busy" state
    await expect(statusBadge).toHaveText("Running");
    await expect(browseButton).toBeDisabled();
    await expect(fastButton).toBeDisabled();
    await expect(slowButton).toBeDisabled();
    await expect(folderInput).toBeDisabled();

    // Check progress bar is visible
    const progressVisible = await progressBar.evaluate(el => el.dataset.visible);
    expect(progressVisible).toBe("true");

    // Wait for completion
    await expect(statusBadge).toHaveText("Ready", { timeout: 30000 });

    await page.screenshot({ path: "tests/ux-audit/screenshots/05-fast-pass-complete.png" });

    // Check results appeared
    const resultsPanel = page.locator("#results-panel");
    const hasResults = await resultsPanel.locator(".group-card").count() > 0;
    expect(hasResults).toBe(true);

    // Check activity log was updated
    const activityCount = await activityList.locator("li").count();
    expect(activityCount).toBeGreaterThan(0);

    console.log("✓ Fast pass UX flow works");

    // Test slow pass
    await slowButton.click();

    await page.screenshot({ path: "tests/ux-audit/screenshots/06-slow-pass-started.png" });

    await expect(statusBadge).toHaveText("Running");

    // Wait for slow pass completion
    await expect(statusBadge).toHaveText("Ready", { timeout: 60000 });

    await page.screenshot({ path: "tests/ux-audit/screenshots/07-slow-pass-complete.png" });

    console.log("✓ Slow pass UX flow works");
  });

  test("audit: identify UX friction points", async () => {
    // This test documents UX issues found during interactive testing

    const findings = {
      issues: [
        {
          id: 1,
          severity: "high",
          category: "feedback",
          issue: "No progress percentage or file count during scan",
          description: "The progress bar is indeterminate and doesn't show how many files have been processed or estimated time remaining. Users have no idea if the scan will take 10 seconds or 10 minutes.",
          recommendation: "Add real-time progress updates showing: current file being processed, X of Y files scanned, estimated time remaining."
        },
        {
          id: 2,
          severity: "high",
          category: "responsiveness",
          issue: "UI completely freezes during backend processing",
          description: "All buttons and inputs are disabled during scan. Users cannot cancel an ongoing scan or perform any other action.",
          recommendation: "Keep UI responsive: allow canceling scans, show a cancel button, process in smaller chunks to allow UI updates."
        },
        {
          id: 3,
          severity: "medium",
          category: "visual",
          issue: "Theme has low contrast and dated appearance",
          description: "The sepia/beige color scheme feels dated. Text contrast could be improved for accessibility.",
          recommendation: "Modernize with a cleaner color palette, better contrast ratios (WCAG AA compliance), and more visual hierarchy."
        },
        {
          id: 4,
          severity: "medium",
          category: "feedback",
          issue: "No preview of images being compared",
          description: "Users must manually open files to see what images look like. The duplicate detection shows file paths but no visual preview.",
          recommendation: "Add thumbnail previews for duplicate groups so users can visually confirm duplicates without opening files."
        },
        {
          id: 5,
          severity: "medium",
          category: "interaction",
          issue: "No way to select and delete duplicates from the app",
          description: "The app only shows duplicates but provides no action to delete or move them. Users must manually navigate to files.",
          recommendation: "Add actions: 'Delete selected', 'Move to folder', 'Open containing folder' buttons on each group."
        },
        {
          id: 6,
          severity: "low",
          category: "feedback",
          issue: "Activity log is limited to 8 entries",
          description: "Previous activity is lost quickly, making it hard to track history across multiple scans.",
          recommendation: "Increase activity log size or make it scrollable with more history."
        },
        {
          id: 7,
          severity: "low",
          category: "visual",
          issue: "Results cards feel cramped",
          description: "Long file paths wrap awkwardly and the layout feels dense.",
          recommendation: "Improve card layout with better spacing, truncation with tooltips, and clearer visual separation between groups."
        }
      ]
    };

    // Write findings to file
    fs.writeFileSync(
      "tests/ux-audit/ux-findings.json",
      JSON.stringify(findings, null, 2)
    );

    console.log("UX Audit Findings:");
    findings.issues.forEach(issue => {
      console.log(`\n[${issue.severity.toUpperCase()}] ${issue.category}: ${issue.issue}`);
      console.log(`  ${issue.description}`);
      console.log(`  → ${issue.recommendation}`);
    });

    // Take final screenshot
    await page.screenshot({ path: "tests/ux-audit/screenshots/08-final-state.png" });
  });
});
