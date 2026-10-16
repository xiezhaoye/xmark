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

export function apiError(c: Context, status: 400 | 404 | 413 | 415, error: string) {
  return c.json({ error }, status);
}

/** Resolve the `root` + `path` query, or produce the error response. */
export async function resolveTarget(c: Context, registry: RegistrySource): Promise<Target | Response> {
  const rootId = c.req.query("root");
  if (!rootId) return apiError(c, 400, "bad_request");
  const root = (await registry.current()).roots.get(rootId);
  if (!root) return apiError(c, 404, "unknown_root");
  const segments = splitRelPath(c.req.query("path") ?? "");
  if (!segments) return apiError(c, 400, "bad_path");
  const rel = segments.join("/");
  const abs = await resolveInRoot(root.absPath, rel);
  if (!abs) return apiError(c, 404, "not_found");
  try {
    return { root, rel, abs, stats: await stat(abs) };
  } catch {
    return apiError(c, 404, "not_found");
  }
}
