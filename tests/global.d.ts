export {};

declare global {
  interface Window {
    imageDedupApi: {
      browseFolder: () => Promise<string | null>;
      getLogInfo: () => Promise<{ directory: string }>;
      logEvent: (
        event: string,
        details?: Record<string, unknown>,
        level?: "info" | "warn" | "error"
      ) => Promise<void>;
      startFastPass: (folder: string) => Promise<unknown>;
      startSlowPass: (folder: string) => Promise<unknown>;
    };
  }
}
