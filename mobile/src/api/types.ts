/**
 * Wire types of the mobile server API (`server/mobile`).
 *
 * @module api/types
 */

export interface Connection {
  host: string;
  port: number;
  token: string;
  /**
   * Set when this "connection" is a folder on this phone rather than a Mac:
   * the absolute path the native picker returned. `host`/`port`/`token` are
   * then placeholders, and the client factory builds a local reader instead of
   * an HTTP one.
   */
  localPath?: string;
}

/** The longest server name accepted from a pairing link or typed in settings. */
export const PAIR_URL_NAME_MAX = 40;

/**
 * One paired Mac, as the phone remembers it. `id` is local to this phone:
 * generated here, never sent to the server. The Mac a profile points at is
 * identified by its `host` and `port`, which is what pairing against an
 * already-known Mac replaces.
 */
export interface ServerProfile {
  id: string;
  name: string;
  host: string;
  port: number;
  token: string;
  /** A folder on this phone, instead of a Mac. See `Connection.localPath`. */
  localPath?: string;
}

/**
 * The name a server gets when nothing names it: the machine part of its
 * Tailscale domain (`m4.tailc8e51.ts.net` → `m4`), or the address itself when
 * it is an IP.
 */
export function defaultServerName(host: string): string {
  if (/^[0-9.]+$/.test(host)) return host;
  return host.split(".")[0] || host;
}

/** The connection a profile stands for; what the HTTP client is built from. */
export const connectionOf = ({ host, port, token, localPath }: ServerProfile): Connection =>
  localPath ? { host, port, token, localPath } : { host, port, token };

/** Two profiles address the same Mac when their host and port match. */
export const sameServer = (
  a: Pick<ServerProfile, "host" | "port" | "localPath">,
  b: Pick<ServerProfile, "host" | "port" | "localPath">,
) =>
  // A local folder is identified by its path; every one of them shares the
  // placeholder host, so host/port alone would merge two folders into one.
  a.localPath || b.localPath
    ? a.localPath === b.localPath
    : a.host.toLowerCase() === b.host.toLowerCase() && a.port === b.port;

let idCounter = 0;

/** A fresh profile id: unique on this phone, so storage keys never collide. */
export function newServerId(): string {
  idCounter += 1;
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch {
    // Fall through to the counter form below.
  }
  return `s${Date.now().toString(36)}${idCounter.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

interface WorkspaceFolder {
  rootId: string;
  name: string;
  available: boolean;
}

export interface WorkspaceGroup {
  id: string;
  name: string;
  folders: WorkspaceFolder[];
}

/**
 * What a tree entry is. The server lists a PDF as `pdf`: it is not read as
 * text, it is shown from its own bytes (see `PdfView`) and shared as a file.
 */
type EntryKind = "dir" | "markdown" | "text" | "html" | "image" | "pdf";

export interface TreeEntry {
  name: string;
  kind: EntryKind;
  relPath: string;
  size?: number;
  mtime?: number;
}

export interface FileContent {
  text: string;
  kind: "markdown" | "text";
  size: number;
  mtime: number;
}

export interface SearchResult {
  rootId: string;
  relPath: string;
  matches: { lineNumber: number; lineContent: string }[];
}
