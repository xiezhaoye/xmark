/**
 * WorkspaceRail — the first column of the window: the user's workspace GROUPS
 * as collapsible sections, each listing its folders by name, followed by an
 * "Ungrouped" section for open workspaces no group claims.
 *
 * Key decisions:
 *   - Groups are persisted folder bookmarks (workspaceGroupsStore). A folder
 *     that is open in this window shows as that workspace (click switches to
 *     it); one that is not shows outlined (click opens it). A folder may be in
 *     several groups.
 *   - Folders join groups from an entry's context menu (add to a group / a
 *     new group) or from a group's "+" (folder picker). Group headers rename
 *     inline and delete from their own context menu.
 *   - Duplicate lives only in the context menu. It used to be a hover badge on
 *     every entry, so the rail's most visible control was a rare action (open
 *     the workspace again in a new window) that was easy to hit by accident.
 *   - Rows always show the folder's own name (no "wiki 2" numbering) and
 *     are not draggable; the column folds to a strip (`workspaceRailCollapsed`).
 *   - Sections are derived by the pure `buildRailSections`; menus by
 *     `workspaceRailMenus`. This file wires stores and actions to them.
 *
 * @coordinates-with workspaceRailModel.ts — sections
 * @coordinates-with workspaceRailMenus.ts — context-menu items
 * @coordinates-with WorkspaceRailSection.tsx / WorkspaceRailEntry.tsx — rendering
 * @coordinates-with WorkspaceRailResizeHandle.tsx — rendered here; resizes this column
 * @module components/WorkspaceRail/WorkspaceRail
 */

