// @vitest-environment node
import { describe, expect, it } from "vitest";
import { anchorPopover, cornerClass } from "./popoverLayout";

/** A 390px-wide phone with a 34px notch. */
const phone = { width: 390, height: 844 };
const viewport = { width: 390, height: 844, top: 34 };
/** The settings button: the rightmost 44px of a 48px-bar, under the notch. */
const anchor = { top: 40, bottom: 84, left: 340, right: 384 };

const layout = (over: Partial<Parameters<typeof anchorPopover>[0]> = {}) =>
  anchorPopover({ anchor, viewport, viewportWidth: phone.width, ...over });

describe("anchorPopover", () => {
  it("hangs below the icon, aligned with its right edge", () => {
    const { top, right } = layout();
    expect(top).toBe(84 + 6);
    expect(right).toBeGreaterThanOrEqual(8);
    expect(right).toBeLessThanOrEqual(12);
  });

  it("takes about half the screen and never less than a usable minimum", () => {
    expect(layout().width).toBeCloseTo(195, 5);
    // A 320px phone as Apple's SE reports it: still wide enough for a row.
    const narrow = anchorPopover({ anchor: { top: 20, bottom: 64, left: 270, right: 314 }, viewport: { width: 320, height: 568, top: 20 }, viewportWidth: 320 });
    expect(narrow.width).toBe(176);
  });

  it("stays inside the viewport on both sides", () => {
    const wide = layout({ viewportWidth: 320 });
    expect(wide.right).toBeGreaterThanOrEqual(0);
    expect(wide.right + wide.width).toBeLessThanOrEqual(320);
    const right = layout({ anchor: { top: 40, bottom: 84, left: 370, right: 390 } });
    expect(right.right).toBeGreaterThanOrEqual(8);
  });

  it("rounds the corner nearest the icon", () => {
    expect(layout().corner).toBe("top-right");
    expect(layout({ anchor: { top: 40, bottom: 84, left: 4, right: 48 } }).corner).toBe("top-left");
  });

  it("grows when the soft keyboard shrinks the visual viewport", () => {
    expect(layout({ viewport: { width: 390, height: 400, top: 34 } }).maxHeight).toBeGreaterThan(200);
  });

  it("keeps a minimum height even on a very short viewport", () => {
    expect(layout({ viewport: { width: 390, height: 120, top: 34 } }).maxHeight).toBeGreaterThanOrEqual(120);
  });

  it("measures from the visual viewport's offset, so a scrolled page still anchors right", () => {
    expect(layout({ viewport: { width: 390, height: 600, top: 0 } }).top).toBe(90);
  });
});

describe("cornerClass", () => {
  it("names the corner nearest the icon", () => {
    expect(cornerClass("top-right")).toBe("corner-top-right");
    expect(cornerClass("top-left")).toBe("corner-top-left");
  });
});
