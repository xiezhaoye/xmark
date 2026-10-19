/**
 * ServerMenu — the rows the server switcher opens: "This Mac", every paired
 * Mac with its reachability, then "Add Server…".
 *
 * Purpose: the switcher owns the button, the anchor and the hook state; this
 * file owns the rows, so the interaction logic and the markup stay in separate
 * files (both under the size ceiling). The items are the shared `.vm-menu`
 * idiom, and the roving `tabIndex` is the parent's `focused` index.
 *
 * @coordinates-with components/WorkspaceRail/ServerSwitcher.tsx — the owner
 * @coordinates-with services/remoteServers/probe.ts — the status states
 * @module components/WorkspaceRail/ServerMenu
 */

import type { Ref } from "react";
import { useTranslation } from "react-i18next";
import { Check, Plus } from "lucide-react";
import { SERVER_STATE_DOT, SERVER_STATE_KEY, type ServerState } from "@/services/remoteServers/probe";

export interface ServerMenuProps {
  menuRef: Ref<HTMLDivElement>;
  /** Register the row at `index` (the parent's one registry). */
  itemRefs: (index: number, element: HTMLButtonElement | null) => void;
  servers: { id: string; name: string; host: string; port: number }[];
  activeId: string | null;
  focused: number;
  status: Record<string, ServerState>;
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  onChoose: (serverId: string | null) => void;
  onAddServer: () => void;
}

export function ServerMenu({
  menuRef,
  itemRefs,
  servers,
  activeId,
  focused,
  status,
  onKeyDown,
  onChoose,
  onAddServer,
}: ServerMenuProps) {
  const { t } = useTranslation("sidebar");
  // The status vocabulary is shared with Settings → Servers; it lives there.
  const { t: tState } = useTranslation("settings");
  // The roving-focus registry. The switcher keeps ONE registry across openings
  // (so a re-open never sees a stale entry), so the rows register through the
  // parent's callback rather than through the ref object itself.
  const register = (index: number) => (el: HTMLButtonElement | null) => {
    itemRefs(index, el);
  };
  const addIndex = servers.length + 1;

  /** The dot for the eye, the word for the screen reader, the state for a test. */
  const statusOf = (id: string) => {
    const state = status[id] ?? "checking";
    return (
      <span
        className="server-switcher__status"
        data-testid={`server-status-${id}`}
        data-state={state}
        title={tState(SERVER_STATE_KEY[state])}
      >
        <span aria-hidden="true" className={`server-switcher__dot ${SERVER_STATE_DOT[state]}`} />
        <span className="server-switcher__status-text" aria-hidden="true">
          {tState(SERVER_STATE_KEY[state])}
        </span>
      </span>
    );
  };

  return (
    <div
      ref={menuRef}
      className="vm-menu server-switcher__menu"
      role="menu"
      aria-label={t("remote.switchServerLabel")}
      onKeyDown={onKeyDown}
    >
      <button
        ref={register(0)}
        type="button"
        role="menuitemradio"
        aria-checked={activeId === null}
        className="server-switcher__item"
        tabIndex={focused === 0 ? 0 : -1}
        onClick={() => onChoose(null)}
      >
        <Check size={12} aria-hidden="true" className="server-switcher__check" />
        <span className="server-switcher__item-name">{t("remote.local")}</span>
      </button>
      {servers.map((server, index) => {
        const itemIndex = index + 1;
        return (
          <button
            key={server.id}
            ref={register(itemIndex)}
            type="button"
            role="menuitemradio"
            aria-checked={server.id === activeId}
            className="server-switcher__item"
            tabIndex={focused === itemIndex ? 0 : -1}
            title={`${server.host}:${server.port}`}
            onClick={() => onChoose(server.id)}
          >
            <Check size={12} aria-hidden="true" className="server-switcher__check" />
            <span className="server-switcher__item-name">{server.name}</span>
            {statusOf(server.id)}
          </button>
        );
      })}
      <button
        ref={register(addIndex)}
        type="button"
        role="menuitem"
        className="server-switcher__item"
        tabIndex={focused === addIndex ? 0 : -1}
        onClick={onAddServer}
      >
        <Plus size={12} aria-hidden="true" className="server-switcher__check" />
        <span className="server-switcher__item-name">{t("remote.addServer")}</span>
      </button>
    </div>
  );
}
