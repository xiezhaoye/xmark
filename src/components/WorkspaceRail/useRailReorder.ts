/**
 * useRailReorder — everything the rail needs to reorder its groups and folders.
 *
 * Purpose: one hook that owns the whole gesture-to-store path, so `WorkspaceRail`
 * stays about rendering. It answers three questions for each row: how to press
 * it, what it looks like while a drag is in flight, and how a keyboard moves it.
 *
 * Two gestures, one implementation:
 *   - **Group headers** reorder the groups (`reorderGroups`).
 *   - **Folder rows** reorder within their group (`reorderFolder`) or move into
 *     another group (`moveFolderToGroup`). The group the pointer is over is the
 *     target; inside it the drop lands in the gap the pointer points at, and a
 *     collapsed or empty target (no rows to point between) appends.
 *
 * Key decisions:
 *   - **Rows are measured from the DOM, not from a layout track.** The rail is a
 *     plain list whose rows the header and each entry already are, so their own
 *     rects are the truth; a parallel array of offsets would be a second
 *     description of the same thing to keep in sync.
 *   - **A drop is a GAP; the store takes a FINAL index.** Three rows have four
 *     gaps. Moving a row down past `n` neighbours lands it in gap `from + n + 1`
 *     but at final index `from + n`, so a same-list commit subtracts one for a
 *     downward move. A drop in the row's own two gaps changes nothing: it
 *     neither commits nor paints an indicator.
 *   - **One drag paints one indicator**, in the list the drop lands in. A row of
 *     any other list that happens to share the drop index stays bare.
 *   - **The derived Ungrouped section is not reorderable**, and not a drop
 *     target. Its order comes from the window's instances, not a stored list.
 *   - **Keyboard reorder is offered, not implied.** Alt+Arrow moves a row one
 *     slot within its list, because a reorder reachable only by dragging is
 *     unreachable by keyboard.
 *
 * @coordinates-with useRailDragReorder.ts — the press/move/release gesture
 * @coordinates-with railReorderGeometry.ts — the threshold, drop index and key mapping
 * @coordinates-with WorkspaceRail.tsx — the only consumer
 * @module components/WorkspaceRail/useRailReorder
 */

import { useCallback, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useWorkspaceGroupsStore } from "@/stores/workspaceGroupsStore";
import { useRailDragReorder, type RailDrop, type RailDragSubject } from "./useRailDragReorder";
import { calcRailDropIndex, railKeyboardTarget } from "./railReorderGeometry";

/** The drag wiring one row needs. */
interface RailRowDrag {
  onPointerDown: (event: React.PointerEvent) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
  dragging: boolean;
  dropAbove: boolean;
  dropBelow: boolean;
}

export interface RailReorder {
  /** Ref for the scrolling list that holds the group rows. */
  listRef: React.RefObject<HTMLDivElement | null>;
  /** True while a drag is armed — drives the rail's own reordering class. */
  isReordering: boolean;
  /** The drag wiring for one row. Callers pass `null` for Ungrouped instead. */
  rowDrag: (subject: RailDragSubject, index: number, length: number) => RailRowDrag;
  /** True while a folder is held over this group and would be appended to it. */
  dropInto: (groupId: string) => boolean;
}

/** Index of the subject in its own list, as the store holds it. */
function sourceIndex(subject: RailDragSubject): number {
  const { groups } = useWorkspaceGroupsStore.getState();
  if (subject.kind === "group") return groups.findIndex((g) => g.id === subject.groupId);
  return groups.find((g) => g.id === subject.groupId)?.folders.indexOf(subject.path) ?? -1;
}

/** A gap in the subject's OWN list that would leave it where it is. */
function isOwnGap(subject: RailDragSubject, gap: number): boolean {
  const from = sourceIndex(subject);
  return from >= 0 && (gap === from || gap === from + 1);
}

