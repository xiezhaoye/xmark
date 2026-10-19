/**
 * The `share` command: edit the share file from the command line.
 *
 * On a Mac the desktop app owns `mobile-share.json`; on a Linux box with no
 * desktop app nothing else can add folders, so this command edits the same
 * file directly. It deliberately keeps the format write-for-write identical
 * to the desktop app's and re-reads before every change, because a running
 * server hot-reloads the file by mtime — no restart is needed.
 *
 * @module shareCli
 */
import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import { readShareFile, writeShareFile, type SharedGroup, type ShareFile } from "./shareFile";

export interface ShareCommandDeps {
  /** Absolute path of the share file. */
  shareFile: string;
  stdout: (s: string) => void;
  stderr: (s: string) => void;
}

const USAGE = `Usage: xmark-mobile-server share <list|add|remove> [...]

  share list                      Show the shared groups and their folders
  share add <group> <path>        Share the existing directory <path> (absolute) in <group>
  share remove <group> [path]     Stop sharing one folder, or the whole group when <path> is omitted

Edits the share file (mobile-share.json) directly, for machines without the
XMark desktop app. Do not use it on a machine where the desktop app runs:
both write the same file and the last write wins.
`;

/** A stable, readable id for a group name; never derived from the folder list. */
export function groupIdFor(name: string, taken: Iterable<string>): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const base = slug || `g-${createHash("sha256").update(name).digest("hex").slice(0, 8)}`;
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

function findGroup(share: ShareFile, name: string): SharedGroup | undefined {
  return share.groups.find((g) => g.name === name);
}

/** Trailing separators never distinguish two folders; compare without them. */
function normalizeFolder(p: string): string {
  const trimmed = p.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

function printShare(share: ShareFile, deps: ShareCommandDeps): void {
  if (share.groups.length === 0) {
    deps.stdout("No shared folders yet. Add one with `xmark-mobile-server share add <group> <path>`.\n");
    return;
  }
  for (const group of share.groups) {
    deps.stdout(`${group.name}\n`);
    if (group.folders.length === 0) deps.stdout("  (no folders)\n");
    for (const folder of group.folders) deps.stdout(`  ${folder}\n`);
  }
}

async function list(_argv: string[], deps: ShareCommandDeps): Promise<number> {
  printShare(await readShareFile(deps.shareFile), deps);
  return 0;
}

async function add(argv: string[], deps: ShareCommandDeps): Promise<number> {
  const [name, folder] = argv;
  if (!name || !folder || argv.length > 2) {
    deps.stderr(`Usage: xmark-mobile-server share add <group> <path>\n`);
    return 2;
  }
  if (!folder.startsWith("/")) {
    deps.stderr(`${folder} is not an absolute path.\n`);
    return 1;
  }
  const target = normalizeFolder(folder);
  const info = await stat(target).catch(() => null);
  if (!info?.isDirectory()) {
    deps.stderr(`${folder} is not an existing directory.\n`);
    return 1;
  }

  const share = await readShareFile(deps.shareFile);
  const existing = findGroup(share, name);
  if (existing?.folders.some((f) => normalizeFolder(f) === target)) {
    deps.stdout(`${target} is already shared in ${name}.\n`);
    return 0;
  }
  if (existing) {
    existing.folders.push(target);
  } else {
    const group = { id: groupIdFor(name, share.groups.map((g) => g.id)), name, folders: [target] };
    share.groups.push(group);
  }
  await writeShareFile(deps.shareFile, share);
  deps.stdout(`Sharing ${target} in ${name}.\n`);
  return 0;
}

async function remove(argv: string[], deps: ShareCommandDeps): Promise<number> {
  const [name, folder] = argv;
  if (!name || argv.length > 2) {
    deps.stderr(`Usage: xmark-mobile-server share remove <group> [path]\n`);
    return 2;
  }

  const share = await readShareFile(deps.shareFile);
  const group = findGroup(share, name);
  if (!group) {
    deps.stderr(`No group named ${JSON.stringify(name)}.\n`);
    return 1;
  }

  if (folder === undefined) {
    share.groups = share.groups.filter((g) => g !== group);
    await writeShareFile(deps.shareFile, share);
    deps.stdout(`Removed group ${group.name}.\n`);
    return 0;
  }

  const target = normalizeFolder(folder);
  const kept = group.folders.filter((f) => normalizeFolder(f) !== target);
  if (kept.length === group.folders.length) {
    deps.stderr(`${folder} is not shared in ${group.name}.\n`);
    return 1;
  }
  group.folders = kept;
  // An empty group would show up in the phone's list as an empty workspace.
  if (kept.length === 0) share.groups = share.groups.filter((g) => g !== group);
  await writeShareFile(deps.shareFile, share);
  deps.stdout(`Stopped sharing ${target} in ${group.name}.\n`);
  return 0;
}

const SUBCOMMANDS: Record<string, (argv: string[], deps: ShareCommandDeps) => Promise<number>> = {
  list,
  add,
  remove,
};

export async function runShareCommand(argv: string[], deps: ShareCommandDeps): Promise<number> {
  const name = argv[0];
  if (name === undefined || name === "help" || name === "--help" || name === "-h") {
    deps.stdout(USAGE);
    return 0;
  }
  const sub = SUBCOMMANDS[name];
  if (!sub) {
    deps.stderr(`Unknown share command ${JSON.stringify(name)}\n\n${USAGE}`);
    return 2;
  }
  try {
    return await sub(argv.slice(1), deps);
  } catch (err) {
    deps.stderr(`${(err as Error).message}\n`);
    return 1;
  }
}
