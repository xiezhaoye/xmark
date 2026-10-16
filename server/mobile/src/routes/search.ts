/**
 * `GET /api/search?q&root?` — full-text search over markdown in the shared roots.
 *
 * Reuses the content server's walker (hidden files, always-skipped folders,
 * `.gitignore`, symlinks skipped) and its capped line matcher. Without `root`
 * every available root is searched in share-file order; the caps apply to the
 * whole response. Walks are cached briefly so typing does not re-walk.
 *
 * @module routes/search
 */
import type { Hono } from "hono";
import { walkWorkspace } from "@content-server/index/walk";
import type { DocEntry } from "@content-server/index/types";
import { SEARCH_CAPS, searchWorkspace } from "@content-server/server/search";
import type { RegistrySource, RootEntry } from "../registry";
import { apiError } from "./target";

export const MAX_QUERY_LENGTH = 200;
const WALK_TTL_MS = 30_000;

export function registerSearch(app: Hono, registry: RegistrySource): void {
  const walks = new Map<string, { at: number; docs: DocEntry[] }>();

  async function docsFor(root: RootEntry): Promise<DocEntry[]> {
    const cached = walks.get(root.rootId);
    if (cached && Date.now() - cached.at < WALK_TTL_MS) return cached.docs;
    const { docs } = await walkWorkspace(root.absPath);
    walks.set(root.rootId, { at: Date.now(), docs });
    return docs;
  }

  app.get("/api/search", async (c) => {
    const q = (c.req.query("q") ?? "").trim().normalize("NFC");
    if (!q || q.length > MAX_QUERY_LENGTH) return apiError(c, 400, "bad_query");

    const reg = await registry.current();
    const rootId = c.req.query("root");
    let roots: RootEntry[];
    if (rootId) {
      const root = reg.roots.get(rootId);
      if (!root) return apiError(c, 404, "unknown_root");
      roots = [root];
    } else {
      roots = [...reg.roots.values()];
    }

    const results: Array<{ rootId: string; relPath: string; matches: { lineNumber: number; lineContent: string }[] }> = [];
    let matchCount = 0;
    let truncated = false;
    for (const root of roots) {
      if (results.length >= SEARCH_CAPS.maxFiles || matchCount >= SEARCH_CAPS.maxMatches) {
        truncated = true;
        break;
      }
      for (const r of await searchWorkspace(await docsFor(root), q)) {
        if (results.length >= SEARCH_CAPS.maxFiles || matchCount >= SEARCH_CAPS.maxMatches) {
          truncated = true;
          break;
        }
        results.push({ rootId: root.rootId, relPath: r.relPath, matches: r.matches });
        matchCount += r.matches.length;
      }
    }
    return c.json({ results, truncated });
  });
}
