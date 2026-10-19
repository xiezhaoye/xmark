/**
 * The top of the drawer's groups column: which Mac is being read, and a way
 * to switch to another paired one or to manage them in settings.
 *
 * The name is always shown, even with a single server; it is the one entry in
 * the list as well, so a server can never be switched away from by accident.
 * The list opens in place, above the groups, rather than as a sheet: the drawer
 * is already the list-like surface, and a sheet would cover it.
 *
 * @module components/ServerPicker
 */
import { useState } from "react";
import { useActiveProfile, useReaderStore } from "../state/readerStore";
import { t } from "../i18n";
import { Icon } from "./Icon";

export function ServerPicker() {
  const servers = useReaderStore((s) => s.servers);
  const activeId = useReaderStore((s) => s.activeServerId);
  const active = useActiveProfile();
  const [open, setOpen] = useState(false);

  if (!servers.length) return null;

  const pick = (id: string) => {
    setOpen(false);
    void useReaderStore.getState().switchServer(id);
  };

  return (
    <div className="server-picker">
      <button
        type="button"
        className="server-picker-toggle"
        aria-label={t("servers.switch")}
        aria-expanded={open}
        title={active ? `${active.host}:${active.port}` : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="label">{active?.name ?? ""}</span>
        <span className={`chevron ${open ? "open" : ""}`}>
          <Icon name="chevron" size={12} />
        </span>
      </button>
      {open && (
        <div className="server-list" role="menu" aria-label={t("servers.switch")}>
          {servers.map((p) => (
            <button
              key={p.id}
              type="button"
              role="menuitemradio"
              aria-checked={p.id === activeId}
              className={`server-option ${p.id === activeId ? "current" : ""}`}
              onClick={() => pick(p.id)}
            >
              <span className="label">{p.name}</span>
              {p.id === activeId && <Icon name="check" size={14} />}
            </button>
          ))}
          <button
            type="button"
            role="menuitem"
            className="server-option manage"
            onClick={() => {
              setOpen(false);
              useReaderStore.getState().setView("settings");
            }}
          >
            {t("servers.manage")}
          </button>
        </div>
      )}
    </div>
  );
}
