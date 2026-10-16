/**
 * WorkspaceRailSection — one collapsible section of the workspace rail: a
 * user group (or the derived Ungrouped section) with its entries.
 *
 * Key decisions:
 *   - Clicking the section NAME toggles it open/closed; the state persists
 *     (workspaceGroupsStore.collapsed).
 *   - Only real groups get the "+" (add a folder via the picker), a context
 *     menu (rename / delete) and inline rename. Ungrouped is derived, so it
 *     has nothing to rename or delete.
 *   - Rename is inline: Enter or blur commits, Escape cancels; Enter/Escape
 *     during IME composition belong to the IME, not to the editor.
 *
 * @coordinates-with WorkspaceRail.tsx — owns the store calls and the menu
 * @module components/WorkspaceRail/WorkspaceRailSection
 */
import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { isImeKeyEvent } from "@/utils/imeGuard";
import type { RailSection } from "./workspaceRailModel";

interface WorkspaceRailSectionProps {
  section: RailSection;
  collapsed: boolean;
  editing: boolean;
  onToggle: () => void;
  onAddFolder: () => void;
  onHeaderContextMenu: (event: MouseEvent<HTMLButtonElement>) => void;
  onRenameCommit: (name: string) => void;
  onRenameCancel: () => void;
  /**
   * Group id whose folder rows this section's list holds, published as
   * `data-rail-folder-rows` so a folder drag measures the target group's rows
   * and no others. `null` for Ungrouped, which has no stored order to reorder
   * and is never a drop target.
   */
  folderRowsId: string | null;
  /**
   * A dragged folder is held over this group and would be appended to it —
   * the group shows no rows to drop between (collapsed or empty), so the whole
   * group is the indicator.
   */
  dropInto?: boolean;
  /**
   * Drag-to-reorder wiring. `null` for the derived Ungrouped section, which has
   * no stored order to change (its entries come from the window's instances),
   * so it neither drags nor accepts a drop.
   */
  drag?: {
    onPointerDown: (event: ReactPointerEvent) => void;
    /** Alt+Arrow moves the row one slot; the keyboard's equivalent of the drag. */
    onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
    /** This header is the row being dragged. */
    dragging: boolean;
    /** The drop lands immediately above this header. */
    dropAbove: boolean;
    /** The drop lands at the very foot of the section list. */
    dropBelow: boolean;
  } | null;
  children: ReactNode;
}

export function WorkspaceRailSection({
  section,
  collapsed,
  editing,
  onToggle,
  onAddFolder,
  onHeaderContextMenu,
  onRenameCommit,
  onRenameCancel,
  folderRowsId,
  dropInto = false,
  drag,
  children,
}: WorkspaceRailSectionProps) {
  const { t } = useTranslation();
  const isGroup = section.groupId !== null;
  const Chevron = collapsed ? ChevronRight : ChevronDown;
  const sectionClass = [
    "workspace-rail__section",
    drag?.dragging ? "workspace-rail__section--dragging" : "",
    drag?.dropAbove ? "workspace-rail__section--drop-above" : "",
    drag?.dropBelow ? "workspace-rail__section--drop-below" : "",
    dropInto ? "workspace-rail__section--drop-into" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={sectionClass}
      role="group"
      aria-label={section.name}
      // The box a folder drag hit-tests to pick its target group.
      {...(folderRowsId !== null ? { "data-rail-group-id": folderRowsId } : {})}
    >
      <div
        className="workspace-rail__section-header"
        // The row a group drag is measured against — see useRailDragReorder.
        {...(drag ? { "data-rail-row": "group" } : {})}
        onPointerDown={drag?.onPointerDown}
      >
        {editing ? (
          <GroupNameInput initial={section.name} onCommit={onRenameCommit} onCancel={onRenameCancel} />
        ) : (
          <button
            type="button"
            className="workspace-rail__section-toggle"
            data-rail-action="toggle-section"
            data-section-id={section.id}
            // The group's press target: a drag may start here (see the guard in
            // useRailDragReorder); a press that does not move still toggles.
            {...(drag ? { "data-rail-drag-handle": "group" } : {})}
            aria-expanded={!collapsed}
            onClick={onToggle}
            onContextMenu={isGroup ? onHeaderContextMenu : (event) => event.preventDefault()}
            onKeyDown={drag?.onKeyDown}
          >
            <Chevron size={14} aria-hidden="true" />
            <span className="workspace-rail__section-name">{section.name}</span>
            <span className="workspace-rail__section-count" aria-hidden="true">
              {section.entries.length}
            </span>
          </button>
        )}
        {isGroup && !editing && (
          <button
            type="button"
            className="vm-icon-btn vm-icon-btn--sm"
            aria-label={t("workspaceRail.addFolderToGroup", { group: section.name })}
            title={t("workspaceRail.addFolderToGroup", { group: section.name })}
            onClick={onAddFolder}
          >
            <Plus size={14} aria-hidden="true" />
          </button>
        )}
      </div>
      {!collapsed && (
        <div
          className="workspace-rail__section-list"
          role="list"
          {...(folderRowsId !== null ? { "data-rail-folder-rows": folderRowsId } : {})}
        >
          {section.entries.length === 0 && isGroup ? (
            <p className="workspace-rail__section-empty">{t("workspaceRail.emptyGroup")}</p>
          ) : (
            children
          )}
        </div>
      )}
    </div>
  );
}

function GroupNameInput({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLInputElement>(null);
  // Enter commits and unmounts the input, whose blur would then commit again.
  const doneRef = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const finish = (commit: boolean) => {
    if (doneRef.current) return;
    doneRef.current = true;
    if (commit) onCommit(ref.current?.value ?? "");
    else onCancel();
  };

  return (
    <input
      ref={ref}
      type="text"
      className="vm-input workspace-rail__section-input"
      aria-label={t("workspaceRail.groupName")}
      defaultValue={initial}
      onKeyDown={(event) => {
        if (isImeKeyEvent(event.nativeEvent)) return;
        if (event.key === "Enter") {
          event.preventDefault();
          finish(true);
        } else if (event.key === "Escape") {
          event.preventDefault();
          finish(false);
        }
      }}
      onBlur={() => finish(true)}
    />
  );
}
