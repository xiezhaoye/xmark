/**
 * useRailWiring — what the rail's rows and menus are made of: the derived
 * sections, the per-entry glyphs, and the two context-menu builders wired to
 * their actions.
 *
 * Purpose: `WorkspaceRail` had grown past the file-size gate by carrying the
 * layout, the store subscriptions AND every menu action. This hook is the
 * second half — mechanical derivation and action wiring, no JSX — so the
 * component stays a component. Behaviour is unchanged: the same builders, the
 * same actions, the same translation keys.
 *
 * Side-effect notes: `groupsApi` is read through `getState()` inside the
 * callbacks (the repo's rule), so this hook needs no subscription of its own;
 * `setEditingGroupId`/`openMenu` are the component's own setters, passed in.
 *
 * @coordinates-with WorkspaceRail.tsx — the caller and its layout
 * @coordinates-with workspaceRailMenus.ts — the menu item builders
 * @module components/WorkspaceRail/useRailWiring
 */

import { useTranslation } from "react-i18next";
import { useWorkspaceGroupsStore } from "@/stores/workspaceGroupsStore";
import { resolveLegacyRootId } from "@/services/workspaces/activeWorkspaceScope";
import { confirmAction } from "@/services/dialogs/confirmAction";
import { workspaceRailGlyphs } from "@/utils/workspaceRailGlyphs";
import { buildRailSections, type RailEntry, type RailInstance } from "./workspaceRailModel";
import { buildEntryMenuItems, buildGroupMenuItems } from "./workspaceRailMenus";
import {
  handleCloseWorkspace,
  handleDuplicateWorkspace,
  handleMoveWorkspace,
  pickFolderForGroup,
} from "./workspaceRailHandlers";

/** The identity fields a rail instance is built from (see `workspaceRailModel`). */
interface RailInstanceRow {
  workspaceInstanceId: string;
  kind: string;
  rootId: string | null;
  rootPath: string | null;
  displayName: string;
  displayNameKey?: string | undefined;
}

export interface RailWiringOptions {
  windowLabel: string;
  instances: RailInstanceRow[];
  groups: ReturnType<typeof useWorkspaceGroupsStore.getState>["groups"];
  editingGroupId: string | null;
  setEditingGroupId: (id: string | null) => void;
}

export function useRailWiring({ windowLabel, instances, groups, setEditingGroupId }: RailWiringOptions) {
  const { t } = useTranslation();
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

  return { sections, groupRowCount, glyphOf, entryMenu, groupMenu, addFolderToGroup, tr, newGroupName };
}
