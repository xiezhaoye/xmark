/**
 * `GET /api/download?root&path` — the original bytes of one file.
 *
 * The phone's "Send original file" needs exactly what is on disk: no
 * re-encoding, no BOM stripping, no line-ending normalisation. The bytes are
 * read through `readFileBounded`, which opens the file, `fstat`s the handle,
 * reads at most `MAX_DOWNLOAD_BYTES + 1` bytes, re-checks size and mtime, and
 * closes the handle — so a file that grows after the first `stat` cannot make
 * the process allocate it, and a file that is still changing is reported as a
 * conflict instead of served torn.
 *
 * Anything the reader cannot show (`unsupported_kind`), a directory, or a
 * path outside the shared root is refused, by the same rules `/api/file`
 * applies.
 *
 * @module routes/download
 */
import type { Context, Hono } from "hono";
import { readFileBounded } from "../boundedRead";
import { contentDisposition, contentTypeFor } from "../fileKinds";
import type { RegistrySource } from "../registry";
import { apiError, resolveTarget } from "./target";

/** Same ceiling as an image asset: a share must stay a download, not a transfer job. */
export const MAX_DOWNLOAD_BYTES = 30 * 1024 * 1024;

/**
 * The byte reader. It may throw an error carrying `code: "TOO_LARGE"` (the
 * file outgrew the limit) or `code: "CHANGED"` (it moved while being read);
 * every other failure is "cannot read this file".
 */
export type ReadBytes = (file: string, max: number) => Promise<Buffer>;

/** The ceiling a caller passes to the reader; kept next to the type it guards. */
export const DOWNLOAD_LIMIT = MAX_DOWNLOAD_BYTES;

/** The production reader: bounded, no symlink followed at the final component. */
export const boundedReader: ReadBytes = async (file, max) => {
  const result = await readFileBounded(file, max, { followFinalSymlink: false });
  if (result.ok) return result.bytes;
  if (result.reason === "too_large") throw Object.assign(new Error("too_large"), { code: "TOO_LARGE" });
  if (result.reason === "changed") throw Object.assign(new Error("file_changed"), { code: "CHANGED" });
  throw Object.assign(new Error("not_found"), { code: "READ_FAILED" });
};

function download(c: Context, name: string, bytes: Buffer, type: string) {
  return c.body(new Uint8Array(bytes), 200, {
    "Content-Type": type,
    "Content-Disposition": contentDisposition(name),
    "Content-Length": String(bytes.length),
  });
}

function codeOf(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : "";
}

/** Map a reader failure onto the status the phone already understands. */
function readFailure(c: Context, err: unknown) {
  const code = codeOf(err);
  if (code === "TOO_LARGE") return apiError(c, 413, "too_large");
  if (code === "CHANGED") return apiError(c, 409, "file_changed");
  return apiError(c, 404, "not_found");
}

export function registerDownload(app: Hono, registry: RegistrySource, readBytes: ReadBytes = boundedReader): void {
  app.get("/api/download", async (c) => {
    const target = await resolveTarget(c, registry);
    if (target instanceof Response) return target;
    if (!target.stats.isFile()) return apiError(c, 404, "not_found");
    const type = contentTypeFor(target.abs);
    if (!type) return apiError(c, 415, "unsupported_kind");
    if (target.stats.size > MAX_DOWNLOAD_BYTES) return apiError(c, 413, "too_large");

    const read = await readBytes(target.abs, MAX_DOWNLOAD_BYTES).then(
      (bytes) => ({ ok: true as const, bytes }),
      (err: unknown) => ({ ok: false as const, err }),
    );
    if (!read.ok) return readFailure(c, read.err);
    const { bytes } = read;
    // The file may have grown after the stat above; never serve more than the
    // limit the phone was promised.
    if (bytes.length > MAX_DOWNLOAD_BYTES) return apiError(c, 413, "too_large");
    const name = target.rel.split("/").pop() ?? target.rel;
    return download(c, name, bytes, type);
  });
}
