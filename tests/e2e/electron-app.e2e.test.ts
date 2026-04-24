import { expect, test } from "@playwright/test";
import electronPath from "electron";
import { mkdtemp } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { _electron as electron } from "playwright";

test("electron app loads the built renderer and responds to scan actions", async () => {
  test.setTimeout(180000);

  const { generateFixtureSet } = await import("../../scripts/image-fixtures.mjs");
  const fixtureDir = await mkdtemp(join(tmpdir(), "imagededup-electron-e2e-"));
  await generateFixtureSet(fixtureDir);

  const env = {
    ...process.env,
    IMAGEDEDUP_OPEN_DEVTOOLS: "0"
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const app = await electron.launch({
    args: ["."],
    cwd: resolve("."),
    env,
    executablePath: electronPath
  });

  try {
    const window = app.windows()[0] ?? await app.firstWindow();
    await window.waitForSelector("#folder-input");
    await expect(window.locator("#activity-list")).toContainText("Renderer initialized.");
    await expect(window.locator("#log-path-line")).toContainText("JSONL logs:");

    await window.locator("#folder-input").fill(fixtureDir);
    await window.locator("#fast-button").click();
    await expect(window.locator("#status-line")).toContainText("Fast Pass finished", {
      timeout: 30000
    });
    await expect(window.locator("#results-panel")).toContainText("base.png");

    await window.locator("#slow-button").click();
    await expect(window.locator("#status-line")).toContainText("Slow Pass finished", {
      timeout: 90000
    });
    await expect(window.locator("#results-panel")).toContainText("slow-rotated-12.png");
  } finally {
    await app.close();
  }
});
