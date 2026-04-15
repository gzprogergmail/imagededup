import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120000,
  use: {
    browserName: "chromium",
    channel: "msedge",
    trace: "retain-on-failure"
  }
});
