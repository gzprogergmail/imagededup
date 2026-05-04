import type { HashCacheInfo, FolderPreview, ScanUpdate } from "../src/shared/types";

export {};

declare global {
  interface Window {
    imageDedupApi: {
      browseFolder: () => Promise<string | null>;
      cancelScan: () => Promise<void>;
      clearCache: (folder: string) => Promise<HashCacheInfo>;
      getCacheInfo: (folder: string) => Promise<HashCacheInfo>;
      getFolderPreview: (folder: string) => Promise<FolderPreview>;
      getLogInfo: () => Promise<{ directory: string }>;
      logEvent: (
        event: string,
        details?: Record<string, unknown>,
        level?: "info" | "warn" | "error"
      ) => Promise<void>;
      onScanUpdate: (callback: (update: ScanUpdate) => void) => () => void;
      openFile: (filePath: string) => Promise<void>;
      openFolder: (filePath: string) => Promise<void>;
      deleteFile: (filePath: string) => Promise<void>;
      rematchFastPass: (folder: string, threshold?: number) => Promise<unknown>;
      startFastPass: (folder: string, threshold?: number, options?: { forceRefreshCache?: boolean }) => Promise<unknown>;
    };
  }
}
