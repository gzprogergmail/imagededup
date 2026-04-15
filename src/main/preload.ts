import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("imageDedupApi", {
  browseFolder: () => ipcRenderer.invoke("folder:browse") as Promise<string | null>,
  startFastPass: (folder: string) => ipcRenderer.invoke("scan:fast", folder),
  startSlowPass: (folder: string) => ipcRenderer.invoke("scan:slow", folder)
});
