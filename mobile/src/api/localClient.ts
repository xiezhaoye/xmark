/**
 * The reader's client, over a folder on this phone instead of a Mac.
 *
 * Same interface as the HTTP client (`Client`), so the tree, the preview, the
 * image viewer and the share sheet all work unchanged: they ask for a listing,
 * a document or bytes, and never learn whether the answer came over Tailscale
 * or from the phone's own storage. The native half (plugins/localfs) holds the
 * security scope; this module only maps its answers onto the wire types.
 *
 * Deliberate omissions:
 *   - `search` returns nothing. Full-text search lives on the server, which
 *     walks the whole shared tree; a phone doing the same would have to read
 *     every file.
 *   - `createShare` refuses. A public link is a server-side snapshot of bytes
 *     the Mac holds; there is no server in this path.
 *
 * @module api/localClient
 */
import { ApiError, type Client } from "./client";
import type { FileContent, TreeEntry, WorkspaceGroup } from "./types";
import {
  listLocalFolder,
  readLocalBytesBase64,
  readLocalText,
  type LocalEntry,
} from "../platformLocalFS";

const MARKDOWN = new Set(["md", "markdown", "mdown", "mkd", "mdx"]);
const HTML = new Set(["html", "htm"]);
const TEXT = new Set([
  "txt", "json", "jsonl", "yaml", "yml", "toml", "mmd",
  "ts", "tsx", "js", "jsx", "py", "rs", "go", "css", "sh", "bash", "rb", "lua",
]);
const IMAGE = new Set([
  "png", "apng", "jpg", "jpeg", "jfif", "gif", "webp", "bmp",
  "ico", "avif", "heic", "heif", "tif", "tiff", "svg",
]);

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
}

/** What the reader shows a file as — mirroring the server's classification. */
function kindOf(name: string): TreeEntry["kind"] {
  const ext = extensionOf(name);
  if (MARKDOWN.has(ext)) return "markdown";
  if (HTML.has(ext)) return "html";
  if (TEXT.has(ext)) return "text";
  if (IMAGE.has(ext)) return "image";
  if (ext === "pdf") return "pdf";
  return "text";
}

function toEntry(e: LocalEntry): TreeEntry {
  return e.isDir
    ? { name: e.name, kind: "dir", relPath: e.relPath, size: e.size, mtime: e.mtime }
    : { name: e.name, kind: kindOf(e.name), relPath: e.relPath, size: e.size, mtime: e.mtime };
}

/** Bytes with an `ArrayBuffer` (not `SharedArrayBuffer`) behind them, which is
 * what `Blob` and the download type require. */
function bytesFromBase64(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const buffer = new ArrayBuffer(binary.length);
  const out = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function mimeOf(name: string): string {
  const ext = extensionOf(name);
  if (ext === "pdf") return "application/pdf";
  if (IMAGE.has(ext)) return `image/${ext === "jpg" ? "jpeg" : ext}`;
  if (MARKDOWN.has(ext)) return "text/markdown";
  if (HTML.has(ext)) return "text/html";
  return "text/plain";
}

/**
 * A client over one local folder. `rootId` is the folder's absolute path, so
 * every tree/document request carries the root it belongs to and nothing has
 * to be remembered here.
 */
export function createLocalClient(folder: { path: string; name: string }): Client {
  return {
    async health() {
      // A green dot must mean "this folder still opens", so ask the file
      // system rather than answering from faith: a folder deleted or moved in
      // Files.app should read as offline before the tree fails.
      await listLocalFolder(folder.path);
      return { ok: true, version: "local" };
    },

    async workspaces(): Promise<{ groups: WorkspaceGroup[] }> {
      return {
        groups: [
          {
            id: "local",
            name: folder.name,
            folders: [{ rootId: folder.path, name: folder.name, available: true }],
          },
        ],
      };
    },

    async tree(rootId, path) {
      // `path` is "" for the root level, an absolute path for anything below.
      const dir = path || rootId;
      const entries = await listLocalFolder(dir);
      return { path, entries: entries.map(toEntry) };
    },

    async file(_rootId, path): Promise<FileContent> {
      const text = await readLocalText(path);
      const name = path.slice(path.lastIndexOf("/") + 1);
      return { text, kind: MARKDOWN.has(extensionOf(name)) ? "markdown" : "text", size: text.length, mtime: 0 };
    },

    async asset(_rootId, path) {
      const bytes = bytesFromBase64(await readLocalBytesBase64(path));
      return new Blob([bytes], { type: mimeOf(path) });
    },

    async search() {
      return { results: [], truncated: false };
    },

    async download(_rootId, path) {
      const bytes = bytesFromBase64(await readLocalBytesBase64(path));
      const name = path.slice(path.lastIndexOf("/") + 1);
      return { bytes, name, mimeType: mimeOf(name) };
    },

    async createShare() {
      throw new ApiError(0, "unsupported");
    },
  };
}
