import { expect, test } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { scanFast, scanSlow } from "../../src/main/core/dedupService";

test("fast and slow pass run end-to-end in the built renderer", async ({ page }) => {
  const { generateFixtureSet } = await import("../../scripts/image-fixtures.mjs");
  const fixtureDir = await mkdtemp(join(tmpdir(), "imagededup-e2e-"));
  await generateFixtureSet(fixtureDir);
  const fastResult = await scanFast(fixtureDir);
  const slowResult = await scanSlow(fixtureDir);
  const { serverUrl, stop } = await startStaticServer(resolve("dist/renderer"));

  try {
    await page.addInitScript(
      ({ fastResult: nextFastResult, slowResult: nextSlowResult }) => {
        (window as Window & { imageDedupApi: unknown }).imageDedupApi = {
          browseFolder: async () => "",
          cancelScan: async () => undefined,
          getFolderPreview: async (folder: string) => ({
            folder,
            imageCount: 2,
            samplePaths: ["C:\\fixtures\\base.png", "C:\\fixtures\\copy.png"]
          }),
          getLogInfo: async () => ({ directory: "C:\\logs" }),
          logEvent: async () => undefined,
          onScanUpdate: undefined,
          startFastPass: async () => nextFastResult,
          startSlowPass: async () => nextSlowResult
        };
      },
      { fastResult, slowResult }
    );

    await page.goto(serverUrl);
    await expect(page.getByText(/JSONL logs:/)).toBeVisible();
    await expect(page.getByText("Nothing to review yet.")).toBeVisible();
    await page.getByLabel("Folder").fill(fixtureDir);
    await expect(page.locator("#folder-preview")).toContainText("images ready to scan");
    await page.getByLabel("Folder").press("Enter");
    await expect(page.locator("#status-line")).toContainText("Fast Pass finished");
    await expect(page.getByText("base.png").first()).toBeVisible();
    await expect(page.getByText(/Fast Pass finished with/)).toBeVisible();
    await expect(page.getByText("Review duplicate groups")).toBeVisible();

    await page.getByRole("button", { name: "Start Slow Pass" }).click();
    await expect(page.locator("#status-line")).toContainText("Slow Pass finished");
    await expect(page.getByText("slow-rotated-12.png").first()).toBeVisible();
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
