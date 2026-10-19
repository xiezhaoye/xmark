/**
 * The desktop → mobile share file: which workspace groups the phone may see.
 *
 * XMark desktop writes `mobile-share.json` whenever its workspace groups
 * change. Shape (version 1):
 *
 *     { "version": 1, "groups": [{ "id": "…", "name": "…", "folders": ["/abs/path"] }] }
 *
 * Parsing is lenient per entry (a bad group or folder is dropped) and strict
 * at the top (an unknown version or missing `groups` is an error), so a newer
 * desktop never gets half-understood by an older server.
 *
 * `share add` / `share remove` write the same format back. They refuse to
 * touch a file that does not parse, and write atomically (temp file + rename,
 * 0600) so a running server never reads a half-written file.
 *
 * @module shareFile
 */
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import * as path from "node:path";

const SHARE_FILE_VERSION = 1;

/** The file is user-private: it lists personal absolute paths. */
const SHARE_FILE_MODE = 0o600;

export interface SharedGroup {
  id: string;
  name: string;
  folders: string[];
}

export interface ShareFile {
  groups: SharedGroup[];
}

function isUsableFolder(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !value.includes("\0") && path.isAbsolute(value);
}

export function parseShareFile(raw: unknown): ShareFile {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("share file is not an object");
  const obj = raw as Record<string, unknown>;
  if (obj.version !== SHARE_FILE_VERSION) throw new Error(`unsupported share file version ${String(obj.version)}`);
  if (!Array.isArray(obj.groups)) throw new Error("share file has no groups");

  const groups: SharedGroup[] = [];
  for (const entry of obj.groups) {
    if (!entry || typeof entry !== "object") continue;
    const g = entry as Record<string, unknown>;
    if (typeof g.id !== "string" || typeof g.name !== "string") continue;
    const folders = Array.isArray(g.folders) ? [...new Set(g.folders.filter(isUsableFolder))] : [];
    groups.push({ id: g.id, name: g.name, folders });
  }
  return { groups };
}

/** Serialise back to the on-disk format the desktop app writes. */
export function serializeShareFile(share: ShareFile): string {
  const groups = share.groups.map((g) => ({ id: g.id, name: g.name, folders: [...g.folders] }));
  return `${JSON.stringify({ version: SHARE_FILE_VERSION, groups }, null, 2)}\n`;
}

/**
 * Read and parse the share file. A missing file is an empty list; a file that
 * exists but does not parse is an error, never silently replaced.
 */
export async function readShareFile(file: string): Promise<ShareFile> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { groups: [] };
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${file} is not valid JSON; fix or remove it before changing shared folders`);
  }
  try {
    return parseShareFile(parsed);
  } catch (err) {
    const reason = (err as Error).message;
    throw new Error(`${file} is corrupt (${reason}); fix or remove it before changing shared folders`, { cause: err });
  }
}

/** Write the share file atomically: a temp file in the same directory, then a rename. */
export async function writeShareFile(file: string, share: ShareFile): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, serializeShareFile(share), { mode: SHARE_FILE_MODE });
  await chmod(tmp, SHARE_FILE_MODE);
  await rename(tmp, file);
}
