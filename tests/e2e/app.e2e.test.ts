import { expect, test } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { scanFast } from "../../src/main/core/dedupService";

test("fast pass runs end-to-end in the built renderer", async ({ page }) => {
  const { generateFixtureSet } = await import("../../scripts/image-fixtures.mjs");
  const fixtureDir = await mkdtemp(join(tmpdir(), "imagededup-e2e-"));
  await generateFixtureSet(fixtureDir);
  const fastResult = await scanFast(fixtureDir);
  const { serverUrl, stop } = await startStaticServer(resolve("dist/renderer"));

  try {
    await page.addInitScript(
      ({ fastResult: nextFastResult }) => {
        (window as Window & { imageDedupApi: unknown }).imageDedupApi = {
          browseFolder: async () => "",
          cancelScan: async () => undefined,
          clearCache: async (folder: string) => ({
            cacheFilePath: "C:\\cache\\folder",
            currentImageCount: 2,
            folder,
            missingEntryCount: 2,
            sizeBytes: 0,
            staleEntryCount: 0,
            totalEntries: 0,
            ttlDays: 365,
            validEntryCount: 0
          }),
          getCacheInfo: async (folder: string) => ({
            cacheFilePath: "C:\\cache\\folder",
            currentImageCount: 2,
            folder,
            missingEntryCount: 2,
            sizeBytes: 0,
            staleEntryCount: 0,
            totalEntries: 0,
            ttlDays: 365,
            validEntryCount: 0
          }),
          getFolderPreview: async (folder: string) => ({
            folder,
            imageCount: 2,
            samplePaths: ["C:\\fixtures\\base.png", "C:\\fixtures\\copy.png"]
          }),
          getLogInfo: async () => ({ directory: "C:\\logs" }),
          logEvent: async () => undefined,
          onScanUpdate: undefined,
          openFile: async () => undefined,
          openFolder: async () => undefined,
          deleteFile: async () => undefined,
          rematchFastPass: async () => nextFastResult,
          startFastPass: async () => nextFastResult
        };
      },
      { fastResult }
    );

    await page.goto(serverUrl);
    await expect(page.getByText(/JSONL logs:/)).toBeVisible();
    await expect(page.getByText("No results yet")).toBeVisible();
    await page.getByLabel("Folder").fill(fixtureDir);
    await expect(page.locator("#folder-preview")).toContainText("images ready to scan");
    await page.getByLabel("Folder").press("Enter");
    await expect(page.locator("#status-line")).toContainText("Scan finished");
    await expect(page.getByText("base.png").first()).toBeVisible();
    await expect(page.getByText(/Scan finished with/)).toBeVisible();
    await expect(page.getByText("Review duplicate groups")).toBeVisible();
  } finally {
    await stop();
  }
});

test("partial results appear during scan before final results arrive", async ({ page }) => {
  const { generateFixtureSet } = await import("../../scripts/image-fixtures.mjs");
  const fixtureDir = await mkdtemp(join(tmpdir(), "imagededup-e2e-partial-"));
  await generateFixtureSet(fixtureDir);
  const fastResult = await scanFast(fixtureDir);
  const { serverUrl, stop } = await startStaticServer(resolve("dist/renderer"));

  try {
    await page.addInitScript(
      ({ fastResult: nextFastResult }) => {
        type ScanUpdateCallback = (update: unknown) => void;
        let scanCallback: ScanUpdateCallback | null = null;

        (window as Window & { imageDedupApi: unknown }).imageDedupApi = {
          browseFolder: async () => "",
          cancelScan: async () => undefined,
          clearCache: async (folder: string) => ({
            cacheFilePath: "C:\\cache\\folder",
            currentImageCount: 2,
            folder,
            missingEntryCount: 2,
            sizeBytes: 0,
            staleEntryCount: 0,
            totalEntries: 0,
            ttlDays: 365,
            validEntryCount: 0
          }),
          getCacheInfo: async (folder: string) => ({
            cacheFilePath: "C:\\cache\\folder",
            currentImageCount: 2,
            folder,
            missingEntryCount: 2,
            sizeBytes: 0,
            staleEntryCount: 0,
            totalEntries: 0,
            ttlDays: 365,
            validEntryCount: 0
          }),
          getFolderPreview: async (folder: string) => ({
            folder,
            imageCount: 2,
            samplePaths: ["C:\\fixtures\\base.png", "C:\\fixtures\\copy.png"]
          }),
          getLogInfo: async () => ({ directory: "C:\\logs" }),
          logEvent: async () => undefined,
          onScanUpdate: (callback: ScanUpdateCallback) => {
            scanCallback = callback;
            return () => { scanCallback = null; };
          },
          openFile: async () => undefined,
          openFolder: async () => undefined,
          deleteFile: async () => undefined,
          rematchFastPass: async () => nextFastResult,
          startFastPass: async () => {
            if (scanCallback) {
              const result = nextFastResult as { groups: unknown[]; scannedFileCount: number };
              // Emit a partial update first
              scanCallback({
                type: "partial",
                groups: result.groups.slice(0, 1),
                scannedSoFar: 1,
                totalFiles: result.scannedFileCount
              });
              // Then emit the complete result after a short delay
              await new Promise<void>(res => setTimeout(res, 400));
              scanCallback({ type: "complete", result: nextFastResult });
            }
            return null;
          }
        };
      },
      { fastResult }
    );

    await page.goto(serverUrl);
    await page.getByLabel("Folder").fill(fixtureDir);
    await page.getByLabel("Folder").press("Enter");

    // Partial results banner should appear while scan is in progress
    await expect(page.locator("#results-panel")).toContainText("Live results");

    // Final results should replace the partial banner
    await expect(page.locator("#status-line")).toContainText("Scan finished");
    await expect(page.getByText(/Scan finished with/)).toBeVisible();
  } finally {
    await stop();
  }
});

async function startStaticServer(root: string): Promise<{ serverUrl: string; stop: () => Promise<void> }> {
  const server = createServer(async (request, response) => {
    try {
      const requestPath = request.url === "/" ? "/index.html" : request.url ?? "/index.html";
      const filePath = join(root, requestPath.replace(/^\//, ""));
      const content = await readFile(filePath);
      response.writeHead(200, { "content-type": contentTypeFor(filePath) });
      response.end(content);
    } catch {
      response.writeHead(404);
      response.end();
    }
  });

  await new Promise<void>((resolvePromise) => {
    server.listen(0, "127.0.0.1", () => resolvePromise());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not start static server");
  }

  return {
    serverUrl: `http://127.0.0.1:${address.port}/index.html`,
    stop: async () => new Promise<void>((resolvePromise, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolvePromise();
      });
    })
  };
}

function contentTypeFor(filePath: string): string {
  const extension = extname(filePath);
  switch (extension) {
    case ".css":
      return "text/css";
    case ".html":
      return "text/html";
    case ".js":
      return "application/javascript";
    default:
      return "application/octet-stream";
  }
}
