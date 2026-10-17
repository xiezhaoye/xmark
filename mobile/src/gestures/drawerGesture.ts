/**
 * The drawer's swipe, as pure state: start → move* → end.
 *
 * A swipe right opens the closed drawer, a swipe left closes the open one.
 * The axis locks after a few pixels: a mostly vertical gesture is a scroll
 * and never moves the drawer. A touch that starts inside something that
 * scrolls sideways (a wide code block or table) or a text field is left to
 * that element.
 *
 * @module gestures/drawerGesture
 */

export const DRAWER_COMMIT_PX = 60;
const AXIS_LOCK_PX = 8;

export interface DrawerGesture {
  startX: number;
  startY: number;
  open: boolean;
  width: number;
  axis: "x" | "y" | null;
  /** Drawer's visible width right now, 0…width. */
  offset: number;
  dx: number;
}

export function startDrawerGesture(p: { x: number; y: number; open: boolean; width: number }): DrawerGesture {
  return { startX: p.x, startY: p.y, open: p.open, width: p.width, axis: null, offset: p.open ? p.width : 0, dx: 0 };
}

export function moveDrawerGesture(g: DrawerGesture, p: { x: number; y: number }): DrawerGesture {
  const dx = p.x - g.startX;
  const dy = p.y - g.startY;
  let axis = g.axis;
  if (!axis && Math.max(Math.abs(dx), Math.abs(dy)) >= AXIS_LOCK_PX) axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
  if (axis !== "x") return { ...g, axis };
  const base = g.open ? g.width : 0;
  const offset = Math.min(g.width, Math.max(0, base + dx));
  return { ...g, axis, offset, dx };
}

export function endDrawerGesture(g: DrawerGesture): "open" | "closed" {
  if (g.axis !== "x") return g.open ? "open" : "closed";
  if (!g.open) return g.dx > DRAWER_COMMIT_PX ? "open" : "closed";
  return g.dx < -DRAWER_COMMIT_PX ? "closed" : "open";
}

export function isInsideHorizontalScroller(target: Element | null): boolean {
  for (let el = target; el && el !== document.body; el = el.parentElement) {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return true;
    const overflowX = getComputedStyle(el).overflowX;
    if ((overflowX === "auto" || overflowX === "scroll") && el.scrollWidth > el.clientWidth) return true;
  }
  return false;
}
