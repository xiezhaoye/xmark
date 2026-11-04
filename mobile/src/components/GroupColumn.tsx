/**
 * Drawer column 1: workspace groups (collapsible) and their folders.
 *
 * Drawn like the Mac's workspace rail: a group is a larger, bold heading with
 * its folder count; each folder carries a coloured one-character glyph from
 * its name; the selected folder gets the accent fill and a coloured bar on its
 * left edge. A folder the Mac cannot serve shows an outlined glyph and, when
 * tapped, explains why.
 *
 * Groups the phone owns are prefixed `local:` (see `state/localLibrary`) and
 * are the only ones this column can change: they get the two buttons at the
 * bottom, a long-press menu (rename / delete), and drag-to-reorder. A Mac's
 * groups are somebody else's arrangement — they are listed, never edited.
 *
 * @module components/GroupColumn
 */
import { useEffect, useRef, useState } from "react";
import { useReaderStore } from "../state/readerStore";
import { errorText, t } from "../i18n";
import { Icon } from "./Icon";
import { railColor, railGlyph } from "../render/railIdentity";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { StatusMessage } from "./StatusMessage";
import { useLocalLibrary } from "../state/localLibrary";
import { forgetLocalFolder, pickLocalFolder } from "../platformLocalFS";
import { RenameDialog } from "./settings/RenameDialog";

const LONG_PRESS_MS = 500;
/** A drag starts only after the finger has travelled this far, so a tap stays a tap. */
const DRAG_START_PX = 6;

/** Which local entry a menu is open for. */
type Menu =
  | { kind: "folder"; path: string; name: string; groupId: string }
  | { kind: "group"; id: string; name: string; groupKey: string }
  | null;

const isLocalGroup = (id: string) => id.startsWith("local:");

