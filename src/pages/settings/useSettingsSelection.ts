/**
 * useSettingsSelection — which server the Settings page shows as CURRENT, and
 * how a click on a row changes it.
 *
 * Purpose: Settings is a different webview from the window that renders a
 * server, so the radio state here is a PROJECTION of what the focused document
 * window shows, kept in step by events, not a second source of truth:
 *   - a row clicked here asks the target document window to switch
 *     (`remote-server:select`), and marks the row at once — a radio that waits
 *     for a round trip reads as a dead click;
 *   - the main window's own menu announces its choice
 *     (`remote-server:selection`), and that re-marks the row here.
 *
 * "This Mac" is `null`: a selection that cannot dangle, which is also what a
 * deleted server falls back to.
 *
 * @coordinates-with services/remoteServers/selection.ts — the events, the writer
 * @coordinates-with hooks/useRemoteSelectionBridge.ts — the listener half
 * @coordinates-with pages/settings/ServersSettings.tsx — the caller
 * @module pages/settings/useSettingsSelection
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import i18n from "@/i18n";
import { toast } from "sonner";
import {
  BROADCAST,
  emitServerSelect,
  forgetRemovedServer,
  reportsSelection,
  resolveSelectionTarget,
  REMOTE_SERVER_SELECTION_EVENT,
  type RemoteSelectionPayload,
} from "@/services/remoteServers/selection";
import { safeUnlistenAsync } from "@/utils/safeUnlisten";
import { remoteServerWarn } from "@/utils/debug";

/** A switch notice stays half the usual time: the row already shows the result. */
const SWITCH_TOAST_MS = 900;

export interface SettingsSelection {
  /** The server id currently shown by the document window; null = this Mac. */
  activeId: string | null;
  /** A row was clicked. A row already current does nothing (no switch, no toast). */
  choose: (serverId: string | null) => void;
  /** A server was deleted: whatever window was on it goes back to this Mac. */
  forget: (serverId: string) => void;
}

export function useSettingsSelection(): SettingsSelection {
  const [activeId, setActiveId] = useState<string | null>(null);
  const activeRef = useRef<string | null>(null);
  const remember = useCallback((id: string | null) => {
    activeRef.current = id;
    setActiveId(id);
  }, []);

  // The main window's own choice, as it happens.
  useEffect(() => {
    const unlisten = listen<RemoteSelectionPayload>(REMOTE_SERVER_SELECTION_EVENT, (event) => {
      if (!reportsSelection(event.payload.windowLabel)) return;
      remember(event.payload.serverId);
    });
    return () => safeUnlistenAsync(unlisten);
  }, [remember]);

  const choose = useCallback(
    (serverId: string | null) => {
      if (serverId === activeRef.current) return;
      remember(serverId);
      void resolveSelectionTarget()
        .then((target) => emitServerSelect(target ?? BROADCAST, serverId))
        .catch((error: unknown) => remoteServerWarn("could not resolve the document window:", error));
      // Read through the global i18n instance, NOT the English bundle: the
      // message is translated, so a Chinese UI must say 切换成功 rather than
      // "Switched". i18n.ts initialises at module load (`main.tsx` imports it
      // first), so it is ready before any click can reach this handler; a test
      // that renders this page alone gets whatever `t` resolves to, which is
      // the key or the English default — never a crash.
      toast.success(i18n.t("settings:servers.switched"), { duration: SWITCH_TOAST_MS });
    },
    [remember],
  );

  const forget = useCallback(
    (serverId: string) => {
      // This page first: it may be the only window holding the id.
      if (activeRef.current === serverId) remember(null);
      forgetRemovedServer(serverId);
    },
    [remember],
  );

  return { activeId, choose, forget };
}
