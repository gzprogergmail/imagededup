import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("imageDedupApi", {
  browseFolder: () => ipcRenderer.invoke("folder:browse") as Promise<string | null>,
  getLogInfo: () => ipcRenderer.invoke("logs:info") as Promise<{ directory: string }>,
  logEvent: (event: string, details?: Record<string, unknown>, level?: "info" | "warn" | "error") =>
    ipcRenderer.invoke("log:write", event, details, level) as Promise<void>,
  startFastPass: (folder: string) => ipcRenderer.invoke("scan:fast", folder),
  startSlowPass: (folder: string) => ipcRenderer.invoke("scan:slow", folder)
});
