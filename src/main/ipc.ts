import { dialog, ipcMain } from "electron";
import { z } from "zod";

import { scanFast, scanSlow } from "./core/dedupService";

const folderSchema = z.string().trim().min(1);

export function registerIpcHandlers(): void {
  ipcMain.handle("folder:browse", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"]
    });

    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  ipcMain.handle("scan:fast", async (_event, folder) => {
    return scanFast(folderSchema.parse(folder));
  });

  ipcMain.handle("scan:slow", async (_event, folder) => {
    return scanSlow(folderSchema.parse(folder));
  });
}
