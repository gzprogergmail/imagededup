import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html", "clover"],
      thresholds: {
        branches: 70,
        functions: 90,
        lines: 90,
        statements: 90
      },
      exclude: [
        "dist/**",
        "release/**",
        "src/main/main.ts",
        "src/main/preload.ts",
        "tests/**"
      ]
    },
    include: ["tests/unit/**/*.test.ts"]
  }
});
