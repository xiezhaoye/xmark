/**
 * The drawer's position, shared by the drawer and the document it pushes.
 *
 * Returns the drawer's width and its visible offset (0 = closed, width =
 * open). While a finger drags, the offset follows it; on release the store's
 * `drawerOpen` decides. A swipe right opens, a swipe left closes, except when
 * the touch starts in something that scrolls sideways or a text field.
 *
 * @module components/useDrawerGesture
 */
import { useEffect, useRef, useState } from "react";
import { endDrawerGesture, isInsideHorizontalScroller, moveDrawerGesture, startDrawerGesture, type DrawerGesture } from "../gestures/drawerGesture";
import { useReaderStore } from "../state/readerStore";

/** The strip of document left visible beside the open drawer. */
const EXPOSED_STRIP_PX = 44;

function drawerWidth(): number {
  return Math.max(240, window.innerWidth - EXPOSED_STRIP_PX);
}

export function useDrawerGesture(enabled: boolean): { width: number; offset: number; dragging: boolean } {
  const open = useReaderStore((s) => s.drawerOpen);
  const [drag, setDrag] = useState<number | null>(null);
  const [width, setWidth] = useState(drawerWidth);
  const gesture = useRef<DrawerGesture | null>(null);

  useEffect(() => {
    const onResize = () => setWidth(drawerWidth());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1 || isInsideHorizontalScroller(e.target as Element)) return;
      const touch = e.touches[0];
      gesture.current = startDrawerGesture({ x: touch.clientX, y: touch.clientY, open: useReaderStore.getState().drawerOpen, width: drawerWidth() });
    };
    const onMove = (e: TouchEvent) => {
      if (!gesture.current) return;
      const touch = e.touches[0];
      gesture.current = moveDrawerGesture(gesture.current, { x: touch.clientX, y: touch.clientY });
      if (gesture.current.axis === "x") setDrag(gesture.current.offset);
      else if (gesture.current.axis === "y") gesture.current = null;
    };
    const onEnd = () => {
      if (!gesture.current) return;
      const result = endDrawerGesture(gesture.current);
      const moved = gesture.current.axis === "x";
      gesture.current = null;
      setDrag(null);
      if (moved) useReaderStore.getState().setDrawer(result === "open");
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onEnd);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, [enabled]);

  return { width, offset: drag ?? (open ? width : 0), dragging: drag !== null };
}
