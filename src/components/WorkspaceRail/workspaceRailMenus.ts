/**
 * workspaceRailMenus — builds the right-click menu items for each kind of
 * workspace rail target: an entry (open workspace or closed folder bookmark)
 * and a group header.
 *
 * Pure builders over injected actions, so which items appear for which
 * target is tested without rendering the rail.
 *
 * @coordinates-with WorkspaceRail.tsx — supplies the actions and opens the menu
 * @coordinates-with WorkspaceRailContextMenu.tsx — renders the items
 * @module components/WorkspaceRail/workspaceRailMenus
 */
import type { WorkspaceGroup } from "@/stores/workspaceGroupsStore";
import type { RailMenuItem } from "./WorkspaceRailContextMenu";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** What the entry menu needs to know about the right-clicked row. */
export interface EntryMenuTarget {
  /** The folder path, or null for an entry with no folder (loose files). */
  path: string | null;
  /** The open instance's id, or null for a closed bookmark. */
  instanceId: string | null;
  /** The group the row was right-clicked in; null in Ungrouped. */
  groupId: string | null;
}

export interface EntryMenuActions {
  addToGroup: (groupId: string, path: string) => void;
  addToNewGroup: (path: string) => void;
  removeFromGroup: (groupId: string, path: string) => void;
  closeWorkspace: (instanceId: string) => void | Promise<void>;
  duplicateWorkspace: (instanceId: string) => void | Promise<void>;
  moveWorkspace: (instanceId: string) => void | Promise<void>;
}

/**
 * Items for an entry: group membership first (remove from this group, add to
 * each group that does not hold the folder yet, add to a new group), then —
 * for an open workspace — close / duplicate / move.
 */
export function buildEntryMenuItems(
  target: EntryMenuTarget,
  groups: readonly WorkspaceGroup[],
  actions: EntryMenuActions,
  t: Translate,
): RailMenuItem[] {
  const items: RailMenuItem[] = [];
  const { path, instanceId, groupId } = target;

  if (path) {
    const current = groupId ? groups.find((g) => g.id === groupId) : undefined;
    if (current) {
      items.push({
        action: "remove-from-group",
        label: t("workspaceRail.menu.removeFromGroup", { group: current.name }),
        run: () => actions.removeFromGroup(current.id, path),
      });
    }
    for (const group of groups) {
      if (group.folders.includes(path)) continue;
      items.push({
        action: `add-to-group:${group.id}`,
        label: t("workspaceRail.menu.addToGroup", { group: group.name }),
        run: () => actions.addToGroup(group.id, path),
      });
    }
    items.push({
      action: "add-to-new-group",
      label: t("workspaceRail.menu.addToNewGroup"),
      run: () => actions.addToNewGroup(path),
    });
  }

  if (instanceId) {
    items.push(
      { action: "close", label: t("workspaceRail.menu.close"), run: () => actions.closeWorkspace(instanceId) },
      { action: "duplicate", label: t("workspaceRail.menu.duplicate"), run: () => actions.duplicateWorkspace(instanceId) },
      {
        action: "move-to-new-window",
        label: t("workspaceRail.menu.moveToNewWindow"),
        run: () => actions.moveWorkspace(instanceId),
      },
    );
  }
  return items;
}

export interface GroupMenuActions {
  renameGroup: (groupId: string) => void;
  deleteGroup: (groupId: string) => void | Promise<void>;
}

/** Items for a group header: rename, delete. */
export function buildGroupMenuItems(groupId: string, actions: GroupMenuActions, t: Translate): RailMenuItem[] {
  return [
    { action: "rename-group", label: t("workspaceRail.menu.renameGroup"), run: () => actions.renameGroup(groupId) },
    { action: "delete-group", label: t("workspaceRail.menu.deleteGroup"), run: () => actions.deleteGroup(groupId) },
  ];
}
