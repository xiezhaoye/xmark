/**
 * Turning a press into a long press: hold still for `delayMs` and the finger
 * has "grabbed" the thing under it; move more than `tolerance` pixels before
 * that and the gesture is an ordinary scroll instead, which is what lets a
 * list be scrolled by starting on a row.
 *
 * Pure and timer-only, so the timing is tested with fake timers and no DOM.
 *
 * @module components/settings/longPress
 */

export interface LongPressOptions {
  /** How long the finger must stay within `tolerance` before the press starts. */
  delayMs?: number;
  /** How far the finger may wander before the press is an ordinary scroll. */
  tolerance?: number;
  /** Called once, when the press becomes a long press. */
  onStart: () => void;
}

export interface LongPress {
  /** A finger went down at `(x, y)`: starts timing. */
  down(x: number, y: number): void;
  /** The finger moved: past the tolerance the press is given up, otherwise ignored. */
  move(x: number, y: number): void;
  /** The finger lifted: `true` when this press had become a drag. */
  up(): boolean;
  /** The gesture was interrupted (cancelled touch, second finger): nothing fires. */
  cancel(): void;
  /** Whether the press has become a long press. */
  readonly active: boolean;
}

interface Press {
  readonly startX: number;
  readonly startY: number;
  readonly timer: ReturnType<typeof setTimeout>;
}

export function createLongPress({ delayMs = 350, tolerance = 8, onStart }: LongPressOptions): LongPress {
  let press: Press | null = null;
  let active = false;

  const clear = () => {
    if (press) clearTimeout(press.timer);
    press = null;
  };

  return {
    down(x, y) {
      clear();
      active = false;
      const timer = setTimeout(() => {
        press = null;
        active = true;
        onStart();
      }, delayMs);
      press = { startX: x, startY: y, timer };
    },

    move(x, y) {
      if (!press) return;
      if (Math.hypot(x - press.startX, y - press.startY) > tolerance) clear();
    },

    up() {
      const was = active;
      clear();
      active = false;
      return was;
    },

    cancel() {
      clear();
      active = false;
    },

    get active() {
      return active;
    },
  };
}
