/**
 * useRemoteSelectionBridge — makes one window a participant in the
 * cross-window server selection.
 *
 * Purpose: "which server this window shows" is per-window memory, so Settings
 * cannot change a document window's view by writing a store. The bridge is the
 * whole of that conversation, and there is one copy of it:
 *   - a DOCUMENT window (`main`, `doc-N`) listens for `remote-server:select`
 *     and applies the ones aimed at it — that is how a row clicked in Settings
 *     switches this window;
 *   - any window announces a change it caused (`remote-server:selection`), so
 *     Settings can mark the row the main window's own menu just chose.
 *
 * Announcing reads the store's `active` map rather than wrapping every
 * `setActive` call site: the map is small, the events are rare, and a call site
 * that forgot to announce is exactly the bug this prevents.
 *
 * Mounted by `DocumentWindowMount` (document windows) and by the Settings page.
 *
 * @coordinates-with services/remoteServers/selection.ts — the events and the one writer
 * @coordinates-with components/WorkspaceRail/ServerSwitcher.tsx — the local picker
 * @coordinates-with pages/settings/ServersSettings.tsx — the cross-window picker
 * @module hooks/useRemoteSelectionBridge
 */

import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useRemoteSessionStore } from "@/stores/remoteSessionStore";
import {
  emitServerSelection,
  isSelectTarget,
  isSelectionFor,
  REMOTE_SERVER_SELECT_EVENT,
  reportsSelection,
  selectInThisWindow,
  type RemoteSelectionPayload,
} from "@/services/remoteServers/selection";
import { safeUnlistenAsync } from "@/utils/safeUnlisten";

/**
 * `onSelect`, when given, replaces the default handling for events aimed at
 * this window (Settings runs it to keep its own selection in step). Without it,
 * a document window switches its own shell.
 *
 * `windowLabel` is `null` where there is no window context (a panel rendered
 * outside the provider, as several page tests do): the hook then does nothing
 * at all rather than throwing.
 */
export function useRemoteSelectionBridge(
  windowLabel: string | null,
  onSelect?: (payload: RemoteSelectionPayload) => void,
): void {
  // Announce this window's choice whenever it changes. The listener is
  // registered even in windows that never report (Settings): a no-op there.
  useEffect(() => {
    if (windowLabel === null || !reportsSelection(windowLabel)) return;
    let last = useRemoteSessionStore.getState().getActive(windowLabel);
    return useRemoteSessionStore.subscribe((state) => {
      const next = state.active[windowLabel] ?? null;
      if (next === last) return;
      last = next;
      emitServerSelection(windowLabel, next);
    });
  }, [windowLabel]);

  useEffect(() => {
    if (windowLabel === null) return;
    const unlisten = listen<RemoteSelectionPayload>(REMOTE_SERVER_SELECT_EVENT, (event) => {
      if (!isSelectionFor(event.payload, windowLabel)) return;
      if (onSelect) {
        onSelect(event.payload);
        return;
      }
      if (!isSelectTarget(windowLabel)) return;
      selectInThisWindow(windowLabel, event.payload.serverId);
    });
    return () => safeUnlistenAsync(unlisten);
  }, [windowLabel, onSelect]);
}
