// @vitest-environment node
import { describe, expect, it } from "vitest";
import { PULL_TRIGGER_PX, pullDistance, shouldRefresh } from "./pullToRefresh";

describe("pull to refresh", () => {
  it("measures a damped downward pull only from the top", () => {
    expect(pullDistance({ startY: 100, y: 200, scrollTop: 0 })).toBe(50);
    expect(pullDistance({ startY: 100, y: 200, scrollTop: 5 })).toBe(0);
    expect(pullDistance({ startY: 200, y: 100, scrollTop: 0 })).toBe(0);
  });

  it("triggers past the threshold only", () => {
    expect(shouldRefresh(PULL_TRIGGER_PX)).toBe(true);
    expect(shouldRefresh(PULL_TRIGGER_PX - 1)).toBe(false);
  });
});
