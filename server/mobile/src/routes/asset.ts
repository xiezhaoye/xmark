/**
 * `GET /api/asset?root&path` — image bytes for the reader.
 *
 * The phone fetches these with the token header and shows them through blob
 * URLs. Weak ETags (size + mtime) let it revalidate cheaply; SVG gets a CSP
 * that forbids scripts even if opened directly.
 *
 * @module routes/asset
 */
import type { Hono } from "hono";
import { readFile } from "node:fs/promises";
import { imageContentType } from "../fileKinds";
import type { RegistrySource } from "../registry";
import { apiError, resolveTarget } from "./target";

const MAX_ASSET_BYTES = 30 * 1024 * 1024;

export function registerAsset(app: Hono, registry: RegistrySource): void {
  app.get("/api/asset", async (c) => {
    const target = await resolveTarget(c, registry);
    if (target instanceof Response) return target;
    if (!target.stats.isFile()) return apiError(c, 404, "not_found");
    const type = imageContentType(target.abs);
    if (!type) return apiError(c, 415, "unsupported_kind");
    if (target.stats.size > MAX_ASSET_BYTES) return apiError(c, 413, "too_large");

    const etag = `"${target.stats.size.toString(36)}-${Math.round(target.stats.mtimeMs).toString(36)}"`;
    c.header("ETag", etag);
    c.header("Cache-Control", "private, no-cache");
    c.header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    if (c.req.header("if-none-match") === etag) return c.body(null, 304);
    const bytes = await readFile(target.abs);
    return c.body(bytes, 200, { "Content-Type": type });
  });
}
