// WI-3R — rail click performs the full context switch (tests)
// WI-TS5.1 — stable data-rail-action/data-instance-id automation attributes
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTabStore } from "@/stores/tabStore";
import {
  selectWindowWorkspaceState,
  useWorkspaceInstancesStore,
} from "@/stores/workspaceInstancesStore";
import { createWorkspaceInstance, createWorkspaceRootIdentity } from "@/utils/workspaceIdentity";
import { WorkspaceRail, WORKSPACE_RAIL_WIDTH } from "./WorkspaceRail";

const { mockMoveWorkspace, mockDuplicateWorkspace, mockCloseWorkspace, mockToastError, mockToastMessage } = vi.hoisted(() => ({
  mockMoveWorkspace: vi.fn(),
  mockDuplicateWorkspace: vi.fn(),
  mockCloseWorkspace: vi.fn(),
  mockToastError: vi.fn(),
  mockToastMessage: vi.fn(),
}));
vi.mock("@/services/workspaces/closeWorkspaceInstance", () => ({
  closeWorkspaceInstance: mockCloseWorkspace,
}));

vi.mock("@/services/workspaces/workspaceWindowActions", () => ({
  moveWorkspaceInstanceToNewWindow: mockMoveWorkspace,
  duplicateWorkspaceInstanceToNewWindow: mockDuplicateWorkspace,
}));
vi.mock("@/services/ime/imeToast", () => ({
  imeToast: { error: mockToastError, message: mockToastMessage },
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve(null)),
}));

function setRailMode(enabled: boolean): void {
  useSettingsStore.setState({
    general: { ...useSettingsStore.getState().general, workspaceRailMode: enabled, workspaceRailCollapsed: false },
  });
}

function addInstance(windowLabel: string, id: string, rootPath: string): void {
  const root = createWorkspaceRootIdentity(rootPath, { platform: "macos" });
  if (!root.ok) throw new Error("test root should be valid");
  useWorkspaceInstancesStore.getState().addWorkspaceInstance(
    createWorkspaceInstance({
      workspaceInstanceId: id,
      root: root.root,
      ownerWindowLabel: windowLabel,
      createdFrom: "open",
    }),
  );
}

function addLooseInstance(windowLabel: string, id = "wsi-loose"): void {
  useWorkspaceInstancesStore.getState().addWorkspaceInstance(
    createWorkspaceInstance({
      workspaceInstanceId: id,
      root: null,
      ownerWindowLabel: windowLabel,
      createdFrom: "open",
      kind: "loose",
    }),
  );
}

beforeEach(() => {
  setRailMode(false);
  useWorkspaceInstancesStore.getState().resetWorkspaceInstances();
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0 });
  mockMoveWorkspace.mockReset();
  mockDuplicateWorkspace.mockReset();
  mockCloseWorkspace.mockReset();
  mockToastError.mockReset();
  mockToastMessage.mockReset();
});

