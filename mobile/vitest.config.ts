import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { LIVENESS_TIMEOUT_MS } from "../vitest.shared.ts";

export default defineConfig({
  resolve: {
    alias: {
      "@content-server": fileURLToPath(new URL("../server/content/src", import.meta.url)),
      // Leaf-pure desktop utilities (no stores, no Tauri), shared so the rail glyphs match.
      "@desktop-utils": fileURLToPath(new URL("../src/utils", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    testTimeout: LIVENESS_TIMEOUT_MS,
    hookTimeout: LIVENESS_TIMEOUT_MS,
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/main.tsx", "src/**/*.testUtils.ts"],
    },
  },
});
