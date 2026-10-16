// Drag-to-reorder in the workspace rail: a press-and-move on a group header
// reorders the groups, and on a folder row reorders that group's folders — all
// without the plain click that opens a workspace ever being mistaken for a drag.
//
// Rendered through the REAL rail (the store, the sections and the gesture hook),
// because the two halves must agree: the row selector the hook measures with is
// the attribute the components render.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useSettingsStore } from "@/stores/settingsStore";
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

/** Give a row a fixed 28px-tall box at `top`, so drop maths is deterministic. */
function layout(selector: string, tops: readonly number[], height = 28): void {
  const rows = Array.from(document.querySelectorAll<HTMLElement>(selector));
  rows.forEach((row, index) => {
    const top = tops[index];
    Object.defineProperty(row, "getBoundingClientRect", {
      value: () => ({
        x: 0,
        y: top,
        top,
        left: 0,
        width: 160,
        height,
        right: 160,
        bottom: top + height,
        toJSON: () => ({}),
      }),
      configurable: true,
    });
  });
}

/** A pointer press + move + release, as the browser delivers it. */
function pressAndMove(
  target: HTMLElement,
  { from, to }: { from: { x: number; y: number }; to: { x: number; y: number } },
  { release = true } = {},
): void {
  act(() => {
    target.dispatchEvent(
      new MouseEvent("pointerdown", {
        bubbles: true,
        button: 0,
        clientX: from.x,
        clientY: from.y,
      }),
    );
  });
  act(() => {
    document.dispatchEvent(
      new MouseEvent("pointermove", { bubbles: true, clientX: to.x, clientY: to.y }),
    );
  });
  if (release) {
    act(() => {
      document.dispatchEvent(
        new MouseEvent("pointerup", { bubbles: true, clientX: to.x, clientY: to.y }),
      );
    });
  }
}

function groupHeaders(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-rail-row='group']"));
}

function makeGroups(...names: string[]): string[] {
  return names.map((name) => groups().createGroup(name));
}

function addInstance(id: string, rootPath: string): void {
  const root = createWorkspaceRootIdentity(rootPath, { platform: "macos" });
  if (!root.ok) throw new Error("test root should be valid");
  useWorkspaceInstancesStore.getState().addWorkspaceInstance(
    createWorkspaceInstance({
      workspaceInstanceId: id,
      root: root.root,
      ownerWindowLabel: "main",
      createdFrom: "open",
    }),
  );
}

beforeEach(() => {
  localStorage.clear();
  useSettingsStore.setState({
    general: { ...useSettingsStore.getState().general, workspaceRailMode: true },
  });
  useWorkspaceInstancesStore.getState().resetWorkspaceInstances();
  useWorkspaceGroupsStore.setState({ groups: [], collapsed: {} });
  mockOpenByPath.mockClear();
});

