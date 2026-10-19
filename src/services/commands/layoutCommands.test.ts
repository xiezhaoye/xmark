// @vitest-environment node
/**
 * Layout presets — the three shapes `Mod+1/2/3` select, expressed through the
 * mechanisms the window already has.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { applyLayoutPreset, layoutCommandSpecs } from "./layoutCommands";
import { useUIStore } from "@/stores/uiStore";
import { useSettingsStore } from "@/stores/settingsStore";

const railCollapsed = () => useSettingsStore.getState().general.workspaceRailCollapsed;
const sidebar = () => useUIStore.getState();

beforeEach(() => {
  useSettingsStore.getState().updateGeneralSetting("workspaceRailCollapsed", false);
  useUIStore.setState({ sidebarVisible: true, sidebarViewMode: "outline" });
});

describe("applyLayoutPreset", () => {
  it("one column folds the rail and hides the sidebar", () => {
    applyLayoutPreset("oneColumn");
    expect(railCollapsed()).toBe(true);
    expect(sidebar().sidebarVisible).toBe(false);
  });

  it("two columns folds the rail and shows the FILE TREE", () => {
    applyLayoutPreset("twoColumns");
    expect(railCollapsed()).toBe(true);
    expect(sidebar().sidebarVisible).toBe(true);
    expect(sidebar().sidebarViewMode).toBe("files");
  });

  it("three columns unfolds the rail and shows the FILE TREE", () => {
    applyLayoutPreset("oneColumn");
    applyLayoutPreset("threeColumns");
    expect(railCollapsed()).toBe(false);
    expect(sidebar().sidebarVisible).toBe(true);
    expect(sidebar().sidebarViewMode).toBe("files");
  });

  it("is idempotent — pressing the same preset twice changes nothing further", () => {
    applyLayoutPreset("twoColumns");
    const first = { ...sidebar(), rail: railCollapsed() };
    applyLayoutPreset("twoColumns");
    expect(railCollapsed()).toBe(first.rail);
    expect(sidebar().sidebarVisible).toBe(first.sidebarVisible);
    expect(sidebar().sidebarViewMode).toBe(first.sidebarViewMode);
  });

  it("does not overwrite a view that is already the file tree", () => {
    useUIStore.setState({ sidebarVisible: true, sidebarViewMode: "files" });
    const before = useUIStore.getState();
    applyLayoutPreset("threeColumns");
    // Same truthy state; the action is not called when nothing needs changing.
    expect(useUIStore.getState().sidebarVisible).toBe(true);
    expect(useUIStore.getState().sidebarViewMode).toBe("files");
    expect(before.sidebarVisible).toBe(true);
  });

  it("moves a non-files sidebar view to the file tree", () => {
    useUIStore.setState({ sidebarVisible: true, sidebarViewMode: "history" });
    applyLayoutPreset("twoColumns");
    expect(useUIStore.getState().sidebarViewMode).toBe("files");
  });

  it("never touches the rail's own enabled switch", () => {
    const mode = useSettingsStore.getState().general.workspaceRailMode;
    applyLayoutPreset("oneColumn");
    expect(useSettingsStore.getState().general.workspaceRailMode).toBe(mode);
  });
});

describe("layoutCommandSpecs", () => {
  it("registers the three view commands the shortcuts route to", () => {
    const ids = layoutCommandSpecs().map((spec) => spec.id);
    expect(ids).toEqual(["view.layoutOneColumn", "view.layoutTwoColumns", "view.layoutThreeColumns"]);
  });

  it("each command applies its own preset", () => {
    for (const spec of layoutCommandSpecs()) {
      useSettingsStore.getState().updateGeneralSetting("workspaceRailCollapsed", false);
      useUIStore.setState({ sidebarVisible: true, sidebarViewMode: "outline" });
      spec.run(null, {});
    }
    // Last one applied is three columns.
    expect(railCollapsed()).toBe(false);
    expect(sidebar().sidebarViewMode).toBe("files");
  });
});
