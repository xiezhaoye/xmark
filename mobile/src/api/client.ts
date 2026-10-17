/**
 * HTTP client for the Mac's mobile server.
 *
 * `fetch` is injected: the app passes Tauri's HTTP plugin (Rust networking,
 * no CORS, no ATS for plain HTTP inside Tailscale); tests pass a fake.
 * Every failure becomes an `ApiError` whose `code` is either the server's
 * error code or `network` / `timeout` / `unauthorized` / `http_<status>`.
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

export function baseUrlFor({ host, port }: Pick<Connection, "host" | "port">): string {
  return `http://${host}:${port}`;
}

export interface Client {
  health(): Promise<{ ok: boolean; version: string }>;
  workspaces(): Promise<{ groups: WorkspaceGroup[] }>;
  tree(rootId: string, path: string): Promise<{ path: string; entries: TreeEntry[] }>;
  file(rootId: string, path: string): Promise<FileContent>;
  asset(rootId: string, path: string): Promise<Blob>;
  search(q: string, rootId?: string): Promise<{ results: SearchResult[]; truncated: boolean }>;
}

export function createClient(conn: Connection, fetch: FetchLike, timeoutMs = DEFAULT_TIMEOUT_MS): Client {
  const base = baseUrlFor(conn);

  async function request(route: string, params: Record<string, string | undefined> = {}): Promise<Response> {
    const query = Object.entries(params)
      .filter((e): e is [string, string] => e[1] !== undefined)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join("&");
    const url = `${base}${route}${query ? `?${query}` : ""}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(url, { headers: { Authorization: `Bearer ${conn.token}` }, signal: controller.signal });
    } catch {
      throw new ApiError(0, controller.signal.aborted ? "timeout" : "network");
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      let code = res.status === 401 ? "unauthorized" : `http_${res.status}`;
      try {
        const body = (await res.json()) as { error?: unknown };
        if (typeof body.error === "string") code = body.error;
      } catch {
        // No JSON body; keep the status-derived code.
      }
      throw new ApiError(res.status, code);
    }
    return res;
  }

  const getJson = async <T>(route: string, params?: Record<string, string | undefined>): Promise<T> =>
    (await (await request(route, params)).json()) as T;

  return {
    health: () => getJson("/api/health"),
    workspaces: () => getJson("/api/workspaces"),
    tree: (root, path) => getJson("/api/tree", { root, path }),
    file: (root, path) => getJson("/api/file", { root, path }),
    asset: async (root, path) => (await request("/api/asset", { root, path })).blob(),
    search: (q, root) => getJson("/api/search", { q, root }),
  };
}
