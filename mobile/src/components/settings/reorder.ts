/**
 * The arithmetic of dragging a row in a list: where it would land, and how
 * far its neighbours slide to make room. Pure, so it is tested without a
 * pointer.
 *
 * @module components/settings/reorder
 */

export interface RowRect {
  top: number;
  height: number;
}

/** `items` with the one at `from` moved to `to`; out-of-range moves change nothing. */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  const next = items.slice();
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return next;
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved as T);
  return next;
}

const centre = (r: RowRect) => r.top + r.height / 2;

/**
 * The index the dragged row lands on after moving `dy` pixels: it passes a
 * neighbour once its centre crosses that neighbour's centre.
 */
export function dragTarget(rects: RowRect[], from: number, dy: number): number {
  const rect = rects[from];
  if (!rect) return from;
  const middle = centre(rect) + dy;
  let to = from;
  for (let i = from + 1; i < rects.length; i++) {
    if (middle > centre(rects[i] as RowRect)) to = i;
    else break;
  }
  if (to !== from) return to;
  for (let i = from - 1; i >= 0; i--) {
    if (middle < centre(rects[i] as RowRect)) to = i;
    else break;
  }
  return to;
}

/** How far a neighbour slides when the dragged row passes it: one row plus the gap between rows. */
export function rowShift(rects: RowRect[], from: number): number {
  const rect = rects[from];
  if (!rect) return 0;
  const other = rects[from === 0 ? 1 : from - 1];
  if (!other) return rect.height;
  const gap = from === 0 ? other.top - (rect.top + rect.height) : rect.top - (other.top + other.height);
  return rect.height + Math.max(0, gap);
}

/**
 * The vertical offset of row `i` while row `from` is dragged to `to`:
 * the dragged row follows the finger, the rows it has passed slide away.
 */
export function rowOffset(i: number, from: number, to: number, dy: number, shift: number): number {
  if (i === from) return dy;
  if (from < to && i > from && i <= to) return -shift;
  if (from > to && i < from && i >= to) return shift;
  return 0;
}
