/**
 * What the phone can show, by extension.
 *
 * Mirrors the desktop's supported-file list (`src-tauri/src/supported_files.rs`)
 * minus video and audio, which the read-only reader does not play. HTML is its
 * own kind: the phone shows escaped source, the public page frames a
 * scriptless preview, and both download the bytes unchanged.
 *
 * PDF and HTML are preview kinds of their own: the reader shows a browser
 * preview link, and the public snapshot page embeds them through
 * `/s/:id/preview`. `contentTypeFor` is the one place a served byte stream
 * gets its MIME, so download, preview and metadata cannot disagree.
 *
 * @module fileKinds
 */
import * as path from "node:path";

export type FileKind = "markdown" | "text" | "image" | "pdf" | "html";

const MARKDOWN = ["md", "markdown", "mdown", "mkd", "mdx"];
const HTML = ["html", "htm"];
const TEXT = [
  "txt", "json", "jsonl", "yaml", "yml", "toml", "mmd",
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

const TEXT_TYPES: Record<string, string> = {
  markdown: "text/markdown; charset=utf-8",
  text: "text/plain; charset=utf-8",
  html: "text/html; charset=utf-8",
};

function ext(name: string): string {
  return path.extname(name).slice(1).toLowerCase();
}

export function classifyFile(name: string): FileKind | null {
  const e = ext(name);
  if (!e) return null;
  if (MARKDOWN.includes(e)) return "markdown";
  if (HTML.includes(e)) return "html";
  if (TEXT.includes(e)) return "text";
  if (e in IMAGE_TYPES) return "image";
  if (e === "pdf") return "pdf";
  return null;
}

/**
 * The MIME a *download* is served with. Text-like kinds are always UTF-8: an
 * HTML file is served as `text/plain` so a browser never runs it — the live
 * `text/html` type exists only on the sandboxed preview route.
 */
export function contentTypeFor(name: string): string | null {
  const kind = classifyFile(name);
  if (!kind) return null;
  if (kind === "pdf") return "application/pdf";
  if (kind === "image") return imageContentType(name);
  if (kind === "html") return TEXT_TYPES.text;
  return TEXT_TYPES[kind];
}

/** The MIME an *inline preview* is served with; only a PDF is ever live markup. */
export function previewContentTypeFor(name: string): string | null {
  const kind = classifyFile(name);
  if (!kind) return null;
  return kind === "html" ? TEXT_TYPES.html : contentTypeFor(name);
}

/** True for the kinds the reader can show without handing bytes to the browser. */
export function isPreviewable(name: string): boolean {
  return classifyFile(name) !== null;
}

export function imageContentType(name: string): string | null {
  return IMAGE_TYPES[ext(name)] ?? null;
}

/**
 * `Content-Disposition` for a file, with an RFC 5987 `filename*` for names
 * outside ASCII (Chinese, emoji) and an ASCII `filename` fallback for old
 * clients. Control characters and path separators never reach the header.
 */
export function contentDisposition(name: string, disposition: "attachment" | "inline" = "attachment"): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  const cleaned = stripControl(base).normalize("NFC") || "file";
  const fallback = cleaned.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "_");
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encodeRFC5987(cleaned)}`;
}

/** Drop C0 controls and DEL, which a header value must never carry. */
function stripControl(value: string): string {
  return [...value].filter((ch) => ch.charCodeAt(0) > 0x1f && ch.charCodeAt(0) !== 0x7f).join("");
}

/** Percent-encode UTF-8 for `filename*` (RFC 5987 attr-char set, everything else escaped). */
function encodeRFC5987(value: string): string {
  return encodeURIComponent(value).replace(/['()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
}
