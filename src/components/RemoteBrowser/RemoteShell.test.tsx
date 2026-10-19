/**
 * RemoteShell — the remote window's three columns obey the window's own layout
 * states, and the groups column keeps the way back to this Mac.
 *
 * Behaviour under test: the groups column leads with the server switcher;
 * selecting a folder reveals the file tree column (and the SAME store state the
 * local window reads, so ⌘1/⌘2/⌘3 keep working); a folded groups column is the
 * strip, and clicking it unfolds; a folded tree is the strip too and never
 * disappears; the tree column shows its empty state before a folder is picked;
 * and the widths the shell would reserve are the widths the regions render at.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RemoteWindowSurface } from "./RemoteShell";
import { useRemoteBrowserStore } from "@/stores/remoteBrowserStore";
import { useRemoteServersStore } from "@/stores/remoteServersStore";
import { useRemoteSessionStore } from "@/stores/remoteSessionStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useUIStore } from "@/stores/uiStore";
import { applyLayoutPreset } from "@/services/commands/layoutCommands";
import { remoteLeadingColumns, remoteSideWidth, COLLAPSED_STRIP_WIDTH } from "@/shell/shellChrome";

vi.mock("@/services/navigation/settingsWindow", () => ({ openSettingsWindow: () => Promise.resolve() }));

const TOKEN = "a".repeat(64);
const SERVER = { id: "s1", name: "Studio", host: "m4.tailc8e51.ts.net", port: 8740, token: TOKEN };
const GROUPS = {
  groups: [{ id: "g", name: "Work", folders: [{ rootId: "r1", name: "wiki", available: true }] }],
};

/**
 * The remote browser's data, served from the store: this is a layout test, so
 * the groups and the tree arrive READY and the assertions are about columns.
 * `browse` is mocked rather than `invoke` because the groups load is the
 * effect's own work, not the code under test here.
 */
