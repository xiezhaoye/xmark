/**
 * Folders the user picked on the phone, read through the system document
 * picker's security scope.
 *
 * The native half (plugins/localfs) owns the picker and the bookmark store;
 * this module is the only place the webview talks to it. Outside Tauri — a
 * `vite dev` in a browser — every call reports "no local folders", so the
 * rest of the app needs no platform branch.
 *
 * @module platformLocalFS
 */

import { invoke } from "@tauri-apps/api/core";
import { ApiError } from "./api/client";

/** A folder the picker returned, or one whose bookmark resolved again. */
export interface LocalFolder {
  /** Absolute path, stable across launches (it keys the bookmark). */
  path: string;
  name: string;
  /** False when the bookmark no longer resolves (folder moved/removed). */
  ok: boolean;
}

/** One entry of a local listing. */
export interface LocalEntry {
  name: string;
  /** Absolute path of the entry — the same value the tree passes back. */
  relPath: string;
  isDir: boolean;
  size: number;
  mtime: number;
}

const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const unsupported = () => new ApiError(0, "unsupported");

/** Opens the system folder picker. Rejects with code `cancelled` if dismissed. */
export async function pickLocalFolder(): Promise<LocalFolder> {
  if (!inTauri) throw unsupported();
  const picked = await invoke<{ path: string; name: string }>("plugin:xmark-localfs|pick_folder", {});
  return { ...picked, ok: true };
}

/** Re-activates every remembered folder's scope. Empty outside Tauri. */
export async function restoreLocalFolders(): Promise<LocalFolder[]> {
  if (!inTauri) return [];
  const reply = await invoke<{ folders: LocalFolder[] }>("plugin:xmark-localfs|restore_folders", {});
  return reply.folders ?? [];
}

/** Forgets a folder: drops its bookmark, so the next launch starts clean. */
export async function forgetLocalFolder(path: string): Promise<void> {
  if (!inTauri) return;
  await invoke("plugin:xmark-localfs|forget_folder", { path });
}

export async function listLocalFolder(dir: string): Promise<LocalEntry[]> {
  if (!inTauri) throw unsupported();
  return invoke<LocalEntry[]>("plugin:xmark-localfs|list_folder", { dir });
}

export async function readLocalText(path: string): Promise<string> {
  if (!inTauri) throw unsupported();
  return invoke<string>("plugin:xmark-localfs|read_text", { path });
}

/** Bytes, base64-encoded by the native side (an array of numbers over IPC is
 * several times larger and slower for a photo). */
export async function readLocalBytesBase64(path: string): Promise<string> {
  if (!inTauri) throw unsupported();
  return invoke<string>("plugin:xmark-localfs|read_bytes", { path });
}
