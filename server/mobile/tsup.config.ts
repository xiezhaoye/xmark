import { defineConfig } from "tsup";
import { fileURLToPath } from "node:url";

/**
 * Production bundle.
 *
 * The walker and search come from the content server's source through the
 * `@content-server/*` alias; esbuild inlines them at bundle time so
 * `dist/cli.js` runs with plain `node` and no build of `server/content`.
 * The npm dependencies are inlined too, so the one file can be copied to
 * another machine (a Linux box, another Mac) and run with nothing installed.
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
  noExternal: [/.*/],
  // Bundled CommonJS dependencies call `require`, which an ES module lacks.
  banner: { js: '#!/usr/bin/env node\nimport { createRequire as __xmarkCreateRequire } from "node:module";\nconst require = __xmarkCreateRequire(import.meta.url);' },
  define: { __VERSION__: JSON.stringify(process.env.npm_package_version ?? "dev") },
  esbuildOptions(options) {
    options.alias = {
      "@content-server": fileURLToPath(new URL("../content/src", import.meta.url)),
    };
  },
});