import { ListPlus, PanelLeftClose } from "lucide-react";
import { useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "@/stores/settingsStore";
import { useWorkspaceInstancesStore } from "@/stores/workspaceInstancesStore";
import { useWorkspaceGroupsStore } from "@/stores/workspaceGroupsStore";
import { switchWorkspaceInstance } from "@/services/workspaces/switchWorkspaceInstance";
import { resolveLegacyRootId } from "@/services/workspaces/activeWorkspaceScope";
import { confirmAction } from "@/services/dialogs/confirmAction";
import { workspaceRailGlyphs } from "@/utils/workspaceRailGlyphs";
import { sidebarTextVars } from "@/utils/sidebarTextSize";
import { CollapsedColumnStrip } from "@/components/shared/CollapsedColumnStrip";
import { WorkspaceRailResizeHandle } from "./WorkspaceRailResizeHandle";
import { WorkspaceRailSection } from "./WorkspaceRailSection";
import { WorkspaceRailEntry } from "./WorkspaceRailEntry";
import { buildRailSections, type RailEntry, type RailInstance } from "./workspaceRailModel";
import { buildEntryMenuItems, buildGroupMenuItems } from "./workspaceRailMenus";
import { useRailReorder } from "./useRailReorder";
import {
  handleCloseWorkspace,
  handleDuplicateWorkspace,
  handleMoveWorkspace,
  handleOpenGroupFolder,
  pickFolderForGroup,
} from "./workspaceRailHandlers";
import {
  WorkspaceRailContextMenu,
  type RailMenuItem,
  type WorkspaceRailMenuPosition,
} from "./WorkspaceRailContextMenu";
import "./WorkspaceRail.css";

// Defined in the shell layout module (with the maths that consume it) and
// re-exported here so existing importers are unaffected.
export { WORKSPACE_RAIL_WIDTH } from "@/shell/shellChrome";

const EMPTY_IDS: string[] = [];

interface OpenMenu {
  name: string;
  items: RailMenuItem[];
  position: WorkspaceRailMenuPosition;
  /** Where focus returns on dismiss — captured per OPENING, since the menu
   *  component is reused across openings. */
  invoker: HTMLElement | null;
}

export function WorkspaceRail({ windowLabel }: { windowLabel: string }) {
  const { t } = useTranslation();
  const enabled = useSettingsStore((state) => state.general.workspaceRailMode);
  const railWidth = useSettingsStore((state) => state.general.workspaceRailWidth);
  const railCollapsed = useSettingsStore((state) => state.general.workspaceRailCollapsed);
  const sidebarFontSize = useSettingsStore((state) => state.appearance.sidebarFontSize ?? 14);
  const workspaceInstanceIds = useWorkspaceInstancesStore(
    (state) => state.windows[windowLabel]?.workspaceInstanceIds ?? EMPTY_IDS,
  );
  const activeId = useWorkspaceInstancesStore(
    (state) => state.windows[windowLabel]?.activeWorkspaceInstanceId ?? null,
  );
  const instancesById = useWorkspaceInstancesStore((state) => state.instances);
  const groups = useWorkspaceGroupsStore((state) => state.groups);
  const collapsed = useWorkspaceGroupsStore((state) => state.collapsed);
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);

  // Drag-to-reorder, and its keyboard equivalent. Declared ABOVE the two early
  // returns below, with every other hook: the folded rail returns a strip and
  // the disabled rail returns null, and a hook after either would change the
  // hook count between renders (React throws "Rendered fewer hooks than
  // expected"). The hook reads the store through
  // `useWorkspaceGroupsStore.getState()` — the repo's rule inside callbacks —
  // so it needs nothing from the render below it.
  const { listRef, isReordering, rowDrag, dropInto } = useRailReorder();

  // Clear a lingering context menu when the rail is disabled (R3-11) —
  // re-enabling must not resurrect a stale menu over an instance that may be
  // gone. Render-time guarded one-way adjustment (an effect cannot run once
  // we return null every render).
  if (!enabled) {
    if (menu) setMenu(null);
    return null;
  }

  const setCollapsed = (collapsed: boolean) =>
    useSettingsStore.getState().updateGeneralSetting("workspaceRailCollapsed", collapsed);
  // Folded, not gone: a strip whose foot holds the way back.
  if (railCollapsed) {
    return (
      <CollapsedColumnStrip
        expandLabel={t("workspaceRail.expand")}
        onExpand={() => setCollapsed(false)}
      />
    );
  }

  const instances = workspaceInstanceIds
    .map((id) => instancesById[id])
    .filter((instance) => instance !== undefined);
  const railInstances: RailInstance[] = instances.map((instance) => ({
    workspaceInstanceId: instance.workspaceInstanceId,
    kind: instance.kind,
    rootId: instance.rootId,
    rootPath: instance.rootPath,
    // Always the folder's OWN name — two folders called "wiki" both read
    // "wiki" (the tooltip shows the full path); no "wiki 2" numbering.
    // Synthetic instances (loose/placeholder) carry a translation key.
    label: instance.displayNameKey ? t(instance.displayNameKey) : instance.displayName,
  }));
  const sections = buildRailSections(groups, railInstances, resolveLegacyRootId, t("workspaceRail.ungrouped"));
  // How many rows a group reorder can land among: Ungrouped is derived and not
  // reorderable, so it is not one of them.
  const groupRowCount = groups.length;
  const glyphOf = (entry: RailEntry) =>
    workspaceRailGlyphs([{ workspaceInstanceId: "x", displayName: entry.label, kind: entry.instance?.kind ?? "workspace" }]).x;

  const groupsApi = useWorkspaceGroupsStore.getState;
  // The menu builders take a plain (key, options?) translator.
  const tr = (key: string, options?: Record<string, unknown>) => (options ? t(key, options) : t(key));
  const newGroupName = t("workspaceRail.newGroupName");

  const openMenu = (event: MouseEvent<HTMLButtonElement>, name: string, items: RailMenuItem[]) => {
    event.preventDefault();
    if (items.length === 0) return;
    setMenu({ name, items, position: { x: event.clientX, y: event.clientY }, invoker: event.currentTarget });
  };

  const entryMenu = (entry: RailEntry, groupId: string | null) =>
    buildEntryMenuItems(
      {
        // Only folders can be grouped: loose files and placeholders have none.
        path: entry.instance && entry.instance.kind !== "workspace" ? null : entry.path,
        instanceId: entry.instance?.workspaceInstanceId ?? null,
        groupId,
      },
      groups,
      {
        addToGroup: (id, path) => groupsApi().addFolder(id, path),
        addToNewGroup: (path) => {
          const id = groupsApi().createGroup("", newGroupName);
          groupsApi().addFolder(id, path);
          setEditingGroupId(id);
        },
        removeFromGroup: (id, path) => groupsApi().removeFolder(id, path),
        closeWorkspace: (id) => handleCloseWorkspace(windowLabel, id, t),
        duplicateWorkspace: (id) => handleDuplicateWorkspace(windowLabel, id, t),
        moveWorkspace: (id) => handleMoveWorkspace(windowLabel, id, t),
      },
      tr,
    );

  const groupMenu = (groupId: string, name: string) =>
    buildGroupMenuItems(
      groupId,
      {
        renameGroup: (id) => setEditingGroupId(id),
        deleteGroup: async (id) => {
          const confirmed = await confirmAction({
            title: t("workspaceRail.deleteGroupTitle", { group: name }),
            message: t("workspaceRail.deleteGroupMessage"),
            actionLabel: t("dialog:action.delete"),
            kind: "warning",
          });
          if (confirmed) groupsApi().deleteGroup(id);
        },
      },
      tr,
    );

  const addFolderToGroup = async (groupId: string) => {
    const path = await pickFolderForGroup();
    if (path) groupsApi().addFolder(groupId, path);
  };

  return (
    <nav
      className={`workspace-rail${isReordering ? " workspace-rail--reordering" : ""}`}
      aria-label={t("workspaceRail.label")}
      style={sidebarTextVars(sidebarFontSize)}
    >
      <div className="workspace-rail__list" ref={listRef}>
        {sections.map((section) => {
          // Index among the DRAGGABLE sections only: Ungrouped contributes no
          // row, so counting it would shift every index after it by one and
          // drop groups one slot short of where the user aimed.
          const groupIndex = sections.indexOf(section);
          const draggable = section.groupId !== null;
          return (
            <WorkspaceRailSection
              key={section.id}
              section={section}
              collapsed={collapsed[section.id] === true}
              editing={section.groupId !== null && editingGroupId === section.groupId}
              onToggle={() => groupsApi().toggleCollapsed(section.id)}
              onAddFolder={() => void addFolderToGroup(section.id)}
              onHeaderContextMenu={(event) => openMenu(event, section.name, groupMenu(section.id, section.name))}
              onRenameCommit={(name) => {
                groupsApi().renameGroup(section.id, name);
                setEditingGroupId(null);
              }}
              onRenameCancel={() => setEditingGroupId(null)}
              drag={
                draggable ? rowDrag({ kind: "group", groupId: section.id }, groupIndex, groupRowCount) : null
              }
              // A folder drag hit-tests this group and measures its rows.
              folderRowsId={section.groupId}
              dropInto={draggable && dropInto(section.id)}>
              {section.entries.map((entry) => (
                <WorkspaceRailEntry
                  key={entry.key}
                  entry={entry}
                  glyph={glyphOf(entry)}
                  colorSeed={entry.instance?.rootId ?? (entry.path ? resolveLegacyRootId(entry.path) : null) ?? entry.key}
                  active={entry.instance?.workspaceInstanceId === activeId}
                  onActivate={() => {
                    // The FULL context switch (stash outgoing, restore incoming
                    // tabs/panes, sidebar re-root) — not a raw flip.
                    if (entry.instance) switchWorkspaceInstance(windowLabel, entry.instance.workspaceInstanceId);
                    else if (entry.path) void handleOpenGroupFolder(windowLabel, entry.path);
                  }}
                  onContextMenu={(event) => openMenu(event, entry.label, entryMenu(entry, section.groupId))}
                  drag={
                    draggable && entry.path
                      ? rowDrag(
                          { kind: "folder", groupId: section.id, path: entry.path },
                          section.entries.indexOf(entry),
                          section.entries.length,
                        )
                      : null
                  }
                />
              ))}
            </WorkspaceRailSection>
          );
        })}
      </div>
      <div className="workspace-rail__footer">
        <button
          type="button"
          className="vm-btn vm-btn--plain vm-btn--compact workspace-rail__new-group"
          title={t("workspaceRail.newGroup")}
          onClick={() => {
            const id = groupsApi().createGroup("", newGroupName);
            setEditingGroupId(id);
          }}
        >
          <ListPlus size={14} aria-hidden="true" />
          <span>{t("workspaceRail.newGroup")}</span>
        </button>
        <button
          type="button"
          className="vm-icon-btn vm-icon-btn--lg workspace-rail__collapse"
          aria-label={t("workspaceRail.collapse")}
          aria-expanded={true}
          title={t("workspaceRail.collapse")}
          onClick={() => setCollapsed(true)}
        >
          <PanelLeftClose size={14} aria-hidden="true" />
        </button>
      </div>
      <WorkspaceRailResizeHandle width={railWidth} />
      {menu && (
        <WorkspaceRailContextMenu
          position={menu.position}
          workspaceName={menu.name}
          invoker={menu.invoker}
          items={menu.items}
          onClose={() => setMenu(null)}
        />
      )}
    </nav>
  );
}
