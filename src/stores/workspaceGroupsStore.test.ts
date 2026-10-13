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
