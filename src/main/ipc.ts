import { dialog, ipcMain, shell, type WebContents } from "electron";
import { z } from "zod";

import {
  clearHashCache,
  inspectHashCache,
  previewFolder,
  rematchFastFromCache,
  scanFast,
  type ScanCallbacks
} from "./core/dedupService";
import { getLogDirectory, logEvent } from "./logger";
import type { ScanProgress } from "../shared/types";

const folderSchema = z.string().trim().min(1);
const pathSchema = z.string().trim().min(1);
const scanOptionsSchema = z.object({
  forceRefreshCache: z.boolean().optional()
}).optional();

let activeScanCancel: (() => void) | null = null;

function sendProgressUpdate(webContents: WebContents, progress: ScanProgress): void {
  webContents.send("scan:update", progress);
}

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

  ipcMain.handle("folder:preview", async (_event, folder) => {
    const parsedFolder = folderSchema.parse(folder);
    const preview = await previewFolder(parsedFolder);
    await logEvent("main", "folder.preview.completed", {
      folder: preview.folder,
      imageCount: preview.imageCount,
      sampleCount: preview.samplePaths.length
    });
    return preview;
  });

  ipcMain.handle("cache:info", async (_event, folder) => {
    const parsedFolder = folderSchema.parse(folder);
    const info = await inspectHashCache(parsedFolder);
    await logEvent("main", "cache.info.completed", {
      currentImageCount: info.currentImageCount,
      folder: info.folder,
      missingEntryCount: info.missingEntryCount,
      staleEntryCount: info.staleEntryCount,
      validEntryCount: info.validEntryCount
    });
    return info;
  });

  ipcMain.handle("cache:clear", async (_event, folder) => {
    const parsedFolder = folderSchema.parse(folder);
    const info = await clearHashCache(parsedFolder);
    await logEvent("main", "cache.clear.completed", {
      currentImageCount: info.currentImageCount,
      folder: info.folder
    });
    return info;
  });

  ipcMain.handle("file:open", async (_event, filePath) => {
    const parsedPath = pathSchema.parse(filePath);
    await logEvent("main", "file.open", { path: parsedPath });
    const error = await shell.openPath(parsedPath);
    if (error) throw new Error(error);
  });

  ipcMain.handle("folder:open", async (_event, filePath) => {
    const parsedPath = pathSchema.parse(filePath);
    await logEvent("main", "folder.open", { path: parsedPath });
    // showItemInFolder opens Explorer/Finder with the file highlighted — correct
    // for both "Open Folder" (group card) and "Show in Folder" (file card).
    shell.showItemInFolder(parsedPath);
  });

  ipcMain.handle("file:delete", async (_event, filePath) => {
    const parsedPath = pathSchema.parse(filePath);
    await logEvent("main", "file.delete", { path: parsedPath });
    await shell.trashItem(parsedPath);
  });

  ipcMain.handle("scan:cancel", async () => {
    if (activeScanCancel) {
      activeScanCancel();
      activeScanCancel = null;
      await logEvent("main", "scan.cancelled");
    }
  });

  ipcMain.handle("scan:fast", async (event, folder, threshold, options) => {
    const parsedFolder = folderSchema.parse(folder);
    const parsedThreshold = typeof threshold === "number" ? Math.max(0, Math.min(16, Math.round(threshold))) : undefined;
    const parsedOptions = scanOptionsSchema.parse(options) ?? {};
    await logEvent("main", "scan.fast.started", {
      folder: parsedFolder,
      forceRefreshCache: parsedOptions.forceRefreshCache === true,
      hammingThreshold: parsedThreshold
    });

    const webContents = event.sender;

    let isCancelled = false;
    activeScanCancel = () => {
      isCancelled = true;
    };

    const callbacks: ScanCallbacks = {
      onProgress: (progress: ScanProgress) => {
        if (!isCancelled) {
          sendProgressUpdate(webContents, progress);
        }
      },
      onPartialGroups: (groups, scannedSoFar, totalFiles) => {
        if (!isCancelled) {
          webContents.send("scan:update", { type: "partial", groups, scannedSoFar, totalFiles });
        }
      },
      isCancelled: () => isCancelled
    };

    try {
      const result = await scanFast(parsedFolder, callbacks, parsedThreshold, parsedOptions);

      if (isCancelled) {
        webContents.send("scan:update", { type: "cancelled" });
        return null;
      }

      webContents.send("scan:update", { type: "complete", result });
      await logEvent("main", "scan.fast.completed", {
        elapsedMs: result.elapsedMs,
        folder: parsedFolder,
        groupCount: result.groups.length,
        scannedFileCount: result.scannedFileCount,
        warnings: result.warnings
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      webContents.send("scan:update", { type: "error", message });
      await logEvent("main", "scan.fast.failed", { error, folder: parsedFolder }, "error");
      throw error;
    } finally {
      activeScanCancel = null;
    }
  });

  ipcMain.handle("scan:rematch", async (event, folder, threshold) => {
    const parsedFolder = folderSchema.parse(folder);
    const parsedThreshold = typeof threshold === "number" ? Math.max(0, Math.min(16, Math.round(threshold))) : undefined;
    await logEvent("main", "scan.rematch.started", { folder: parsedFolder, hammingThreshold: parsedThreshold });

    const webContents = event.sender;
    try {
      const result = await rematchFastFromCache(parsedFolder, parsedThreshold);
      webContents.send("scan:update", { type: "complete", result });
      await logEvent("main", "scan.rematch.completed", {
        elapsedMs: result.elapsedMs,
        folder: parsedFolder,
        groupCount: result.groups.length,
        scannedFileCount: result.scannedFileCount
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      webContents.send("scan:update", { type: "error", message });
      await logEvent("main", "scan.rematch.failed", { error, folder: parsedFolder }, "error");
      throw error;
    }
  });

  ipcMain.handle("log:write", async (_event, eventName, details, level = "info") => {
    await logEvent("renderer", eventSchema.parse(eventName), detailsSchema.parse(details), levelSchema.parse(level));
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
