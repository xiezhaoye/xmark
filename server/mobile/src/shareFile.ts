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
 * @module shareFile
 */
import * as path from "node:path";

const SHARE_FILE_VERSION = 1;

interface SharedGroup {
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
