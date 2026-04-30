import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/performance/**/*.test.ts"],
    environmentMatchGlobs: [
      ["tests/performance/renderer.performance.test.ts", "jsdom"]
    ]
  }
});
