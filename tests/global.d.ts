import type { FolderPreview, ScanUpdate } from "../src/shared/types";

export {};

declare global {
  interface Window {
    imageDedupApi: {
      browseFolder: () => Promise<string | null>;
      cancelScan: () => Promise<void>;
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
      startFastPass: (folder: string, threshold?: number) => Promise<unknown>;
    };
  }
}
