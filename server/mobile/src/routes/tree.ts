/**
 * `GET /api/tree?root&path` — one directory level, lazily.
 *
 * Folders first, then files, each in natural order (`note2` before
 * `note10`). Hidden entries, always-skipped folders, symlinks and files the
 * phone cannot show are left out — the same rules `/api/file` enforces.
 *
 * @module routes/tree
 */
import type { Hono } from "hono";
import { readdir, stat } from "node:fs/promises";
import * as path from "node:path";
import { ALWAYS_SKIP_DIRS } from "@content-server/index/walk";
import { classifyFile, type FileKind } from "../fileKinds";
import type { RegistrySource } from "../registry";
import { apiError, resolveTarget } from "./target";

interface TreeEntry {
  name: string;
  kind: "dir" | FileKind;
  relPath: string;
  size?: number;
  mtime?: number;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function registerTree(app: Hono, registry: RegistrySource): void {
  app.get("/api/tree", async (c) => {
    const target = await resolveTarget(c, registry);
    if (target instanceof Response) return target;
    if (!target.stats.isDirectory()) return apiError(c, 404, "not_found");

    const dirents = await readdir(target.abs, { withFileTypes: true });
    const dirs: TreeEntry[] = [];
    const files: TreeEntry[] = [];
    for (const d of dirents) {
      if (d.name.startsWith(".") || d.isSymbolicLink()) continue;
      const name = d.name.normalize("NFC");
      const relPath = target.rel ? `${target.rel}/${name}` : name;
      if (d.isDirectory()) {
        if (!ALWAYS_SKIP_DIRS.has(d.name)) dirs.push({ name, kind: "dir", relPath });
        continue;
      }
      const kind = d.isFile() ? classifyFile(d.name) : null;
      if (!kind) continue;
      try {
        const s = await stat(path.join(target.abs, d.name));
        files.push({ name, kind, relPath, size: s.size, mtime: Math.round(s.mtimeMs) });
      } catch {
        // Vanished between readdir and stat.
      }
    }
    const byName = (a: TreeEntry, b: TreeEntry) => collator.compare(a.name, b.name);
    return c.json({ path: target.rel, entries: [...dirs.sort(byName), ...files.sort(byName)] });
  });
}
