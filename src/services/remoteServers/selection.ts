/**
 * remoteServerSelection — the ONE way a window changes the server it shows, and
 * the one way that change crosses to another window.
 *
 * Purpose: choosing a server used to be three lines inside `ServerSwitcher`
 * (set the session selection, close the remote browser when returning to this
 * Mac). Settings → Servers now makes the same choice from a DIFFERENT webview,
 * so the three lines have to be one function, and the crossing has to be an
 * event: `useRemoteSessionStore` is per-window memory, never persisted.
 *
 * Key decisions:
 *   - **The payload names the target window** and only that window acts, the
 *     same scoping `openFileEvent` uses. Tauri's `emit` reaches every window.
 *   - **Two events, one direction each**:
 *     `remote-server:select` (Settings → the focused document window: "show
 *     this server") and `remote-server:selection` (a window's choice changed:
 *     "this is what I show now", so Settings can mark the same row).
 *   - **Settings is not a document window, so it never sends to itself.** The
 *     target is `isDocumentWindowLabel`'s answer, which is also what decides
 *     which windows answer a selection broadcast.
 *   - **Getting back to this Mac closes the remote browser**, exactly as the
 *     switcher always did: coming back re-reads the server instead of painting
 *     a tree from minutes ago.
 *
 * @coordinates-with stores/remoteSessionStore.ts — the per-window selection
 * @coordinates-with components/WorkspaceRail/ServerSwitcher.tsx — the local picker
 * @coordinates-with pages/settings/ServersSettings.tsx — the cross-window picker
 * @module services/remoteServers/selection
 */

import { emit } from "@tauri-apps/api/event";
import { useRemoteSessionStore } from "@/stores/remoteSessionStore";
import { useRemoteBrowserStore } from "@/stores/remoteBrowserStore";
import { isDocumentWindowLabel } from "@/utils/windowLabels";
import { remoteServerWarn } from "@/utils/debug";

/**
 * A `select` aimed at this label reaches every document window. Only used when
 * the target cannot be resolved at all — "all of them" is the fallback, never
 * the plan.
 */
export const BROADCAST = "*";

/** Settings → a document window: show `serverId` (null = this Mac). */
export const REMOTE_SERVER_SELECT_EVENT = "remote-server:select";
/** A document window → everyone: the selection I now hold. */
export const REMOTE_SERVER_SELECTION_EVENT = "remote-server:selection";

export interface RemoteSelectionPayload {
  /** The window that should ACT on `select`; the window that CHANGED for `selection`. */
  windowLabel: string;
  /** The paired server's id, or null for this Mac. */
  serverId: string | null;
}

/** Ask another window to show a server. Best-effort: a window that closed loses nothing. */
export function emitServerSelect(windowLabel: string, serverId: string | null): void {
  const payload: RemoteSelectionPayload = { windowLabel, serverId };
  void emit(REMOTE_SERVER_SELECT_EVENT, payload).catch((error: unknown) =>
    remoteServerWarn("could not hand the selection to the document window:", error),
  );
}

/** Announce that this window's selection changed. */
export function emitServerSelection(windowLabel: string, serverId: string | null): void {
  const payload: RemoteSelectionPayload = { windowLabel, serverId };
  void emit(REMOTE_SERVER_SELECTION_EVENT, payload).catch((error: unknown) =>
    remoteServerWarn("could not announce the selection:", error),
  );
}

/** Is `payload` a well-formed selection, aimed at `windowLabel`? Anything else is dropped. */
export function isSelectionFor(payload: unknown, windowLabel: string): payload is RemoteSelectionPayload {
  if (typeof payload !== "object" || payload === null) return false;
  const p = payload as Partial<RemoteSelectionPayload>;
  if (p.windowLabel !== windowLabel && p.windowLabel !== BROADCAST) return false;
  return p.serverId === null || typeof p.serverId === "string";
}
/** A window that may report a selection: a document window; Settings itself may not. */
export function reportsSelection(windowLabel: string): boolean {
  return isDocumentWindowLabel(windowLabel);
}

