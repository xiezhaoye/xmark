import { describe, expect, it } from "vitest";
import { DRAWER_COMMIT_PX, endDrawerGesture, isInsideHorizontalScroller, moveDrawerGesture, startDrawerGesture } from "./drawerGesture";

const WIDTH = 354;

describe("drawer gesture", () => {
  it("opens on a rightward swipe past the threshold when closed", () => {
    const g = startDrawerGesture({ x: 100, y: 300, open: false, width: WIDTH });
    const moved = moveDrawerGesture(g, { x: 100 + DRAWER_COMMIT_PX + 1, y: 305 });
    expect(moved.axis).toBe("x");
    expect(endDrawerGesture(moved)).toBe("open");
  });

  it("stays closed on a short rightward swipe", () => {
    const g = moveDrawerGesture(startDrawerGesture({ x: 100, y: 300, open: false, width: WIDTH }), { x: 130, y: 300 });
    expect(endDrawerGesture(g)).toBe("closed");
  });

  it("closes on a leftward swipe when open", () => {
    const g = moveDrawerGesture(startDrawerGesture({ x: 300, y: 300, open: true, width: WIDTH }), { x: 200, y: 300 });
    expect(endDrawerGesture(g)).toBe("closed");
  });

  it("ignores a leftward swipe when closed and a rightward one when open", () => {
    const closed = moveDrawerGesture(startDrawerGesture({ x: 300, y: 300, open: false, width: WIDTH }), { x: 100, y: 300 });
    expect(endDrawerGesture(closed)).toBe("closed");
    const open = moveDrawerGesture(startDrawerGesture({ x: 100, y: 300, open: true, width: WIDTH }), { x: 300, y: 300 });
    expect(endDrawerGesture(open)).toBe("open");
  });

  it("locks to vertical scrolling and never moves the drawer", () => {
    let g = startDrawerGesture({ x: 100, y: 300, open: false, width: WIDTH });
    g = moveDrawerGesture(g, { x: 104, y: 330 });
    expect(g.axis).toBe("y");
    g = moveDrawerGesture(g, { x: 300, y: 340 });
    expect(g.offset).toBe(0);
    expect(endDrawerGesture(g)).toBe("closed");
  });

  it("follows the finger, clamped to the drawer width", () => {
    let g = startDrawerGesture({ x: 0, y: 0, open: false, width: WIDTH });
    g = moveDrawerGesture(g, { x: 50, y: 0 });
    expect(g.offset).toBe(50);
    g = moveDrawerGesture(g, { x: 900, y: 0 });
    expect(g.offset).toBe(WIDTH);
    let o = startDrawerGesture({ x: 300, y: 0, open: true, width: WIDTH });
    o = moveDrawerGesture(o, { x: -200, y: 0 });
    expect(o.offset).toBe(0);
  });

  it("does nothing before the finger moves", () => {
    expect(endDrawerGesture(startDrawerGesture({ x: 0, y: 0, open: true, width: WIDTH }))).toBe("open");
  });
});

describe("isInsideHorizontalScroller", () => {
  it("finds a scrollable ancestor such as a wide code block", () => {
    const pre = document.createElement("pre");
    pre.style.overflowX = "auto";
    Object.defineProperty(pre, "scrollWidth", { value: 800 });
    Object.defineProperty(pre, "clientWidth", { value: 300 });
    const span = document.createElement("span");
    pre.appendChild(span);
    document.body.appendChild(pre);
    expect(isInsideHorizontalScroller(span)).toBe(true);
    pre.remove();
  });

  it("ignores elements that fit", () => {
    const div = document.createElement("div");
    div.style.overflowX = "auto";
    document.body.appendChild(div);
    expect(isInsideHorizontalScroller(div)).toBe(false);
    div.remove();
  });

  it("treats text inputs as off-limits", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    expect(isInsideHorizontalScroller(input)).toBe(true);
    input.remove();
  });
});
