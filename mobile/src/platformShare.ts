/**
 * The native share sheet: hand an exact original file (raw bytes + name +
 * extension) to the system share UI on iOS, with a browser fallback for
 * `vite dev`.
 *
 * @module platformShare
 */

export interface SharePayload {
  name: string;
  bytes: Uint8Array;
  mimeType: string;
}

/** 30 MiB ceiling shared with the native side; zero bytes included. */
const MAX_BYTES = 30 * 1024 * 1024;

const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Encode bytes to base64 in bounded chunks, so a 30 MiB payload never becomes
 * a single huge `String.fromCharCode(...bytes)` spread on the stack. */
function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000; // 32 KiB per slice
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Copy bytes into a fresh `ArrayBuffer` (the `File`/`Blob` constructor wants
 * an `ArrayBuffer` view, not a `SharedArrayBuffer`-backed one). */
function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

/** Present the system share sheet (native) or `navigator.share` (browser). */
export async function shareFile(file: SharePayload): Promise<boolean> {
  if (file.bytes.byteLength > MAX_BYTES) {
    throw new Error("invalid file size");
  }
  if (!file.name.trim() || file.name === "." || file.name === ".." || /[/\\\u0000-\u001f\u007f]/.test(file.name)) {
    throw new Error("invalid filename");
  }

  if (inTauri) {
    return shareNative(file);
  }
  return shareBrowser(file);
}

/** Native path: invoke the registered `xmark-share` plugin command. */
async function shareNative(file: SharePayload): Promise<boolean> {
  const { invoke } = await import("@tauri-apps/api/core");
  const base64 = bytesToBase64(file.bytes);
  // The command reports completion (true) vs cancellation (false); errors
  // propagate as a rejected promise with a stable message the UI localises.
  return invoke<boolean>("plugin:xmark-share|share_file", {
    name: file.name,
    base64,
    mimeType: file.mimeType,
  });
}

/** Browser fallback for `vite dev` layout work. */
async function shareBrowser(file: SharePayload): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.canShare) {
    throw new Error("unsupported on this platform");
  }
  const f = new File([bytesToArrayBuffer(file.bytes)], file.name, { type: file.mimeType });
  if (!navigator.canShare({ files: [f] })) {
    throw new Error("unsupported on this platform");
  }
  try {
    await navigator.share({ files: [f] });
    return true;
  } catch (err) {
    // The user dismissing the sheet is a quiet cancel, not an error.
    if (err instanceof DOMException && err.name === "AbortError") {
      return false;
    }
    throw err;
  }
}