/** Will a `select` aimed at `windowLabel` be acted on there at all? */
export function isSelectTarget(windowLabel: string): boolean {
  return isDocumentWindowLabel(windowLabel);
}

/**
 * The document window a cross-window choice should land in.
 *
 * "The window the user is looking at", as `mcpBridge/focusedWindow` resolves
 * it: the focused webview, when that webview is a document window. Settings
 * usually holds focus when a row is clicked there, so the next step asks the
 * platform which document windows are live and picks the one that ACTED most
 * recently — `LAST_SELECTED_AT`, the order this module's own listeners keep.
 *
 * `undefined` when nothing can be read: the caller then addresses `BROADCAST`,
 * and every document window acts — "all of them" is wrong, but a click that
 * does nothing at all is worse.
 */

/** Document window label → the clock reading of its last selection change. */
const LAST_SELECTED_AT = new Map<string, number>();
let selectionClock = 0;

/** Test seam: forget the order (never called in production). */
export function resetSelectionOrder(): void {
  LAST_SELECTED_AT.clear();
  selectionClock = 0;
}

/** Record that `windowLabel` changed its selection — this is the MRU order above. */
function noteSelectionChange(windowLabel: string): void {
  selectionClock += 1;
  LAST_SELECTED_AT.set(windowLabel, selectionClock);
}

async function liveDocumentWindows(): Promise<string[] | undefined> {
  let labels: string[];
  try {
    const { getAllWebviewWindows } = await import("@tauri-apps/api/webviewWindow");
    labels = (await getAllWebviewWindows()).map((w) => w.label);
  } catch {
    return undefined;
  }
  const documents = labels.filter(isDocumentWindowLabel);
  const rank = (label: string) => (LAST_SELECTED_AT.has(label) ? -LAST_SELECTED_AT.get(label)! : -1);
  return documents.sort((a, b) => {
    if (a === b) return 0;
    if (a === "main") return -1;
    if (b === "main") return 1;
    return rank(a) - rank(b) || a.localeCompare(b);
  });
}

/**
 * The document window a cross-window choice should land in, or `undefined` when
 * it cannot be resolved (see the note above the MRU map).
 */
export async function resolveSelectionTarget(): Promise<string | undefined> {
  try {
    const { resolveFocusedWindowLabel } = await import("@/services/mcpBridge/focusedWindow");
    const focused = await resolveFocusedWindowLabel();
    if (typeof focused === "string" && isDocumentWindowLabel(focused)) return focused;
  } catch {
    // Fall through to the store's own view of who is live.
  }
  const live = await liveDocumentWindows();
  return live?.[0];
}

/**
 * The one place a window's own choice is recorded: set the session selection
 * (and close the remote slice when returning to this Mac), and announce it so
 * the Settings window marks the same row. Returns false when the choice was
 * already in force — a re-click is not a switch.
 */
export function selectInThisWindow(windowLabel: string, serverId: string | null): boolean {
  const session = useRemoteSessionStore.getState();
  if (session.getActive(windowLabel) === serverId) return false;
  session.setActive(windowLabel, serverId);
  // Back to this Mac drops the remote slice: coming back re-reads the server
  // rather than painting a tree from minutes ago.
  if (serverId === null) useRemoteBrowserStore.getState().close();
  noteSelectionChange(windowLabel);
  if (reportsSelection(windowLabel)) emitServerSelection(windowLabel, serverId);
  return true;
}

/**
 * A server that is no longer in the paired list cannot be shown: every window
 * that was on it goes back to this Mac, which is also the only selection that
 * cannot dangle. Called by Settings after a delete.
 *
 * The reset is sent to the windows themselves (`select` → "show this Mac"), not
 * written into this window's map: a document window lives in another webview,
 * where this map is a copy that only the window itself may change — and the
 * copy is exactly what the announcement listener would then read back as "the
 * main window changed" on a stale value.
 */
export function forgetRemovedServer(serverId: string): void {
  const targets = new Set(
    Object.entries(useRemoteSessionStore.getState().active)
      .filter(([label, id]) => id === serverId && isSelectTarget(label))
      .map(([label]) => label),
  );
  for (const label of targets) emitServerSelect(label, null);
}
