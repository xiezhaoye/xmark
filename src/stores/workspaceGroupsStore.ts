/**
 * workspaceGroupsStore — the user's named groups of workspace folders, shown
 * as collapsible sections in the workspace rail.
 *
 * Key decisions:
 *   - **Persisted bookmarks, not open instances.** A group holds folder PATHS
 *     and outlives the session; clicking one in the rail opens (or switches
 *     to) that folder as a workspace. Open-but-ungrouped workspaces are shown
 *     in an "Ungrouped" section derived at render time, never stored here.
 *   - **A folder may sit in several groups** (tag-like), but at most once in
 *     any one group.
 *   - **Multi-window.** Every window has its own store instance over one
 *     localStorage key, so a `storage` event (fired in the OTHER windows on
 *     every write) rehydrates them. Edits are rare, single-user gestures, so a
 *     whole-list last-writer-wins is acceptable here.
 *   - **Order is the array order.** Nothing stores a rank: the rail renders
 *     `groups` and `folders` in the order they sit in, so the drag gestures in
 *     the rail commit with `reorderGroups` / `reorderFolder` /
 *     `moveFolderToGroup`. A move that changes nothing returns the SAME array,
 *     so a drag released where it started does not re-render the rail (see
 *     `moveItem`).
 *
 * @coordinates-with components/WorkspaceRail/workspaceRailModel.ts — derives the rail's sections
 * @coordinates-with components/WorkspaceRail/WorkspaceRail.tsx — renders and edits groups
 * @module stores/workspaceGroupsStore
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { createSafeStorage } from "@/services/persistence/safeStorage";

const STORAGE_KEY = "vmark-workspace-groups";

/** Bump when the persisted shape changes, and write a migration. */
const WORKSPACE_GROUPS_SCHEMA_VERSION = 1;

/** Collapsed-state key of the derived "Ungrouped" section. */
export const UNGROUPED_ID = "__ungrouped";

export interface WorkspaceGroup {
  id: string;
  name: string;
  /** Absolute folder paths, in the order they were added. */
  folders: string[];
}

interface WorkspaceGroupsState {
  groups: WorkspaceGroup[];
  /** Section id → collapsed. Absent means expanded. */
  collapsed: Record<string, boolean>;
}

interface WorkspaceGroupsActions {
  /** Create a group; a blank name becomes `fallbackName`. Returns the new id. */
  createGroup: (name: string, fallbackName?: string) => string;
  /** Rename; a blank name is ignored. */
  renameGroup: (id: string, name: string) => void;
  deleteGroup: (id: string) => void;
  addFolder: (id: string, path: string) => void;
  removeFolder: (id: string, path: string) => void;
  toggleCollapsed: (id: string) => void;
  /** Move a group so it ends up at index `toIndex` of the resulting list. */
  reorderGroups: (id: string, toIndex: number) => void;
  /** Move a folder within one group so it ends up at `toIndex` (same convention as `reorderGroups`). */
  reorderFolder: (groupId: string, fromIndex: number, toIndex: number) => void;
  /**
   * Move `path` out of `fromGroupId` into `toGroupId` at `toIndex` (clamped). A
   * target that already holds the folder keeps its own copy where it is — the
   * folder only leaves the source — so a group never lists one folder twice.
   */
  moveFolderToGroup: (fromGroupId: string, path: string, toGroupId: string, toIndex: number) => void;
}

let nextId = 0;
const makeId = () => `grp${Date.now().toString(36)}${(++nextId).toString(36)}`;

/** Apply `update` to group `id`; unchanged state when the group is missing. */
function updateGroup(
  state: WorkspaceGroupsState,
  id: string,
  update: (group: WorkspaceGroup) => WorkspaceGroup,
): Partial<WorkspaceGroupsState> {
  if (!state.groups.some((g) => g.id === id)) return state;
  return { groups: state.groups.map((g) => (g.id === id ? update(g) : g)) };
}

