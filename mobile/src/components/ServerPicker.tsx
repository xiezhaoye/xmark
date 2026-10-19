/**
 * The top of the drawer's groups column: which Mac is being read, and a way
 * to switch to another paired one or to add a new one.
 *
 * The name is always shown, even with a single server, in one narrow button
 * that never moves the column: the list is a bottom sheet instead. The sheet
 * is portalled to `document.body` because the drawer and the document carry
 * transforms, and a transformed ancestor would otherwise become the
 * containing block of anything `position: fixed` inside it.
 *
 * The sheet takes the keyboard when it opens — a tap on the backdrop or Esc
 * closes it — and gives focus back to the button it was opened from.
 *
 * @module components/ServerPicker
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useActiveProfile, useReaderStore } from "../state/readerStore";
import { t } from "../i18n";
import { Icon } from "./Icon";

export function ServerPicker() {
  const servers = useReaderStore((s) => s.servers);
  const activeId = useReaderStore((s) => s.activeServerId);
  const active = useActiveProfile();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const sheet = useRef<HTMLDivElement>(null);

  // Focus enters the sheet while it is open, and goes back to the button
  // once it closes — but only from a sheet that was actually shown, so the
  // drawer's own opening never moves the focus.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      sheet.current?.focus();
    } else if (wasOpen.current) {
      wasOpen.current = false;
      button.current?.focus();
    }
  }, [open]);

  if (!servers.length) return null;

  const close = () => setOpen(false);

  const pick = (id: string) => {
    setOpen(false);
    useReaderStore.getState().switchServer(id);
  };

  const add = () => {
    setOpen(false);
    const store = useReaderStore.getState();
    store.setDrawer(false);
    store.setView("settings");
  };

  const sheetBody = (
    <div className="server-sheet-backdrop" onClick={close}>
      <div
        ref={sheet}
        className="server-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={t("servers.switch")}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            close();
          }
        }}
      >
        <div className="sheet-handle" aria-hidden="true" />
        <button type="button" className="server-sheet-title" onClick={close}>
          {t("servers.switch")}
        </button>
        <ul role="radiogroup" aria-label={t("servers.switch")}>
          {servers.map((p) => {
            const current = p.id === activeId;
            return (
              <li key={p.id}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={current}
                  className={`server-sheet-option ${current ? "current" : ""}`}
                  onClick={() => pick(p.id)}
                >
                  <span className="sheet-option-main">
                    <span className="sheet-option-name">{p.name}</span>
                    <span className="sheet-option-address">
                      {p.host}:{p.port}
                    </span>
                  </span>
                  {current ? <Icon name="check" size={16} /> : <span className="sheet-option-spacer" />}
                </button>
              </li>
            );
          })}
        </ul>
        <button type="button" className="server-sheet-add" onClick={add}>
          ＋ {t("servers.add")}
        </button>
      </div>
    </div>
  );

  return (
    <div className="server-picker">
      <button
        ref={button}
        type="button"
        className="server-picker-toggle"
        aria-label={t("servers.switch")}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={active ? `${active.host}:${active.port}` : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="glyph-server" aria-hidden="true">
          <Icon name="server" size={14} />
        </span>
        <span className="label">{active?.name ?? ""}</span>
        <span className="chevron">
          <Icon name="chevron" size={12} />
        </span>
      </button>
      {open && typeof document !== "undefined" && createPortal(sheetBody, document.body)}
    </div>
  );
}
