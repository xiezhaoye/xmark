/**
 * Identity helpers for a remote server: the default name a server gets when
 * nothing names it, and whether two servers address the same Mac.
 *
 * @coordinates-with stores/remoteServersStore.ts — add-or-update uses `sameServer`
 * @coordinates-with pages/settings/ServersSettings.tsx — the display name
 * @module services/remoteServers/serverIdentity
 */

/** An IPv4 literal (the only literal form the pairing link can carry). */
const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/**
 * The name a server gets when the user names it nothing: the first label of its
 * domain (`m4.tailc8e51.ts.net` → `m4`), or the address itself when it is an
 * IP — the phone app's rule, so the same Mac reads the same on both devices.
 */
export function defaultServerName(host: string): string {
  const trimmed = host.trim();
  if (trimmed === "") return "";
  if (IPV4_RE.test(trimmed)) return trimmed;
  return trimmed.split(".")[0] || trimmed;
}

/** Two entries address the same Mac when their host (case-insensitive) and port match. */
export function sameServer(
  a: { host: string; port: number },
  b: { host: string; port: number },
): boolean {
  return a.host.trim().toLowerCase() === b.host.trim().toLowerCase() && a.port === b.port;
}

/**
 * `host:port`, with zero-width break opportunities after each dot so a long
 * Tailscale name wraps instead of splitting its port.
 */
export function addressParts(host: string, port: number): { segments: string[]; port: string } {
  const labels = host.split(".");
  return { segments: labels, port: `:${port}` };
}
