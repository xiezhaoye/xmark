import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLongPress } from "./longPress";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const setup = () => {
  const onStart = vi.fn();
  return { onStart, press: createLongPress({ onStart }) };
};

describe("createLongPress", () => {
  it("starts once the finger has been held for the delay", () => {
    const { onStart, press } = setup();
    press.down(10, 20);
    expect(press.active).toBe(false);
    vi.advanceTimersByTime(349);
    expect(onStart).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(press.active).toBe(true);
    // A held finger that keeps still does not start a second time.
    press.move(12, 22);
    vi.advanceTimersByTime(1000);
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("gives up once the finger moves past the tolerance, and never fires", () => {
    const { onStart, press } = setup();
    press.down(0, 0);
    press.move(0, 9);
    vi.advanceTimersByTime(1000);
    expect(onStart).not.toHaveBeenCalled();
    expect(press.active).toBe(false);
    expect(press.up()).toBe(false);
  });

  it("allows a wobble inside the tolerance", () => {
    const { onStart, press } = setup();
    press.down(0, 0);
    press.move(5, 6);
    press.move(-3, 2);
    vi.advanceTimersByTime(350);
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("does not start when the finger lifts before the delay", () => {
    const { onStart, press } = setup();
    press.down(0, 0);
    expect(press.up()).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(onStart).not.toHaveBeenCalled();
  });

  it("reports whether the press that ended had become a drag", () => {
    const { press } = setup();
    press.down(0, 0);
    vi.advanceTimersByTime(350);
    expect(press.up()).toBe(true);
    expect(press.active).toBe(false);
  });

  it("never starts after cancel, and a cancel ends an active press", () => {
    const { onStart, press } = setup();
    press.down(0, 0);
    press.cancel();
    vi.advanceTimersByTime(1000);
    expect(onStart).not.toHaveBeenCalled();

    press.down(0, 0);
    vi.advanceTimersByTime(350);
    expect(press.active).toBe(true);
    press.cancel();
    expect(press.active).toBe(false);
    expect(press.up()).toBe(false);
  });

  it("a new press replaces the one before it", () => {
    const { onStart, press } = setup();
    press.down(0, 0);
    press.down(100, 100);
    vi.advanceTimersByTime(350);
    expect(onStart).toHaveBeenCalledTimes(1);
    // The first press's start point is gone: moving past the second's does not cancel.
    press.move(150, 150);
    expect(press.active).toBe(true);
  });

  it("takes its own delay and tolerance", () => {
    const onStart = vi.fn();
    const press = createLongPress({ delayMs: 100, tolerance: 2, onStart });
    press.down(0, 0);
    press.move(0, 3);
    vi.advanceTimersByTime(100);
    expect(onStart).not.toHaveBeenCalled();
    press.down(0, 0);
    vi.advanceTimersByTime(100);
    expect(onStart).toHaveBeenCalledTimes(1);
  });
});
