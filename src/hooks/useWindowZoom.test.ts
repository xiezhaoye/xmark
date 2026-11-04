/**
 * ⌘+ / ⌘− / ⌘0 — the browser's own page zoom.
 *
 * Behaviour under test: the chord's key maps to the next scale on a 0.1 grid,
 * clamped to 0.5–3, with 0 as the reset; and junk input never escapes the range.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ setZoom: vi.fn(() => Promise.resolve()) }),
}));

const { clampWindowZoom, windowZoomForKey, WINDOW_ZOOM_DEFAULT } = await import("./useWindowZoom");

describe("clampWindowZoom", () => {
  it("snaps to the 0.1 grid and clamps to the supported range", () => {
    expect(clampWindowZoom(1.04)).toBe(1);
    expect(clampWindowZoom(1.06)).toBe(1.1);
    expect(clampWindowZoom(0.1)).toBe(0.5);
    expect(clampWindowZoom(9)).toBe(3);
  });

  it("falls back instead of producing NaN from junk", () => {
    expect(clampWindowZoom(Number.NaN)).toBe(WINDOW_ZOOM_DEFAULT);
    expect(clampWindowZoom(Number.POSITIVE_INFINITY)).toBe(WINDOW_ZOOM_DEFAULT);
  });
});

describe("windowZoomForKey", () => {
  it("steps up on = and + (⌘+ is ⌘⇧= on a US layout)", () => {
    expect(windowZoomForKey("=", 1)).toBe(1.1);
    expect(windowZoomForKey("+", 1)).toBe(1.1);
  });

  it("steps down on - and _", () => {
    expect(windowZoomForKey("-", 1)).toBe(0.9);
    expect(windowZoomForKey("_", 1)).toBe(0.9);
  });

  it("resets on 0", () => {
    expect(windowZoomForKey("0", 2.4)).toBe(1);
  });

  it("leaves every other key alone", () => {
    expect(windowZoomForKey("a", 1)).toBeNull();
    expect(windowZoomForKey("ArrowRight", 1)).toBeNull();
  });

  it("stops at the range instead of running past it", () => {
    expect(windowZoomForKey("=", 3)).toBe(3);
    expect(windowZoomForKey("-", 0.5)).toBe(0.5);
  });
});
