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
export const WORKSPACE_GROUPS_SCHEMA_VERSION = 1;

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
