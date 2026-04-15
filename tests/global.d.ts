export {};

declare global {
  interface Window {
    imageDedupApi: {
      browseFolder: () => Promise<string | null>;
      startFastPass: (folder: string) => Promise<unknown>;
      startSlowPass: (folder: string) => Promise<unknown>;
    };
  }
}
