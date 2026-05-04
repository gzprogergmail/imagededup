import { contextBridge, ipcRenderer } from "electron";
import type { HashCacheInfo, FolderPreview, ScanUpdate } from "../shared/types";

contextBridge.exposeInMainWorld("imageDedupApi", {
  browseFolder: () => ipcRenderer.invoke("folder:browse") as Promise<string | null>,
  cancelScan: () => ipcRenderer.invoke("scan:cancel") as Promise<void>,
  clearCache: (folder: string) => ipcRenderer.invoke("cache:clear", folder) as Promise<HashCacheInfo>,
  getFolderPreview: (folder: string) => ipcRenderer.invoke("folder:preview", folder) as Promise<FolderPreview>,
  getCacheInfo: (folder: string) => ipcRenderer.invoke("cache:info", folder) as Promise<HashCacheInfo>,
  getLogInfo: () => ipcRenderer.invoke("logs:info") as Promise<{ directory: string }>,
  logEvent: (event: string, details?: Record<string, unknown>, level?: "info" | "warn" | "error") =>
    ipcRenderer.invoke("log:write", event, details, level) as Promise<void>,
  onScanUpdate: (callback: (update: ScanUpdate) => void) => {
    const handler = (_event: unknown, update: ScanUpdate) => callback(update);
    ipcRenderer.on("scan:update", handler);
    return () => ipcRenderer.removeListener("scan:update", handler);
  },
  openFile: (filePath: string) => ipcRenderer.invoke("file:open", filePath) as Promise<void>,
  openFolder: (filePath: string) => ipcRenderer.invoke("folder:open", filePath) as Promise<void>,
  deleteFile: (filePath: string) => ipcRenderer.invoke("file:delete", filePath) as Promise<void>,
  rematchFastPass: (folder: string, threshold?: number) => ipcRenderer.invoke("scan:rematch", folder, threshold),
  startFastPass: (folder: string, threshold?: number, options?: { forceRefreshCache?: boolean }) =>
    ipcRenderer.invoke("scan:fast", folder, threshold, options)
});
