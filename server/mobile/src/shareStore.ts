/**
 * The immutable snapshot store: what a share link points at.
 *
 * A share is a directory of plain files under the app's data directory
 * (`mobile-server/shares/<id>/`), so it survives restarts and a reinstall of
 * the bundle:
 *
 *     <id>/original    the exact bytes captured at share time
 *     <id>/meta.json   {name, kind, contentType, size, createdAt, assets[]}
 *     <id>/assets/…    frozen preview images the markdown references
 *
 * `original` is copied once, under a temporary name in the same directory,
 * and published with `rename` — the public page never reads the workspace, so
 * editing or deleting the source file (or losing the volume) cannot change a
 * share. `rename` also makes the publish atomic: a share directory exists only
 * when it is complete, and a failure leaves nothing behind.
 *
 * Ids are 32 random bytes in hex (256 bits), created here and never derived
 * from a path. Every id is re-validated before it is used as a path segment,
 * long before `path.join`, and a directory that is a symlink is refused, so a
 * planted link cannot read outside the store.
 *
 * @module shareStore
 */
import { randomBytes } from "node:crypto";
import { chmod, lstat, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { classifyFile, contentTypeFor, imageContentType, type FileKind } from "./fileKinds";

export const SHARE_ID_PATTERN = /^[0-9a-f]{64}$/;

export interface ShareAssetInput {
  /** Flat file name inside `assets/`, derived from `source`. */
  name: string;
  /** Normalised relative reference in the note (`a/pic.png`); its identity. */
  source: string;
  bytes: Buffer;
  contentType: string;
}

export interface ShareAssetEntry {
  name: string;
  /** Present on snapshots written with reference-keyed assets; absent on older ones. */
  source?: string;
  contentType: string;
}

export interface ShareMeta {
  id: string;
  name: string;
  kind: FileKind;
  contentType: string;
  size: number;
  /** Epoch milliseconds; informational only — shares never expire. */
  createdAt: number;
  assets: ShareAssetEntry[];
}

export interface ShareInput {
  bytes: Buffer;
  name: string;
  kind: FileKind;
  assets?: ShareAssetInput[];
}

export interface ShareStore {
  save(input: ShareInput, id?: string): Promise<ShareMeta>;
  read(id: string): Promise<Buffer | null>;
  meta(id: string): Promise<ShareMeta | null>;
  readAsset(id: string, name: string): Promise<Buffer | null>;
}

export function isValidShareId(id: string): boolean {
  return SHARE_ID_PATTERN.test(id);
}

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: DIR_MODE });
  await chmod(dir, DIR_MODE);
}

