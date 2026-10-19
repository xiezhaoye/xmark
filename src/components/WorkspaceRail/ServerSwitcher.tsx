/**
 * ServerSwitcher — the server a window is looking at, and the way to change it.
 *
 * Purpose: one unframed button at the head of the workspace rail saying "this
 * Mac" or the remote Mac's name, opening a menu of the paired servers. The
 * menu is the only place a server is CHOSEN; pairing happens in
 * Settings → Servers, which the last item opens.
 *
 * Key decisions:
 *   - **An unframed button**: a glyph, a truncating name, a chevron. No border,
 *     no fill; hover and press use the same `--hover-bg` vocabulary as every
 *     rail row (rule 30).
 *   - **The menu is a `role="menu"` with roving focus**, arrow keys, Home/End,
 *     Enter and Escape — the keyboard contract of the rail's own context menu,
 *     including "Tab exits by dismissing" and focus returned to the invoker.
 *   - **Choosing the current entry only closes.** Re-selecting would otherwise
 *     re-open a document or reset a tree for no reason.
 *   - **Every row shows the server's reachability.** The probe runs when the
 *     menu OPENS — never on a timer: a menu that holds sockets open is a poll
 *     the user never asked for. The same opening also re-reads the STORED list
 *     (`adoptStoredServers`), so a server paired in the Settings window appears
 *     here without a separate action. The states are
 *     `services/remoteServers/probe`, the same vocabulary Settings uses.
 *   - **There is no Refresh row.** Opening the menu already re-reads the list
 *     and re-probes every server, so a second control for the same read was a
 *     button whose effect the user could not see (the list never went stale
 *     without an open).
 *   - **`添加服务器…` opens Settings → Servers**, in the Settings window (a
 *     separate webview), so the list is edited where the list lives.
 *   - With no servers paired, the menu is "This Mac" and that last item alone.
 *   - **The choice is recorded by `selection.ts`**, the one writer of the
 *     session store, so the Settings window hears about a choice made here and
 *     the two surfaces cannot disagree.
 *
 * @coordinates-with services/remoteServers/selection.ts — the one writer
 * @coordinates-with services/remoteServers/probe.ts — the status dots
 * @coordinates-with stores/remoteServersStore.ts — the list it lists
 * @module components/WorkspaceRail/ServerSwitcher
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, Server } from "lucide-react";
import { useRemoteServersStore, adoptStoredServers } from "@/stores/remoteServersStore";
import { useRemoteSessionStore } from "@/stores/remoteSessionStore";
import { openSettingsWindow } from "@/services/navigation/settingsWindow";
import { selectInThisWindow } from "@/services/remoteServers/selection";
import { createServerProber, type ServerState } from "@/services/remoteServers/probe";
import { useMenuPosition, type MenuPoint } from "@/hooks/useMenuPosition";
import { remoteServerWarn } from "@/utils/debug";
import { ServerMenu } from "./ServerMenu";
import "./ServerSwitcher.css";

export interface ServerSwitcherProps {
  windowLabel: string;
}

export function ServerSwitcher({ windowLabel }: ServerSwitcherProps) {
  const { t } = useTranslation("sidebar");
  const servers = useRemoteServersStore((s) => s.servers);
  const activeId = useRemoteSessionStore((s) => s.active[windowLabel] ?? null);
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(0);
  const [position, setPosition] = useState<MenuPoint | null>(null);
  const [status, setStatus] = useState<Record<string, ServerState>>({});
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  // The list this menu is showing: a probe's answer counts only while the
  // server is still in it.
  const listedRef = useRef(servers);

  // One entry per server plus "This Mac", then "Add server…".
  const itemCount = servers.length + 2;

  useMenuPosition(menuRef, position, { open });

  const dismiss = useCallback((restoreFocus = true) => {
    setOpen(false);
    setPosition(null);
    if (restoreFocus) buttonRef.current?.focus();
  }, []);

  /** Probe every server, `checking` first — the menu's own status source. */
  const probeAll = useCallback(async (list: typeof servers) => {
    const prober = createServerProber(
      (id, state) => setStatus((s) => ({ ...s, [id]: state })),
      (id) => listedRef.current.some((s) => s.id === id),
    );
    await prober.probeAll(list);
  }, []);

  const choose = (serverId: string | null) => {
    selectInThisWindow(windowLabel, serverId);
    dismiss();
  };

  const openMenu = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Anchored under the button's left edge, clamped into the viewport by
    // `useMenuPosition`.
    setPosition({ x: rect.left, y: rect.bottom + 4 });
    // Focus starts on the CURRENT entry, so Enter immediately does nothing
    // harmful.
    const currentIndex = activeId ? servers.findIndex((s) => s.id === activeId) + 1 : 0;
    setFocused(Math.max(0, currentIndex));
    setOpen(true);
  };

  // The menu opened: pick up a list another window may have written, then probe
  // it once. Opening is a user gesture, so it is the right moment to ask.
  useEffect(() => {
    if (!open) return;
    void probeAll(adoptStoredServers());
  }, [open, probeAll]);

  useEffect(() => {
    listedRef.current = servers;
  }, [servers]);

  useEffect(() => {
    if (!open) return;
    itemRefs.current[focused]?.focus();
  }, [open, focused]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      if (buttonRef.current?.contains(event.target as Node)) return;
      // An outside click keeps focus where the user put it.
      dismiss(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open, dismiss]);

  const move = (delta: number) => setFocused((i) => Math.min(itemCount - 1, Math.max(0, i + delta)));

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      move(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      move(-1);
    } else if (event.key === "Home") {
      event.preventDefault();
      setFocused(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setFocused(itemCount - 1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      dismiss();
    } else if (event.key === "Tab") {
      // Tabbing out of a menu dismisses it, as in every other menu here.
      dismiss();
    }
  };

  const activeServer = activeId ? servers.find((s) => s.id === activeId) : undefined;
  const activeName = activeServer?.name ?? t("remote.local");

  const addServer = () => {
    dismiss();
    void (async () => {
      try {
        await openSettingsWindow("servers");
      } catch (error) {
        remoteServerWarn("could not open Settings:", error);
      }
    })();
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="server-switcher"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("remote.switchServer", { name: activeName })}
        title={activeName}
        onClick={() => (open ? dismiss() : openMenu())}
      >
        <Server size={14} aria-hidden="true" className="server-switcher__icon" />
        <span className="server-switcher__name">{activeName}</span>
        <ChevronDown size={12} aria-hidden="true" className="server-switcher__chevron" />
      </button>
      {open && position && (
        <ServerMenu
          menuRef={menuRef}
          itemRefs={(index, element) => {
            itemRefs.current[index] = element;
          }}
          servers={servers}
          activeId={activeId}
          focused={focused}
          status={status}
          onKeyDown={onKeyDown}
          onChoose={choose}
          onAddServer={addServer}
        />
      )}
    </>
  );
}
