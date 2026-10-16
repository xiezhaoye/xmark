import { defineConfig } from "tsup";
import { fileURLToPath } from "node:url";

/**
 * Production bundle.
 *
 * The walker and search come from the content server's source through the
 * `@content-server/*` alias; esbuild inlines them at bundle time so
 * `dist/cli.js` runs with plain `node` and no build of `server/content`.
 * Real npm dependencies stay external.
 */
export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  outDir: "dist",
  sourcemap: true,
  clean: true,
  dts: false,
  banner: { js: "#!/usr/bin/env node" },
  define: { __VERSION__: JSON.stringify(process.env.npm_package_version ?? "dev") },
  esbuildOptions(options) {
    options.alias = {
      "@content-server": fileURLToPath(new URL("../content/src", import.meta.url)),
    };
  },
});
