/**
 * HTTP client for the Mac's mobile server.
 *
 * `fetch` is injected: the app passes Tauri's HTTP plugin (Rust networking,
 * no CORS, no ATS for plain HTTP inside Tailscale); tests pass a fake.
 * Every failure becomes an `ApiError` whose `code` is either the server's
 * error code or `network` / `timeout` / `unauthorized` / `http_<status>`.
 *
 * `download` and `createShare` are what sharing needs: the original bytes of
 * a file (never a cached copy — each call asks the Mac again) and a public
 * link to an immutable snapshot of it. Both share the GET helper's timeout,
 * token and error vocabulary; the POST helper is the same builder with a body.
 *
 * @module api/client
 */
import type { Connection, FileContent, SearchResult, TreeEntry, WorkspaceGroup } from "./types";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`${status} ${code}`);
    this.name = "ApiError";
  }
}

const DEFAULT_TIMEOUT_MS = 15_000;

/** What a share was made from; the bytes the Mac had saved at that moment. */
export interface DownloadedFile {
  bytes: Uint8Array;
  name: string;
  mimeType: string;
}

export function baseUrlFor({ host, port }: Pick<Connection, "host" | "port">): string {
  return `http://${host}:${port}`;
}

/** The last non-empty segment of a path, with any directory part removed. */
function lastSegment(path: string): string | null {
  const parts = path.split(/[/\\]/).filter((p) => p && p !== "." && p !== "..");
  return parts.length ? parts[parts.length - 1] : null;
}

/** A file name to send under when the server names none: safe, from the path. */
export function fallbackName(path: string): string {
  // A trailing slash names a folder, which no download has.
  if (/[/\\]$/.test(path)) return "download";
  return lastSegment(path) ?? "download";
}

/** The name in a `Content-Disposition`, preferring its RFC 5987 UTF-8 form. */
export function filenameFrom(disposition: string | null): string | null {
  if (!disposition) return null;
  const star = /filename\*\s*=\s*(?:utf-8|UTF-8)''([^;]+)/.exec(disposition);
  if (star) {
    try {
      const name = lastSegment(decodeURIComponent(star[1]));
      if (name) return name;
    } catch {
      // A broken escape is not a name; try the plain parameter below.
    }
  }
  const plain = /filename\s*=\s*"([^"]*)"/.exec(disposition) ?? /filename\s*=\s*([^;]+)/.exec(disposition);
  const name = plain ? lastSegment(plain[1].trim()) : null;
  return name || null;
}

export interface Client {
  health(): Promise<{ ok: boolean; version: string }>;
  workspaces(): Promise<{ groups: WorkspaceGroup[] }>;
  tree(rootId: string, path: string): Promise<{ path: string; entries: TreeEntry[] }>;
  file(rootId: string, path: string): Promise<FileContent>;
  asset(rootId: string, path: string): Promise<Blob>;
  search(q: string, rootId?: string): Promise<{ results: SearchResult[]; truncated: boolean }>;
  /** The file's original bytes as the Mac has them now. */
  download(rootId: string, path: string): Promise<DownloadedFile>;
  /** A public link to an immutable snapshot of the file's current bytes. */
  createShare(rootId: string, path: string): Promise<{ url: string }>;
}

export function createClient(conn: Connection, fetch: FetchLike, timeoutMs = DEFAULT_TIMEOUT_MS): Client {
  const base = baseUrlFor(conn);

  async function request(route: string, params: Record<string, string | undefined> = {}, init: { method?: string; json?: unknown } = {}): Promise<Response> {
    const query = Object.entries(params)
      .filter((e): e is [string, string] => e[1] !== undefined)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join("&");
    const url = `${base}${route}${query ? `?${query}` : ""}`;
    const headers: Record<string, string> = { Authorization: `Bearer ${conn.token}` };
    const body = init.json === undefined ? undefined : JSON.stringify(init.json);
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(url, { method: init.method ?? "GET", headers, body, signal: controller.signal });
    } catch {
      throw new ApiError(0, controller.signal.aborted ? "timeout" : "network");
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      let code = res.status === 401 ? "unauthorized" : `http_${res.status}`;
      try {
        const parsed = (await res.json()) as { error?: unknown };
        if (typeof parsed.error === "string") code = parsed.error;
      } catch {
        // No JSON body; keep the status-derived code.
      }
      throw new ApiError(res.status, code);
    }
    return res;
  }

  const getJson = async <T>(route: string, params?: Record<string, string | undefined>): Promise<T> =>
    (await (await request(route, params)).json()) as T;

  const postJson = async <T>(route: string, json: unknown): Promise<T> =>
    (await (await request(route, {}, { method: "POST", json })).json()) as T;

  return {
    health: () => getJson("/api/health"),
    workspaces: () => getJson("/api/workspaces"),
    tree: (root, path) => getJson("/api/tree", { root, path }),
    file: (root, path) => getJson("/api/file", { root, path }),
    asset: async (root, path) => (await request("/api/asset", { root, path })).blob(),
    search: (q, root) => getJson("/api/search", { q, root }),
    download: async (root, path) => {
      const res = await request("/api/download", { root, path });
      const bytes = new Uint8Array(await res.arrayBuffer());
      return {
        bytes,
        name: filenameFrom(res.headers.get("content-disposition")) ?? fallbackName(path),
        mimeType: res.headers.get("content-type") ?? "application/octet-stream",
      };
    },
    createShare: async (root, path) => {
      const body = await postJson<{ url?: unknown }>("/api/shares", { root, path });
      if (typeof body.url !== "string" || !body.url) throw new ApiError(0, "bad_response");
      return { url: body.url };
    },
  };
}
