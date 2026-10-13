import { describe, expect, it } from "vitest";
import { SIDEBAR_FONT_SIZES, sidebarRowHeight, sidebarTextVars } from "./sidebarTextSize";

describe("sidebarTextSize", () => {
  it.each([
    [13, 28],
    [14, 30],
    [15, 32],
    [16, 34],
  ])("a %dpx text size gets a %dpx row", (font, row) => {
    expect(sidebarRowHeight(font)).toBe(row);
  });

  it("publishes both variables", () => {
    expect(sidebarTextVars(15)).toEqual({ "--sidebar-font-size": "15px", "--sidebar-row-height": "32px" });
  });

  it("offers small to extra-large presets", () => {
    expect(SIDEBAR_FONT_SIZES).toEqual([13, 14, 15, 16]);
  });
});
