// Workspace groups in the rail: collapsible sections of persisted folder
// bookmarks, plus a derived "Ungrouped" section.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTabStore } from "@/stores/tabStore";
import { useWorkspaceInstancesStore } from "@/stores/workspaceInstancesStore";
import { useWorkspaceGroupsStore } from "@/stores/workspaceGroupsStore";
import { createWorkspaceInstance, createWorkspaceRootIdentity } from "@/utils/workspaceIdentity";
import { WorkspaceRail } from "./WorkspaceRail";

const { mockOpenByPath, mockPickFolder, mockConfirm } = vi.hoisted(() => ({
  mockOpenByPath: vi.fn(() => Promise.resolve(true)),
  mockPickFolder: vi.fn<() => Promise<string | null>>(() => Promise.resolve(null)),
  mockConfirm: vi.fn(() => Promise.resolve(true)),
}));

vi.mock("@/services/workspaces/openWorkspaceByPath", () => ({
  openWorkspaceByPath: mockOpenByPath,
  WORKSPACE_TRANSITION_GUARD: "workspace-transition",
}));
vi.mock("@/services/workspaces/workspaceAccess", () => ({ pickWorkspaceFolder: mockPickFolder }));
vi.mock("@/services/dialogs/confirmAction", () => ({ confirmAction: mockConfirm }));
vi.mock("@/services/workspaces/closeWorkspaceInstance", () => ({ closeWorkspaceInstance: vi.fn() }));
vi.mock("@/services/workspaces/workspaceWindowActions", () => ({
  moveWorkspaceInstanceToNewWindow: vi.fn(),
  duplicateWorkspaceInstanceToNewWindow: vi.fn(),
}));
vi.mock("@/services/ime/imeToast", () => ({ imeToast: { error: vi.fn(), message: vi.fn() } }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve(null)) }));

const groups = () => useWorkspaceGroupsStore.getState();

function addInstance(id: string, rootPath: string): void {
  const root = createWorkspaceRootIdentity(rootPath, { platform: "macos" });
  if (!root.ok) throw new Error("test root should be valid");
  useWorkspaceInstancesStore.getState().addWorkspaceInstance(
    createWorkspaceInstance({ workspaceInstanceId: id, root: root.root, ownerWindowLabel: "main", createdFrom: "open" }),
  );
}

/** The section whose header toggle is named `name`. */
function section(name: string): HTMLElement {
  return screen.getByRole("group", { name });
}

beforeEach(() => {
  localStorage.clear();
  useSettingsStore.setState({
    general: { ...useSettingsStore.getState().general, workspaceRailMode: true },
  });
  useWorkspaceInstancesStore.getState().resetWorkspaceInstances();
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0 });
  useWorkspaceGroupsStore.setState({ groups: [], collapsed: {} });
  mockOpenByPath.mockClear();
  mockPickFolder.mockReset();
  mockConfirm.mockReset();
});