describe("WorkspaceRail drag-to-reorder", () => {
  it("does not reorder when a header is pressed without moving", async () => {
    const [a] = makeGroups("A", "B", "C");
    render(<WorkspaceRail windowLabel="main" />);
    layout("[data-rail-row='group']", [0, 28, 56]);

    // A press that stays put is a CLICK: it toggles the section, not the order.
    await userEvent.click(within(screen.getByRole("group", { name: "A" })).getByRole("button", { name: "A" }));

    expect(groups().groups.map((g) => g.id)).toEqual([a, groups().groups[1].id, groups().groups[2].id]);
    expect(groups().collapsed[a]).toBe(true);
  });

  it("does not reorder when the pointer stays inside the threshold", () => {
    makeGroups("A", "B", "C");
    render(<WorkspaceRail windowLabel="main" />);
    layout("[data-rail-row='group']", [0, 28, 56]);
    const before = groups().groups.map((g) => g.id);

    // 5px: still a tap's jitter, so the drag never arms.
    pressAndMove(groupHeaders()[0], { from: { x: 10, y: 10 }, to: { x: 15, y: 12 } });

    expect(groups().groups.map((g) => g.id)).toEqual(before);
  });

  it("moves a group down when its header is dragged past the next midpoint", () => {
    const [a, b] = makeGroups("A", "B");
    render(<WorkspaceRail windowLabel="main" />);
    layout("[data-rail-row='group']", [0, 28]);

    // Group A spans 0–28; dragging below B's midpoint (28+14) is the last gap.
    pressAndMove(groupHeaders()[0], { from: { x: 10, y: 10 }, to: { x: 10, y: 60 } });

    expect(groups().groups.map((g) => g.id)).toEqual([b, a]);
  });

  it("moves a group up when its header is dragged above the first midpoint", () => {
    const [a, b, c] = makeGroups("A", "B", "C");
    render(<WorkspaceRail windowLabel="main" />);
    layout("[data-rail-row='group']", [0, 28, 56]);

    pressAndMove(groupHeaders()[2], { from: { x: 10, y: 60 }, to: { x: 10, y: -20 } });

    expect(groups().groups.map((g) => g.id)).toEqual([c, a, b]);
  });

  it("abandons the reorder when Escape is pressed mid-drag", async () => {
    const [a, b] = makeGroups("A", "B");
    render(<WorkspaceRail windowLabel="main" />);
    layout("[data-rail-row='group']", [0, 28]);

    pressAndMove(groupHeaders()[0], { from: { x: 10, y: 10 }, to: { x: 10, y: 60 } }, { release: false });
    await userEvent.keyboard("{Escape}");
    act(() => {
      document.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, clientX: 10, clientY: 60 }));
    });

    expect(groups().groups.map((g) => g.id)).toEqual([a, b]);
  });

  it("does not commit a drag whose release is outside the window", () => {
    const [a, b] = makeGroups("A", "B");
    render(<WorkspaceRail windowLabel="main" />);
    layout("[data-rail-row='group']", [0, 28]);

    pressAndMove(groupHeaders()[0], { from: { x: 10, y: 10 }, to: { x: 10, y: 60 } }, { release: false });
    act(() => {
      window.dispatchEvent(new Event("blur"));
    });

    expect(groups().groups.map((g) => g.id)).toEqual([a, b]);
  });

  it("moves a folder within its group when its row is dragged", () => {
    const id = groups().createGroup("A");
    groups().addFolder(id, "/one");
    groups().addFolder(id, "/two");
    groups().addFolder(id, "/three");
    render(<WorkspaceRail windowLabel="main" />);
    layout(`[data-rail-folder-rows='${id}'] [data-rail-row='folder']`, [0, 28, 56]);

    const first = document.querySelector<HTMLElement>(
      `[data-rail-folder-rows='${id}'] [data-rail-row='folder']`,
    );
    if (!first) throw new Error("folder row not found");
    pressAndMove(first, { from: { x: 10, y: 5 }, to: { x: 10, y: 70 } });

    expect(groups().groups[0].folders).toEqual(["/two", "/three", "/one"]);
  });

  it("still opens a workspace when its row is clicked without moving", async () => {
    const id = groups().createGroup("A");
    groups().addFolder(id, "/Users/me/archive");
    render(<WorkspaceRail windowLabel="main" />);
    layout(`[data-rail-folder-rows='${id}'] [data-rail-row='folder']`, [0]);

    await userEvent.click(screen.getByRole("button", { name: "Open archive" }));

    expect(mockOpenByPath).toHaveBeenCalledWith("/Users/me/archive", { windowLabel: "main" });
    expect(groups().groups[0].folders).toEqual(["/Users/me/archive"]);
  });

  it("does not make the Ungrouped section draggable", () => {
    // Ungrouped's order comes from the window's instances, not from a stored
    // list, so it renders no drag row and cannot be a drop target.
    const id = groups().createGroup("A");
    groups().addFolder(id, "/x");
    addInstance("wsi-a", "/Users/me/loose");
    render(<WorkspaceRail windowLabel="main" />);

    const ungrouped = screen.getByRole("group", { name: "Ungrouped" });
    expect(ungrouped.querySelector("[data-rail-row='group']")).toBeNull();
    expect(ungrouped.querySelector("[data-rail-folder-rows]")).toBeNull();
    // The group's own rows are draggable, so the absence above is a decision
    // about Ungrouped and not an accident of the attribute never rendering.
    expect(document.querySelectorAll("[data-rail-row='group']")).toHaveLength(1);
  });

  it("does not start a drag from a group's + button", () => {
    const [a] = makeGroups("A", "B");
    render(<WorkspaceRail windowLabel="main" />);
    layout("[data-rail-row='group']", [0, 28]);

    const addButton = screen.getByRole("button", { name: "Add a folder to A" });
    pressAndMove(addButton, { from: { x: 10, y: 5 }, to: { x: 10, y: 70 } });

    expect(groups().groups.map((g) => g.id)).toEqual([a, groups().groups[1].id]);
  });

  it("does not paint a drop indicator before the gesture arms", () => {
    makeGroups("A", "B");
    render(<WorkspaceRail windowLabel="main" />);
    layout("[data-rail-row='group']", [0, 28]);

    pressAndMove(groupHeaders()[0], { from: { x: 10, y: 10 }, to: { x: 12, y: 11 } }, { release: false });

    expect(document.querySelector(".workspace-rail__section--drop-above")).toBeNull();
    expect(document.querySelector(".workspace-rail__section--drop-below")).toBeNull();
    expect(document.querySelector(".workspace-rail--reordering")).toBeNull();
  });

  it("paints the drop indicator and marks the dragged row while dragging", () => {
    makeGroups("A", "B");
    render(<WorkspaceRail windowLabel="main" />);
    layout("[data-rail-row='group']", [0, 28]);

    pressAndMove(groupHeaders()[0], { from: { x: 10, y: 10 }, to: { x: 10, y: 60 } }, { release: false });

    expect(document.querySelector(".workspace-rail--reordering")).not.toBeNull();
    expect(document.querySelector(".workspace-rail__section--dragging")).not.toBeNull();
    // Dropped past B, so the indicator sits at the foot of the last section.
    expect(document.querySelector(".workspace-rail__section--drop-below")).not.toBeNull();
  });

  it("clears every drag style once the gesture ends", () => {
    makeGroups("A", "B");
    render(<WorkspaceRail windowLabel="main" />);
    layout("[data-rail-row='group']", [0, 28]);

    pressAndMove(groupHeaders()[0], { from: { x: 10, y: 10 }, to: { x: 10, y: 60 } });

    expect(document.querySelector(".workspace-rail--reordering")).toBeNull();
    expect(document.querySelector(".workspace-rail__section--dragging")).toBeNull();
    expect(document.querySelector(".workspace-rail__section--drop-above")).toBeNull();
    expect(document.querySelector(".workspace-rail__section--drop-below")).toBeNull();
    expect(document.body.style.cursor).toBe("");
  });

  // The keyboard path exists because a drag-only reorder is unreachable without
  // a pointer. Alt+Arrow moves one slot.
  it("moves a group down with Alt+ArrowDown on its header", async () => {
    const [a, b] = makeGroups("A", "B");
    render(<WorkspaceRail windowLabel="main" />);

    const header = within(screen.getByRole("group", { name: "A" })).getByRole("button", { name: "A" });
    header.focus();
    await userEvent.keyboard("{Alt>}{ArrowDown}{/Alt}");

    expect(groups().groups.map((g) => g.id)).toEqual([b, a]);
  });

  it("moves a folder up with Alt+ArrowUp on its row", async () => {
    const id = groups().createGroup("A");
    groups().addFolder(id, "/one");
    groups().addFolder(id, "/two");
    render(<WorkspaceRail windowLabel="main" />);

    const row = screen.getByRole("button", { name: "Open two" });
    row.focus();
    await userEvent.keyboard("{Alt>}{ArrowUp}{/Alt}");

    expect(groups().groups[0].folders).toEqual(["/two", "/one"]);
    expect(mockOpenByPath).not.toHaveBeenCalled();
  });

  it("does not reorder with a bare arrow, which belongs to focus movement", async () => {
    const [a, b] = makeGroups("A", "B");
    render(<WorkspaceRail windowLabel="main" />);

    const header = within(screen.getByRole("group", { name: "A" })).getByRole("button", { name: "A" });
    header.focus();
    await userEvent.keyboard("{ArrowDown}");

    expect(groups().groups.map((g) => g.id)).toEqual([a, b]);
  });

  it("does not move a group past the end with Alt+ArrowDown", async () => {
    const [a, b] = makeGroups("A", "B");
    render(<WorkspaceRail windowLabel="main" />);

    const last = within(screen.getByRole("group", { name: "B" })).getByRole("button", { name: "B" });
    last.focus();
    await userEvent.keyboard("{Alt>}{ArrowDown}{/Alt}");

    expect(groups().groups.map((g) => g.id)).toEqual([a, b]);
  });

  it("does not give the Ungrouped header a keyboard reorder either", async () => {
    const id = groups().createGroup("A");
    groups().addFolder(id, "/x");
    addInstance("wsi-a", "/Users/me/loose");
    render(<WorkspaceRail windowLabel="main" />);
    const before = groups().groups.map((g) => g.id);

    const ungroupedToggle = within(screen.getByRole("group", { name: "Ungrouped" })).getByRole(
      "button",
      { name: "Ungrouped" },
    );
    ungroupedToggle.focus();
    await userEvent.keyboard("{Alt>}{ArrowDown}{/Alt}");

    expect(groups().groups.map((g) => g.id)).toEqual(before);
  });
});

