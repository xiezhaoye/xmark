/**
 * What sharing needs from the phone itself: the clipboard, and the target a
 * share action works on.
 *
 * Inside the app the clipboard is Tauri's plugin — the WebView's own
 * `navigator.clipboard` never resolves there (the same reason pairing reads
 * pasted links through the plugin). In a browser, `navigator.clipboard` is
 * used, so the UI still works in `vite dev`. A refused write is a `false`,
 * never a throw: the caller keeps the link on screen and offers a retry.
 *
 * The share sheet is not here: it is `platformShare.ts`, a named export the
 * native side owns (`shareFile({name, bytes, mimeType})`, `false` when the
 * user cancels).
 *
 * @module share
 */

const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** A file to act on, with the server it was read from captured at click time. */
export interface ShareTarget {
  rootId: string;
  relPath: string;
  /** The file's name as a phone shows it: the last path segment. */
  name: string;
  /** The Mac the document was open on when the action started. */
  serverId: string;
}

/** The target for a document: its own root and path, on the current Mac. */
export function shareTargetOf(doc: { rootId: string; relPath: string }, serverId: string): ShareTarget {
  const parts = doc.relPath.split("/").filter(Boolean);
  return { rootId: doc.rootId, relPath: doc.relPath, name: parts.at(-1) || doc.rootId, serverId };
}

/** The last text that made it into the clipboard, for a failure that follows it. */
let copied: string | null = null;

export const lastCopiedLink = (): string | null => copied;

/** Puts `text` on the clipboard; false when the phone refused to. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (inTauri) {
      const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
      await writeText(text);
    } else if (typeof navigator !== "undefined" && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
    } else {
      return false;
    }
    copied = text;
    return true;
  } catch {
    return false;
  }
}
