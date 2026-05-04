import { contextBridge, ipcRenderer } from "electron";
import type { FolderPreview, ScanUpdate } from "../shared/types";

contextBridge.exposeInMainWorld("imageDedupApi", {
  browseFolder: () => ipcRenderer.invoke("folder:browse") as Promise<string | null>,
  cancelScan: () => ipcRenderer.invoke("scan:cancel") as Promise<void>,
  getFolderPreview: (folder: string) => ipcRenderer.invoke("folder:preview", folder) as Promise<FolderPreview>,
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
  startFastPass: (folder: string, threshold?: number) => ipcRenderer.invoke("scan:fast", folder, threshold)
});