export function useRailReorder(): RailReorder {
  const listRef = useRef<HTMLDivElement>(null);

  const measure = useCallback((subject: RailDragSubject, clientY: number): RailDrop => {
    const list = listRef.current;
    const rects = (selector: string): DOMRect[] =>
      list ? Array.from(list.querySelectorAll(selector)).map((el) => el.getBoundingClientRect()) : [];

    if (subject.kind === "group") {
      const index = calcRailDropIndex(rects("[data-rail-row='group']"), clientY);
      return { index, targetGroupId: null, into: false, noop: isOwnGap(subject, index) };
    }

    // A folder drops into the group whose section the pointer is over; above
    // the first or below the last, the nearest one. Unmeasurable sections (no
    // height yet) keep the folder in its own group.
    const sections = list ? Array.from(list.querySelectorAll<HTMLElement>("[data-rail-group-id]")) : [];
    const measured = sections
      .map((el) => ({ id: el.dataset.railGroupId ?? "", rect: el.getBoundingClientRect() }))
      .filter((s) => s.id !== "" && s.rect.height > 0);
    let target = subject.groupId;
    if (measured.length > 0) {
      const hit = measured.find((s) => clientY >= s.rect.top && clientY < s.rect.bottom);
      target = (hit ?? (clientY < measured[0].rect.top ? measured[0] : measured[measured.length - 1])).id;
    }

    const rows = rects(`[data-rail-folder-rows='${CSS.escape(target)}'] [data-rail-row='folder']`);
    if (rows.length === 0) {
      const count = useWorkspaceGroupsStore.getState().groups.find((g) => g.id === target)?.folders.length ?? 0;
      return { index: count, targetGroupId: target, into: true, noop: target === subject.groupId };
    }
    const index = calcRailDropIndex(rows, clientY);
    return { index, targetGroupId: target, into: false, noop: target === subject.groupId && isOwnGap(subject, index) };
  }, []);

  const commit = useCallback((subject: RailDragSubject, drop: RailDrop) => {
    const api = useWorkspaceGroupsStore.getState();
    const from = sourceIndex(subject);
    // Gap → final index: a row moving down leaves its own slot behind it.
    const finalIndex = from >= 0 && drop.index > from ? drop.index - 1 : drop.index;
    if (subject.kind === "group") {
      api.reorderGroups(subject.groupId, finalIndex);
      return;
    }
    if (drop.targetGroupId !== null && drop.targetGroupId !== subject.groupId) {
      api.moveFolderToGroup(subject.groupId, subject.path, drop.targetGroupId, drop.index);
      return;
    }
    if (from >= 0) api.reorderFolder(subject.groupId, from, finalIndex);
  }, []);

  /** Keyboard moves take a final index directly (one slot up or down). */
  const commitIndex = useCallback((subject: RailDragSubject, toIndex: number) => {
    const api = useWorkspaceGroupsStore.getState();
    if (subject.kind === "group") api.reorderGroups(subject.groupId, toIndex);
    else {
      const from = sourceIndex(subject);
      if (from >= 0) api.reorderFolder(subject.groupId, from, toIndex);
    }
  }, []);

  const { drag, isDragging, onRowPointerDown } = useRailDragReorder({ measure, onCommit: commit });

  // The drop that should be drawn, or null: nothing before arming and nothing
  // for a no-op release.
  const shownDrop = isDragging && drag?.drop && !drag.drop.noop ? drag.drop : null;

  const rowDrag = (subject: RailDragSubject, index: number, length: number): RailRowDrag => {
    const dragged = drag?.subject;
    const dragging =
      dragged !== undefined &&
      dragged.kind === subject.kind &&
      dragged.groupId === subject.groupId &&
      (subject.kind === "group" || (dragged as { path: string }).path === subject.path);
    // Is this row's list the one the drop lands in (and drawn between rows)?
    const inTargetList =
      shownDrop !== null &&
      dragged !== undefined &&
      dragged.kind === subject.kind &&
      (subject.kind === "group" || (shownDrop.targetGroupId === subject.groupId && !shownDrop.into));
    return {
      onPointerDown: (event) => onRowPointerDown(event, subject),
      onKeyDown: (event) => {
        const target = railKeyboardTarget(event, index, length);
        if (target === null) return;
        // Stop the arrow from also scrolling the rail.
        event.preventDefault();
        commitIndex(subject, target);
      },
      dragging,
      // The gap before this row; and, on the last row only, the gap after it.
      dropAbove: inTargetList && shownDrop.index === index,
      dropBelow: inTargetList && index === length - 1 && shownDrop.index === length,
    };
  };

  const dropInto = (groupId: string): boolean =>
    shownDrop !== null && shownDrop.into && shownDrop.targetGroupId === groupId && drag?.subject.kind === "folder";

  return { listRef, isReordering: isDragging, rowDrag, dropInto };
}
