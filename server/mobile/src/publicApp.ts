/**
 * The public listener: share snapshots only, no API, no token.
 *
 * This app is what `tailscale funnel` proxies to, so everything reachable here
 * is reachable by anyone with the link. It therefore registers **no** `/api`
 * route and never asks for a token: the snapshot id (256 random bits) is the
 * entire capability, and the private app keeps every authenticated route.
 *
 * A request never reaches the workspace: a page is rendered from bytes already
 * frozen in the store, and an unknown id answers the same "not found" page as
 * a malformed one, so the route cannot be used to probe what exists.
 *
 * Three routes per snapshot, and the split is deliberate:
 *
 *     /s/:id          the reading page (DENY framing, no script)
 *     /s/:id/preview  the inline view the page frames (SAMEORIGIN, sandboxed)
 *     /s/:id/download the original bytes, as an attachment
 *
 * @module publicApp
 */
import { Hono, type Context } from "hono";
import { contentDisposition, contentTypeFor, previewContentTypeFor } from "./fileKinds";
import { renderPreviewHtml } from "./renderMarkdown";
import { assetUrlFor } from "./shareAssets";
import { langFromHeader, renderMissingPage, renderRootPage, renderSharePage, SHARE_PAGE_CSP } from "./sharePage";
import { isValidShareId, type ShareStore } from "./shareStore";

export interface PublicAppDeps {
  store: ShareStore;
  /** Cap for embedding a PDF inline; larger files get a preview link only. */
  maxEmbedBytes?: number;
}

const DEFAULT_MAX_EMBED_BYTES = 20 * 1024 * 1024;

/**
 * The preview route is framed by its own reading page, so `DENY` here would
 * block the embed the page needs. `SAMEORIGIN` keeps every other origin out,
 * and `frame-ancestors 'self'` says the same thing to browsers that read CSP.
 */
const PREVIEW_CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "script-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'self'",
  // A second, browser-enforced sandbox for the document itself: no scripts, no
  // forms, no popups, no same-origin access — even if the CSP were dropped.
  "sandbox allow-same-origin",
].join("; ");

function harden(c: Context, csp = SHARE_PAGE_CSP): void {
  c.header("Content-Security-Policy", csp);
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "no-referrer");
  c.header("X-Robots-Tag", "noindex, nofollow, noarchive");
  c.header("X-Frame-Options", "DENY");
  c.header("Cache-Control", "no-store");
}

function html(c: Context, body: string, status: 200 | 404 = 200) {
  harden(c);
  return c.body(body, status, { "Content-Type": "text/html; charset=utf-8" });
}

export function createPublicApp({ store, maxEmbedBytes = DEFAULT_MAX_EMBED_BYTES }: PublicAppDeps): Hono {
  const app = new Hono();
  const lang = (c: Context) => langFromHeader(c.req.header("accept-language"));

  app.get("/", (c) => html(c, renderRootPage(lang(c))));

  app.get("/s/:id", async (c) => {
    const id = c.req.param("id");
    if (!isValidShareId(id)) return html(c, renderMissingPage(lang(c)), 404);
    const meta = await store.meta(id);
    const bytes = meta ? await store.read(id) : null;
    if (!meta || !bytes) return html(c, renderMissingPage(lang(c)), 404);

    const markdown = meta.kind === "markdown" || meta.kind === "text" ? bytes.toString("utf8") : "";
    const bodyHtml =
      meta.kind === "pdf" || meta.kind === "image" || meta.kind === "html"
        ? ""
        : await renderPreviewHtml(markdown, { kind: meta.kind, assetUrl: assetUrlFor(id, meta.assets) });
    return html(
      c,
      renderSharePage({
        lang: lang(c),
        title: meta.name,
        id,
        size: bytes.length,
        kind: meta.kind,
        bodyHtml,
        embedPdf: meta.kind === "pdf" && bytes.length <= maxEmbedBytes,
      }),
    );
  });

  app.get("/s/:id/download", async (c) => {
    const id = c.req.param("id");
    const meta = isValidShareId(id) ? await store.meta(id) : null;
    const bytes = meta ? await store.read(id) : null;
    if (!meta || !bytes) return html(c, renderMissingPage(lang(c)), 404);
    harden(c);
    return c.body(new Uint8Array(bytes), 200, {
      "Content-Type": contentTypeFor(meta.name) ?? "application/octet-stream",
      "Content-Disposition": contentDisposition(meta.name),
      "Content-Length": String(bytes.length),
    });
  });

  /**
   * The inline view of the same bytes. A separate route, not a parameter on
   * `/download`: the reading page frames PDFs, images and HTML here, while
   * Download original keeps its attachment disposition.
   */
  app.get("/s/:id/preview", async (c) => {
    const id = c.req.param("id");
    const meta = isValidShareId(id) ? await store.meta(id) : null;
    const bytes = meta ? await store.read(id) : null;
    if (!meta || !bytes) return html(c, renderMissingPage(lang(c)), 404);
    const type = previewContentTypeFor(meta.name);
    if (!type) return html(c, renderMissingPage(lang(c)), 404);
    // `sandbox allow-same-origin` keeps the framed document from scripting ours;
    // XFO SAMEORIGIN matches `frame-ancestors 'self'` for older clients.
    harden(c, PREVIEW_CSP);
    c.header("X-Frame-Options", "SAMEORIGIN");
    return c.body(new Uint8Array(bytes), 200, {
      "Content-Type": type,
      "Content-Disposition": contentDisposition(meta.name, "inline"),
      "Content-Length": String(bytes.length),
    });
  });

  app.get("/s/:id/assets/:name", async (c) => {
    const id = c.req.param("id");
    const name = c.req.param("name");
    const bytes = isValidShareId(id) ? await store.readAsset(id, name) : null;
    if (!bytes) return c.json({ error: "not_found" }, 404);
    const type = contentTypeFor(name) ?? "application/octet-stream";
    harden(c, "default-src 'none'; sandbox");
    return c.body(new Uint8Array(bytes), 200, { "Content-Type": type, "Content-Length": String(bytes.length) });
  });

  app.notFound((c) => html(c, renderMissingPage(lang(c)), 404));
  app.onError((err, c) => {
    // The message is logged, never rendered: markup stays off the page.
    console.error(`[xmark-mobile-public] ${c.req.method} ${c.req.path}: ${err.message}`);
    return html(c, renderMissingPage(lang(c)), 404);
  });

  return app;
}
