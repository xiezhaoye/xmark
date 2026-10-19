/**
 * Parse the pairing link `xmark-mobile://pair?host&port&token[&name]` that
 * `xmark-mobile-server pair` prints as a QR code. `name` is the optional
 * display name of the server; links printed before names existed still parse.
 *
 * @module pairing/parsePairUrl
 */
import type { Connection } from "../api/types";
import { PAIR_URL_NAME_MAX } from "../api/types";

export function parsePairUrl(raw: string): Connection | null {
  return parsePairLink(raw)?.connection ?? null;
}

/**
 * The connection a pairing link carries, plus the server name it names.
 * `name` is `` when the link has none; `nameTooLong` flags a name that was
 * cut to `PAIR_URL_NAME_MAX` characters, so the form can keep the old value.
 */
export interface PairLink {
  connection: Connection;
  name: string;
  nameTooLong: boolean;
}

export function parsePairLink(raw: string): PairLink | null {
  const text = raw.trim();
  const m = /^xmark-mobile:\/\/pair\?(.*)$/.exec(text);
  if (!m) return null;
  const q = new URLSearchParams(m[1]);
  const host = q.get("host") ?? "";
  const port = Number(q.get("port"));
  const token = q.get("token") ?? "";
  if (!/^[A-Za-z0-9.-]+$/.test(host)) return null;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const rawName = (q.get("name") ?? "").trim();
  return {
    connection: { host, port, token },
    name: rawName.slice(0, PAIR_URL_NAME_MAX),
    nameTooLong: rawName.length > PAIR_URL_NAME_MAX,
  };
}
