/**
 * Freezing the images a markdown note references, at share time.
 *
 * A share page has no session and no workspace, so a relative `![](pic.png)`
 * would be a broken image there. Only the images the note actually references
 * are copied into the snapshot — never a whole folder — and each is bounded
 * (count, per-file size, total) so a note referencing a hundred large photos
 * cannot turn a share into a transfer.
 *
 * The identity of a frozen asset is the *source reference* — the normalised
 * relative path the note wrote (`a/pic.png`), not its basename. Keying by
 * basename made `a/pic.png` and `b/pic.png` collide, so the second one was
 * skipped as "already frozen" while the first one's bytes rendered in both
 * places. Each reference instead gets its own flat, hashed file name
 * (`<12 hex>-pic.png`), and the map from reference to that name is what the
 * renderer consults.
 *
 * References are collected from the remark AST (inline *and* reference-style
 * images, at any nesting depth), never with a regular expression: `<a b.png>`
 * and `图形 (1).png` are ordinary markdown, and a fenced code block that
 * happens to contain `![x](y.png)` is not a reference at all.
 *
 * Limits, stated honestly: resolution stays inside the note's own directory
 * (a conservative reading of "the folder this note lives in"), so `../pic.png`
 * is never frozen; query strings and fragments are dropped before resolution;
 * nothing is fetched over the network; a file that is not a regular file, is
 * hidden, or is over the per-file or total ceiling is skipped; a reference
 * that cannot be resolved is left out, and the page shows its caption instead.
 *
 * @module shareAssets
 */
import { createHash } from "node:crypto";
import { open, realpath } from "node:fs/promises";
import { imageContentType } from "./fileKinds";
import { resolveInRoot, splitRelPath } from "./containment";
import type { ShareAssetInput } from "./shareStore";
import { imageUrls } from "./markdownImages";

export const MAX_ASSETS = 40;
export const MAX_ASSET_BYTES = 8 * 1024 * 1024;
export const MAX_ASSETS_TOTAL_BYTES = 24 * 1024 * 1024;

/** Longest path part of a source reference, in characters: a hard refusal, not a truncation. */
const MAX_REF_CHARS = 400;
/** How much of the base name the flat asset name keeps, so a snapshot stays readable. */
const MAX_BASE_CHARS = 120;
const HASH_CHARS = 12;

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * The normalised relative source reference for a markdown image URL, or null.
 *
 * `pic.png?v=2#top` → `pic.png`; `./sub//图形%20图.png` → `sub/图形 图.png`;
 * anything absolute, remote, `data:`, or escaping the note's folder is null.
 */
export function sourceRefFor(url: string): string | null {
  const trimmed = url.trim();
  if (trimmed === "" || trimmed.startsWith("/") || trimmed.startsWith("#")) return null;
  if (HAS_SCHEME.test(trimmed)) return null;
  const withoutQuery = trimmed.split("#")[0].split("?")[0];
  let decoded: string;
  try {
    decoded = decodeURIComponent(withoutQuery);
  } catch {
    return null;
  }
  const segments = splitRelPath(decoded);
  if (!segments || segments.length === 0) return null;
  const ref = segments.join("/").normalize("NFC");
  return ref.length > 0 && ref.length <= MAX_REF_CHARS ? ref : null;
}

/** A flat, collision-free asset file name for a source reference, or null. */
export function assetNameFor(url: string): string | null {
  const ref = sourceRefFor(url);
  if (!ref) return null;
  const base = ref.split("/").pop() ?? "";
  if (!base || base.length > 200) return null;
  const hash = createHash("sha256").update(ref).digest("hex").slice(0, HASH_CHARS);
  const stem = base.slice(0, MAX_BASE_CHARS);
  return `${hash}-${stem}`;
}

/** Local image references in document order, deduplicated and bounded. */
export function referencedImages(markdown: string): string[] {
  const found: string[] = [];
  for (const url of imageUrls(markdown)) {
    const ref = sourceRefFor(url);
    if (!ref || found.includes(ref)) continue;
    if (found.length >= MAX_ASSETS * 4) break;
    found.push(ref);
  }
  return found;
}

/** Read at most `max` bytes; null when the file is not a regular file, is bigger, or read fails. */
async function boundedRead(file: string, max: number): Promise<Buffer | null> {
  let handle;
  try {
    handle = await open(file, "r");
    const stats = await handle.stat();
    if (!stats.isFile() || stats.size > max) return null;
    const buffer = Buffer.allocUnsafe(max + 1);
    let total = 0;
    while (total <= max) {
      const { bytesRead } = await handle.read(buffer, total, max + 1 - total, total);
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    return total > max ? null : Buffer.from(buffer.subarray(0, total));
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => {});
  }
}

/** Copy the referenced local images, up to the bounds above. */
export async function freezeAssets({ dir, markdown }: { dir: string; markdown: string }): Promise<ShareAssetInput[]> {
  // Every reference is resolved inside the note's directory, following the
  // same containment rules as `/api/asset` (symlinks out of the folder stay out).
  const root = await realpath(dir).catch(() => null);
  if (!root) return [];
  const assets: ShareAssetInput[] = [];
  let total = 0;
  for (const ref of referencedImages(markdown)) {
    if (assets.length >= MAX_ASSETS || total >= MAX_ASSETS_TOTAL_BYTES) break;
    const name = assetNameFor(ref);
    const type = name ? imageContentType(name) : null;
    if (!name || !type || assets.some((a) => a.source === ref || a.name === name)) continue;
    const abs = await resolveInRoot(root, ref);
    if (!abs) continue;
    const bytes = await boundedRead(abs, MAX_ASSET_BYTES);
    if (!bytes || total + bytes.length > MAX_ASSETS_TOTAL_BYTES) continue;
    total += bytes.length;
    assets.push({ name, source: ref, bytes, contentType: type });
  }
  return assets;
}

/** A frozen-asset entry as the store records it; older snapshots carry only a name. */
interface FrozenEntry {
  name: string;
  source?: string;
}

/**
 * A resolver for the renderer: a reference becomes its public asset URL when
 * that exact reference — or, for a snapshot written before references were
 * recorded, that exact name — was frozen, and `null` (omit the image) otherwise.
 */
export function assetUrlFor(shareId: string, assets: readonly FrozenEntry[]): (url: string) => string | null {
  const bySource = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const asset of assets) {
    if (asset.source) bySource.set(asset.source, asset.name);
    byName.set(asset.name, asset.name);
  }
  const urlFor = (name: string) => `/s/${shareId}/assets/${encodeURIComponent(name)}`;
  return (url: string) => {
    const ref = sourceRefFor(url);
    if (!ref) return null;
    const byRef = bySource.get(ref);
    if (byRef) return urlFor(byRef);
    // Legacy entry: the reference *was* the flat name.
    const legacy = byName.get(ref);
    return legacy ? urlFor(legacy) : null;
  };
}
