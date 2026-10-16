import { describe, expect, it } from "vitest";
import { calcRailDropIndex, isRailDragArmed, railKeyboardTarget } from "./railReorderGeometry";

/** A row at `top`, `height` tall — the only part of a rect this maths reads. */
function rect(top: number, height = 28): DOMRect {
  return { top, bottom: top + height, height, left: 0, right: 100, width: 100, x: 0, y: top } as DOMRect;
}

const ROWS = [rect(0), rect(28), rect(56)];

describe("calcRailDropIndex", () => {
  it("drops first when the pointer is above every row's midpoint", () => {
    expect(calcRailDropIndex(ROWS, -50)).toBe(0);
    expect(calcRailDropIndex(ROWS, 0)).toBe(0);
    expect(calcRailDropIndex(ROWS, 13)).toBe(0);
  });

  it("drops after a row once the pointer passes its midpoint", () => {
    // Row 0 spans 0–28, midpoint 14.
    expect(calcRailDropIndex(ROWS, 15)).toBe(1);
  });

  it("drops last when the pointer is below every midpoint", () => {
    // Row 2 spans 56–84, midpoint 70.
    expect(calcRailDropIndex(ROWS, 71)).toBe(3);
    expect(calcRailDropIndex(ROWS, 500)).toBe(3);
  });

  it("returns a gap for every position, including after the last row", () => {
    const gaps = new Set([-100, 10, 20, 40, 60, 200].map((y) => calcRailDropIndex(ROWS, y)));
    expect([...gaps].sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
  });

  it("returns 0 for an empty column, so a drop into it is well defined", () => {
    expect(calcRailDropIndex([], 500)).toBe(0);
  });

  it("ignores a row that has no laid-out height first", () => {
    // A section measured at 0 height cannot decide a midpoint, so it is skipped
    // rather than swallowing the drop: with the zero row first, the live row at
    // 0–28 is what the pointer is compared against.
    expect(calcRailDropIndex([rect(0, 0), rect(0)], 10)).toBe(1);
    // Whereas the live row alone would place 10 before itself.
    expect(calcRailDropIndex([rect(0)], 10)).toBe(0);
  });
});

describe("isRailDragArmed", () => {
  it("stays disarmed inside the threshold, so a click is still a click", () => {
    expect(isRailDragArmed(0, 0)).toBe(false);
    expect(isRailDragArmed(5, 0)).toBe(false);
    expect(isRailDragArmed(0, 5)).toBe(false);
    expect(isRailDragArmed(4, 4)).toBe(false);
  });

  it("arms past the threshold in any direction", () => {
    expect(isRailDragArmed(6, 0)).toBe(true);
    expect(isRailDragArmed(-6, 0)).toBe(true);
    expect(isRailDragArmed(0, -6)).toBe(true);
    expect(isRailDragArmed(6, 6)).toBe(true);
  });
});

/** The modifier set a real Alt+Arrow arrives with. */
function key(key: string, extra: Partial<Record<string, boolean>> = {}) {
  return { key, altKey: true, shiftKey: false, metaKey: false, ctrlKey: false, ...extra };
}

describe("railKeyboardTarget", () => {
  it("ignores an arrow without Alt, so the key keeps its own meaning", () => {
    expect(railKeyboardTarget(key("ArrowUp", { altKey: false }), 1, 3)).toBeNull();
    expect(railKeyboardTarget(key("ArrowDown", { altKey: false }), 1, 3)).toBeNull();
  });

  it("ignores non-arrow keys even with Alt held", () => {
    expect(railKeyboardTarget(key("a"), 1, 3)).toBeNull();
    expect(railKeyboardTarget(key("Enter"), 1, 3)).toBeNull();
  });

  it("ignores Alt+Arrow carrying another modifier, which is someone else's shortcut", () => {
    expect(railKeyboardTarget(key("ArrowUp", { shiftKey: true }), 1, 3)).toBeNull();
    expect(railKeyboardTarget(key("ArrowUp", { metaKey: true }), 1, 3)).toBeNull();
    expect(railKeyboardTarget(key("ArrowUp", { ctrlKey: true }), 1, 3)).toBeNull();
  });

  it("moves one slot up or down in the middle of the list", () => {
    expect(railKeyboardTarget(key("ArrowUp"), 1, 3)).toBe(0);
    expect(railKeyboardTarget(key("ArrowDown"), 1, 3)).toBe(2);
  });

  it("reports no move at either end", () => {
    expect(railKeyboardTarget(key("ArrowUp"), 0, 3)).toBeNull();
    expect(railKeyboardTarget(key("ArrowDown"), 2, 3)).toBeNull();
    // A one-row list cannot move in either direction.
    expect(railKeyboardTarget(key("ArrowUp"), 0, 1)).toBeNull();
    expect(railKeyboardTarget(key("ArrowDown"), 0, 1)).toBeNull();
  });
});
