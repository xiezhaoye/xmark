/**
 * useRailDragReorder — the workspace rail's drag-to-reorder gesture.
 *
 * Purpose: turn a press-and-move on a group header into "move this group", and
 * a press-and-move on a folder row into "move this folder" — within its group
 * or into another one — without breaking the plain click that opens a
 * workspace. Where a drop lands is the caller's measurement (`measure`); this
 * hook owns only the gesture.
 *
 * Key decisions:
 *   - **Pointer events, never HTML5 drag and never `app-region: drag`.** Both of
 *     those decide "click vs drag" outside the app's control and swallow the
 *     click when they guess drag — the file tree had exactly that bug and fixed
 *     it by disabling drag (`FileExplorer.tsx`). Here the app owns the
 *     threshold, so a click stays a click.
 *   - **Nothing is touched below `RAIL_DRAG_THRESHOLD_PX`.** No drag state, no
 *     `preventDefault`, no pointer capture until the pointer has actually moved:
 *     arming on `pointerdown` is what makes a naive implementation eat clicks.
 *   - **Commit on release only.** The drag preview is CSS; the store is written
 *     once, when the gesture ends with a release at a drop that changes
 *     something. A cancel, a window blur, an unmount
 *     or a superseding press abandons the drag where it was.
 *   - **Listener lifetime belongs to `useDocumentDrag`**, so all five ways a
 *     gesture can end are handled in one place.
 *   - **Esc cancels.** A drag that arms by accident must be abandonable without
 *     dropping the row somewhere unintended.
 *
 * @coordinates-with railReorderGeometry.ts — the threshold and the drop index
 * @coordinates-with WorkspaceRail.tsx — owns the store calls the commit makes
 * @module components/WorkspaceRail/useRailDragReorder
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useDocumentDrag } from "@/hooks/useDocumentDrag";
import { isRailDragArmed } from "./railReorderGeometry";

/** What is being dragged, and where it can land. */
export type RailDragSubject =
  | { kind: "group"; groupId: string }
  | { kind: "folder"; groupId: string; path: string };

/** Where the dragged row would land if released now. */
export interface RailDrop {
  /** Gap index in the target list (rows + 1 gaps). */
  index: number;
  /** Group whose folder list a folder drop lands in; null for a group drag. */
  targetGroupId: string | null;
  /** The target list shows no rows (collapsed or empty): the drop appends, and
   *  the indicator is the whole group, not a line between rows. */
  into: boolean;
  /** Releasing here would leave the order unchanged (the row's own gaps). */
  noop: boolean;
}

interface RailDragState {
  subject: RailDragSubject;
  /** Null before the gesture arms. */
  drop: RailDrop | null;
}

interface UseRailDragReorderOptions {
  /**
   * Where the subject would drop for a pointer at `clientY` — measured by the
   * caller, the only side that knows whether a group drag is over the section
   * headers or a folder drag is over some group's rows.
   */
  measure: (subject: RailDragSubject, clientY: number) => RailDrop;
  onCommit: (subject: RailDragSubject, drop: RailDrop) => void;
}

export interface RailDragReorder {
  /** The in-flight drag, or null. Drives the preview styling. */
  drag: RailDragState | null;
  /** True once the gesture has armed and rows should show a drop indicator. */
  isDragging: boolean;
  /** Press handler for a draggable row. Arms nothing until the pointer moves. */
  onRowPointerDown: (event: React.PointerEvent, subject: RailDragSubject) => void;
}

export function useRailDragReorder({
  measure,
  onCommit,
}: UseRailDragReorderOptions): RailDragReorder {
  const [dragState, setDragState] = useState<RailDragState | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Latest-value refs: the document listeners below are attached once per
  // gesture and must read what the CURRENT render passed in (#1063).
  const measureRef = useRef(measure);
  const onCommitRef = useRef(onCommit);
  /* eslint-disable react-hooks/refs -- latest-value refs read by document pointer listeners mid-drag must be fresh before any event fires */
  measureRef.current = measure;
  onCommitRef.current = onCommit;
  /* eslint-enable react-hooks/refs */

  const gesture = useDocumentDrag("pointer");
  // Held in a ref as well as state: the commit path reads it synchronously in
  // the document's pointerup listener, which can run before React re-renders.
  const dropRef = useRef<RailDrop | null>(null);
  const cancelRef = useRef<() => void>(() => {});

  const reset = useCallback(() => {
    dropRef.current = null;
    setDragState(null);
    setIsDragging(false);
  }, []);

  const onRowPointerDown = useCallback(
    (event: React.PointerEvent, subject: RailDragSubject) => {
      // Primary button only, and never on the row's own controls (the "+"): a
      // press there belongs to that control. A button that IS the row's press
      // target says so — a folder row's button carries `data-rail-row`, a group
      // header's name/toggle button `data-rail-drag-handle` — and may start a
      // drag; its click still fires when the pointer does not move.
      if (event.button !== 0) return;
      const target = event.target;
      if (target instanceof Element && target.closest("button:not([data-rail-row]):not([data-rail-drag-handle])")) return;

      // A press can arrive with a previous drag still attached (its pointerup
      // went to another window). End it before this one writes its state.
      gesture.stop();

      const startX = event.clientX;
      const startY = event.clientY;
      let armed = false;

      const handleMove = (moveEvent: PointerEvent) => {
        if (!armed) {
          if (!isRailDragArmed(moveEvent.clientX - startX, moveEvent.clientY - startY)) return;
          armed = true;
          setDragState({ subject, drop: null });
          setIsDragging(true);
        }
        const drop = measureRef.current(subject, moveEvent.clientY);
        const prev = dropRef.current;
        if (prev && prev.index === drop.index && prev.targetGroupId === drop.targetGroupId && prev.into === drop.into) return;
        dropRef.current = drop;
        setDragState({ subject, drop });
      };

      cancelRef.current = () => gesture.stop();

      gesture.start({
        onMove: handleMove,
        onEnd: (reason) => {
          // Only a release places the row; anything else abandons the gesture.
          // `armed` gates it too, so a press with no movement — a click — is
          // never a reorder, even if the release lands on another row.
          const drop = dropRef.current;
          if (reason === "release" && armed && drop !== null && !drop.noop) {
            onCommitRef.current(subject, drop);
          }
          cancelRef.current = () => {};
          reset();
        },
      });
    },
    [gesture, reset],
  );

  // Escape abandons an armed drag without committing.
  useEffect(() => {
    if (!isDragging) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      cancelRef.current();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [isDragging]);

  return { drag: dragState, isDragging, onRowPointerDown };
}
