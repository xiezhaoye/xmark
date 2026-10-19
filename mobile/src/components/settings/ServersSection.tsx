/**
 * The servers section: every paired Mac as a row, one of them selected like a
 * radio button, plus the one way to add another — scan its QR code.
 *
 * Adding is automatic: a scan that does not work leaves nothing behind (the
 * reason appears as a message), one that does lists the server and says so,
 * without leaving the page. Choosing a row says "selected" and also stays on
 * the page. A row can be renamed or deleted from its "more" menu, and dragged
 * by its handle (or moved with the arrow keys) to change the order, which is
 * also the order of the drawer's server picker.
 *
 * @module components/settings/ServersSection
 */
import { Fragment, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { ApiError } from "../../api/client";
import { defaultServerName, type ServerProfile } from "../../api/types";
import { parsePairLink } from "../../pairing/parsePairUrl";
import { scanQrCode } from "../../platform";
import { SERVER_NAME_MAX, useReaderStore } from "../../state/readerStore";
import { errorText, t } from "../../i18n";
import { Icon } from "../Icon";
import { useToast } from "../Toast";
import { dragTarget, moveItem, rowOffset, rowShift, type RowRect } from "./reorder";
import { useServerStatus, type ServerState } from "./useServerStatus";

/** A drag in progress: which row, how far the finger has moved, and where every row started. */
interface Drag {
  from: number;
  startY: number;
  dy: number;
  rects: RowRect[];
}

const STATE_KEY: Record<ServerState, "settings.status.checking" | "settings.status.online" | "settings.status.offline" | "settings.status.unauthorized"> = {
  checking: "settings.status.checking",
  online: "settings.status.online",
  offline: "settings.status.offline",
  unauthorized: "settings.status.unauthorized",
};

/** `host:port`, allowed to wrap after a dot so a long Tailscale name never splits its port. */
function Address({ host, port }: { host: string; port: number }) {
  const parts = host.split(".");
  return (
    <>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {part}
          {i < parts.length - 1 && (
            <>
              .<wbr />
            </>
          )}
        </Fragment>
      ))}
      :{port}
    </>
  );
}

