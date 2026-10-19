/**
 * The desktop's remote-server client: one thin `invoke` per route of the
 * mobile server's read-only API, plus the error vocabulary both surfaces share.
 *
 * Purpose: the frontend must not `fetch` the server itself — the webview's CSP
 * forbids reaching an external origin — so every call is a Rust command
 * (`src-tauri/src/remote_server`). This module is the only place that names
 * those commands, and the only place that turns their rejections into the
 * message a user reads.
 *
 * The codes mirror `mobile/src/api/client.ts`: a rejection carries the server's
 * own `error` string when there is one, and one of `unauthorized` /
 * `http_<status>` / `network` / `timeout` when there is not. `describeRemoteFailure`
 * maps them to the keys of the `remoteServer` namespace.
 *
 * @coordinates-with src-tauri/src/remote_server/commands.rs — the commands
 * @coordinates-with pages/settings/ServersSettings.tsx — pairing + probing
 * @coordinates-with components/RemoteBrowser — the browsing UI
 * @module services/remoteServers/client
 */

import { invoke } from "@tauri-apps/api/core";
import { parseCommandError } from "@/services/commands/commandError";

export interface RemoteConnection {
  host: string;
  port: number;
  token: string;
}

export interface RemoteHealth {
  ok: boolean;
  version: string;
}

interface RemoteFolder {
  rootId: string;
  name: string;
  available: boolean;
}

export interface RemoteGroup {
  id: string;
  name: string;
  folders: RemoteFolder[];
}

/** What a tree entry is, as the server classifies it. Unknown kinds stay strings. */
type RemoteEntryKind = "dir" | "markdown" | "text" | "image" | (string & {});

export interface RemoteTreeEntry {
  name: string;
  kind: RemoteEntryKind;
  relPath: string;
  size?: number;
  mtime?: number;
}

export interface RemoteTree {
  path: string;
  entries: RemoteTreeEntry[];
}

export interface RemoteFile {
  text: string;
  kind: "markdown" | "text" | (string & {});
  size: number;
  mtime: number;
}

export interface RemoteAsset {
  contentType: string;
  bytes: number[] | Uint8Array;
  etag?: string;
}

const conn = (c: RemoteConnection) => ({ conn: { host: c.host, port: c.port, token: c.token } });

/** `/api/health` — also the pairing check: it fails when the token is wrong. */
export async function remoteHealth(c: RemoteConnection): Promise<RemoteHealth> {
  return invoke<RemoteHealth>("remote_health", conn(c));
}

export async function remoteWorkspaces(c: RemoteConnection): Promise<RemoteGroup[]> {
  const reply = await invoke<{ groups: RemoteGroup[] }>("remote_workspaces", conn(c));
  return reply.groups;
}

export async function remoteTree(
  c: RemoteConnection,
  rootId: string,
  path: string,
): Promise<RemoteTree> {
  return invoke<RemoteTree>("remote_tree", { ...conn(c), rootId, path });
}

export async function remoteFile(
  c: RemoteConnection,
  rootId: string,
  path: string,
): Promise<RemoteFile> {
  return invoke<RemoteFile>("remote_file", { ...conn(c), rootId, path });
}

export async function remoteAsset(
  c: RemoteConnection,
  rootId: string,
  path: string,
): Promise<RemoteAsset> {
  return invoke<RemoteAsset>("remote_asset", { ...conn(c), rootId, path });
}

/** The failure classes the UI branches on (the phone client's own vocabulary). */
export type RemoteFailureCode =
  | "network"
  | "timeout"
  | "unauthorized"
  | "http"
  | "tooLarge"
  | "hostRejected"
  | "badAddress"
  | "server"
  | "unknown";

/**
 * Classify a rejection.
 *
 * Rust's `CommandError` is the primary shape: its `code` separates timeout,
 * network, 401 and a refusal, and `detail.remoteError` carries the SERVER's own
 * error string (`not_found`, `unsupported_kind`, `too_large`, …) which is what
 * the phone shows when it has nothing better.
 */
export function classifyRemoteFailure(error: unknown): RemoteFailureCode {
  const parsed = parseCommandError(error);
  if (!parsed) return "unknown";
  switch (parsed.code) {
    case "timeout":
      return "timeout";
    case "network":
      return parsed.detail?.status === undefined ? "network" : "http";
    case "unauthorized":
      return "unauthorized";
    case "permission-denied":
      return "hostRejected";
    case "invalid-input":
      return detailIsTooLarge(error) ? "tooLarge" : "badAddress";
    default:
      return "server";
  }
}

function detailIsTooLarge(error: unknown): boolean {
  const parsed = parseCommandError(error);
  return parsed?.i18nKey === "errors.remoteServer.tooLarge";
}

/**
 * The translation key for a failure, in the `remoteServer` namespace. `server`
 * and `unknown` fall back to the generic "could not reach" line: a named
 * server error means nothing to a user who did not write the server.
 */
export function remoteFailureKey(code: RemoteFailureCode): string {
  switch (code) {
    case "network":
      return "servers.error.network";
    case "timeout":
      return "servers.error.timeout";
    case "unauthorized":
      return "servers.error.unauthorized";
    case "http":
      return "servers.error.http";
    case "tooLarge":
      return "servers.error.tooLarge";
    case "hostRejected":
      return "servers.error.hostRejected";
    case "badAddress":
      return "servers.error.badAddress";
    default:
      return "servers.error.network";
  }
}

/**
 * The status code a refusal carries (`detail.status`, set by Rust's `refusal`),
 * or `undefined` for a failure that has none (timeout, unreachable, 401.
 * `null`/a non-integer never reaches the UI as `[object Object]` or `NaN`).
 */
function remoteFailureStatus(error: unknown): number | undefined {
  const status = parseCommandError(error)?.detail?.status;
  return typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599
    ? status
    : undefined;
}

/**
 * The interpolation values for `remoteFailureKey(code)`'s translation. Today
 * only `http` has any: the panel shows the server's status (`(502)`) so a
 * refusal points at the proxy or the server that produced it.
 */
export function remoteFailureParams(error: unknown): { status: number } | undefined {
  const status = remoteFailureStatus(error);
  return status === undefined ? undefined : { status };
}
