/**
 * The native capabilities the reader uses, with browser fallbacks so
 * the UI also runs in `vite dev` for layout work.
 *
 * - HTTP goes through Tauri's HTTP plugin inside the app.
 * - External links open in the system browser (opener plugin).
 * - The pairing QR is read with the barcode-scanner plugin, a pasted
 *   pairing link with the clipboard plugin (the WebView's own clipboard API
 *   never resolves inside the app).
 *
 * @module platform
 */
import type { FetchLike } from "./api/client";

const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const httpFetch: FetchLike = async (url, init) => {
  if (!inTauri) return window.fetch(url, init);
  const { fetch } = await import("@tauri-apps/plugin-http");
  return fetch(url, init);
};

export async function openExternal(url: string): Promise<void> {
  if (!inTauri) {
    window.open(url, "_blank", "noopener");
    return;
  }
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(url);
}

/** The clipboard's text; empty when there is none or reading is refused. */
export async function readClipboardText(): Promise<string> {
  try {
    if (!inTauri) return await navigator.clipboard.readText();
    const { readText } = await import("@tauri-apps/plugin-clipboard-manager");
    return (await readText()) ?? "";
  } catch {
    return "";
  }
}

/** Scan a QR code; null when the user cancels. Throws when scanning is impossible. */
export async function scanQrCode(): Promise<string | null> {
  if (!inTauri) throw new Error("Scanning needs the iPhone app");
  const scanner = await import("@tauri-apps/plugin-barcode-scanner");
  let permission = await scanner.checkPermissions();
  if (permission !== "granted") permission = await scanner.requestPermissions();
  if (permission !== "granted") throw new Error("Camera permission denied");
  try {
    const result = await scanner.scan({ windowed: false, formats: [scanner.Format.QRCode] });
    return result.content;
  } catch (err) {
    if (/cancel/i.test(String(err))) return null;
    throw err;
  }
}