describe("WorkspaceRail", () => {
  it("defaults to a column wide enough for workspace names", () => {
    expect(WORKSPACE_RAIL_WIDTH).toBe(160);
  });

  it("shows each workspace's full name, not just its glyph", () => {
    setRailMode(true);
    addInstance("main", "wsi-a", "/Users/xiaolai/muse");
    addInstance("main", "wsi-b", "/Users/xiaolai/project");

    render(<WorkspaceRail windowLabel="main" />);

    expect(screen.getByRole("button", { name: "Activate muse" })).toHaveTextContent("muse");
    expect(screen.getByRole("button", { name: "Activate project" })).toHaveTextContent("project");
  });

  it("has no per-entry duplicate button (duplicate lives in the context menu)", () => {
    setRailMode(true);
    addInstance("main", "wsi-a", "/Users/xiaolai/muse");

    const { container } = render(<WorkspaceRail windowLabel="main" />);

    expect(screen.queryByRole("button", { name: /duplicate/i })).toBeNull();
    expect(container.querySelector('[data-rail-action="duplicate"]')).toBeNull();
  });

  it("has no Open Folder button; New Group and collapse share the footer", () => {
    setRailMode(true);
    render(<WorkspaceRail windowLabel="main" />);
    expect(screen.queryByRole("button", { name: /open folder/i })).toBeNull();
    const newGroup = screen.getByRole("button", { name: "New Group" });
    const collapse = screen.getByRole("button", { name: "Collapse Workspaces" });
    // Same footer row, collapse last (the bottom-right corner).
    expect(newGroup.parentElement).toBe(collapse.parentElement);
    expect(collapse.parentElement?.lastElementChild).toBe(collapse);
  });

  it("renders nothing while workspace rail mode is disabled", () => {
    addInstance("main", "wsi-main", "/Users/xiaolai/project");

    const { container } = render(<WorkspaceRail windowLabel="main" />);

    expect(container.firstChild).toBeNull();
  });

  it("renders local workspace instances when enabled", () => {
    setRailMode(true);
    addInstance("main", "wsi-main", "/Users/xiaolai/project");
    addInstance("doc-1", "wsi-doc", "/Users/xiaolai/other");

    render(<WorkspaceRail windowLabel="main" />);

    expect(screen.getByRole("navigation", { name: /workspaces/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /activate project/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /activate other/i })).not.toBeInTheDocument();
  });

  it("marks the active workspace instance", () => {
    setRailMode(true);
    addInstance("main", "wsi-a", "/Users/xiaolai/a");
    addInstance("main", "wsi-b", "/Users/xiaolai/b");
    useWorkspaceInstancesStore.getState().activateWorkspaceInstance("main", "wsi-b");

    render(<WorkspaceRail windowLabel="main" />);

    expect(screen.getByRole("button", { name: "Activate b" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Activate a" })).toHaveAttribute("aria-pressed", "false");
  });

  it("renders name-derived glyphs with stable workspace colors", () => {
    setRailMode(true);
    addInstance("main", "wsi-a", "/Users/xiaolai/a");
    addInstance("main", "wsi-b", "/Users/xiaolai/b");

    const { container } = render(<WorkspaceRail windowLabel="main" />);

    // Was `index + 1` ("1", "2") — a POSITIONAL number that changed on reorder
    // and identified nothing. Now the first character of the workspace name.
    const glyphs = [...container.querySelectorAll(".workspace-rail__glyph")].map(
      (glyph) => glyph.textContent,
    );
    const entries = [...container.querySelectorAll<HTMLElement>(".workspace-rail__entry")];
    expect(glyphs).toEqual(["A", "B"]);
    // The colour seeding this test also guarded must survive the change. A
    // `/^var\(--/` match would pass even if BOTH entries got the same token, so
    // assert they are distinct as well as well-formed.
    const colors = entries.map((e) => e.style.getPropertyValue("--workspace-rail-color"));
    for (const color of colors) expect(color).toMatch(/^var\(--[a-z-]+\)$/);
    expect(new Set(colors).size).toBe(2);
  });

  it("keeps glyphs stable when entries are reordered", () => {
    setRailMode(true);
    addInstance("main", "wsi-a", "/Users/xiaolai/alpha");
    addInstance("main", "wsi-b", "/Users/xiaolai/beta");

    const { rerender } = render(<WorkspaceRail windowLabel="main" />);
    // Query by accessible name, so the assertion survives a CSS-class rename
    // and states the real contract: THIS workspace shows THIS glyph.
    const glyphOf = (name: string) =>
      screen
        .getByRole("button", { name: `Activate ${name}` })
        .querySelector(".workspace-rail__glyph")?.textContent;

    expect(glyphOf("alpha")).toBe("A");
    expect(glyphOf("beta")).toBe("B");

    act(() => {
      useWorkspaceInstancesStore
        .getState()
        .reorderWorkspaceInstances("main", ["wsi-b", "wsi-a"]);
    });
    rerender(<WorkspaceRail windowLabel="main" />);

    // A positional index would still read "1","2" after the swap while pointing
    // at different workspaces. Name-derived glyphs travel with their workspace.
    expect(glyphOf("alpha")).toBe("A");
    expect(glyphOf("beta")).toBe("B");
  });

  it("keeps colliding initials at one character each", () => {
    setRailMode(true);
    addInstance("main", "wsi-a", "/Users/xiaolai/alpha");
    addInstance("main", "wsi-b", "/Users/xiaolai/apex");

    render(<WorkspaceRail windowLabel="main" />);

    expect(screen.getByRole("button", { name: "Activate alpha" })).toHaveTextContent("A");
    expect(screen.getByRole("button", { name: "Activate apex" })).toHaveTextContent("A");
  });

  it("leaves every workspace at one character, colliding or not", () => {
    setRailMode(true);
    addInstance("main", "wsi-z", "/Users/xiaolai/zulu");
    addInstance("main", "wsi-a", "/Users/xiaolai/alpha");
    addInstance("main", "wsi-b", "/Users/xiaolai/apex");

    render(<WorkspaceRail windowLabel="main" />);

    // No glyph is ever lengthened, even when two collide: the full name is
    // already carried by the accessible name, the tooltip and the accent colour.
    expect(screen.getByRole("button", { name: "Activate zulu" })).toHaveTextContent("Z");
    expect(screen.getByRole("button", { name: "Activate alpha" })).toHaveTextContent("A");
    expect(screen.getByRole("button", { name: "Activate apex" })).toHaveTextContent("A");
  });

  it("keeps the full workspace name as the accessible name, not the glyph", () => {
    setRailMode(true);
    addInstance("main", "wsi-a", "/Users/xiaolai/alpha");

    const { container } = render(<WorkspaceRail windowLabel="main" />);

    // Screen readers must announce the workspace, never the one-letter glyph.
    expect(screen.getByRole("button", { name: "Activate alpha" })).toBeInTheDocument();
    expect(container.querySelector(".workspace-rail__glyph")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  it("renders loose files as a non-folder rail entry", () => {
    setRailMode(true);
    addLooseInstance("main");

    const { container } = render(<WorkspaceRail windowLabel="main" />);

    expect(screen.getByRole("button", { name: "Activate Loose Files" }))
      .toBeInTheDocument();
    expect(container.querySelector(".workspace-rail__loose svg")).toBeInTheDocument();
    // Loose Files is not a workspace: it keeps its own icon and must never be
    // given an identity glyph (which would make it read as another workspace).
    expect(container.querySelector(".workspace-rail__glyph")).not.toBeInTheDocument();
  });

  it("performs the FULL context switch on click: activation + outgoing stash (WI-3R)", async () => {
    const user = userEvent.setup();
    setRailMode(true);
    addInstance("main", "wsi-a", "/Users/xiaolai/a");
    addInstance("main", "wsi-b", "/Users/xiaolai/b");
    useWorkspaceInstancesStore.getState().activateWorkspaceInstance("main", "wsi-a");
    const tabId = useTabStore.getState().createTab("main", "/Users/xiaolai/a/doc.md");
    useTabStore.getState().setActiveTab("main", tabId);

    render(<WorkspaceRail windowLabel="main" />);
    await user.click(screen.getByRole("button", { name: "Activate b" }));

    expect(
      selectWindowWorkspaceState(useWorkspaceInstancesStore.getState(), "main")
        ?.activeWorkspaceInstanceId,
    ).toBe("wsi-b");
    // The outgoing instance stashed its live context — the full switch ran,
    // not a raw activation flip.
    const outgoing = useWorkspaceInstancesStore.getState().instances["wsi-a"];
    expect(outgoing.tabIds).toEqual([tabId]);
    expect(outgoing.activeTabId).toBe(tabId);
    // aria-pressed follows the new active instance.
    expect(screen.getByRole("button", { name: "Activate b" }))
      .toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Activate a" }))
      .toHaveAttribute("aria-pressed", "false");
  });

  it("clicking the ACTIVE entry is a strict no-op", async () => {
    const user = userEvent.setup();
    setRailMode(true);
    addInstance("main", "wsi-a", "/Users/xiaolai/a");
    useWorkspaceInstancesStore.getState().activateWorkspaceInstance("main", "wsi-a");
    const before = useWorkspaceInstancesStore.getState().instances;

    render(<WorkspaceRail windowLabel="main" />);
    await user.click(screen.getByRole("button", { name: "Activate a" }));

    expect(useWorkspaceInstancesStore.getState().instances).toEqual(before);
  });

  // Rows are not draggable: a trackpad press that drifted a few pixels used
  // to start a drag and swallow the click. Moving lives in the context menu.
  it("rail rows are not draggable", () => {
    setRailMode(true);
    addInstance("main", "wsi-a", "/Users/xiaolai/a");
    render(<WorkspaceRail windowLabel="main" />);
    expect(screen.getByRole("button", { name: "Activate a" })).not.toHaveAttribute("draggable", "true");
  });

  it("moves a workspace to a new window from the context menu", async () => {
    const user = userEvent.setup();
    setRailMode(true);
    addInstance("main", "wsi-a", "/Users/xiaolai/a");
    render(<WorkspaceRail windowLabel="main" />);

    await user.pointer({ keys: "[MouseRight]", target: screen.getByRole("button", { name: "Activate a" }) });
    await user.click(screen.getByRole("menuitem", { name: "Move to New Window" }));

    expect(mockMoveWorkspace).toHaveBeenCalledWith("main", "wsi-a");
  });

  it("shows an error toast when moving a workspace fails", async () => {
    const user = userEvent.setup();
    setRailMode(true);
    addInstance("main", "wsi-a", "/Users/xiaolai/a");
    mockMoveWorkspace.mockResolvedValueOnce({ ok: false, reason: "invokeFailed" });
    render(<WorkspaceRail windowLabel="main" />);

    await user.pointer({ keys: "[MouseRight]", target: screen.getByRole("button", { name: "Activate a" }) });
    await user.click(screen.getByRole("menuitem", { name: "Move to New Window" }));

    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith("Failed to move workspace to a new window"),
    );
  });

  it("shows two folders with the same name by their own name, without numbering", () => {
    setRailMode(true);
    addInstance("main", "wsi-a", "/Users/xiaolai/one/wiki");
    addInstance("main", "wsi-b", "/Users/xiaolai/two/wiki");
    render(<WorkspaceRail windowLabel="main" />);

    const rows = screen.getAllByRole("button", { name: "Activate wiki" });
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.getAttribute("title"))).toEqual([
      "/Users/xiaolai/one/wiki",
      "/Users/xiaolai/two/wiki",
    ]);
  });

  it("folds to a strip and back", async () => {
    setRailMode(true);
    addInstance("main", "wsi-a", "/Users/xiaolai/a");
    render(<WorkspaceRail windowLabel="main" />);

    await userEvent.click(screen.getByRole("button", { name: "Collapse Workspaces" }));
    expect(useSettingsStore.getState().general.workspaceRailCollapsed).toBe(true);
    expect(screen.queryByRole("button", { name: "Activate a" })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Expand Workspaces" }));
    expect(useSettingsStore.getState().general.workspaceRailCollapsed).toBe(false);
    expect(screen.getByRole("button", { name: "Activate a" })).toBeInTheDocument();
  });

  it("duplicates a workspace from the context menu", async () => {
    const user = userEvent.setup();
    setRailMode(true);
    addInstance("main", "wsi-a", "/Users/xiaolai/a");

    render(<WorkspaceRail windowLabel="main" />);
    await user.pointer({
      keys: "[MouseRight]",
      target: screen.getByRole("button", { name: "Activate a" }),
    });
    await user.click(screen.getByRole("menuitem", { name: "Duplicate in New Window" }));

    expect(mockDuplicateWorkspace).toHaveBeenCalledWith("main", "wsi-a");
  });

  it("shows an error toast when duplicate fails", async () => {
    const user = userEvent.setup();
    setRailMode(true);
    addInstance("main", "wsi-a", "/Users/xiaolai/a");
    mockDuplicateWorkspace.mockResolvedValueOnce({ ok: false, reason: "invokeFailed" });

    render(<WorkspaceRail windowLabel="main" />);
    await user.pointer({
      keys: "[MouseRight]",
      target: screen.getByRole("button", { name: "Activate a" }),
    });
    await user.click(screen.getByRole("menuitem", { name: "Duplicate in New Window" }));

    expect(mockToastError).toHaveBeenCalledWith("Failed to duplicate workspace");
  });

  it("reports skipped tabs after duplicate succeeds with skipped content", async () => {
    const user = userEvent.setup();
    setRailMode(true);
    addInstance("main", "wsi-a", "/Users/xiaolai/a");
    mockDuplicateWorkspace.mockResolvedValueOnce({
      ok: true,
      targetWindowLabel: "doc-2",
      skippedDirtyCount: 1,
      skippedUntitledCount: 1,
      skippedMissingCount: 1,
    });

    render(<WorkspaceRail windowLabel="main" />);
    await user.pointer({
      keys: "[MouseRight]",
      target: screen.getByRole("button", { name: "Activate a" }),
    });
    await user.click(screen.getByRole("menuitem", { name: "Duplicate in New Window" }));

    expect(mockToastMessage).toHaveBeenCalledWith(
      "Duplicated workspace and skipped 3 dirty, untitled, or missing tabs.",
    );
  });

  it("does not report skipped tabs after a clean duplicate", async () => {
    const user = userEvent.setup();
    setRailMode(true);
    addInstance("main", "wsi-a", "/Users/xiaolai/a");
    mockDuplicateWorkspace.mockResolvedValueOnce({
      ok: true,
      targetWindowLabel: "doc-2",
    });

    render(<WorkspaceRail windowLabel="main" />);
    await user.pointer({
      keys: "[MouseRight]",
      target: screen.getByRole("button", { name: "Activate a" }),
    });
    await user.click(screen.getByRole("menuitem", { name: "Duplicate in New Window" }));

    expect(mockToastMessage).not.toHaveBeenCalled();
  });

  describe("context menu", () => {
    /** Right-click the rail entry for `name` and return its menu. */
    async function openMenu(name: string) {
      const user = userEvent.setup();
      await user.pointer({
        keys: "[MouseRight]",
        target: screen.getByRole("button", { name: `Activate ${name}` }),
      });
      return screen.getByRole("menu");
    }

    it("does not resurrect a stale menu across a rail-mode toggle (R3-11)", async () => {
      setRailMode(true);
      addInstance("main", "wsi-a", "/Users/xiaolai/alpha");
      render(<WorkspaceRail windowLabel="main" />);
      await openMenu("alpha");
      expect(screen.getByRole("menu")).toBeInTheDocument();

      // Disable the rail with the menu open, then re-enable: the menu's
      // instance may be long gone by the time the rail returns.
      act(() => setRailMode(false));
      expect(screen.queryByRole("menu")).toBeNull();
      act(() => setRailMode(true));

      expect(screen.queryByRole("menu")).toBeNull();
    });

    it("opens on right-click with the three workspace actions", async () => {
      setRailMode(true);
      addInstance("main", "wsi-a", "/Users/xiaolai/alpha");
      render(<WorkspaceRail windowLabel="main" />);

      const menu = await openMenu("alpha");

      // Close and Move were previously unreachable from the rail: there was no
      // close affordance at all, and moving required dragging the icon outside
      // the window — undiscoverable and easy to trigger by accident.
      expect(menu).toHaveAccessibleName("alpha");
      expect(screen.getByRole("menuitem", { name: "Close" })).toBeInTheDocument();
      expect(screen.getByRole("menuitem", { name: "Duplicate in New Window" })).toBeInTheDocument();
      expect(screen.getByRole("menuitem", { name: "Move to New Window" })).toBeInTheDocument();
    });

    it("closes the workspace through the dirty-checked path", async () => {
      setRailMode(true);
      addInstance("main", "wsi-a", "/Users/xiaolai/alpha");
      render(<WorkspaceRail windowLabel="main" />);
      await openMenu("alpha");

      await userEvent.click(screen.getByRole("menuitem", { name: "Close" }));

      // The tab-closing function is INJECTED: services/ may not import hooks/
      // (ADR-013 tiering), so the component bridges the two tiers.
      expect(mockCloseWorkspace).toHaveBeenCalledWith("main", "wsi-a", {
        closeTabs: expect.any(Function),
      });
    });

    it("duplicates and moves through the existing actions", async () => {
      setRailMode(true);
      addInstance("main", "wsi-a", "/Users/xiaolai/alpha");
      render(<WorkspaceRail windowLabel="main" />);

      await openMenu("alpha");
      await userEvent.click(screen.getByRole("menuitem", { name: "Duplicate in New Window" }));
      expect(mockDuplicateWorkspace).toHaveBeenCalledWith("main", "wsi-a");

      await openMenu("alpha");
      await userEvent.click(screen.getByRole("menuitem", { name: "Move to New Window" }));
      expect(mockMoveWorkspace).toHaveBeenCalledWith("main", "wsi-a");
    });

    it("focuses the first item and roves with arrow keys", async () => {
      setRailMode(true);
      addInstance("main", "wsi-a", "/Users/xiaolai/alpha");
      render(<WorkspaceRail windowLabel="main" />);
      await openMenu("alpha");

      // Focus lands on an ITEM, not the container — the container's outline is
      // suppressed, so focusing it would show nothing.
      // Group membership comes first, then the window actions.
      expect(screen.getByRole("menuitem", { name: "Add to New Group" })).toHaveFocus();

      await userEvent.keyboard("{ArrowDown}");
      expect(screen.getByRole("menuitem", { name: "Close" })).toHaveFocus();
      await userEvent.keyboard("{End}");
      expect(screen.getByRole("menuitem", { name: "Move to New Window" })).toHaveFocus();
      await userEvent.keyboard("{ArrowDown}");
      expect(screen.getByRole("menuitem", { name: "Add to New Group" })).toHaveFocus();
    });

    it("returns focus to the rail entry when dismissed", async () => {
      setRailMode(true);
      addInstance("main", "wsi-a", "/Users/xiaolai/alpha");
      render(<WorkspaceRail windowLabel="main" />);
      const trigger = screen.getByRole("button", { name: "Activate alpha" });
      await openMenu("alpha");

      await userEvent.keyboard("{Escape}");

      // Without this a keyboard user is dumped on <body>, losing their place.
      expect(trigger).toHaveFocus();
    });

    it("dismisses on Escape without running an action", async () => {
      setRailMode(true);
      addInstance("main", "wsi-a", "/Users/xiaolai/alpha");
      render(<WorkspaceRail windowLabel="main" />);
      await openMenu("alpha");

      await userEvent.keyboard("{Escape}");

      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
      expect(mockCloseWorkspace).not.toHaveBeenCalled();
    });

    it("does not activate the workspace when right-clicked", async () => {
      setRailMode(true);
      addInstance("main", "wsi-a", "/Users/xiaolai/alpha");
      addInstance("main", "wsi-b", "/Users/xiaolai/beta");
      useWorkspaceInstancesStore.getState().activateWorkspaceInstance("main", "wsi-b");
      render(<WorkspaceRail windowLabel="main" />);

      await openMenu("alpha");

      // Opening a menu is not a selection gesture.
      expect(
        useWorkspaceInstancesStore.getState().windows["main"]?.activeWorkspaceInstanceId,
      ).toBe("wsi-b");
    });
  });
});
describe("hook order across fold / unfold / disable", () => {
  // The layout shortcuts (⌘1/⌘2/⌘3) fold and unfold this column while it is
  // mounted, and the rail is also disabled from Settings. A hook declared
  // below the folded or disabled early return makes the hook count change on
  // exactly those transitions, which React reports as "Rendered fewer hooks
  // than expected" and which throws away the whole window.
  it("survives folded → unfolded → folded, and disabled → enabled", () => {
    setRailMode(true);
    addInstance("main", "wsi-a", "/Users/xiaolai/muse");
    const setFlag = (key: "workspaceRailCollapsed" | "workspaceRailMode", value: boolean) => {
      useSettingsStore.setState({
        general: { ...useSettingsStore.getState().general, [key]: value },
      });
    };

    render(<WorkspaceRail windowLabel="main" />);
    expect(screen.getByRole("navigation", { name: /workspaces/i })).toBeInTheDocument();

    // ⌘1: fold. The strip replaces the list.
    act(() => setFlag("workspaceRailCollapsed", true));
    expect(screen.queryByRole("navigation", { name: /workspaces/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expand Workspaces" })).toBeInTheDocument();

    // ⌘2: unfold — the rail, and its rows, come back.
    act(() => setFlag("workspaceRailCollapsed", false));
    expect(screen.getByRole("button", { name: "Activate muse" })).toBeInTheDocument();

    // ⌘1 again: the same transition a second time must be as cheap.
    act(() => setFlag("workspaceRailCollapsed", true));
    expect(screen.getByRole("button", { name: "Expand Workspaces" })).toBeInTheDocument();

    // Disabled while FOLDED, then re-enabled: the strip, then the column —
    // and no crash in between.
    act(() => setFlag("workspaceRailMode", false));
    expect(screen.queryByRole("navigation", { name: /workspaces/i })).not.toBeInTheDocument();
    act(() => setFlag("workspaceRailMode", true));
    expect(screen.getByRole("button", { name: "Expand Workspaces" })).toBeInTheDocument();
    act(() => setFlag("workspaceRailCollapsed", false));
    expect(screen.getByRole("button", { name: "Activate muse" })).toBeInTheDocument();

    // Disabled while UNFOLDED, then re-enabled: null ↔ column.
    act(() => setFlag("workspaceRailMode", false));
    expect(screen.queryByRole("navigation", { name: /workspaces/i })).not.toBeInTheDocument();
    act(() => setFlag("workspaceRailMode", true));
    expect(screen.getByRole("navigation", { name: /workspaces/i })).toBeInTheDocument();
  });
});

describe("stable rail automation hooks (WI-TS5.1)", () => {
  it("every rail item carries data-rail-action + data-instance-id (E2E contract)", () => {
    setRailMode(true);
    addInstance("main", "wsi-a", "/Users/xiaolai/a");
    addInstance("main", "wsi-b", "/Users/xiaolai/b");

    const { container } = render(<WorkspaceRail windowLabel="main" />);

    const activate = [...container.querySelectorAll('[data-rail-action="activate"]')];
    expect(activate.map((el) => el.getAttribute("data-instance-id"))).toEqual([
      "wsi-a",
      "wsi-b",
    ]);
  });
});
