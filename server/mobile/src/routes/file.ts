/**
 * `GET /api/file?root&path` — a text file's content for the reader.
 *
 * UTF-8 only (decoded strictly; a BOM is dropped). Anything else is refused
 * with `not_utf8` rather than shown as mojibake.
 *
 * @module routes/file
 */
import type { Hono } from "hono";
import { readFile } from "node:fs/promises";
import { classifyFile } from "../fileKinds";
import type { RegistrySource } from "../registry";
import { apiError, resolveTarget } from "./target";

/** Larger notes are refused; the desktop opens them, the phone does not. */
export const MAX_TEXT_BYTES = 5 * 1024 * 1024;

const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });

export function registerFile(app: Hono, registry: RegistrySource): void {
  app.get("/api/file", async (c) => {
    const target = await resolveTarget(c, registry);
    if (target instanceof Response) return target;
    if (!target.stats.isFile()) return apiError(c, 404, "not_found");
    const kind = classifyFile(target.abs);
    if (kind !== "markdown" && kind !== "text") return apiError(c, 415, "unsupported_kind");
    if (target.stats.size > MAX_TEXT_BYTES) return apiError(c, 413, "too_large");

    let text: string;
    try {
      text = decoder.decode(await readFile(target.abs));
    } catch {
      return apiError(c, 415, "not_utf8");
    }
    return c.json({ text, kind, size: target.stats.size, mtime: Math.round(target.stats.mtimeMs) });
  });
}
