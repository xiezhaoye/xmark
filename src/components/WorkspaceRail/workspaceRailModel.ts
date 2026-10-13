/**
 * workspaceRailModel — derives the rail's collapsible sections from the
 * user's groups and the window's open workspace instances.
 *
 * Purpose: one pure function, so the grouping rules are tested without React:
 *   - each group lists its folders in the order they were added; a folder
 *     that is open in this window points at that instance, otherwise it is a
 *     closed bookmark the rail can open;
 *   - "Ungrouped" lists every open instance no group claims (loose files and
 *     placeholders always land here), in the window's own order.
 *
 * Folders are matched to instances by root IDENTITY (`rootIdOf`), not by raw
 * path string, so a trailing slash or a differently-cased macOS path still
 * finds its open workspace.
 *
 * @coordinates-with stores/workspaceGroupsStore.ts — the persisted groups
 * @coordinates-with WorkspaceRail.tsx — renders the sections
 * @module components/WorkspaceRail/workspaceRailModel
 */
import type { WorkspaceGroup } from "@/stores/workspaceGroupsStore";
import { UNGROUPED_ID } from "@/stores/workspaceGroupsStore";

/** The fields of a workspace instance the rail needs. */
export interface RailInstance {
  workspaceInstanceId: string;
  kind: string;
  rootId: string | null;
  rootPath: string | null;
  /** Already localized and disambiguated by the caller. */
  label: string;
}

export interface RailEntry {
  /** Stable React key, unique within its section. */
  key: string;
  /** Folder path for a group entry, the instance's root for an ungrouped one. */
  path: string | null;
  /** The open instance in this window, or null for a closed bookmark. */
  instance: RailInstance | null;
  label: string;
}

export interface RailSection {
  id: string;
  /** null for the derived Ungrouped section. */
  groupId: string | null;
  name: string;
  entries: RailEntry[];
}

/** The last path segment, ignoring trailing separators. */
export function folderName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const parts = trimmed.split(/[\\/]/);
  return parts[parts.length - 1] || trimmed || path;
}

/**
 * Build the rail's sections: one per group, then Ungrouped (only when it has
 * entries, or when there are no groups at all).
 */
export function buildRailSections(
  groups: readonly WorkspaceGroup[],
  instances: readonly RailInstance[],
  rootIdOf: (path: string) => string | null,
  ungroupedName: string,
): RailSection[] {
  const byRootId = new Map<string, RailInstance>();
  for (const instance of instances) {
    if (instance.kind === "workspace" && instance.rootId) byRootId.set(instance.rootId, instance);
  }

  const claimed = new Set<string>();
  const sections: RailSection[] = groups.map((group) => ({
    id: group.id,
    groupId: group.id,
    name: group.name,
    entries: group.folders.map((path) => {
      const rootId = rootIdOf(path);
      const instance = rootId ? byRootId.get(rootId) ?? null : null;
      if (instance) claimed.add(instance.workspaceInstanceId);
      return { key: path, path, instance, label: instance?.label ?? folderName(path) };
    }),
  }));

  const ungrouped = instances
    .filter((instance) => !claimed.has(instance.workspaceInstanceId))
    .map((instance) => ({
      key: instance.workspaceInstanceId,
      path: instance.rootPath,
      instance,
      label: instance.label,
    }));
  if (ungrouped.length > 0 || groups.length === 0) {
    sections.push({ id: UNGROUPED_ID, groupId: null, name: ungroupedName, entries: ungrouped });
  }
  return sections;
}
