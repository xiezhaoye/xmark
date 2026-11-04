/**
 * `POST /api/shares` — freeze the current bytes of a file into a public link.
 *
 * Body: `{"root": "<rootId>", "path": "<relPath>"}`, JSON only (`415
 * unsupported_content_type` for anything else). The body is bounded while it is
 * read — 8 KiB, a `Content-Length` that agrees or does not, a chunked stream —
 * so a phone that sends the wrong thing cannot make the process allocate it.
 * The reply is
 * `{url: "<publicBaseUrl>/s/<id>"}`; with no configured base URL the answer is
 * `503 {"error":"sharing_unavailable"}` — the phone then offers native sharing
 * instead.
 *
 * The snapshot is taken here, on the private listener, from the file as saved
 * on disk: the share page never reads the workspace and the original file is
 * never written to. The URL is built from configuration (`publicBaseUrl`), so
 * a forged `Host` header cannot redirect a link.
 *
 * @module routes/shares
 */
import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import * as path from "node:path";
import { classifyFile, contentTypeFor } from "../fileKinds";
import type { RegistrySource } from "../registry";
import { freezeAssets } from "../shareAssets";
import type { ShareAssetInput, ShareStore } from "../shareStore";
import { boundedReader, MAX_DOWNLOAD_BYTES, type ReadBytes } from "./download";
import { apiError, resolveByRel, type Target } from "./target";

export interface ShareDeps {
  store: ShareStore;
  publicBaseUrl: string | null;
  /** The same bounded reader `/api/download` uses; tests inject failures here. */
  readBytes?: ReadBytes;
}

/** A share request is two short strings; anything bigger is not from the phone. */
const MAX_BODY_BYTES = 8 * 1024;
const MAX_NAME_CHARS = 255;

const unavailable = (c: Context) => c.json({ error: "sharing_unavailable" }, 503);

interface Requested {
  root: string;
  path: string;
}

/** True for `application/json`, with or without parameters; nothing else parses here. */
function isJsonContentType(header: string | undefined): boolean {
  if (!header) return false;
  const [type] = header.split(";");
  return type.trim().toLowerCase() === "application/json";
}

/** Read a JSON body already bounded by `bodyLimit`; `too_large` covers a body that grew inside it. */
async function readBody(c: Context): Promise<Requested | "too_large" | null> {
  const raw = await c.req.text();
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return "too_large";
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const { root, path: rel } = parsed as Record<string, unknown>;
  if (typeof root !== "string" || typeof rel !== "string" || !root || !rel) return null;
  if (rel.length > MAX_NAME_CHARS * 4 || root.length > 256) return null;
  return { root, path: rel };
}

/** A capture failure, mapped onto the status the phone already understands. */
function captureFailure(c: Context, err: unknown) {
  const code = (err as { code?: unknown } | null)?.code;
  if (code === "TOO_LARGE") return apiError(c, 413, "too_large");
  if (code === "CHANGED") return apiError(c, 409, "file_changed");
  return apiError(c, 404, "not_found");
}

/** Markdown references are frozen beside the snapshot; other kinds keep no assets. */
async function collectAssets(abs: string, kind: string, bytes: Buffer): Promise<ShareAssetInput[]> {
  if (kind !== "markdown") return [];
  return freezeAssets({ dir: path.dirname(abs), markdown: bytes.toString("utf8") });
}

/**
 * Every request to `/api/shares` is bounded *while* it is read: a declared
 * `Content-Length` over the cap is refused before a byte is buffered, and a
 * streamed or forged-short body is counted as it arrives. `readBody` keeps its
 * own check as the second lock.
 */
const boundedBody = bodyLimit({
  maxSize: MAX_BODY_BYTES,
  onError: (c) => apiError(c, 413, "too_large"),
});

export function registerShares(app: Hono, registry: RegistrySource, deps: ShareDeps | undefined): void {
  const readBytes: ReadBytes = deps?.readBytes ?? boundedReader;
  app.post("/api/shares", boundedBody, async (c) => {
    if (!deps || deps.publicBaseUrl === null) return unavailable(c);
    if (!isJsonContentType(c.req.header("content-type"))) return apiError(c, 415, "unsupported_content_type");
    const body = await readBody(c);
    if (body === "too_large") return apiError(c, 413, "too_large");
    if (!body) return apiError(c, 400, "bad_request");

    // Body fields go through the same root/path validation as the query ones.
    const target: Target | Response = await resolveByRel(registry, body.root, body.path);
    if (target instanceof Response) return target;
    if (!target.stats.isFile()) return apiError(c, 404, "not_found");
    const kind = classifyFile(target.rel);
    if (!kind || !contentTypeFor(target.rel)) return apiError(c, 415, "unsupported_kind");
    if (target.stats.size > MAX_DOWNLOAD_BYTES) return apiError(c, 413, "too_large");

    // Read once, bounded: the bytes in the snapshot are the bytes the reader
    // verified did not change, never an unbounded `readFile` of a file that grew.
    const read = await readBytes(target.abs, MAX_DOWNLOAD_BYTES).then(
      (bytes) => ({ ok: true as const, bytes }),
      (err: unknown) => ({ ok: false as const, err }),
    );
    if (!read.ok) return captureFailure(c, read.err);
    const { bytes } = read;
    if (bytes.length > MAX_DOWNLOAD_BYTES) return apiError(c, 413, "too_large");

    const name = target.rel.split("/").pop() ?? "file";
    const snapshot = await deps.store.save({ bytes, name, kind, assets: await collectAssets(target.abs, kind, bytes) });
    return c.json({ url: `${deps.publicBaseUrl}/s/${snapshot.id}` });
  });
}