// A drop is a GAP in the list as it looks before the move. Dragging DOWN past a
// neighbour must land right after it — not one slot further — and a release in
// the gap just below the row itself must leave the order alone.
describe("WorkspaceRail drag-to-reorder: dropping into a middle gap", () => {
  function folderRows(groupId: string): HTMLElement[] {
    return Array.from(
      document.querySelectorAll<HTMLElement>(`[data-rail-folder-rows='${groupId}'] [data-rail-row='folder']`),
    );
  }

  it("moves a folder one slot down when dropped between the next two rows", () => {
    const id = groups().createGroup("A");
    ["/one", "/two", "/three"].forEach((p) => groups().addFolder(id, p));
    render(<WorkspaceRail windowLabel="main" />);
    layout(`[data-rail-folder-rows='${id}'] [data-rail-row='folder']`, [0, 28, 56]);

    // Below /two's midpoint (42), above /three's (70): the gap before /three.
    pressAndMove(folderRows(id)[0], { from: { x: 10, y: 5 }, to: { x: 10, y: 50 } });

    expect(groups().groups[0].folders).toEqual(["/two", "/one", "/three"]);
  });

  it("leaves a folder where it is when dropped in the gap just below itself", () => {
    const id = groups().createGroup("A");
    ["/one", "/two", "/three"].forEach((p) => groups().addFolder(id, p));
    render(<WorkspaceRail windowLabel="main" />);
    layout(`[data-rail-folder-rows='${id}'] [data-rail-row='folder']`, [0, 28, 56]);

    pressAndMove(folderRows(id)[0], { from: { x: 10, y: 5 }, to: { x: 10, y: 20 } });

    expect(groups().groups[0].folders).toEqual(["/one", "/two", "/three"]);
  });

  it("moves a group one slot down when dropped between the next two headers", () => {
    const [a, b, c] = makeGroups("A", "B", "C");
    render(<WorkspaceRail windowLabel="main" />);
    layout("[data-rail-row='group']", [0, 28, 56]);

    pressAndMove(groupHeaders()[0], { from: { x: 10, y: 5 }, to: { x: 10, y: 50 } });

    expect(groups().groups.map((g) => g.id)).toEqual([b, a, c]);
  });
});

