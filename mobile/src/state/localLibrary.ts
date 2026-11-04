/**
 * The local library: folders on this phone, arranged in groups the user owns.
 *
 * What lives here and what does not:
 *   - **the structure** — which folders, their display names, their order,
 *     which group holds them — is this store, persisted on the phone;
 *   - **the access** — the security-scoped bookmark — is the native bookmark
 *     store (plugins/localfs). A folder is usable only while both agree, so
 *     removing it here also forgets the bookmark.
 *
 * Groups exist only here: a Mac's groups come from that Mac and stay read-only.
 * Group ids are prefixed `local:` so a surface can tell whose group it is
 * rendering without asking the store twice.
 *
 * @module state/localLibrary
 */
import { create } from "zustand";

/** A folder on this phone. `name` is the folder's own name; `label` is what the
 * user renamed it to, and is what every surface shows. */
export interface LocalFolderEntry {
  path: string;
  name: string;
  label?: string;
}

export interface LocalGroup {
  id: string;
  name: string;
  folders: LocalFolderEntry[];
}

/** The group a new folder lands in, and the one a deleted group's folders
 * return to. It is created on demand and never removed. */
export const DEFAULT_LOCAL_GROUP_ID = "local:default";
export const DEFAULT_LOCAL_GROUP_NAME = "本机文件夹";

const STORAGE_KEY = "xmark-mobile.localLibrary";
/** Ids are local; a counter keeps them stable and readable in logs. */
let groupCounter = 0;

/** What a folder is called on screen: the rename if there is one. */
export const folderLabel = (f: LocalFolderEntry): string => f.label?.trim() || f.name;

function newGroupId(): string {
  groupCounter += 1;
  return `local:g${Date.now().toString(36)}${groupCounter.toString(36)}`;
}

interface Persisted {
  groups: LocalGroup[];
}

/** Reads the library, tolerating a corrupt blob by starting empty (the native
 * bookmarks are the real grants; a lost list is recoverable by re-adding). */
export function loadLocalLibrary(): LocalGroup[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Persisted;
    if (!Array.isArray(parsed.groups)) return [];
    return parsed.groups.filter(
      (g): g is LocalGroup =>
        !!g && typeof g.id === "string" && typeof g.name === "string" && Array.isArray(g.folders),
    );
  } catch {
    return [];
  }
}

function save(groups: LocalGroup[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ groups }));
  } catch {
    // A full disk must not take the library down with it.
  }
}

interface LocalLibraryState {
  groups: LocalGroup[];
  /** Adds a folder to `groupId`, or to the default group. No duplicates by path. */
  addFolder: (folder: { path: string; name: string }, groupId?: string) => void;
  /** Removes the entry; the caller also forgets the native bookmark. */
  removeFolder: (path: string) => void;
  renameFolder: (path: string, label: string) => void;
  /** Moves a folder to `toGroupId` at `toIndex` — the one call drag reorder uses. */
  moveFolder: (path: string, toGroupId: string, toIndex: number) => void;
  addGroup: (name: string) => string;
  renameGroup: (id: string, name: string) => void;
  /** Deletes a group; its folders move to the default group, never lost. */
  removeGroup: (id: string) => void;
  /** Replaces the list (bootstrap, after the native bookmarks resolve). */
  setGroups: (groups: LocalGroup[]) => void;
}

/** The default group, created on first use. */
function withDefaultGroup(groups: LocalGroup[]): LocalGroup[] {
  if (groups.some((g) => g.id === DEFAULT_LOCAL_GROUP_ID)) return groups;
  return [{ id: DEFAULT_LOCAL_GROUP_ID, name: DEFAULT_LOCAL_GROUP_NAME, folders: [] }, ...groups];
}

export const useLocalLibrary = create<LocalLibraryState>()((set, get) => {
  const commit = (groups: LocalGroup[]) => {
    save(groups);
    set({ groups });
  };
  return {
    groups: [],

    addFolder({ path, name }, groupId = DEFAULT_LOCAL_GROUP_ID) {
      const groups = withDefaultGroup(get().groups);
      if (groups.some((g) => g.folders.some((f) => f.path === path))) return;
      commit(
        groups.map((g) => (g.id === groupId ? { ...g, folders: [...g.folders, { path, name }] } : g)),
      );
    },

    removeFolder(path) {
      commit(get().groups.map((g) => ({ ...g, folders: g.folders.filter((f) => f.path !== path) })));
    },

    renameFolder(path, label) {
      const trimmed = label.trim();
      commit(
        get().groups.map((g) => ({
          ...g,
          folders: g.folders.map((f) => (f.path === path ? { ...f, label: trimmed || undefined } : f)),
        })),
      );
    },

    moveFolder(path, toGroupId, toIndex) {
      const groups = get().groups;
      const from = groups.find((g) => g.folders.some((f) => f.path === path));
      const moved = from?.folders.find((f) => f.path === path);
      if (!from || !moved) return;
      const stripped = groups.map((g) => ({ ...g, folders: g.folders.filter((f) => f.path !== path) }));
      const target = stripped.find((g) => g.id === toGroupId);
      if (!target) return;
      const index = Math.max(0, Math.min(toIndex, target.folders.length));
      const folders = [...target.folders];
      folders.splice(index, 0, moved);
      commit(stripped.map((g) => (g.id === toGroupId ? { ...g, folders } : g)));
    },

    addGroup(name) {
      const id = newGroupId();
      commit([...withDefaultGroup(get().groups), { id, name: name.trim() || DEFAULT_LOCAL_GROUP_NAME, folders: [] }]);
      return id;
    },

    renameGroup(id, name) {
      const trimmed = name.trim();
      if (!trimmed) return;
      commit(get().groups.map((g) => (g.id === id ? { ...g, name: trimmed } : g)));
    },

    removeGroup(id) {
      if (id === DEFAULT_LOCAL_GROUP_ID) return;
      const groups = get().groups;
      const doomed = groups.find((g) => g.id === id);
      if (!doomed) return;
      const rest = groups.filter((g) => g.id !== id);
      commit(
        withDefaultGroup(rest).map((g) =>
          g.id === DEFAULT_LOCAL_GROUP_ID ? { ...g, folders: [...g.folders, ...doomed.folders] } : g,
        ),
      );
    },

    setGroups(groups) {
      commit(withDefaultGroup(groups));
    },
  };
});