/** A real directory, not a symlink planted where a share should be. */
async function isPlainDir(dir: string): Promise<boolean> {
  try {
    const stats = await lstat(dir);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

async function writePrivate(file: string, bytes: Buffer): Promise<void> {
  await writeFile(file, bytes, { mode: FILE_MODE });
  await chmod(file, FILE_MODE);
}

/**
 * Asset file names are flat: no separators, no dot segments, nothing hidden.
 * Checked before a write as well as before a read — an internal caller that
 * passed `../original` could otherwise overwrite a snapshot's own bytes.
 */
function isPlainAssetName(name: unknown): name is string {
  if (typeof name !== "string" || name.length === 0 || name.length > 255) return false;
  if (name.startsWith(".") || name.normalize("NFC") !== name) return false;
  // Separators, NUL and every other control character would escape the folder
  // or corrupt a header; a code-point test avoids a control-character regex.
  return ![...name].some((ch) => ch === "/" || ch === "\\" || ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f);
}

/** A file that is not an absolute path or a directory; used to read an asset entry. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * One recorded asset, or null when the entry cannot be trusted. A name that is
 * not a plain file name, or that claims a non-image type, is dropped rather
 * than allowed to reach a path join or a response header.
 */
function assetEntry(raw: unknown): ShareAssetEntry | null {
  if (!isRecord(raw) || !isPlainAssetName(raw.name)) return null;
  const declared = typeof raw.contentType === "string" && raw.contentType.startsWith("image/") ? raw.contentType : null;
  const contentType = declared ?? imageContentType(raw.name);
  if (!contentType) return null;
  const entry: ShareAssetEntry = { name: raw.name, contentType };
  if (typeof raw.source === "string" && raw.source.length > 0 && raw.source.length <= 400) entry.source = raw.source;
  return entry;
}

/**
 * Parse a stored meta.json into a `ShareMeta`, or null when it is not usable.
 *
 * Written once by `save`, but it lives in a user-writable data directory, so
 * every field is re-checked here: a damaged file must read as "unknown
 * snapshot", never as a thrown `TypeError` from a route.
 */
async function normaliseMeta(parsed: unknown, id: string, dir: string): Promise<ShareMeta | null> {
  if (!isRecord(parsed)) return null;
  const { name, kind } = parsed;
  if (typeof name !== "string" || name.length === 0) return null;
  if (typeof kind !== "string" || classifyFile(name) === null) return null;
  const rawAssets = Array.isArray(parsed.assets) ? parsed.assets : [];
  const assets = rawAssets.map(assetEntry).filter((a): a is ShareAssetEntry => a !== null);
  const size = typeof parsed.size === "number" && Number.isInteger(parsed.size) && parsed.size >= 0 ? parsed.size : 0;
  const createdAt = typeof parsed.createdAt === "number" ? parsed.createdAt : 0;
  const contentType = typeof parsed.contentType === "string" && parsed.contentType ? parsed.contentType : mimeForName(name);
  if (size === 0) {
    // A record written before size was stored: take it from the bytes on disk.
    const stats = await stat(path.join(dir, "original")).catch(() => null);
    if (stats?.isFile()) return { id, name, kind: kind as FileKind, contentType, size: stats.size, createdAt, assets };
  }
  return { id, name, kind: kind as FileKind, contentType, size, createdAt, assets };
}

/** The MIME a snapshot's bytes are served with, from its name. */
function mimeForName(name: string): string {
  return contentTypeFor(name) ?? "application/octet-stream";
}

function mimeFor(input: ShareInput): string {
  return mimeForName(input.name);
}

async function writeSnapshot(dir: string, input: ShareInput, id: string): Promise<ShareMeta> {
  const assets = input.assets ?? [];
  const seen = new Set<string>();
  for (const asset of assets) {
    if (!isPlainAssetName(asset.name)) throw new Error(`invalid asset name: ${JSON.stringify(asset.name)}`);
    if (seen.has(asset.name)) throw new Error(`duplicate asset name: ${asset.name}`);
    seen.add(asset.name);
    // Only an image may be copied into a snapshot; a record claiming otherwise
    // would serve bytes under a type the page never expected.
    if (!asset.contentType.startsWith("image/")) {
      throw new Error(`invalid asset content type: ${asset.contentType}`);
    }
  }
  await ensureDir(dir);
  await writePrivate(path.join(dir, "original"), input.bytes);
  if (assets.length > 0) {
    const assetDir = path.join(dir, "assets");
    await ensureDir(assetDir);
    for (const asset of assets) await writePrivate(path.join(assetDir, asset.name), asset.bytes);
  }
  const meta: ShareMeta = {
    id,
    name: input.name,
    kind: input.kind,
    contentType: mimeFor(input),
    size: input.bytes.length,
    createdAt: Date.now(),
    assets: assets.map(({ name, source, contentType }) => ({ name, source, contentType })),
  };
  await writePrivate(path.join(dir, "meta.json"), Buffer.from(`${JSON.stringify(meta, null, 2)}\n`));
  return meta;
}

export async function createShareStore(root: string): Promise<ShareStore> {
  await ensureDir(root);

  function dirFor(id: string): string | null {
    return isValidShareId(id) ? path.join(root, id) : null;
  }

  async function readMeta(id: string): Promise<ShareMeta | null> {
    const dir = dirFor(id);
    if (!dir || !(await isPlainDir(dir))) return null;
    try {
      const parsed: unknown = JSON.parse(await readFile(path.join(dir, "meta.json"), "utf8"));
      return await normaliseMeta(parsed, id, dir);
    } catch {
      return null;
    }
  }

  return {
    async save(input, id = randomBytes(32).toString("hex")) {
      const dir = dirFor(id);
      if (!dir) throw new Error("invalid share id");
      const staging = path.join(root, `.${id}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`);
      try {
        await ensureDir(staging);
        const meta = await writeSnapshot(staging, input, id);
        // `rename` fails when the target exists, so a repeated write can never
        // replace a published snapshot.
        await rename(staging, dir);
        return meta;
      } catch (err) {
        await rm(staging, { recursive: true, force: true });
        throw err;
      }
    },

    async read(id) {
      const dir = dirFor(id);
      if (!dir || !(await isPlainDir(dir))) return null;
      try {
        return await readFile(path.join(dir, "original"));
      } catch {
        return null;
      }
    },

    meta: readMeta,

    async readAsset(id, name) {
      if (!isPlainAssetName(name)) return null;
      const dir = dirFor(id);
      if (!dir || !(await isPlainDir(dir))) return null;
      const meta = await readMeta(id);
      // Only an asset recorded at save time is servable; anything else in the
      // directory stays private. `assets` is always an array (see normaliseMeta).
      if (!meta?.assets.some((a) => a.name === name)) return null;
      try {
        return await readFile(path.join(dir, "assets", name));
      } catch {
        return null;
      }
    },
  };
}
