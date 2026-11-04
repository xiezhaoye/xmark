/**
 * Shared request → (root, real path) resolution for the file routes.
 *
 * One place decides the error vocabulary the phone sees:
 * `bad_request` (no root), `unknown_root`, `bad_path` (refused segment),
 * `not_found` (missing, escaped, or wrong type).
 *
 * @module routes/target
 */
import type { Context } from "hono";
import { stat } from "node:fs/promises";
import type { Stats } from "node:fs";
import { resolveInRoot, splitRelPath } from "../containment";
import type { RegistrySource, RootEntry } from "../registry";

export interface Target {
  root: RootEntry;
  rel: string;
  abs: string;
  stats: Stats;
}

export function apiError(c: Context, status: 400 | 404 | 409 | 413 | 415, error: string) {
  return c.json({ error }, status);
}

/** Resolve the `root` + `path` query, or produce the error response. */
export async function resolveTarget(c: Context, registry: RegistrySource): Promise<Target | Response> {
  return resolveByRel(registry, c.req.query("root"), c.req.query("path"));
}

/**
 * The same resolution for values that did not arrive as a query string —
 * `POST /api/shares` carries them in a JSON body and must be refused by the
 * identical rules.
 */
export async function resolveByRel(
  registry: RegistrySource,
  rootId: string | undefined,
  relPath: string | undefined,
): Promise<Target | Response> {
  if (!rootId) return errorResponse(400, "bad_request");
  const root = (await registry.current()).roots.get(rootId);
  if (!root) return errorResponse(404, "unknown_root");
  const segments = splitRelPath(relPath ?? "");
  if (!segments) return errorResponse(400, "bad_path");
  const rel = segments.join("/");
  const abs = await resolveInRoot(root.absPath, rel);
  if (!abs) return errorResponse(404, "not_found");
  try {
    return { root, rel, abs, stats: await stat(abs) };
  } catch {
    return errorResponse(404, "not_found");
  }
}

/** An error response built without a request context, for the body-based callers. */
function errorResponse(status: 400 | 404 | 409 | 413 | 415, error: string) {
  return Response.json({ error }, { status });
}
