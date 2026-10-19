/**
 * The pairing link and its terminal QR code.
 *
 * `xmark-mobile://pair?host&port&token&name` is what the phone scans. The
 * token appears only here, in the terminal of the person who ran `pair`.
 *
 * `name` is optional and, when set, is the display name the phone stores for
 * this server (it may hold non-ASCII text, so it is percent-encoded). Without
 * it the link is byte-for-byte what older releases printed.
 *
 * @module pairing
 */
import QRCode from "qrcode";

export interface PairInfo {
  host: string;
  port: number;
  token: string;
  /** Display name for this server in the phone's server list. */
  name?: string;
}

export function pairUrl({ host, port, token, name }: PairInfo): string {
  const q = new URLSearchParams({ host, port: String(port), token });
  if (name) q.set("name", name);
  return `xmark-mobile://pair?${q.toString()}`;
}

export async function renderPairing(info: PairInfo): Promise<string> {
  const qr = await QRCode.toString(pairUrl(info), { type: "terminal", small: true });
  return [
    qr,
    "Scan with XMark Mobile → Settings, or copy this link and tap “Paste pairing link”:",
    `  ${pairUrl(info)}`,
    "",
    "Or enter manually:",
    ...(info.name ? [`  Name:  ${info.name}`] : []),
    `  Host:  ${info.host}`,
    `  Port:  ${info.port}`,
    `  Token: ${info.token}`,
    "",
  ].join("\n");
}
