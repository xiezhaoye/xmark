/**
 * Parse the pairing link `xmark-mobile://pair?host&port&token` that
 * `xmark-mobile-server pair` prints as a QR code.
 *
 * @module pairing/parsePairUrl
 */
import type { Connection } from "../api/types";

export function parsePairUrl(raw: string): Connection | null {
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
  return { host, port, token };
}
