import { describe, expect, it } from "vitest";
import { UNGROUPED_ID, type WorkspaceGroup } from "@/stores/workspaceGroupsStore";
import { buildRailSections, folderName, type RailInstance } from "./workspaceRailModel";

const rootIdOf = (path: string) => `id:${path.replace(/\/+$/, "").toLowerCase()}`;

function ws(id: string, path: string): RailInstance {
  return { workspaceInstanceId: id, kind: "workspace", rootId: rootIdOf(path), rootPath: path, label: folderName(path) };
}

const loose: RailInstance = { workspaceInstanceId: "wsi-loose", kind: "loose", rootId: null, rootPath: null, label: "Loose Files" };

describe("folderName", () => {
  it.each([
    ["/Users/me/muse", "muse"],
    ["/Users/me/muse/", "muse"],
    ["C:\\work\\notes", "notes"],
    ["/", "/"],
  ])("%s → %s", (path, name) => {
    expect(folderName(path)).toBe(name);
  });
});

describe("buildRailSections", () => {
  it("with no groups, lists every open instance under Ungrouped", () => {
    const sections = buildRailSections([], [ws("a", "/m/muse"), loose], rootIdOf, "Ungrouped");
    expect(sections).toHaveLength(1);
    expect(sections[0].id).toBe(UNGROUPED_ID);
    expect(sections[0].entries.map((e) => e.key)).toEqual(["a", "wsi-loose"]);
  });

  it("keeps an empty Ungrouped section when there are no groups at all", () => {
    const sections = buildRailSections([], [], rootIdOf, "Ungrouped");
    expect(sections.map((s) => s.id)).toEqual([UNGROUPED_ID]);
  });

  it("links a group's folder to its open instance by root identity", () => {
    const groups: WorkspaceGroup[] = [{ id: "g1", name: "Clients", folders: ["/M/Muse/"] }];
    const sections = buildRailSections(groups, [ws("a", "/m/muse")], rootIdOf, "Ungrouped");
    expect(sections).toHaveLength(1);
    expect(sections[0].entries[0].instance?.workspaceInstanceId).toBe("a");
    expect(sections[0].entries[0].label).toBe("muse");
  });

  it("shows a closed bookmark with its folder name and no instance", () => {
    const groups: WorkspaceGroup[] = [{ id: "g1", name: "Clients", folders: ["/m/archive"] }];
    const [group] = buildRailSections(groups, [], rootIdOf, "Ungrouped");
    expect(group.entries).toEqual([{ key: "/m/archive", path: "/m/archive", instance: null, label: "archive" }]);
  });

  it("puts only unclaimed instances (and loose files) in Ungrouped, after the groups", () => {
    const groups: WorkspaceGroup[] = [{ id: "g1", name: "Clients", folders: ["/m/muse"] }];
    const sections = buildRailSections(groups, [ws("a", "/m/muse"), ws("b", "/m/other"), loose], rootIdOf, "Ungrouped");
    expect(sections.map((s) => s.id)).toEqual(["g1", UNGROUPED_ID]);
    expect(sections[1].entries.map((e) => e.key)).toEqual(["b", "wsi-loose"]);
  });

  it("lets one open folder appear in several groups", () => {
    const groups: WorkspaceGroup[] = [
      { id: "g1", name: "A", folders: ["/m/muse"] },
      { id: "g2", name: "B", folders: ["/m/muse"] },
    ];
    const sections = buildRailSections(groups, [ws("a", "/m/muse")], rootIdOf, "Ungrouped");
    expect(sections.map((s) => s.entries[0].instance?.workspaceInstanceId)).toEqual(["a", "a"]);
    expect(sections.some((s) => s.id === UNGROUPED_ID)).toBe(false);
  });
});