describe("WorkspaceRail groups", () => {
  it("lists open workspaces under Ungrouped when there are no groups", () => {
    addInstance("wsi-a", "/Users/me/muse");
    render(<WorkspaceRail windowLabel="main" />);
    expect(within(section("Ungrouped")).getByRole("button", { name: "Activate muse" })).toBeInTheDocument();
  });

  it("shows an open folder inside its group, not under Ungrouped", () => {
    addInstance("wsi-a", "/Users/me/muse");
    addInstance("wsi-b", "/Users/me/other");
    const id = groups().createGroup("Clients");
    groups().addFolder(id, "/Users/me/muse");
    render(<WorkspaceRail windowLabel="main" />);

    expect(within(section("Clients")).getByRole("button", { name: "Activate muse" })).toBeInTheDocument();
    expect(within(section("Ungrouped")).queryByRole("button", { name: "Activate muse" })).toBeNull();
    expect(within(section("Ungrouped")).getByRole("button", { name: "Activate other" })).toBeInTheDocument();
  });

  it("opens a closed folder bookmark when clicked", async () => {
    const id = groups().createGroup("Clients");
    groups().addFolder(id, "/Users/me/archive");
    render(<WorkspaceRail windowLabel="main" />);

    await userEvent.click(screen.getByRole("button", { name: "Open archive" }));

    expect(mockOpenByPath).toHaveBeenCalledWith("/Users/me/archive", { windowLabel: "main" });
  });

  it("collapses and expands a group by clicking its name", async () => {
    const id = groups().createGroup("Clients");
    groups().addFolder(id, "/Users/me/archive");
    render(<WorkspaceRail windowLabel="main" />);
    const toggle = within(section("Clients")).getByRole("button", { name: "Clients" });

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "Open archive" })).toBeNull();
    expect(groups().collapsed[id]).toBe(true);

    await userEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Open archive" })).toBeInTheDocument();
  });

  it("creates a group from the footer and names it inline", async () => {
    render(<WorkspaceRail windowLabel="main" />);
    await userEvent.click(screen.getByRole("button", { name: "New Group" }));

    const input = screen.getByRole("textbox", { name: "Group name" });
    expect(input).toHaveFocus();
    await userEvent.clear(input);
    await userEvent.type(input, "客户{Enter}");

    expect(groups().groups.map((g) => g.name)).toEqual(["客户"]);
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("Escape cancels a rename and keeps the old name", async () => {
    const id = groups().createGroup("Clients");
    render(<WorkspaceRail windowLabel="main" />);
    await userEvent.pointer({ keys: "[MouseRight]", target: within(section("Clients")).getByRole("button", { name: "Clients" }) });
    await userEvent.click(screen.getByRole("menuitem", { name: "Rename Group" }));

    await userEvent.type(screen.getByRole("textbox", { name: "Group name" }), "Other{Escape}");

    expect(groups().groups.find((g) => g.id === id)?.name).toBe("Clients");
  });

  it("adds an open workspace to a group from its context menu", async () => {
    addInstance("wsi-a", "/Users/me/muse");
    const id = groups().createGroup("Clients");
    render(<WorkspaceRail windowLabel="main" />);

    await userEvent.pointer({ keys: "[MouseRight]", target: screen.getByRole("button", { name: "Activate muse" }) });
    await userEvent.click(screen.getByRole("menuitem", { name: "Add to “Clients”" }));

    expect(groups().groups.find((g) => g.id === id)?.folders).toEqual(["/Users/me/muse"]);
  });

  it("removes a folder from the group it was right-clicked in", async () => {
    const id = groups().createGroup("Clients");
    groups().addFolder(id, "/Users/me/archive");
    render(<WorkspaceRail windowLabel="main" />);

    await userEvent.pointer({ keys: "[MouseRight]", target: screen.getByRole("button", { name: "Open archive" }) });
    await userEvent.click(screen.getByRole("menuitem", { name: "Remove from “Clients”" }));

    expect(groups().groups[0].folders).toEqual([]);
  });

  it("adds a picked folder with the group's + button", async () => {
    const id = groups().createGroup("Clients");
    mockPickFolder.mockResolvedValueOnce("/Users/me/picked");
    render(<WorkspaceRail windowLabel="main" />);

    await userEvent.click(screen.getByRole("button", { name: "Add a folder to Clients" }));

    await waitFor(() => expect(groups().groups.find((g) => g.id === id)?.folders).toEqual(["/Users/me/picked"]));
  });

  it("deletes a group only after confirmation", async () => {
    groups().createGroup("Clients");
    mockConfirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    render(<WorkspaceRail windowLabel="main" />);
    const header = () => within(section("Clients")).getByRole("button", { name: "Clients" });

    await userEvent.pointer({ keys: "[MouseRight]", target: header() });
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete Group" }));
    await waitFor(() => expect(mockConfirm).toHaveBeenCalledTimes(1));
    expect(groups().groups).toHaveLength(1);

    await userEvent.pointer({ keys: "[MouseRight]", target: header() });
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete Group" }));
    await waitFor(() => expect(groups().groups).toHaveLength(0));
  });
});
