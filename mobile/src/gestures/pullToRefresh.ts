/**
 * Pull-to-refresh distance and trigger, as pure functions.
 *
 * Only a pull that starts with the list scrolled to the top counts, and the
 * distance is damped by half so the indicator lags the finger.
 *
 * @module gestures/pullToRefresh
 */

export const PULL_TRIGGER_PX = 64;

export function pullDistance({ startY, y, scrollTop }: { startY: number; y: number; scrollTop: number }): number {
  if (scrollTop > 0) return 0;
  return Math.max(0, (y - startY) / 2);
}

export function shouldRefresh(distance: number): boolean {
  return distance >= PULL_TRIGGER_PX;
}