export function ServersSection() {
  const servers = useReaderStore((s) => s.servers);
  const activeId = useReaderStore((s) => s.activeServerId);
  const status = useServerStatus(servers);
  const { toast, show } = useToast();
  const [adding, setAdding] = useState(false);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const rows = useRef(new Map<string, HTMLLIElement>());
  const store = useReaderStore.getState;

  const add = async () => {
    if (adding) return;
    setAdding(true);
    try {
      const raw = await scanQrCode();
      if (raw === null) return;
      const link = parsePairLink(raw);
      if (!link) {
        show(t("settings.badQr"), "error");
        return;
      }
      try {
        await store().makeClient(link.connection).health();
      } catch (err) {
        show(errorText(err instanceof ApiError ? err.code : "network"), "error");
        return;
      }
      const result = await store().connect(link.connection, link.name || null);
      show(t(result.status === "added" ? "settings.added" : "settings.updated", { name: result.name }));
    } catch (err) {
      show(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setAdding(false);
    }
  };

  const select = (p: ServerProfile) => {
    void store().switchServer(p.id);
    show(t("settings.selected", { name: p.name }));
  };

  const commitRename = () => {
    if (!renaming) return;
    const p = servers.find((s) => s.id === renaming.id);
    if (p) {
      // An empty name goes back to the machine name from the address.
      const name = renaming.value.trim() || defaultServerName(p.host);
      void store().updateServer(p.id, { name });
    }
    setRenaming(null);
    setMenuId(null);
  };

  const ids = servers.map((p) => p.id);

  const startDrag = (e: PointerEvent<HTMLButtonElement>, index: number) => {
    const rects = servers.map((p) => {
      const r = rows.current.get(p.id)?.getBoundingClientRect();
      return { top: r?.top ?? 0, height: r?.height ?? 0 };
    });
    e.currentTarget.setPointerCapture(e.pointerId);
    setMenuId(null);
    setConfirmId(null);
    setDrag({ from: index, startY: e.clientY, dy: 0, rects });
  };

  const moveDrag = (e: PointerEvent<HTMLButtonElement>) => {
    setDrag((d) => (d ? { ...d, dy: e.clientY - d.startY } : d));
  };

  const endDrag = (cancel: boolean) => {
    if (!drag) return;
    const to = cancel ? drag.from : dragTarget(drag.rects, drag.from, drag.dy);
    setDrag(null);
    if (to !== drag.from) store().reorderServers(moveItem(ids, drag.from, to));
  };

  const keyMove = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const to = e.key === "ArrowUp" ? index - 1 : e.key === "ArrowDown" ? index + 1 : index;
    if (to === index || to < 0 || to >= ids.length) return;
    e.preventDefault();
    store().reorderServers(moveItem(ids, index, to));
  };

  const target = drag ? dragTarget(drag.rects, drag.from, drag.dy) : -1;
  const shift = drag ? rowShift(drag.rects, drag.from) : 0;

  return (
    <>
      <button type="button" className="button primary wide" disabled={adding} onClick={() => void add()}>
        <Icon name="scan" size={18} /> {adding ? t("settings.verifying") : t("settings.scanAdd")}
      </button>
      <p className="muted hint">{t("settings.hint")}</p>

      {servers.length ? (
        <ul className="servers" role="radiogroup" aria-label={t("settings.servers")}>
          {servers.map((p, i) => {
            const state = status[p.id] ?? "checking";
            const dragging = drag?.from === i;
            const offset = drag ? rowOffset(i, drag.from, target, drag.dy, shift) : 0;
            return (
              <li
                key={p.id}
                ref={(el) => {
                  if (el) rows.current.set(p.id, el);
                  else rows.current.delete(p.id);
                }}
                className={`server ${p.id === activeId ? "current" : ""} ${dragging ? "dragging" : ""}`}
                style={offset ? { transform: `translateY(${offset}px)` } : undefined}
              >
                <div className="server-row">
                  <button type="button" role="radio" aria-checked={p.id === activeId} className="server-select" onClick={() => select(p)}>
                    <span className="radio" aria-hidden="true" />
                    <span className="server-main">
                      <span className="server-name">{p.name}</span>
                      <span className="server-address">
                        <Address host={p.host} port={p.port} />
                      </span>
                    </span>
                    <span className={`status-dot ${state}`} role="img" aria-label={t(STATE_KEY[state])} />
                  </button>
                  <button type="button" className="icon-button" aria-label={t("settings.more")} aria-expanded={menuId === p.id} onClick={() => setMenuId(menuId === p.id ? null : p.id)}>
                    <Icon name="more" />
                  </button>
                  <button
                    type="button"
                    className="icon-button grip"
                    aria-label={t("settings.drag")}
                    onPointerDown={(e) => startDrag(e, i)}
                    onPointerMove={moveDrag}
                    onPointerUp={() => endDrag(false)}
                    onPointerCancel={() => endDrag(true)}
                    onKeyDown={(e) => keyMove(e, i)}
                  >
                    <Icon name="grip" />
                  </button>
                </div>

                {menuId === p.id && !renaming && confirmId !== p.id && (
                  <div className="server-menu">
                    <button type="button" className="button small" onClick={() => setRenaming({ id: p.id, value: p.name })}>
                      {t("settings.rename")}
                    </button>
                    <button type="button" className="button small danger" onClick={() => setConfirmId(p.id)}>
                      {t("settings.remove")}
                    </button>
                  </div>
                )}

                {renaming?.id === p.id && (
                  <form
                    className="server-rename"
                    onSubmit={(e) => {
                      e.preventDefault();
                      commitRename();
                    }}
                  >
                    <input
                      autoFocus
                      aria-label={t("settings.rename")}
                      value={renaming.value}
                      maxLength={SERVER_NAME_MAX}
                      onChange={(e) => setRenaming({ id: p.id, value: e.target.value })}
                      placeholder={defaultServerName(p.host)}
                    />
                    <button type="button" className="button small" onClick={() => setRenaming(null)}>
                      {t("settings.cancel")}
                    </button>
                    <button type="submit" className="button small primary">
                      {t("settings.renameSave")}
                    </button>
                  </form>
                )}

                {confirmId === p.id && (
                  <div className="server-confirm" role="group" aria-label={t("settings.removeConfirm", { name: p.name })}>
                    <p>{t("settings.removeConfirm", { name: p.name })}</p>
                    <div className="row">
                      <button type="button" className="button small" onClick={() => setConfirmId(null)}>
                        {t("settings.cancel")}
                      </button>
                      <button
                        type="button"
                        className="button small danger"
                        onClick={() => {
                          store().removeServer(p.id);
                          setConfirmId(null);
                          setMenuId(null);
                        }}
                      >
                        {t("settings.removeYes")}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted">{t("settings.noServers")}</p>
      )}
      {toast}
    </>
  );
}
