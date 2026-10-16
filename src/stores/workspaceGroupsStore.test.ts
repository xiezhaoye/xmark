import { beforeEach, describe, expect, it } from "vitest";
import { useWorkspaceGroupsStore, UNGROUPED_ID } from "./workspaceGroupsStore";

const store = () => useWorkspaceGroupsStore.getState();

beforeEach(() => {
  localStorage.clear();
  useWorkspaceGroupsStore.setState({ groups: [], collapsed: {} });
});

describe("workspaceGroupsStore", () => {
  it("creates a group and returns its id", () => {
    const id = store().createGroup("客户项目");
    expect(store().groups).toEqual([{ id, name: "客户项目", folders: [] }]);
  });

  it("falls back to a non-empty name when given a blank one", () => {
    const id = store().createGroup("   ", "New Group");
    expect(store().groups.find((g) => g.id === id)?.name).toBe("New Group");
  });

  it("renames a group, ignoring blank names", () => {
    const id = store().createGroup("A");
    store().renameGroup(id, "  B  ");
    expect(store().groups[0].name).toBe("B");
    store().renameGroup(id, "   ");
    expect(store().groups[0].name).toBe("B");
  });

  it("deletes a group and forgets its collapsed state", () => {
    const id = store().createGroup("A");
    store().toggleCollapsed(id);
    store().deleteGroup(id);
    expect(store().groups).toEqual([]);
    expect(store().collapsed[id]).toBeUndefined();
  });

  it("adds a folder once per group", () => {
    const id = store().createGroup("A");
    store().addFolder(id, "/Users/me/muse");
    store().addFolder(id, "/Users/me/muse");
    expect(store().groups[0].folders).toEqual(["/Users/me/muse"]);
  });

  it("lets the same folder live in several groups", () => {
    const a = store().createGroup("A");
    const b = store().createGroup("B");
    store().addFolder(a, "/Users/me/muse");
    store().addFolder(b, "/Users/me/muse");
    expect(store().groups.map((g) => g.folders)).toEqual([["/Users/me/muse"], ["/Users/me/muse"]]);
  });

  it("removes a folder from one group only", () => {
    const a = store().createGroup("A");
    const b = store().createGroup("B");
    store().addFolder(a, "/x");
    store().addFolder(b, "/x");
    store().removeFolder(a, "/x");
    expect(store().groups.map((g) => g.folders)).toEqual([[], ["/x"]]);
  });

  it("ignores actions on a missing group", () => {
    store().addFolder("nope", "/x");
    store().renameGroup("nope", "B");
    expect(store().groups).toEqual([]);
  });

  it("toggles collapsed state, including for the ungrouped section", () => {
    const id = store().createGroup("A");
    store().toggleCollapsed(id);
    store().toggleCollapsed(UNGROUPED_ID);
    expect(store().collapsed).toEqual({ [id]: true, [UNGROUPED_ID]: true });
    store().toggleCollapsed(id);
    expect(store().collapsed[id]).toBe(false);
  });

  it("persists groups to localStorage", () => {
    const id = store().createGroup("A");
    store().addFolder(id, "/x");
    const raw = localStorage.getItem("vmark-workspace-groups");
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw ?? "{}").state.groups[0]).toEqual({ id, name: "A", folders: ["/x"] });
  });
});

