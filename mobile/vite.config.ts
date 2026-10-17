import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  resolve: {
    alias: {
      // Pure remark plugins shared with the content server (GitHub alerts).
      "@content-server": fileURLToPath(new URL("../server/content/src", import.meta.url)),
      // Leaf-pure desktop utilities (no stores, no Tauri), shared so the rail glyphs match.
      "@desktop-utils": fileURLToPath(new URL("../src/utils", import.meta.url)),
    },
  },
  server: {
    port: 1440,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1441 } : undefined,
  },
  build: { target: "safari16", chunkSizeWarningLimit: 4000 },
});
