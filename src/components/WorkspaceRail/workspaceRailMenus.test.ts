import { describe, expect, it, vi } from "vitest";
import type { WorkspaceGroup } from "@/stores/workspaceGroupsStore";
import { buildEntryMenuItems, buildGroupMenuItems, type EntryMenuActions } from "./workspaceRailMenus";

const t = (key: string, opts?: Record<string, unknown>) => (opts?.group ? `${key}:${String(opts.group)}` : key);

function actions(): EntryMenuActions {
  return {
    addToGroup: vi.fn(),
    addToNewGroup: vi.fn(),
    removeFromGroup: vi.fn(),
    closeWorkspace: vi.fn(),
    duplicateWorkspace: vi.fn(),
    moveWorkspace: vi.fn(),
  };
}

const groups: WorkspaceGroup[] = [
  { id: "g1", name: "A", folders: ["/m/muse"] },
  { id: "g2", name: "B", folders: [] },
];

describe("buildEntryMenuItems", () => {
  it("an open, ungrouped workspace can join each group, a new group, and has the window actions", () => {
    const items = buildEntryMenuItems({ path: "/m/x", instanceId: "wsi-x", groupId: null }, groups, actions(), t);
    expect(items.map((i) => i.action)).toEqual([
      "add-to-group:g1",
      "add-to-group:g2",
      "add-to-new-group",
      "close",
      "duplicate",
      "move-to-new-window",
    ]);
  });

  it("inside a group: remove from it, and only offer groups that lack the folder", () => {
    const a = actions();
    const items = buildEntryMenuItems({ path: "/m/muse", instanceId: null, groupId: "g1" }, groups, a, t);
    expect(items.map((i) => i.action)).toEqual(["remove-from-group", "add-to-group:g2", "add-to-new-group"]);
    expect(items[0].label).toBe("workspaceRail.menu.removeFromGroup:A");
    void items[0].run();
    expect(a.removeFromGroup).toHaveBeenCalledWith("g1", "/m/muse");
    void items[1].run();
    expect(a.addToGroup).toHaveBeenCalledWith("g2", "/m/muse");
  });

  it("loose files (no folder) get only the window actions", () => {
    const items = buildEntryMenuItems({ path: null, instanceId: "wsi-loose", groupId: null }, groups, actions(), t);
    expect(items.map((i) => i.action)).toEqual(["close", "duplicate", "move-to-new-window"]);
  });

  it("routes window actions to the right instance", () => {
    const a = actions();
    const items = buildEntryMenuItems({ path: "/m/x", instanceId: "wsi-x", groupId: null }, [], a, t);
    void items.find((i) => i.action === "close")?.run();
    expect(a.closeWorkspace).toHaveBeenCalledWith("wsi-x");
  });
});

describe("buildGroupMenuItems", () => {
  it("offers rename and delete for the group", () => {
    const renameGroup = vi.fn();
    const deleteGroup = vi.fn();
    const items = buildGroupMenuItems("g1", { renameGroup, deleteGroup }, t);
    expect(items.map((i) => i.action)).toEqual(["rename-group", "delete-group"]);
    void items[1].run();
    expect(deleteGroup).toHaveBeenCalledWith("g1");
  });
});