// One drag, one line. The indicator belongs to the list the drop will land in;
// rows of every OTHER list that happen to share the same index must stay bare.
describe("WorkspaceRail drag-to-reorder: a single drop indicator", () => {
  function indicators(): Element[] {
    return Array.from(
      document.querySelectorAll(
        ".workspace-rail__entry--drop-above, .workspace-rail__entry--drop-below," +
          " .workspace-rail__section--drop-above, .workspace-rail__section--drop-below," +
          " .workspace-rail__section--drop-into",
      ),
    );
  }

  it("paints exactly one indicator while a folder is dragged, and none in other groups", () => {
    const a = groups().createGroup("A");
    const b = groups().createGroup("B");
    ["/a1", "/a2"].forEach((p) => groups().addFolder(a, p));
    ["/b1", "/b2"].forEach((p) => groups().addFolder(b, p));
    render(<WorkspaceRail windowLabel="main" />);
    layout(`[data-rail-folder-rows='${a}'] [data-rail-row='folder']`, [28, 56]);
    layout(`[data-rail-folder-rows='${b}'] [data-rail-row='folder']`, [112, 140]);
    layout("[data-rail-group-id]", [0, 84], 84);

    const a1 = document.querySelector<HTMLElement>(`[data-rail-folder-rows='${a}'] [data-rail-row='folder']`);
    if (!a1) throw new Error("folder row not found");
    // Inside A, below /a2's midpoint: the gap after A's last row.
    pressAndMove(a1, { from: { x: 10, y: 35 }, to: { x: 10, y: 75 } }, { release: false });

    expect(indicators()).toHaveLength(1);
    const bList = document.querySelector(`[data-rail-folder-rows='${b}']`);
    expect(bList?.querySelector("[class*='--drop-']")).toBeNull();
  });

  it("paints exactly one indicator while a group is dragged", () => {
    const a = groups().createGroup("A");
    makeGroups("B", "C");
    ["/a1", "/a2", "/a3"].forEach((p) => groups().addFolder(a, p));
    render(<WorkspaceRail windowLabel="main" />);
    layout("[data-rail-row='group']", [0, 120, 148]);

    pressAndMove(groupHeaders()[2], { from: { x: 10, y: 150 }, to: { x: 10, y: 125 } }, { release: false });

    expect(indicators()).toHaveLength(1);
    expect(document.querySelector(".workspace-rail__entry[class*='--drop-']")).toBeNull();
  });
});

