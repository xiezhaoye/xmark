/**
 * The servers section: every paired Mac as a row, one of them selected like a
 * radio button, plus the one way to add another — scan its QR code.
 *
 * Adding is automatic: a scan that does not work leaves nothing behind (the
 * reason appears as a message), one that does lists the server and says so,
 * without leaving the page. Choosing a row says "switched" and also stays on
 * the page; a row already current says nothing and reloads nothing. A row can
 * be renamed or deleted from its "more" menu, and reordered by pressing and
 * holding it (or with Alt+arrow keys), which is also the order of the
 * drawer's server picker. A press that moves before it becomes a hold is an
 * ordinary scroll, never a drag.
 *
 * @module components/settings/ServersSection
 */
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type TouchEvent } from "react";
import { ApiError } from "../../api/client";
import { defaultServerName, type ServerProfile } from "../../api/types";
import { parsePairLink } from "../../pairing/parsePairUrl";
import { scanQrCode } from "../../platform";
import { SERVER_NAME_MAX, useReaderStore } from "../../state/readerStore";
import { errorText, t } from "../../i18n";
import { Icon } from "../Icon";
import { Modal } from "../Modal";
import { useToast } from "../Toast";
import { createLongPress, type LongPress } from "./longPress";
import { dragTarget, moveItem, rowOffset, rowShift, type RowRect } from "./reorder";
import { SERVER_STATE_KEY, useServerStatus } from "./useServerStatus";

/** A drag in progress: which row, how far the finger has moved, and where every row started. */
interface Drag {
  from: number;
  /** Screen y where the drag began. */
  startY: number;
  dy: number;
  rects: RowRect[];
}


/** Where each row starts on screen, so a drag knows what it is passing. */
const rowRects = (servers: ServerProfile[], rows: Map<string, HTMLLIElement>): RowRect[] =>
  servers.map((p) => {
    const r = rows.get(p.id)?.getBoundingClientRect();
    return { top: r?.top ?? 0, height: r?.height ?? 0 };
  });