const browse = vi.hoisted(() => ({
  loadGroups: vi.fn(() => Promise.resolve()),
  loadLevel: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/services/remoteServers/browse", () => browse);

function showServer() {
  useRemoteServersStore.setState({ servers: [SERVER], corrupt: false });
  useRemoteSessionStore.setState({ active: { main: "s1" } });
  useRemoteBrowserStore.setState({
    serverId: "s1",
    connection: { host: SERVER.host, port: SERVER.port, token: TOKEN },
    groups: GROUPS.groups,
    groupsStatus: "ready",
    groupsMessage: null,
    activeRootId: null,
    doc: null,
    levels: {},
    expanded: {},
    seq: 0,
  });
}

afterEach(cleanup);

beforeEach(() => {
  browse.loadGroups.mockClear();
  browse.loadLevel.mockClear();
  localStorage.clear();
  useRemoteServersStore.setState({ servers: [], corrupt: false });
  useRemoteSessionStore.setState({ active: {} });
  useRemoteBrowserStore.getState().close();
  useUIStore.setState({ sidebarVisible: false, sidebarViewMode: "outline", sidebarWidth: 260 });
  useSettingsStore.setState((state) => ({
    general: { ...state.general, workspaceRailCollapsed: false, workspaceRailWidth: 200 },
  }));
});

describe("RemoteShell — the columns", () => {
  it("leads the groups column with the server switcher", async () => {
    showServer();
    render(<RemoteWindowSurface serverId="s1" column="leading" windowLabel="main" />);
    const switcher = await screen.findByRole("button", { name: /Server: Studio/ });
    expect(switcher).toBeInTheDocument();
  });

  it("shows the tree column's empty state before a folder is picked", async () => {
    showServer();
    useUIStore.setState({ sidebarVisible: true });
    render(<RemoteWindowSurface serverId="s1" column="leading" windowLabel="main" />);
    expect(await screen.findByText("Choose a folder")).toBeInTheDocument();
  });

  it("reveals the file tree column when a folder is selected", async () => {
    showServer();
    const user = userEvent.setup();
    render(<RemoteWindowSurface serverId="s1" column="leading" windowLabel="main" />);
    expect(useUIStore.getState().sidebarVisible).toBe(false);

    await user.click(await screen.findByRole("button", { name: /wiki/ }));

    // The window's own state, not a remote-only copy: ⌘1/⌘2/⌘3 read this.
    expect(useUIStore.getState().sidebarVisible).toBe(true);
    expect(useUIStore.getState().sidebarViewMode).toBe("files");
    // And the tree itself is on screen — column two exists.
    expect(
      await screen.findByLabelText("Files", { selector: ".remote-sidebar" }),
    ).toBeInTheDocument();
  });

  it("renders the folded groups column as the strip, which unfolds it", async () => {
    showServer();
    useSettingsStore.setState((state) => ({
      general: { ...state.general, workspaceRailCollapsed: true },
    }));
    const user = userEvent.setup();
    render(<RemoteWindowSurface serverId="s1" column="leading" windowLabel="main" />);

    // `workspaceRail.expand` is the rail's own label; the test resolver leaves
    // an unknown key as the key, so match that rather than the English.
    const strip = await screen.findByRole("button", { name: "workspaceRail.expand" });
    // Folded, so no switcher — as in the local rail (⌘1/⌘2).
    expect(screen.queryByRole("button", { name: /Server: Studio/ })).not.toBeInTheDocument();

    await user.click(strip);
    // Unfolded: the full column, with the switcher back at its head.
    await waitFor(() =>
      expect(useSettingsStore.getState().general.workspaceRailCollapsed).toBe(false),
    );
    expect(await screen.findByRole("button", { name: /Server: Studio/ })).toBeInTheDocument();
  });

  it("renders a folded file tree as the strip, and the strip re-opens it", async () => {
    showServer();
    const user = userEvent.setup();
    render(<RemoteWindowSurface serverId="s1" column="leading" windowLabel="main" />);

    const strip = await screen.findByRole("button", { name: /Expand Sidebar/ });
    await user.click(strip);
    expect(useUIStore.getState().sidebarVisible).toBe(true);
    expect(await screen.findByLabelText("Files", { selector: ".remote-sidebar" })).toBeInTheDocument();
  });

  it("follows ⌘1/⌘2/⌘3: each column folds or expands, width and content together", async () => {
    showServer();
    const { container } = render(<RemoteWindowSurface serverId="s1" column="leading" windowLabel="main" />);
    await screen.findByRole("button", { name: /Server: Studio/ });
    const rail = () => container.querySelector<HTMLElement>(".app-sidebar-stack__rail");
    const tree = () => container.querySelector<HTMLElement>(".app-sidebar-stack__sidebar");

    // Three columns: both full.
    applyLayoutPreset("threeColumns");
    await waitFor(() => expect(useUIStore.getState().sidebarVisible).toBe(true));
    expect(rail()?.style.width).toBe(`${remoteColumns().railWidth}px`);
    expect(tree()?.style.width).toBe(`${remoteColumns().treeWidth}px`);
    expect(rail()?.style.width).toBe("200px");
    expect(tree()?.style.width).toBe("260px");

    // Two columns: the groups column folds to its strip, the tree stays.
    applyLayoutPreset("twoColumns");
    await waitFor(() => expect(useSettingsStore.getState().general.workspaceRailCollapsed).toBe(true));
    expect(rail()?.style.width).toBe(`${COLLAPSED_STRIP_WIDTH}px`);
    expect(tree()?.style.width).toBe("260px");
    expect(container.querySelectorAll(".collapsed-column-strip").length).toBe(1);

    // One column: the tree folds too, and BOTH are strips — never a blank.
    applyLayoutPreset("oneColumn");
    await waitFor(() => expect(useUIStore.getState().sidebarVisible).toBe(false));
    expect(tree()?.style.width).toBe(`${COLLAPSED_STRIP_WIDTH}px`);
    await waitFor(() =>
      expect(container.querySelectorAll(".collapsed-column-strip").length).toBe(2),
    );
  });

  it("sizes the column from the same state the regions read", async () => {
    // The reserved width (App.tsx) and the rendered widths (here) are one
    // function of one state — the bug was two readers of two states.
    useUIStore.setState({ sidebarVisible: false });
    expect(remoteSideWidth(remoteColumns())).toBe(
      remoteColumns().railWidth + COLLAPSED_STRIP_WIDTH + 8 * 2,
    );
    useUIStore.setState({ sidebarVisible: true });
    expect(remoteSideWidth(remoteColumns())).toBe(200 + 260 + 8 * 2);
  });
});

/** The columns as a remote window would derive them from the live stores. */
function remoteColumns() {
  const general = useSettingsStore.getState().general;
  const ui = useUIStore.getState();
  return remoteLeadingColumns({
    railWidth: general.workspaceRailWidth,
    railCollapsed: general.workspaceRailCollapsed,
    sidebarVisible: ui.sidebarVisible,
    sidebarWidth: ui.sidebarWidth,
  });
}
