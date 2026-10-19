/**
 * Pairing-link parsing for the desktop's remote servers.
 *
 * Purpose: the desktop accepts the SAME link `xmark-mobile-server pair` prints
 * (`xmark-mobile://pair?host=…&port=…&token=…[&name=…]`), so the two clients
 * cannot disagree about what a valid link is. This is the desktop's own copy —
 * the mobile app is a separate package and is not imported from here — and it
 * keeps the phone's rules exactly: host `^[A-Za-z0-9.-]+$`, port 1–65535,
 * token 64 lowercase hex characters, optional name trimmed to 40 characters.
 *
 * @coordinates-with stores/remoteServersStore.ts — what the page saves
 * @coordinates-with mobile/src/pairing/parsePairUrl.ts — the phone's twin
 * @module services/remoteServers/parsePairLink
 */

/** The longest server name accepted from a pairing link or typed in settings. */
export const PAIR_LINK_NAME_MAX = 40;

/** One server as a link describes it. */
interface PairLinkConnection {
  host: string;
  port: number;
  token: string;
}

export interface ParsedPairLink {
  connection: PairLinkConnection;
  /** The link's `name`, trimmed and cut to `PAIR_LINK_NAME_MAX`; empty when absent. */
  name: string;
  /** The link named a server, but the name was longer than the limit and was cut. */
  nameTooLong: boolean;
}

const HOST_RE = /^[A-Za-z0-9.-]+$/;
const TOKEN_RE = /^[0-9a-f]{64}$/;

/**
 * Parse a pairing link, or `null` when it is not one.
 *
 * Total: every failure is `null`, never a throw — the settings page shows one
 * message ("this is not a pairing link") for all of them, because a user who
 * pasted the wrong thing cannot act on the difference between a bad port and a
 * bad token length.
 */
export function parsePairLink(raw: string): ParsedPairLink | null {
  const text = raw.trim();
  const match = /^xmark-mobile:\/\/pair\?(.*)$/.exec(text);
  if (!match) return null;
  const query = new URLSearchParams(match[1]);
  const host = query.get("host") ?? "";
  const portText = query.get("port") ?? "";
  const token = query.get("token") ?? "";
  if (!HOST_RE.test(host)) return null;
  // Rejects "8080.5", "+8080", "1e3" and the empty string alike.
  if (!/^\d+$/.test(portText)) return null;
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  if (!TOKEN_RE.test(token)) return null;
  const rawName = (query.get("name") ?? "").trim();
  return {
    connection: { host, port, token },
    name: rawName.slice(0, PAIR_LINK_NAME_MAX),
    nameTooLong: rawName.length > PAIR_LINK_NAME_MAX,
  };
}
