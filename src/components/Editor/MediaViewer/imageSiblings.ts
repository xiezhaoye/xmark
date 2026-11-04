/**
 * The images that sit beside one image, for ← / → inside an image tab.
 *
 * Purpose: an image tab shows ONE file, but a folder of photos is read by
 * walking it. Reading the containing directory here — rather than asking the
 * sidebar's tree — keeps the tab independent of whether the sidebar is open,
 * which tree it is showing, or whether the file arrived from Finder.
 *
 * Only the directory's own files are listed (no recursion), in name order; a
 * read that fails (permission, removed folder) yields an empty list, and the
 * caller then simply shows no arrows.
 *
 * @module components/Editor/MediaViewer/imageSiblings
 */
import { readDir } from "@tauri-apps/plugin-fs";
import { getMediaType } from "@/utils/mediaPathDetection";

/** Separator-agnostic split: Windows paths reach the same code. */
export function parentDirectory(path: string): string {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (cut > 0) return path.slice(0, cut);
  // A file at the root keeps "/" (or the Windows drive's separator) as its parent.
  if (cut === 0) return path.slice(0, 1);
  return "";
}

function nameOf(path: string): string {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return cut >= 0 ? path.slice(cut + 1) : path;
}

/** True for paths MediaView renders as a picture (audio/video are not siblings). */
export function isImagePath(path: string): boolean {
  const media = getMediaType(path);
  return media === "image" || /\.svg$/i.test(path);
}

/**
 * Every image in `path`'s directory, absolute and in name order — including
 * `path` itself, so the caller can find its own index.
 */
export async function imageSiblings(path: string): Promise<string[]> {
  const dir = parentDirectory(path);
  try {
    const entries = await readDir(dir);
    const sep = path.includes("\\") && !path.includes("/") ? "\\" : "/";
    const names = entries
      .filter((entry) => entry.isFile !== false && isImagePath(entry.name))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
    const siblings = names.map((name) => `${dir}${sep}${name}`);
    // A directory read that missed the file we are showing (a symlink, a filter
    // difference) must not lose it: the tab keeps its own path at least.
    return siblings.includes(path) ? siblings : [path, ...siblings];
  } catch {
    return [path];
  }
}

/** The path `offset` steps from `current` in `siblings`, clamped at both ends. */
export function stepSibling(siblings: string[], current: string, offset: -1 | 1): string | null {
  if (siblings.length < 2) return null;
  const index = siblings.indexOf(current);
  if (index < 0) return null;
  return siblings[index + offset] ?? null;
}

export { nameOf as fileNameOf };
