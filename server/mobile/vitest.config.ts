import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { LIVENESS_TIMEOUT_MS } from "../../vitest.shared.ts";

export default defineConfig({
  resolve: {
    alias: {
      "@content-server": fileURLToPath(new URL("../content/src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    testTimeout: LIVENESS_TIMEOUT_MS,
    hookTimeout: LIVENESS_TIMEOUT_MS,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/cli.ts", "src/testFixtures.testUtils.ts"],
      thresholds: {
        statements: 85,
        branches: 75,
        functions: 85,
        lines: 85,
      },
    },
  },
});
