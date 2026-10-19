/**
 * ServerRow — one paired Mac in Settings → Servers: a radio that shows (and
 * changes) which server the document window is on, its live status dot, and
 * inline rename / move up / move down / delete / refresh.
 *
 * Key decisions:
 *   - **The row's BODY is the radio**, not the whole `<li>`. Clicking anywhere
 *     on the name/address/status area — or pressing Space or Enter on it —
 *     selects that server. The maintenance buttons are siblings of that body,
 *     never inside it: a button inside a button is invalid HTML and unreachable
 *     by keyboard, and a hit area stretched over them would swallow their
 *     clicks. The highlight still spans the whole row (see ServersSettings.css);
 *     only the *click target* stops before the buttons.
 *   - **The current row is marked with the filled mark and `aria-checked`.**
 *     The word "Current" is gone from the visual design — the row's own fill and
 *     the filled radio already say it — but it survives as `sr-only` text,
 *     because a dot alone is not a label (audit #953's reasoning).
 *   - **Status is a dot, not a word.** Online green, unreachable grey, token
 *     rejected orange, in flight grey. The dot keeps its `title`/`aria-label`
 *     so the meaning is still available without colour.
 *   - **Refresh re-probes this one server.** There is no polling: the page
 *     probes on open, and this button is the manual "I changed something, check
 *     again" the user asked for. It is disabled while the probe is in flight.
 *   - **Rename happens in place**, committed on Enter or blur, cancelled by
 *     Escape (IME-safe: a composing Enter is never a commit). A blank name
 *     returns the server to its default name instead of being rejected — the
 *     default is what the server would have been called anyway.
 *   - **Delete asks first.** The confirmation is the row's own inline strip,
 *     not a dialog: the row being removed stays visible while the question is
 *     asked, which is what makes the target unambiguous.
 *   - **Order is moved with buttons**, each carrying its direction and the
 *     server's name, so a screen reader hears what a click will do.
 *
 * @coordinates-with pages/settings/ServersSettings.tsx — owns the list
 * @coordinates-with pages/settings/ProviderRadio.tsx — the radio mark
 * @coordinates-with services/remoteServers/probe.ts — the states and dots
 * @module pages/settings/ServerRow
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp, Pencil, RefreshCw, Trash2 } from "lucide-react";
import { Button, FieldInput } from "./components";
import { RadioMark } from "./ProviderRadio";
import type { RemoteServer } from "@/stores/remoteServersStore";
import {
  SERVER_STATE_DOT,
  SERVER_STATE_KEY,
  type ServerState,
} from "@/services/remoteServers/probe";
import { defaultServerName } from "@/services/remoteServers/serverIdentity";
import { PAIR_LINK_NAME_MAX } from "@/services/remoteServers/parsePairLink";
import { isImeKeyEvent } from "@/utils/imeGuard";

export interface ServerRowProps {
  server: RemoteServer;
  state: ServerState;
  /** This is the server the document window shows. */
  current: boolean;
  /** Tabbing stops only at the current row (roving tabindex). */
  tabbable: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onSelect: () => void;
  onMove: (delta: number) => void;
  onRemove: () => void;
  onRename: (name: string) => void;
  /** Probe this server again, on demand. */
  onRefresh: () => void;
}

export function ServerRow({
  server,
  state,
  current,
  tabbable,
  canMoveUp,
  canMoveDown,
  onSelect,
  onMove,
  onRemove,
  onRename,
  onRefresh,
}: ServerRowProps) {
  const { t } = useTranslation("settings");
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const commit = (value: string) => {
    onRename(value);
    setEditing(null);
  };

  const checking = state === "checking";

  return (
    <li className="server-row flex flex-wrap items-center gap-1 py-1">
      {/* A div, not a button: `role="radio"` with a tabIndex is what a row-wide
          radio has to be once the maintenance buttons have to sit beside it.
          Space/Enter are therefore handled here — a native button had them. */}
      <div
        role="radio"
        aria-checked={current}
        aria-label={server.name}
        tabIndex={tabbable ? 0 : -1}
        className="server-row__body"
        onClick={onSelect}
        onKeyDown={(event) => {
          if (isImeKeyEvent(event)) return;
          if (event.key === " " || event.key === "Enter") {
            event.preventDefault();
            onSelect();
          }
        }}
      >
        <RadioMark checked={current} />
        <span className="min-w-0 flex-1">
          <span className="server-row__name">
            <span className="truncate text-sm font-medium text-[var(--text-color)]">
              {server.name}
            </span>
            <span
              className={`server-row__status ${SERVER_STATE_DOT[state]}`}
              role="img"
              aria-label={t(SERVER_STATE_KEY[state])}
              title={t(SERVER_STATE_KEY[state])}
            />
          </span>
          <span className="block truncate font-mono text-xs text-[var(--text-secondary)]">
            {server.host}:{server.port}
          </span>
        </span>
        {current && <span className="sr-only">{t("servers.current")}</span>}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          className="vm-icon-btn vm-icon-btn--sm"
          title={t("servers.refresh")}
          aria-label={t("servers.refreshNamed", { name: server.name })}
          disabled={checking}
          onClick={onRefresh}
        >
          <RefreshCw size={14} aria-hidden="true" className={checking ? "animate-spin" : undefined} />
        </button>
        <button
          type="button"
          className="vm-icon-btn vm-icon-btn--sm"
          title={t("servers.rename")}
          aria-label={t("servers.renameNamed", { name: server.name })}
          onClick={() => setEditing(server.name)}
        >
          <Pencil size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="vm-icon-btn vm-icon-btn--sm"
          title={t("servers.moveUp")}
          aria-label={t("servers.moveUpNamed", { name: server.name })}
          disabled={!canMoveUp}
          onClick={() => onMove(-1)}
        >
          <ArrowUp size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="vm-icon-btn vm-icon-btn--sm"
          title={t("servers.moveDown")}
          aria-label={t("servers.moveDownNamed", { name: server.name })}
          disabled={!canMoveDown}
          onClick={() => onMove(1)}
        >
          <ArrowDown size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="vm-icon-btn vm-icon-btn--sm"
          title={t("servers.remove")}
          aria-label={t("servers.removeNamed", { name: server.name })}
          onClick={() => setConfirming(true)}
        >
          <Trash2 size={14} aria-hidden="true" />
        </button>
      </div>
      {editing !== null && (
        <div className="w-full">
          <FieldInput
            value={editing}
            onChange={(v) => setEditing(v.slice(0, PAIR_LINK_NAME_MAX))}
            aria-label={t("servers.rename")}
            placeholder={defaultServerName(server.host)}
            autoFocus
            onKeyDown={(e) => {
              if (isImeKeyEvent(e)) return;
              if (e.key === "Enter") {
                e.preventDefault();
                commit(editing);
              } else if (e.key === "Escape") {
                e.preventDefault();
                setEditing(null);
              }
            }}
            onBlur={() => commit(editing)}
          />
        </div>
      )}
      {confirming && (
        <div
          role="group"
          aria-label={t("servers.removeConfirm", { name: server.name })}
          className="flex w-full items-center justify-end gap-2"
        >
          <span className="text-xs text-[var(--text-secondary)]">
            {t("servers.removeConfirm", { name: server.name })}
          </span>
          <Button onClick={() => setConfirming(false)}>{t("servers.cancel")}</Button>
          <Button variant="danger" onClick={onRemove}>
            {t("servers.removeYes")}
          </Button>
        </div>
      )}
    </li>
  );
}
