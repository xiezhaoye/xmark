import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useSettingsStore } from "@/stores/settingsStore";
import { WorkspaceRailResizeHandle, clampRailWidth } from "./WorkspaceRailResizeHandle";

function setRailWidth(width: number): void {
  useSettingsStore.setState({
    general: { ...useSettingsStore.getState().general, workspaceRailWidth: width },
  });
}

const railWidth = () => useSettingsStore.getState().general.workspaceRailWidth;

beforeEach(() => {
  setRailWidth(160);
});

describe("clampRailWidth", () => {
  it.each([
    [50, 120],
    [120, 120],
    [200, 200],
    [999, 320],
  ])("clamps %d to %d", (input, expected) => {
    expect(clampRailWidth(input)).toBe(expected);
  });
});

describe("WorkspaceRailResizeHandle", () => {
  it("is a focusable vertical separator reporting the live width", () => {
    render(<WorkspaceRailResizeHandle width={160} />);
    const handle = screen.getByRole("separator");
    expect(handle).toHaveAttribute("aria-orientation", "vertical");
    expect(handle).toHaveAttribute("aria-valuenow", "160");
    expect(handle).toHaveAttribute("aria-valuemin", "120");
    expect(handle).toHaveAttribute("aria-valuemax", "320");
    expect(handle).toHaveAttribute("tabindex", "0");
  });

  it("steps the width with arrow keys (Shift for larger steps)", async () => {
    render(<WorkspaceRailResizeHandle width={160} />);
    screen.getByRole("separator").focus();

    await userEvent.keyboard("{ArrowRight}");
    expect(railWidth()).toBe(168);
    await userEvent.keyboard("{Shift>}{ArrowLeft}{/Shift}");
    expect(railWidth()).toBe(136);
  });

  it("jumps to the bounds with Home and End", async () => {
    render(<WorkspaceRailResizeHandle width={160} />);
    screen.getByRole("separator").focus();

    await userEvent.keyboard("{End}");
    expect(railWidth()).toBe(320);
    await userEvent.keyboard("{Home}");
    expect(railWidth()).toBe(120);
  });

  it("writes the setting once, when the drag ends", () => {
    render(<WorkspaceRailResizeHandle width={160} />);
    const handle = screen.getByRole("separator");

    fireEvent.mouseDown(handle, { clientX: 100 });
    fireEvent.mouseMove(document, { clientX: 140 });
    fireEvent.mouseMove(document, { clientX: 150 });
    expect(railWidth()).toBe(160);

    fireEvent.mouseUp(document, { clientX: 150 });
    expect(railWidth()).toBe(210);
  });

  it("a press with no movement writes nothing", () => {
    render(<WorkspaceRailResizeHandle width={160} />);
    const handle = screen.getByRole("separator");

    fireEvent.mouseDown(handle, { clientX: 100 });
    fireEvent.mouseUp(document, { clientX: 100 });

    expect(railWidth()).toBe(160);
  });
});
