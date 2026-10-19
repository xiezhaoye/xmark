import { describe, expect, it } from "vitest";
import { dragTarget, moveItem, rowOffset, rowShift } from "./reorder";

// Three rows, 50px high with an 8px gap.
const RECTS = [
  { top: 0, height: 50 },
  { top: 58, height: 50 },
  { top: 116, height: 50 },
];

describe("moveItem", () => {
  it("moves an item and leaves the original alone", () => {
    const ids = ["a", "b", "c"];
    expect(moveItem(ids, 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveItem(ids, 2, 0)).toEqual(["c", "a", "b"]);
    expect(ids).toEqual(["a", "b", "c"]);
  });

  it("changes nothing for a move to itself or out of range", () => {
    expect(moveItem(["a", "b"], 1, 1)).toEqual(["a", "b"]);
    expect(moveItem(["a", "b"], 0, 5)).toEqual(["a", "b"]);
    expect(moveItem(["a", "b"], -1, 0)).toEqual(["a", "b"]);
  });
});

describe("dragTarget", () => {
  it("stays put until the row's centre passes a neighbour's centre", () => {
    expect(dragTarget(RECTS, 0, 0)).toBe(0);
    expect(dragTarget(RECTS, 0, 50)).toBe(0);
    expect(dragTarget(RECTS, 0, 60)).toBe(1);
  });

  it("can pass several rows, downward and upward", () => {
    expect(dragTarget(RECTS, 0, 140)).toBe(2);
    expect(dragTarget(RECTS, 2, -120)).toBe(0);
    expect(dragTarget(RECTS, 2, -60)).toBe(1);
  });

  it("clamps at the ends of the list", () => {
    expect(dragTarget(RECTS, 0, 5000)).toBe(2);
    expect(dragTarget(RECTS, 2, -5000)).toBe(0);
  });
});

describe("rowShift and rowOffset", () => {
  it("is one row plus the gap", () => {
    expect(rowShift(RECTS, 0)).toBe(58);
    expect(rowShift(RECTS, 2)).toBe(58);
    expect(rowShift([{ top: 0, height: 50 }], 0)).toBe(50);
  });

  it("slides the rows the dragged one has passed", () => {
    // Row 0 dragged down onto row 2: rows 1 and 2 move up.
    expect([0, 1, 2].map((i) => rowOffset(i, 0, 2, 130, 58))).toEqual([130, -58, -58]);
    // Row 2 dragged up onto row 0: rows 0 and 1 move down.
    expect([0, 1, 2].map((i) => rowOffset(i, 2, 0, -130, 58))).toEqual([58, 58, -130]);
    // Not moved past anyone yet.
    expect([0, 1, 2].map((i) => rowOffset(i, 1, 1, 10, 58))).toEqual([0, 10, 0]);
  });
});
