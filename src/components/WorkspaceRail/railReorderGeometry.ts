/**
 * railReorderGeometry — the pure measurements behind a workspace-rail drag.
 *
 * Purpose: where a dragged group header or folder row would drop, and whether
 * a pointer has moved far enough to count as a drag at all. No state, no
 * listeners, no DOM lookups: every function reads the rects it is given and
 * returns a number, so the gesture hook stays about the gesture (the same split
 * as `utils/tabDragGeometry.ts` for the tab bar).
 *
 * The drop index is a GAP, not an element: three rows have four gaps (before
 * the first, between each pair, after the last). That is what lets a row be
 * dropped at the foot of its column, and it is why `toIndex` in the store's
 * `reorderGroups` / `reorderFolder` is clamped rather than rejected.
 *
 * @coordinates-with components/WorkspaceRail/useRailDragReorder.ts — the gesture that calls these
 * @coordinates-with stores/workspaceGroupsStore.ts — commits the indexes
 * @module components/WorkspaceRail/railReorderGeometry
 */

/**
 * How far the pointer must travel before a press becomes a drag.
 *
 * This is the ONLY thing standing between "click to open this workspace" and
 * "drag to reorder it", so it is deliberately larger than the 1–2px of jitter a
 * trackpad reports during a tap, and deliberately small enough that a real drag
 * arms immediately. Below it the gesture does nothing at all — no drag state,
 * no `preventDefault` — so the underlying button's click fires normally.
 */
const RAIL_DRAG_THRESHOLD_PX = 6;

/**
 * The gap index `clientY` points at, among rows already measured in
 * document/visual order.
 *
 * Walks the rows and returns the first whose vertical midpoint is below the
 * pointer — so the pointer is "in the gap" before that row. Past every
 * midpoint the answer is `rows.length`, the gap after the last row. Rows with
 * no height are skipped: a folded section's header can measure 0 during a
 * layout pass, and letting it decide a midpoint would swallow drops.
 */
export function calcRailDropIndex(rows: readonly DOMRect[], clientY: number): number {
  for (let i = 0; i < rows.length; i++) {
    const rect = rows[i];
    if (rect.height <= 0) continue;
    if (clientY < rect.top + rect.height / 2) return i;
  }
  return rows.length;
}

/**
 * True once the pointer has left the press point by more than
 * `RAIL_DRAG_THRESHOLD_PX` on either axis.
 *
 * Comparison is per-axis, not Euclidean: a pointer that travels 5px right and
 * 5px down has moved 7px in a straight line but is still within the jitter a
 * tap produces on both axes, and arming there would break clicks in the
 * direction users gesture most. Inclusive at exactly the threshold, so the
 * constant reads as "6px arms a drag" with no off-by-one to remember.
 */
export function isRailDragArmed(dx: number, dy: number): boolean {
  return Math.abs(dx) >= RAIL_DRAG_THRESHOLD_PX || Math.abs(dy) >= RAIL_DRAG_THRESHOLD_PX;
}

/**
 * The destination index for a keyboard reorder of the row at `fromIndex`, or
 * `null` when the key is not a reorder or the row cannot move further.
 *
 * Alt+Arrow is the pointer-free equivalent of dragging a row one slot. It is
 * deliberately a SLOT and not a jump to either end: a keyboard user needs the
 * same reversible, one-step-at-a-time control a drag gives, and `null` at the
 * ends keeps the key from reordering to where the row already is.
 */
export function railKeyboardTarget(
  event: { key: string; altKey: boolean; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean },
  fromIndex: number,
  length: number,
): number | null {
  if (!event.altKey) return null;
  // Other modifiers belong to shortcuts this handler must not shadow.
  if (event.shiftKey || event.metaKey || event.ctrlKey) return null;
  if (event.key === "ArrowUp") return fromIndex > 0 ? fromIndex - 1 : null;
  if (event.key === "ArrowDown") return fromIndex < length - 1 ? fromIndex + 1 : null;
  return null;
}
