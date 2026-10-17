/**
 * Root registry: the shared folders, resolved, with opaque ids.
 *
 * The phone addresses a folder only by `rootId` — a hash of its real path —
 * so absolute paths never leave the Mac. Only folders that resolve to an
 * existing directory are servable; the rest are listed as unavailable so the
 * phone can show them greyed out.
 *
 * @module registry
 */
import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import * as path from "node:path";
import { parseShareFile, type ShareFile } from "./shareFile";

export interface RootEntry {
  rootId: string;
  name: string;
  /** Real (symlink-resolved) path; never sent to the phone. */
  absPath: string;
  available: boolean;
}

interface RegistryGroup {
  id: string;
  name: string;
  folders: RootEntry[];
}

export interface Registry {
  groups: RegistryGroup[];
  /** Available roots only, by id. */
  roots: Map<string, RootEntry>;
}

const EMPTY: ShareFile = { groups: [] };

function rootIdFor(p: string): string {
  return createHash("sha256").update(p).digest("hex").slice(0, 16);
}

async function resolveRoot(folder: string): Promise<RootEntry> {
  const name = path.basename(folder).normalize("NFC");
  try {
    const real = await realpath(folder);
    const available = (await stat(real)).isDirectory();
    return { rootId: rootIdFor(real), name, absPath: real, available };
  } catch {
    return { rootId: rootIdFor(folder), name, absPath: folder, available: false };
  }
}

async function readShare(file: string): Promise<ShareFile> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return EMPTY;
    throw err;
  }
  return parseShareFile(JSON.parse(text));
}

async function buildRegistry(share: ShareFile): Promise<Registry> {
  const roots = new Map<string, RootEntry>();
  const groups: RegistryGroup[] = [];
  for (const g of share.groups) {
    const folders = await Promise.all(g.folders.map(resolveRoot));
    for (const f of folders) if (f.available) roots.set(f.rootId, f);
    groups.push({ id: g.id, name: g.name, folders });
  }
  return { groups, roots };
}

export async function loadRegistry(shareFile: string): Promise<Registry> {
  return buildRegistry(await readShare(shareFile));
}

/** The `/api/workspaces` payload: everything but the paths. */
export function publicWorkspaces(reg: Registry) {
  return {
    groups: reg.groups.map((g) => ({
      id: g.id,
      name: g.name,
      folders: g.folders.map(({ rootId, name, available }) => ({ rootId, name, available })),
    })),
  };
}

export interface RegistrySource {
  current(): Promise<Registry>;
}

/**
 * A registry that follows the share file. Re-parses when the file's mtime
 * changes and re-resolves folders at most every `rescanMs` (a volume can be
 * mounted or a folder created without the share file changing). A corrupt
 * file keeps the last good registry and is reported once per change.
 */
export async function createRegistrySource(
  shareFile: string,
  onError: (message: string) => void = () => {},
  rescanMs = 5_000,
): Promise<RegistrySource> {
  let share: ShareFile = EMPTY;
  let mtimeMs: number | null = null;
  let registry: Registry = await buildRegistry(EMPTY);
  let builtAt = 0;

  async function refresh(): Promise<void> {
    let now: number | null;
    try {
      now = (await stat(shareFile)).mtimeMs;
    } catch {
      now = null;
    }
    const changed = now !== mtimeMs;
    if (changed) {
      mtimeMs = now;
      try {
        share = await readShare(shareFile);
      } catch (err) {
        onError(`Ignoring unreadable share file ${shareFile}: ${(err as Error).message}`);
        return;
      }
    }
    if (changed || Date.now() - builtAt >= rescanMs) {
      registry = await buildRegistry(share);
      builtAt = Date.now();
    }
  }

  await refresh();
  return {
    async current() {
      await refresh();
      return registry;
    },
  };
}
