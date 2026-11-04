/**
 * What the settings popover's Share block does with a document: read the
 * Mac's original bytes and hand them to the system share sheet, or create a
 * public link and put it on the clipboard.
 *
 * A share action is a snapshot: the connection and the document are taken
 * when the action starts, and the Mac is asked afresh for the bytes — the
 * reader's loaded text is never what gets sent, and switching servers or
 * documents mid-flight cannot redirect it. A cancelled share sheet is quiet;
 * a link that could not be copied is kept, so the caller can show it and
 * retry the copy rather than create a second snapshot.
 *
 * @module shareActions
 */
import { ApiError } from "./api/client";
import { connectionOf, type Connection, type ServerProfile } from "./api/types";
import { copyText, shareTargetOf, type ShareTarget } from "./share";
import { shareFile } from "./platformShare";
import type { Client } from "./api/client";

export interface ShareDeps {
  makeClient: (c: Connection) => Client;
}

export type ShareFileResult =
  | { status: "sent" }
  | { status: "cancelled" }
  | { status: "error"; code: string };

export type ShareLinkResult =
  | { status: "copied"; url: string }
  /** The snapshot exists; only the clipboard failed, so `url` must stay visible. */
  | { status: "copy_failed"; url: string }
  | { status: "error"; code: string };

/** The error code in the app's own vocabulary. */
function codeOf(err: unknown): string {
  return err instanceof ApiError ? err.code : "share_failed";
}

/** Sends the file as it is saved on the Mac right now; `false` means cancelled. */
export async function sendOriginal(doc: { rootId: string; relPath: string }, profile: ServerProfile, deps: ShareDeps): Promise<ShareFileResult> {
  const target = shareTargetOf(doc, profile.id);
  try {
    const { bytes, name, mimeType } = await deps.makeClient(connectionOf(profile)).download(target.rootId, target.relPath);
    const shared = await shareFile({ name, bytes, mimeType });
    return shared ? { status: "sent" } : { status: "cancelled" };
  } catch (err) {
    return { status: "error", code: codeOf(err) };
  }
}

/** Creates a link to a snapshot of the file's current bytes and copies it. */
export async function createLink(doc: { rootId: string; relPath: string }, profile: ServerProfile, deps: ShareDeps): Promise<ShareLinkResult> {
  const target: ShareTarget = shareTargetOf(doc, profile.id);
  let url: string;
  try {
    ({ url } = await deps.makeClient(connectionOf(profile)).createShare(target.rootId, target.relPath));
  } catch (err) {
    return { status: "error", code: codeOf(err) };
  }
  const copied = await copyText(url);
  return copied ? { status: "copied", url } : { status: "copy_failed", url };
}

/** Retries the clipboard for a link that already exists. */
export async function copyExistingLink(url: string): Promise<boolean> {
  return copyText(url);
}
