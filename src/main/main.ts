import { app, BrowserWindow } from "electron";
import { join } from "node:path";

import { registerIpcHandlers } from "./ipc";

async function createWindow(): Promise<void> {
  const window = new BrowserWindow({
    height: 900,
    minHeight: 720,
    minWidth: 960,
    show: false,
    webPreferences: {
      contextIsolation: true,
      preload: join(__dirname, "preload.js"),
      sandbox: false
    },
    width: 1400
  });

  await window.loadFile(join(__dirname, "..", "..", "renderer", "index.html"));
  window.once("ready-to-show", () => window.show());
}

app.whenReady().then(async () => {
  registerIpcHandlers();
  await createWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
