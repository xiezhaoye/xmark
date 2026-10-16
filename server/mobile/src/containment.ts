/**
 * Keeping a requested path inside its shared root.
 *
 * The phone sends a root id plus a POSIX relative path (already URL-decoded
 * by the router — decoding again would corrupt names containing `%`). A path
 * is refused when any segment is `..`, hidden (leading dot), an always-skipped
 * directory, or carries NUL/backslash; then the real path is re-checked after
 * following symlinks, so exposure through `/api/file` never exceeds what
 * `/api/tree` lists.
 *
 * @module containment
 */
import { realpath } from "node:fs/promises";
import * as path from "node:path";
import { ALWAYS_SKIP_DIRS } from "@content-server/index/walk";

/** Split and validate a relative path; null when any segment is refused. */
export function splitRelPath(rel: string): string[] | null {
  const segments: string[] = [];
  for (const seg of rel.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === ".." || seg.startsWith(".") || seg.includes("\0") || seg.includes("\\")) return null;
    if (ALWAYS_SKIP_DIRS.has(seg)) return null;
    segments.push(seg);
  }
  return segments;
}

/** True when `candidate` is `root` or lies beneath it. */
function isWithin(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(root + path.sep);
}

/**
 * Resolve `rel` under `realRoot` (which must already be a real path).
 * Returns the real absolute path, or null when refused or missing.
 */
export async function resolveInRoot(realRoot: string, rel: string): Promise<string | null> {
  const segments = splitRelPath(rel);
  if (!segments) return null;
  try {
    const real = await realpath(path.join(realRoot, ...segments));
    return isWithin(realRoot, real) ? real : null;
  } catch {
    return null;
  }
}