// Reordering is how the rail's drag gestures commit: the display order IS the
// array order (`buildRailSections` maps over it verbatim), so a move is a move
// of one array element. The index is the FINAL index the element ends up at;
// a drag's drop index is a gap and is converted by the rail before it commits.
describe("workspaceGroupsStore reordering", () => {
  it("moves a group to a later position", () => {
    const a = store().createGroup("A");
    const b = store().createGroup("B");
    const c = store().createGroup("C");
    store().reorderGroups(a, 2);
    expect(store().groups.map((g) => g.id)).toEqual([b, c, a]);
  });

  it("moves a group to an earlier position", () => {
    const a = store().createGroup("A");
    const b = store().createGroup("B");
    const c = store().createGroup("C");
    store().reorderGroups(c, 0);
    expect(store().groups.map((g) => g.id)).toEqual([c, a, b]);
  });

  it("leaves the list untouched when a group is dropped on itself", () => {
    const a = store().createGroup("A");
    const b = store().createGroup("B");
    const before = store().groups;
    store().reorderGroups(a, 0);
    // Same array identity: a no-op must not wake every rail subscriber.
    expect(store().groups).toBe(before);
    expect(store().groups.map((g) => g.id)).toEqual([a, b]);
  });

  it("clamps an out-of-range destination instead of dropping the group", () => {
    const a = store().createGroup("A");
    const b = store().createGroup("B");
    store().reorderGroups(a, 99);
    expect(store().groups.map((g) => g.id)).toEqual([b, a]);
    store().reorderGroups(a, -5);
    expect(store().groups.map((g) => g.id)).toEqual([a, b]);
  });

  it("ignores a reorder for a missing group", () => {
    const a = store().createGroup("A");
    const before = store().groups;
    store().reorderGroups("nope", 0);
    expect(store().groups).toBe(before);
    expect(store().groups[0].id).toBe(a);
  });

  it("moves a folder within its group", () => {
    const id = store().createGroup("A");
    store().addFolder(id, "/one");
    store().addFolder(id, "/two");
    store().addFolder(id, "/three");
    store().reorderFolder(id, 0, 2);
    expect(store().groups[0].folders).toEqual(["/two", "/three", "/one"]);
  });

  it("moves a folder to the front of its group", () => {
    const id = store().createGroup("A");
    store().addFolder(id, "/one");
    store().addFolder(id, "/two");
    store().addFolder(id, "/three");
    store().reorderFolder(id, 2, 0);
    expect(store().groups[0].folders).toEqual(["/three", "/one", "/two"]);
  });

  it("leaves the group untouched when a folder is dropped on itself", () => {
    const id = store().createGroup("A");
    store().addFolder(id, "/one");
    store().addFolder(id, "/two");
    const before = store().groups;
    store().reorderFolder(id, 1, 1);
    expect(store().groups).toBe(before);
  });

  it("clamps a folder destination and ignores out-of-range sources", () => {
    const id = store().createGroup("A");
    store().addFolder(id, "/one");
    store().addFolder(id, "/two");
    store().reorderFolder(id, 0, 99);
    expect(store().groups[0].folders).toEqual(["/two", "/one"]);
    store().reorderFolder(id, 7, 0);
    expect(store().groups[0].folders).toEqual(["/two", "/one"]);
  });

  it("reorders only the named group when the same folder is in several", () => {
    const a = store().createGroup("A");
    const b = store().createGroup("B");
    store().addFolder(a, "/one");
    store().addFolder(a, "/two");
    store().addFolder(b, "/one");
    store().addFolder(b, "/two");
    store().reorderFolder(a, 0, 1);
    expect(store().groups.map((g) => g.folders)).toEqual([
      ["/two", "/one"],
      ["/one", "/two"],
    ]);
  });

  it("persists a reorder", () => {
    const a = store().createGroup("A");
    const b = store().createGroup("B");
    store().addFolder(a, "/one");
    store().addFolder(a, "/two");
    store().reorderGroups(b, 0);
    store().reorderFolder(a, 0, 1);
    const stored = JSON.parse(localStorage.getItem("vmark-workspace-groups") ?? "{}").state;
    expect(stored.groups.map((g: { id: string }) => g.id)).toEqual([b, a]);
    expect(stored.groups[1].folders).toEqual(["/two", "/one"]);
  });
});

// Moving a folder between groups: out of one list, into another at an index.
describe("workspaceGroupsStore moving a folder to another group", () => {
  it("removes the folder from its group and inserts it at the index in the other", () => {
    const a = store().createGroup("A");
    const b = store().createGroup("B");
    store().addFolder(a, "/one");
    store().addFolder(a, "/two");
    store().addFolder(b, "/x");
    store().addFolder(b, "/y");
    store().moveFolderToGroup(a, "/one", b, 1);
    expect(store().groups.map((g) => g.folders)).toEqual([["/two"], ["/x", "/one", "/y"]]);
  });

  it("clamps the index into the target's range", () => {
    const a = store().createGroup("A");
    const b = store().createGroup("B");
    store().addFolder(a, "/one");
    store().addFolder(b, "/x");
    store().moveFolderToGroup(a, "/one", b, 99);
    expect(store().groups.map((g) => g.folders)).toEqual([[], ["/x", "/one"]]);
  });

  it("only removes it from the source when the target already holds it", () => {
    const a = store().createGroup("A");
    const b = store().createGroup("B");
    store().addFolder(a, "/one");
    store().addFolder(b, "/x");
    store().addFolder(b, "/one");
    store().moveFolderToGroup(a, "/one", b, 0);
    expect(store().groups.map((g) => g.folders)).toEqual([[], ["/x", "/one"]]);
  });

  it("is a no-op for the same group, a missing group or a folder the source lacks", () => {
    const a = store().createGroup("A");
    const b = store().createGroup("B");
    store().addFolder(a, "/one");
    const before = store().groups;
    store().moveFolderToGroup(a, "/one", a, 0);
    store().moveFolderToGroup(a, "/one", "nope", 0);
    store().moveFolderToGroup("nope", "/one", b, 0);
    store().moveFolderToGroup(a, "/missing", b, 0);
    expect(store().groups).toBe(before);
  });

  it("persists the move", () => {
    const a = store().createGroup("A");
    const b = store().createGroup("B");
    store().addFolder(a, "/one");
    store().moveFolderToGroup(a, "/one", b, 0);
    const stored = JSON.parse(localStorage.getItem("vmark-workspace-groups") ?? "{}").state;
    expect(stored.groups.map((g: { folders: string[] }) => g.folders)).toEqual([[], ["/one"]]);
  });
});
