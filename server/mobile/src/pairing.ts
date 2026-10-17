/**
 * The pairing link and its terminal QR code.
 *
 * `xmark-mobile://pair?host&port&token` is what the phone scans. The token
 * appears only here, in the terminal of the person who ran `pair`.
 *
 * @module pairing
 */
import QRCode from "qrcode";

export interface PairInfo {
  host: string;
  port: number;
  token: string;
}

export function pairUrl({ host, port, token }: PairInfo): string {
  const q = new URLSearchParams({ host, port: String(port), token });
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
    `  Host:  ${info.host}`,
    `  Port:  ${info.port}`,
    `  Token: ${info.token}`,
    "",
  ].join("\n");
}
