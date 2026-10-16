/**
 * The mobile server's HTTP app: auth in front, read-only routes behind.
 *
 * No CORS: the phone calls through Tauri's HTTP plugin (Rust, no browser
 * origin), so a browser page elsewhere on the tailnet gets nothing it can
 * read even if it guessed the token.
 *
 * @module createApp
 */
import { Hono } from "hono";
import { bearerAuth } from "./auth";
import { publicWorkspaces, type RegistrySource } from "./registry";
import { registerAsset } from "./routes/asset";
import { registerFile } from "./routes/file";
import { registerSearch } from "./routes/search";
import { registerTree } from "./routes/tree";
import type { TokenSource } from "./token";

export interface AppDeps {
  tokens: TokenSource;
  registry: RegistrySource;
  version: string;
}

export function createApp({ tokens, registry, version }: AppDeps): Hono {
  const app = new Hono();
  app.use("*", async (c, next) => {
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    if (!c.res.headers.has("Cache-Control")) c.header("Cache-Control", "no-store");
  });
  app.use("*", bearerAuth(tokens));

  app.get("/api/health", (c) => c.json({ ok: true, version }));
  app.get("/api/workspaces", async (c) => c.json(publicWorkspaces(await registry.current())));
  registerTree(app, registry);
  registerFile(app, registry);
  registerAsset(app, registry);
  registerSearch(app, registry);

  app.notFound((c) => c.json({ error: "not_found" }, 404));
  app.onError((err, c) => {
    console.error(`[xmark-mobile-server] ${c.req.method} ${c.req.path}: ${err.message}`);
    return c.json({ error: "internal" }, 500);
  });
  return app;
}
