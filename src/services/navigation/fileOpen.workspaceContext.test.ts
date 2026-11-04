// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fileBytes } from "@/test/fileBytes";

vi.mock("@tauri-apps/plugin-fs", () => ({
  readFile: vi.fn(() => fileBytes("# Preview")),
}));

import { readFile } from "@tauri-apps/plugin-fs";
import { handleOpenFile } from "./fileOpen";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { usePaneStore } from "@/stores/paneStore";
import { useWorkspaceInstancesStore } from "@/stores/workspaceInstancesStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { createWorkspaceInstance, createWorkspaceRootIdentity } from "@/utils/workspaceIdentity";
import { rebootstrapFormats } from "@/lib/formats/registryBootstrap";

function addWorkspace(id: string, path: string) {
  const root = createWorkspaceRootIdentity(path, { platform: "macos" });
  if (!root.ok) throw new Error("invalid test root");
  useWorkspaceInstancesStore.getState().addWorkspaceInstance(createWorkspaceInstance({
    workspaceInstanceId: id, root: root.root, ownerWindowLabel: "main", createdFrom: "open",
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  rebootstrapFormats();
  useSettingsStore.getState().updateGeneralSetting("workspaceRailMode", true);
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0 });
  useDocumentStore.setState({ documents: {} });
  usePaneStore.setState({ byWindow: {} });
  useWorkspaceStore.getState().closeWorkspace();
  useWorkspaceInstancesStore.getState().resetWorkspaceInstances();
  addWorkspace("parent", "/项目/A");
  addWorkspace("child", "/项目/A/B");
  addWorkspace("deep", "/项目/A/B/C");
  useWorkspaceInstancesStore.getState().activateWorkspaceInstance("main", "parent");
});

describe("file explorer keeps the selected workspace", () => {
  it.each(["/项目/A/B/笔记.md", "/项目/A/B/C/笔记.md", "/项目/A/B/C/图片.png"])(
    "opens %s under the selected parent without jumping to its nested bookmark", async (path) => {
      await handleOpenFile("main", path);

      const state = useWorkspaceInstancesStore.getState();
      const tabId = useTabStore.getState().activeTabId.main;
      expect(state.windows.main.activeWorkspaceInstanceId).toBe("parent");
      expect(state.instances.parent.tabIds).toContain(tabId);
      expect(state.instances.child.tabIds).not.toContain(tabId);
      expect(state.instances.deep.tabIds).not.toContain(tabId);
      expect(useDocumentStore.getState().getDocument(tabId!)?.filePath).toBe(path);
    },
  );

  it("keeps the parent selected when previewing a file already open in the child", async () => {
    const path = "/项目/A/B/笔记.md";
    const tabId = useTabStore.getState().createTab("main", path);
    useDocumentStore.getState().initDocument(tabId, "# Unsaved preview", path);
    useWorkspaceInstancesStore.getState().setWorkspaceInstanceTabs("child", [tabId], tabId);

    await handleOpenFile("main", path);

    const state = useWorkspaceInstancesStore.getState();
    expect(state.windows.main.activeWorkspaceInstanceId).toBe("parent");
    expect(state.instances.parent.tabIds).toContain(tabId);
    expect(state.instances.child.tabIds).not.toContain(tabId);
    expect(useTabStore.getState().activeTabId.main).toBe(tabId);
    expect(useDocumentStore.getState().getDocument(tabId)?.content).toBe("# Unsaved preview");
    expect(readFile).not.toHaveBeenCalled();
  });

  it("keeps a manually selected child when opening deeper descendants", async () => {
    useWorkspaceInstancesStore.getState().activateWorkspaceInstance("main", "child");
    await handleOpenFile("main", "/项目/A/B/C/笔记.md");
    expect(useWorkspaceInstancesStore.getState().windows.main.activeWorkspaceInstanceId).toBe("child");
  });

  it("still resolves a different workspace when the file is outside the selection", async () => {
    addWorkspace("other", "/项目/AB");
    await handleOpenFile("main", "/项目/AB/笔记.md");
    expect(useWorkspaceInstancesStore.getState().windows.main.activeWorkspaceInstanceId).toBe("other");
  });
});
