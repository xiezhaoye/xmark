/**
 * The mobile server's HTTP app: auth in front, read-only routes behind.
 *
 * CORS is off unless the caller passes a non-empty `corsOrigins` (the web
 * build's origin list, from `XMARK_MOBILE_CORS_ORIGINS`). With no list the
 * phone's Tauri HTTP plugin — which sends no browser origin — is the only
 * client, so a browser page elsewhere on the tailnet gets nothing it can
 * read even if it guessed the token.
 *
 * @module createApp
 */
import { Hono, type Context, type Next } from "hono";
import { bearerAuth } from "./auth";
import { publicWorkspaces, type RegistrySource } from "./registry";
import { registerAsset } from "./routes/asset";
import { registerDownload, type ReadBytes } from "./routes/download";
import { registerFile } from "./routes/file";
import { registerSearch } from "./routes/search";
import { registerShares } from "./routes/shares";
import { registerTree } from "./routes/tree";
import type { ShareStore } from "./shareStore";
import type { TokenSource } from "./token";

export interface AppDeps {
  tokens: TokenSource;
  registry: RegistrySource;
  version: string;
  /** Browser origins allowed cross-origin; empty (the default) adds no CORS middleware. */
  corsOrigins?: string[];
  /** Snapshot store + public base URL; absent means `POST /api/shares` is 503. */
  shares?: { store: ShareStore; publicBaseUrl: string | null };
  /**
   * Byte reader for `/api/download` and the share snapshot. Both write paths go
   * through one bounded reader, so a file that grows mid-capture is refused in
   * the same way wherever it is read; tests replace it to inject failures.
   */
  readBytes?: ReadBytes;
}

const ALLOWED_METHODS = "GET, OPTIONS";
const ALLOWED_HEADERS = "Authorization";
/** A configured share link makes `POST /api/shares` a JSON cross-origin call. */
const SHARING_METHODS = "GET, POST, OPTIONS";
const SHARING_HEADERS = "Authorization, Content-Type";
const EXPOSED_HEADERS = "ETag";
const PREFLIGHT_MAX_AGE_S = "600";

/**
 * CORS for exactly the listed origins. Preflights are answered before auth —
 * a preflight carries no `Authorization` header by design, so requiring the
 * token there would make every cross-origin call fail.
 */
function cors(origins: string[], sharing: boolean) {
  return async (c: Context, next: Next) => {
    const origin = c.req.header("origin");
    const allowed = origin !== undefined && origins.includes(origin);
    if (allowed) {
      c.header("Access-Control-Allow-Origin", origin);
      c.header("Vary", "Origin");
      c.header("Access-Control-Allow-Headers", sharing ? SHARING_HEADERS : ALLOWED_HEADERS);
      c.header("Access-Control-Allow-Methods", sharing ? SHARING_METHODS : ALLOWED_METHODS);
      c.header("Access-Control-Expose-Headers", EXPOSED_HEADERS);
    }
    if (c.req.method === "OPTIONS") {
      if (allowed) c.header("Access-Control-Max-Age", PREFLIGHT_MAX_AGE_S);
      return c.body(null, 204);
    }
    await next();
  };
}

export function createApp({ tokens, registry, version, corsOrigins = [], shares, readBytes }: AppDeps): Hono {
  const app = new Hono();
  const sharingConfigured = shares !== undefined && shares.publicBaseUrl !== null;
  if (corsOrigins.length > 0) app.use("*", cors(corsOrigins, sharingConfigured));
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
  registerDownload(app, registry, readBytes);
  registerShares(app, registry, shares ? { ...shares, readBytes } : shares);
  registerSearch(app, registry);

  app.notFound((c) => c.json({ error: "not_found" }, 404));
  app.onError((err, c) => {
    console.error(`[xmark-mobile-server] ${c.req.method} ${c.req.path}: ${err.message}`);
    return c.json({ error: "internal" }, 500);
  });
  return app;
}
