import { app, BrowserWindow } from "electron";
import { join } from "node:path";

import { registerIpcHandlers } from "./ipc";
import { logEvent } from "./logger";

async function createWindow(): Promise<void> {
  const window = new BrowserWindow({
    height: 900,
    minHeight: 720,
    minWidth: 960,
    show: true,
    webPreferences: {
      contextIsolation: true,
      preload: join(__dirname, "preload.js"),
      sandbox: false
    },
    width: 1400
  });

  await logEvent("main", "window.created", {
    height: 900,
    minHeight: 720,
    minWidth: 960,
    width: 1400
  });
  await window.loadFile(join(__dirname, "..", "..", "renderer", "index.html"));
  await logEvent("main", "window.loaded");
  window.once("ready-to-show", () => {
    window.show();
    void logEvent("main", "window.ready");
    if (process.env.IMAGEDEDUP_OPEN_DEVTOOLS === "1") {
      try {
        window.webContents.openDevTools({ mode: "detach" });
      } catch {
        void logEvent("main", "window.devtools.open_failed", undefined, "warn");
      }
    }
  });
}

app.whenReady().then(async () => {
  await logEvent("main", "app.ready");
  registerIpcHandlers();
  await createWindow();

  app.on("activate", async () => {
    await logEvent("main", "app.activate");
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  void logEvent("main", "app.window_all_closed");
  if (process.platform !== "darwin") {
    app.quit();
  }
});

process.on("unhandledRejection", (reason) => {
  void logEvent("main", "process.unhandled_rejection", { reason }, "error");
});

process.on("uncaughtException", (error) => {
  void logEvent("main", "process.uncaught_exception", { error }, "error");
});
