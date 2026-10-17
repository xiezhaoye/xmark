/**
 * What the phone can show, by extension.
 *
 * Mirrors the desktop's supported-file list (`src-tauri/src/supported_files.rs`)
 * minus video and audio, which the read-only reader does not play. HTML is
 * listed as text: the phone shows its source, never renders it.
 *
 * @module fileKinds
 */
import * as path from "node:path";

export type FileKind = "markdown" | "text" | "image";

const MARKDOWN = ["md", "markdown", "mdown", "mkd", "mdx"];
const TEXT = [
  "txt", "json", "jsonl", "yaml", "yml", "toml", "mmd", "html", "htm",
  "ts", "tsx", "js", "jsx", "py", "rs", "go", "css", "sh", "bash", "rb", "lua",
];
const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  apng: "image/apng",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  jfif: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  ico: "image/x-icon",
  avif: "image/avif",
  heic: "image/heic",
  heif: "image/heif",
  tif: "image/tiff",
  tiff: "image/tiff",
  svg: "image/svg+xml",
};

function ext(name: string): string {
  return path.extname(name).slice(1).toLowerCase();
}

export function classifyFile(name: string): FileKind | null {
  const e = ext(name);
  if (!e) return null;
  if (MARKDOWN.includes(e)) return "markdown";
  if (TEXT.includes(e)) return "text";
  if (e in IMAGE_TYPES) return "image";
  return null;
}

export function imageContentType(name: string): string | null {
  return IMAGE_TYPES[ext(name)] ?? null;
}