export function ServersSection() {
  const servers = useReaderStore((s) => s.servers);
  const activeId = useReaderStore((s) => s.activeServerId);
  const status = useServerStatus(servers);
  const { toast, show } = useToast();
  const [adding, setAdding] = useState(false);
  // Adding a Mac is a choice now: point the camera at a code, or paste the line
  // the Mac printed. The scan covers the screen (components/ScanScreen), so the
  // two paths share one sheet that never guesses which one you wanted.
  const [addStep, setAddStep] = useState<"idle" | "choose" | "code">("idle");
  const [code, setCode] = useState("");
  const [menuId, setMenuId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const rows = useRef(new Map<string, HTMLLIElement>());
  const list = useRef<HTMLUListElement | null>(null);
  const store = useReaderStore.getState;

  /** Health-check, then pair. Shared by the camera and the pasted link. */
  const connectWithLink = async (raw: string): Promise<void> => {
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
    setAddStep("idle");
    setCode("");
  };

  const scan = async () => {
    if (adding) return;
    setAdding(true);
    try {
      const raw = await scanQrCode();
      if (raw === null) return;
      await connectWithLink(raw);
    } catch (err) {
      show(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setAdding(false);
    }
  };

  const submitCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (adding || !code.trim()) return;
    setAdding(true);
    try {
      await connectWithLink(code);
    } finally {
      setAdding(false);
    }
  };

  /** Picking the current row again is not a switch: no message, no reload. */
  const select = (p: ServerProfile) => {
    if (p.id === store().activeServerId) return;
    void store().switchServer(p.id);
    // Half the usual stay: the row itself already shows the new selection.
    show(t("settings.switched"), "ok", 900);
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

  const reorder = (from: number, to: number) => {
    if (to !== from) store().reorderServers(moveItem(ids, from, to));
  };

  // --- Long press to drag -------------------------------------------------

  const dragRef = useRef<Drag | null>(null);
  const fromIndex = useRef<number | null>(null);
  const pressPointer = useRef<{ id: number; el: Element } | null>(null);
  const pressY = useRef(0);
  const swallowClick = useRef(false);
  // The controller in use: the one built at mount, until an effect replaces it
  // with one that sees the current rows.
  const longPress = useRef<LongPress>({ down: () => {}, move: () => {}, up: () => false, cancel: () => {}, active: false });

  const setDragged = (next: Drag | null) => {
    dragRef.current = next;
    setDrag(next);
  };

  /** Keeping the pointer on the row lets it keep reporting moves past its edges. */
  const takeCapture = () => {
    const held = pressPointer.current;
    try {
      (held?.el as (Element & { setPointerCapture?: (id: number) => void }) | undefined)?.setPointerCapture?.(held?.id as number);
    } catch {
      // Capture is a convenience: the arrow keys still reorder without it.
    }
  };

  const releaseCapture = () => {
    const held = pressPointer.current;
    pressPointer.current = null;
    try {
      (held?.el as (Element & { releasePointerCapture?: (id: number) => void }) | undefined)?.releasePointerCapture?.(held?.id as number);
    } catch {
      // Already released by the browser.
    }
  };

  /** The hold has become a drag: freeze where every row is, and follow the finger from here. */
  const onHold = () => {
    const from = fromIndex.current;
    fromIndex.current = null;
    if (from === null) return;
    takeCapture();
    setMenuId(null);
    setConfirmId(null);
    // Nobody has moved yet: the drag starts from where the finger went down.
    setDragged({ from, startY: pressY.current, dy: 0, rects: rowRects(servers, rows.current) });
  };

  const endDrag = (cancel: boolean) => {
    releaseCapture();
    const d = dragRef.current;
    if (!d) return;
    const to = cancel ? d.from : dragTarget(d.rects, d.from, d.dy);
    setDragged(null);
    reorder(d.from, to);
  };

  const pressDown = (e: PointerEvent<HTMLButtonElement>, index: number) => {
    if (e.pointerType === "mouse") return;
    fromIndex.current = index;
    pressPointer.current = { id: e.pointerId, el: e.currentTarget };
    pressY.current = e.clientY;
    longPress.current.down(e.clientX, e.clientY);
  };

  const pressMove = (e: PointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current;
    if (d) {
      setDragged({ ...d, dy: e.clientY - d.startY });
      return;
    }
    longPress.current.move(e.clientX, e.clientY);
  };

  const pressUp = () => {
    fromIndex.current = null;
    releaseCapture();
    const dragged = longPress.current.up() || dragRef.current !== null;
    if (dragRef.current) endDrag(false);
    if (dragged) swallowClick.current = true;
  };

  const pressCancel = () => {
    fromIndex.current = null;
    releaseCapture();
    longPress.current.cancel();
    endDrag(true);
  };

  const onSelectClick = (e: MouseEvent<HTMLButtonElement>, p: ServerProfile) => {
    if (swallowClick.current) {
      swallowClick.current = false;
      e.preventDefault();
      return;
    }
    select(p);
  };

  // A second finger or an interrupted gesture gives up, and the click that
  // follows a drag must not pick the row.
  const onListTouchStart = (e: TouchEvent<HTMLElement>) => {
    if (e.touches.length > 1) {
      fromIndex.current = null;
      longPress.current.cancel();
      endDrag(true);
    }
  };
  const onListTouchEnd = () => {
    fromIndex.current = null;
    const dragged = longPress.current.up() || dragRef.current !== null;
    if (dragRef.current) endDrag(false);
    if (dragged) swallowClick.current = true;
  };
  const onListTouchCancel = () => {
    fromIndex.current = null;
    longPress.current.cancel();
    endDrag(true);
    swallowClick.current = true;
  };

  // The controller is rebuilt from what the rows are now, so a press always
  // drags the list as the page shows it.
  useEffect(() => {
    longPress.current = createLongPress({ onStart: onHold });
    return () => longPress.current.cancel();
  });

  // React's touch handlers are passive, so the page can only be kept still
  // while dragging from a native listener.
  useEffect(() => {
    const el = list.current;
    if (!el) return;
    const onTouchMove = (e: globalThis.TouchEvent) => {
      if (dragRef.current) e.preventDefault();
    };
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => el.removeEventListener("touchmove", onTouchMove);
  }, []);

  // Alt+arrow keys move the row, on the row's own radio button.
  const keyMove = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!e.altKey) return;
    const to = e.key === "ArrowUp" ? index - 1 : e.key === "ArrowDown" ? index + 1 : index;
    if (to === index || to < 0 || to >= ids.length) return;
    e.preventDefault();
    reorder(index, to);
  };

  const target = drag ? dragTarget(drag.rects, drag.from, drag.dy) : -1;
  const shift = drag ? rowShift(drag.rects, drag.from) : 0;

  return (
    <>
      {servers.length ? (
        <ul
          ref={list}
          className="servers"
          role="radiogroup"
          aria-label={t("settings.servers")}
          onTouchStart={onListTouchStart}
          onTouchEnd={onListTouchEnd}
          onTouchCancel={onListTouchCancel}
        >
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
                data-local={p.local ? "true" : undefined}
                style={offset ? { transform: `translateY(${offset}px)` } : undefined}
              >
                <div className="server-row">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={p.id === activeId}
                    className="server-select"
                    onClick={(e) => onSelectClick(e, p)}
                    onPointerDown={(e) => pressDown(e, i)}
                    onPointerMove={pressMove}
                    onPointerUp={pressUp}
                    onPointerCancel={pressCancel}
                    onKeyDown={(e) => keyMove(e, i)}
                  >
                    {/* No radio button: the status dot IS the leading mark, in the
                        slot the radio used to occupy. The phone itself has no
                        reachability to report, so its row carries no dot. */}
                    {!p.local && (
                      <span className={`status-dot ${state}`} role="img" aria-label={t(SERVER_STATE_KEY[state])} />
                    )}
                    <span className="server-main">
                      <span className="server-title">
                        <span className="server-name">{p.name}</span>
                      </span>
                    </span>
                  </button>
                  {/* The phone itself is not a paired Mac: no rename, no
                      remove, no drag. Only the folder library inside it is the
                      user's to arrange (drawer column 1). */}
                  {!p.local && (
                    <button type="button" className="icon-button" aria-label={t("settings.more")} aria-expanded={menuId === p.id} onClick={() => setMenuId(menuId === p.id ? null : p.id)}>
                      <Icon name="more" />
                    </button>
                  )}
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

      {/* Adding sits under the list it adds to, and asks HOW first. */}
      <button type="button" className="button wide" onClick={() => setAddStep("choose")}>
        <Icon name="scan" size={18} /> {t("settings.addServer")}
      </button>
      {/* How to pair is a choice, so it is asked in a dialog: a code or the camera. */}
      {addStep === "choose" && (
        <Modal label={t("settings.addServer")} onClose={() => setAddStep("idle")}>
          <h2 className="modal-title">{t("settings.addServer")}</h2>
          <div className="choose-dialog">
            <button type="button" className="button" onClick={() => setAddStep("code")}>
              {t("settings.addChoice.code")}
            </button>
            <button type="button" className="button" disabled={adding} onClick={() => { setAddStep("idle"); void scan(); }}>
              <Icon name="scan" size={18} /> {adding ? t("settings.verifying") : t("settings.addChoice.scan")}
            </button>
            <button type="button" className="button" onClick={() => setAddStep("idle")}>
              {t("settings.cancel")}
            </button>
          </div>
        </Modal>
      )}
      {addStep === "code" && (
        <Modal label={t("settings.addChoice.code")} onClose={() => setAddStep("choose")}>
          <form className="rename-dialog" onSubmit={(e) => void submitCode(e)}>
            <h2 className="modal-title">{t("settings.addChoice.code")}</h2>
            <input
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={t("settings.pairCodePlaceholder")}
              aria-label={t("settings.pairCodeLabel")}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
            <p className="hint">{t("settings.pairCodeHint")}</p>
            <div className="modal-actions">
              <button type="button" className="button" onClick={() => { setAddStep("choose"); setCode(""); }}>
                {t("settings.cancel")}
              </button>
              <button type="submit" className="button primary" disabled={adding || !code.trim()}>
                {adding ? t("settings.verifying") : t("settings.connect")}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {toast}
    </>
  );
}
