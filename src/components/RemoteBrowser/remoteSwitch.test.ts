/**
 * Switching a window to a remote server and back must not disturb what was
 * open locally: the tabs, the unsaved document content, the sidebar state.
 *
 * The remote shell REPLACES what the three columns render. This test proves the
 * property a user cares about — my unsaved work is still there — by driving the
 * stores the way the shell does and asserting the document survives, including
 * across a switch away and back.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { useUIStore } from "@/stores/uiStore";
import { useRemoteSessionStore } from "@/stores/remoteSessionStore";
import { useRemoteBrowserStore } from "@/stores/remoteBrowserStore";

const TAB = "tab-unsaved";

beforeEach(() => {
  useRemoteSessionStore.setState({ active: {} });
  useRemoteBrowserStore.setState({
    serverId: null,
    connection: null,
    groups: [],
    groupsStatus: "idle",
    groupsMessage: null,
    activeRootId: null,
    doc: null,
    levels: {},
    expanded: {},
    seq: 0,
  });
});

describe("switching to a remote server", () => {
  it("keeps an unsaved document exactly as it was", () => {
    useDocumentStore.getState().initDocument(TAB, "draft.md", "line one\nedited line\n");
    useDocumentStore.getState().setEditorContent(TAB, "line one\nedited line\nand more\n");
    const before = useDocumentStore.getState().documents[TAB];
    expect(before?.content).toContain("and more");

    // The switch: the shell renders the remote regions instead of the local ones.
    useRemoteSessionStore.getState().setActive("main", "server-1");
    useRemoteSessionStore.getState().setActive("main", null);

    const after = useDocumentStore.getState().documents[TAB];
    expect(after?.content).toBe(before?.content);
    expect(after?.filePath).toBe(before?.filePath);
  });

  it("leaves the sidebar's own state alone", () => {
    useUIStore.setState({ sidebarVisible: true, sidebarViewMode: "outline" });
    useRemoteSessionStore.getState().setActive("main", "server-1");
    expect(useUIStore.getState().sidebarVisible).toBe(true);
    expect(useUIStore.getState().sidebarViewMode).toBe("outline");
  });

  it("does not close tabs", () => {
    useTabStore.setState((state) => ({
      ...state,
      tabs: { ...state.tabs, main: [{ id: TAB, filePath: "draft.md" } as never] },
    }));
    useRemoteSessionStore.getState().setActive("main", "server-1");
    useRemoteSessionStore.getState().setActive("main", null);
    expect(useTabStore.getState().tabs.main).toHaveLength(1);
  });

  it("is per window: another window's selection is untouched", () => {
    useRemoteSessionStore.getState().setActive("main", "server-1");
    useRemoteSessionStore.getState().setActive("doc-2", null);
    expect(useRemoteSessionStore.getState().getActive("main")).toBe("server-1");
    expect(useRemoteSessionStore.getState().getActive("doc-2")).toBeNull();
  });

  it("starts on this Mac for every window", () => {
    expect(useRemoteSessionStore.getState().getActive("fresh-window")).toBeNull();
  });

  it("drops the remote browser's loaded state when returning to this Mac", () => {
    // `ServerSwitcher` closes the browser slice when it selects this Mac, so
    // coming back re-reads the server instead of painting a stale tree.
    useRemoteBrowserStore.setState({ serverId: "server-1", activeRootId: "root-1" });
    useRemoteBrowserStore.getState().close();
    expect(useRemoteBrowserStore.getState().serverId).toBeNull();
    expect(useRemoteBrowserStore.getState().activeRootId).toBeNull();
  });
});