// A folder row can be dragged out of its group into another one. The group the
// pointer is over is the target; inside an expanded target the drop lands in
// the gap the pointer points at, onto a collapsed or empty one it is appended.
describe("WorkspaceRail drag-to-reorder: moving a folder to another group", () => {
  function setup({ collapseB = false } = {}) {
    const a = groups().createGroup("A");
    const b = groups().createGroup("B");
    ["/a1", "/a2"].forEach((p) => groups().addFolder(a, p));
    ["/b1", "/b2"].forEach((p) => groups().addFolder(b, p));
    if (collapseB) groups().toggleCollapsed(b);
    render(<WorkspaceRail windowLabel="main" />);
    layout(`[data-rail-folder-rows='${a}'] [data-rail-row='folder']`, [28, 56]);
    layout(`[data-rail-folder-rows='${b}'] [data-rail-row='folder']`, [112, 140]);
    layout("[data-rail-group-id]", [0, 84], 84);
    const a1 = document.querySelector<HTMLElement>(`[data-rail-folder-rows='${a}'] [data-rail-row='folder']`);
    if (!a1) throw new Error("folder row not found");
    return { a, b, a1 };
  }

  it("moves the folder into the gap it is dropped on in the other group", () => {
    const { a1 } = setup();

    // Over B, between /b1 (mid 126) and /b2 (mid 154).
    pressAndMove(a1, { from: { x: 10, y: 35 }, to: { x: 10, y: 140 } });

    expect(groups().groups.map((g) => g.folders)).toEqual([["/a2"], ["/b1", "/a1", "/b2"]]);
  });

  it("appends the folder to a collapsed group it is dropped on", () => {
    const { a1 } = setup({ collapseB: true });

    pressAndMove(a1, { from: { x: 10, y: 35 }, to: { x: 10, y: 95 } });

    expect(groups().groups.map((g) => g.folders)).toEqual([["/a2"], ["/b1", "/b2", "/a1"]]);
  });

  it("highlights the collapsed target group while the folder is over it", () => {
    const { b, a1 } = setup({ collapseB: true });

    pressAndMove(a1, { from: { x: 10, y: 35 }, to: { x: 10, y: 95 } }, { release: false });

    const target = document.querySelector(`[data-rail-group-id='${b}']`);
    expect(target?.classList.contains("workspace-rail__section--drop-into")).toBe(true);
  });

  it("does not duplicate a folder the target group already holds", () => {
    const a = groups().createGroup("A");
    const b = groups().createGroup("B");
    groups().addFolder(a, "/shared");
    ["/shared", "/b2"].forEach((p) => groups().addFolder(b, p));
    render(<WorkspaceRail windowLabel="main" />);
    layout(`[data-rail-folder-rows='${a}'] [data-rail-row='folder']`, [28]);
    layout(`[data-rail-folder-rows='${b}'] [data-rail-row='folder']`, [84, 112]);
    layout("[data-rail-group-id]", [0, 56], 84);
    const shared = document.querySelector<HTMLElement>(`[data-rail-folder-rows='${a}'] [data-rail-row='folder']`);
    if (!shared) throw new Error("folder row not found");

    pressAndMove(shared, { from: { x: 10, y: 35 }, to: { x: 10, y: 130 } });

    expect(groups().groups.map((g) => g.folders)).toEqual([[], ["/shared", "/b2"]]);
  });
});

// A real press on a group header lands on its name — the toggle button inside
// the header — not on the header's own box. The drag must start from there.
describe("WorkspaceRail drag-to-reorder: pressing on the group's name", () => {
  function groupNameButton(name: string): HTMLElement {
    const label = Array.from(document.querySelectorAll<HTMLElement>(".workspace-rail__section-name")).find(
      (el) => el.textContent === name,
    );
    const button = label?.closest("button");
    if (!button) throw new Error(`no toggle button for group ${name}`);
    return button;
  }

  it("reorders the groups when the drag starts on the group name", () => {
    const [a, b, c] = makeGroups("A", "B", "C");
    render(<WorkspaceRail windowLabel="main" />);
    layout("[data-rail-row='group']", [0, 28, 56]);

    pressAndMove(groupNameButton("A"), { from: { x: 10, y: 5 }, to: { x: 10, y: 80 } });

    expect(groups().groups.map((g) => g.id)).toEqual([b, c, a]);
  });

  it("still toggles the group when its name is clicked without moving", async () => {
    const [a] = makeGroups("A", "B");
    render(<WorkspaceRail windowLabel="main" />);

    await userEvent.click(groupNameButton("A"));

    expect(groups().collapsed[a]).toBe(true);
    expect(groups().groups[0].id).toBe(a);
  });
});
