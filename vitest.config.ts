import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";


const rootDir = fileURLToPath(new URL(".", import.meta.url));


export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/frontend/setup.ts"],
    include: ["tests/frontend/**/*.test.ts", "tests/frontend/**/*.test.tsx"],
    css: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "src"),
    },
  },
});