export function GroupColumn() {
  const groups = useReaderStore((s) => s.groups);
  const groupsError = useReaderStore((s) => s.groupsError);
  const collapsed = useReaderStore((s) => s.collapsedGroups);
  const selected = useReaderStore((s) => s.selectedRootId);
  const [hint, setHint] = useState<string | null>(null);
  const [menu, setMenu] = useState<Menu>(null);
  // Renaming is a dialog, never a field inside the rail.
  const [rename, setRename] = useState<{ kind: "folder" | "group"; id: string; value: string; title: string } | null>(null);
  const [drag, setDrag] = useState<{ path: string; overGroup: string; overIndex: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressOrigin = useRef<{ x: number; y: number; path: string; groupId: string } | null>(null);

  const pressStart = (full: string) => {
    timer.current = setTimeout(() => setHint(full), LONG_PRESS_MS);
  };
  const pressEnd = () => {
    if (timer.current) clearTimeout(timer.current);
  };

  const library = () => useLocalLibrary.getState();

  // A tap anywhere else closes the ⋯ sheet. The trigger itself is excluded: its
  // own click toggles, and closing on pointerdown first would fight that.
  useEffect(() => {
    if (!menu) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (target?.closest(".local-menu, .group-more")) return;
      setMenu(null);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [menu]);

  /* ---- actions ------------------------------------------------------- */

  /** Picks a folder and files it under `groupId` (the default group by default). */
  const addFolder = async (groupId?: string) => {
    try {
      const folder = await pickLocalFolder();
      // The picker's name is the folder's own; the library keeps it as the row.
      library().addFolder({ path: folder.path, name: folder.name }, groupId);
      await useReaderStore.getState().connectLocal();
      await useReaderStore.getState().refreshWorkspaces();
    } catch (err) {
      const code = err instanceof Error ? err.message : String(err);
      if (!code.includes("cancelled")) setHint(errorText(code));
    }
  };

  const removeFolder = (path: string) => {
    library().removeFolder(path);
    void forgetLocalFolder(path);
    void useReaderStore.getState().refreshWorkspaces();
  };

  /* ---- drag to reorder ----------------------------------------------- */

  const beginDrag = (e: ReactPointerEvent<HTMLButtonElement>, path: string, groupId: string) => {
    pressOrigin.current = { x: e.clientX, y: e.clientY, path, groupId };
  };

  const moveDrag = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const origin = pressOrigin.current;
    if (!origin) return;
    if (!drag && Math.hypot(e.clientX - origin.x, e.clientY - origin.y) < DRAG_START_PX) return;
    // The row under the finger decides the destination; any local folder row
    // of any local group is a target, so moving between groups is the same
    // gesture as reordering inside one.
    const under = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-local-folder]");
    const groupId = under?.dataset.groupId;
    const index = under ? Number(under.dataset.index ?? 0) : 0;
    setDrag({ path: origin.path, overGroup: groupId ?? origin.groupId, overIndex: index });
    if (timer.current) clearTimeout(timer.current);
  };

  const endDrag = () => {
    const origin = pressOrigin.current;
    pressOrigin.current = null;
    const target = drag;
    setDrag(null);
    if (!origin || !target) return;
    library().moveFolder(origin.path, target.overGroup, target.overIndex);
    void useReaderStore.getState().refreshWorkspaces();
  };

  /* ---- render --------------------------------------------------------- */

  if (groupsError) return <StatusMessage tone="error" text={errorText(groupsError)} onRetry={() => void useReaderStore.getState().refreshWorkspaces()} />;

  return (
    <div className="groups-pane">
      <nav className="groups" aria-label={t("drawer.groups")}>
        {hint && (
          <button type="button" className="hint" onClick={() => setHint(null)}>
            {hint}
          </button>
        )}
        {!groups.length && <StatusMessage text={t("drawer.noGroups")} />}
        {groups.map((g) => {
          const local = isLocalGroup(g.id);
          return (
            <section key={g.id} className="group">
              <button
                type="button"
                className="group-title"
                aria-expanded={!collapsed[g.id]}
                onClick={() => useReaderStore.getState().toggleGroup(g.id)}
                onTouchStart={() => (local ? undefined : pressStart(g.name))}
                onTouchEnd={pressEnd}
                onTouchMove={pressEnd}
                onContextMenu={(e) => {
                  if (!local) return;
                  e.preventDefault();
                  setMenu({ kind: "group", id: g.id, name: g.name, groupKey: g.id });
                }}
              >
                <span className={`chevron ${collapsed[g.id] ? "" : "open"}`}>
                  <Icon name="chevron" size={14} />
                </span>
                <span className="label">{g.name}</span>
                <span className="group-count">{g.folders.length}</span>
                {local && (
                  <span
                    role="button"
                    tabIndex={0}
                    className="group-more"
                    aria-label={t("side.actions", { name: g.name })}
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenu({ kind: "group", id: g.id, name: g.name, groupKey: g.id });
                    }}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter" && e.key !== " ") return;
                      e.preventDefault();
                      e.stopPropagation();
                      setMenu({ kind: "group", id: g.id, name: g.name, groupKey: g.id });
                    }}
                  >
                    <Icon name="more" size={16} />
                  </span>
                )}
              </button>
              {!collapsed[g.id] &&
                (g.folders.length ? (
                  g.folders.map((f, i) => (
                    <button
                      type="button"
                      key={f.rootId}
                      data-local-folder={local ? f.rootId : undefined}
                      data-group-id={local ? g.id : undefined}
                      data-index={local ? i : undefined}
                      className={`folder ${selected === f.rootId ? "selected" : ""} ${f.available ? "" : "unavailable"} ${drag?.path === f.rootId ? "dragging" : ""}`}
                      aria-current={selected === f.rootId}
                      onClick={() => {
                        if (!f.available) setHint(t("drawer.unavailable"));
                        void useReaderStore.getState().selectRoot(f.rootId);
                      }}
                      onContextMenu={(e) => {
                        if (!local) return;
                        e.preventDefault();
                        setMenu({ kind: "folder", path: f.rootId, name: f.name, groupId: g.id });
                      }}
                      onTouchStart={() => (local ? undefined : pressStart(f.name))}
                      onTouchEnd={pressEnd}
                      onTouchMove={pressEnd}
                      onPointerDown={local ? (e) => beginDrag(e, f.rootId, g.id) : undefined}
                      onPointerMove={local ? moveDrag : undefined}
                      onPointerUp={local ? endDrag : undefined}
                      onPointerCancel={local ? endDrag : undefined}
                      style={{ "--rail-color": railColor(f.rootId) } as CSSProperties}
                    >
                      <span className="glyph" aria-hidden="true">
                        {railGlyph(f.name)}
                      </span>
                      <span className="label">{f.name}</span>
                    </button>
                  ))
                ) : (
                  <p className="empty">{t("drawer.emptyGroup")}</p>
                ))}
            </section>
          );
        })}
        {menu && (
          <LocalMenu
            menu={menu}
            onClose={() => setMenu(null)}
            onAddFolder={(groupId) => void addFolder(groupId)}
            onRename={setRename}
            onDeleteFolder={removeFolder}
          />
        )}
      </nav>


      {rename && (
        <RenameDialog
          title={rename.title}
          initial={rename.value}
          onCancel={() => setRename(null)}
          onConfirm={(value) => {
            if (rename.kind === "folder") library().renameFolder(rename.id, value);
            else library().renameGroup(rename.id, value);
            setRename(null);
            void useReaderStore.getState().refreshWorkspaces();
          }}
        />
      )}
      {drag && <div className="drag-marker" aria-hidden="true" />}
    </div>
  );
}

/** The long-press / ⋯ menu for a local folder or group. */
function LocalMenu({
  menu,
  onClose,
  onAddFolder,
  onRename,
  onDeleteFolder,
}: {
  menu: Exclude<Menu, null>;
  onClose: () => void;
  onAddFolder: (groupId: string) => void;
  onRename: (target: { kind: "folder" | "group"; id: string; value: string; title: string }) => void;
  onDeleteFolder: (path: string) => void;
}) {
  const name = menu.name;
  return (
    <div className="local-menu" role="dialog" aria-label={t("side.actions", { name })}>
      {/* Groups are fixed (the default one and nothing else), so the only
          group-level action is adding a folder INTO it. Editing lives on the
          folder itself. */}
      {menu.kind === "group" ? (
        <button
          type="button"
          className="local-menu-item"
          onClick={() => {
            onClose();
            onAddFolder(menu.id);
          }}
        >
          {t("side.addFolder")}
        </button>
      ) : (
        <>
          <button
            type="button"
            className="local-menu-item"
            onClick={() => {
              onClose();
              onRename({ kind: "folder", id: menu.path, value: name, title: t("side.rename") });
            }}
          >
            {t("side.rename")}
          </button>
          <button
            type="button"
            className="local-menu-item danger"
            onClick={() => {
              onClose();
              onDeleteFolder(menu.path);
            }}
          >
            {t("side.delete")}
          </button>
        </>
      )}
      <button type="button" className="local-menu-item" onClick={onClose}>
        {t("settings.cancel")}
      </button>
    </div>
  );
}