/**
 * Move `items[fromIndex]` so it ends up at index `toIndex` of the result,
 * clamping `toIndex` into range. This is a FINAL index, not a drag's gap index:
 * the rail converts a gap before committing (see useRailReorder).
 *
 * Returns the ORIGINAL array when the move is a no-op (same index, or a source
 * that does not exist). Array identity is the contract, not an optimisation:
 * every group edit is a gesture the user is watching, and these arrays are
 * subscribed to by the rail — a fresh copy with identical contents would
 * re-render every section for a drag that ended where it started.
 */
function moveItem<T>(items: readonly T[], fromIndex: number, toIndex: number): readonly T[] {
  if (fromIndex < 0 || fromIndex >= items.length) return items;
  const to = Math.max(0, Math.min(items.length - 1, toIndex));
  if (to === fromIndex) return items;
  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(to, 0, moved);
  return next;
}

export const useWorkspaceGroupsStore = create<WorkspaceGroupsState & WorkspaceGroupsActions>()(
  persist(
    (set) => ({
      groups: [],
      collapsed: {},

      createGroup: (name, fallbackName = "New Group") => {
        const id = makeId();
        const trimmed = name.trim();
        set((s) => ({ groups: [...s.groups, { id, name: trimmed || fallbackName, folders: [] }] }));
        return id;
      },

      renameGroup: (id, name) => {
        const trimmed = name.trim();
        if (!trimmed) return;
        set((s) => updateGroup(s, id, (g) => ({ ...g, name: trimmed })));
      },

      deleteGroup: (id) =>
        set((s) => {
          const { [id]: _removed, ...collapsed } = s.collapsed;
          return { groups: s.groups.filter((g) => g.id !== id), collapsed };
        }),

      addFolder: (id, path) =>
        set((s) =>
          updateGroup(s, id, (g) => (g.folders.includes(path) ? g : { ...g, folders: [...g.folders, path] })),
        ),

      removeFolder: (id, path) =>
        set((s) => updateGroup(s, id, (g) => ({ ...g, folders: g.folders.filter((f) => f !== path) }))),

      toggleCollapsed: (id) =>
        set((s) => ({ collapsed: { ...s.collapsed, [id]: !s.collapsed[id] } })),

      reorderGroups: (id, toIndex) =>
        set((s) => {
          const from = s.groups.findIndex((g) => g.id === id);
          const groups = moveItem(s.groups, from, toIndex);
          return groups === s.groups ? s : { groups: groups as WorkspaceGroup[] };
        }),

      reorderFolder: (groupId, fromIndex, toIndex) =>
        set((s) => {
          const group = s.groups.find((g) => g.id === groupId);
          if (!group) return s;
          const folders = moveItem(group.folders, fromIndex, toIndex);
          if (folders === group.folders) return s;
          return updateGroup(s, groupId, (g) => ({ ...g, folders: folders as string[] }));
        }),

      moveFolderToGroup: (fromGroupId, path, toGroupId, toIndex) =>
        set((s) => {
          if (fromGroupId === toGroupId) return s;
          const from = s.groups.find((g) => g.id === fromGroupId);
          const to = s.groups.find((g) => g.id === toGroupId);
          if (!from || !to || !from.folders.includes(path)) return s;
          const at = Math.max(0, Math.min(to.folders.length, toIndex));
          const target = to.folders.includes(path)
            ? to.folders
            : [...to.folders.slice(0, at), path, ...to.folders.slice(at)];
          return {
            groups: s.groups.map((g) => {
              if (g.id === fromGroupId) return { ...g, folders: g.folders.filter((f) => f !== path) };
              if (g.id === toGroupId) return { ...g, folders: target };
              return g;
            }),
          };
        }),
    }),
    {
      name: STORAGE_KEY,
      version: WORKSPACE_GROUPS_SCHEMA_VERSION,
      storage: createJSONStorage(() => createSafeStorage()),
      partialize: (s) => ({ groups: s.groups, collapsed: s.collapsed }),
    },
  ),
);

// Another window wrote the groups: pick up its version.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY) void useWorkspaceGroupsStore.persist.rehydrate();
  });
}
