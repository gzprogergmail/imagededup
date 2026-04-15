import { dialog, ipcMain } from "electron";
import { z } from "zod";

import { scanFast, scanSlow } from "./core/dedupService";
import { getLogDirectory, logEvent } from "./logger";

const folderSchema = z.string().trim().min(1);

export function registerIpcHandlers(): void {
  ipcMain.handle("folder:browse", async () => {
    await logEvent("main", "folder.browse.started");
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"]
    });
    const selection = result.canceled ? null : result.filePaths[0] ?? null;
    await logEvent("main", "folder.browse.completed", {
      canceled: result.canceled,
      selection
    });
    return selection;
  });

  ipcMain.handle("scan:fast", async (_event, folder) => {
    const parsedFolder = folderSchema.parse(folder);
    await logEvent("main", "scan.fast.started", { folder: parsedFolder });

    try {
      const result = await scanFast(parsedFolder);
      await logEvent("main", "scan.fast.completed", {
        elapsedMs: result.elapsedMs,
        folder: parsedFolder,
        groupCount: result.groups.length,
        scannedFileCount: result.scannedFileCount,
        warnings: result.warnings
      });
      return result;
    } catch (error) {
      await logEvent("main", "scan.fast.failed", { error, folder: parsedFolder }, "error");
      throw error;
    }
  });

  ipcMain.handle("scan:slow", async (_event, folder) => {
    const parsedFolder = folderSchema.parse(folder);
    await logEvent("main", "scan.slow.started", { folder: parsedFolder });

    try {
      const result = await scanSlow(parsedFolder);
      await logEvent("main", "scan.slow.completed", {
        elapsedMs: result.elapsedMs,
        folder: parsedFolder,
        groupCount: result.groups.length,
        scannedFileCount: result.scannedFileCount,
        warnings: result.warnings
      });
      return result;
    } catch (error) {
      await logEvent("main", "scan.slow.failed", { error, folder: parsedFolder }, "error");
      throw error;
    }
  });

  ipcMain.handle("log:write", async (_event, event, details, level = "info") => {
    await logEvent("renderer", eventSchema.parse(event), detailsSchema.parse(details), levelSchema.parse(level));
  });

  ipcMain.handle("logs:info", async () => {
    return {
      directory: await getLogDirectory()
    };
  });
}

const eventSchema = z.string().trim().min(1);
const levelSchema = z.enum(["info", "warn", "error"]);
const detailsSchema = z.record(z.string(), z.unknown()).optional();
