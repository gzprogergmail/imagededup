import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  build: {
    outDir: "../../dist/renderer",
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, "src/renderer/index.html")
    }
  },
  root: "src/renderer"
});
