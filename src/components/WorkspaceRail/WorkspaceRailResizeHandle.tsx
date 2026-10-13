/**
 * WorkspaceRailResizeHandle — the focusable separator on the workspace rail's
 * right edge that resizes the rail column by mouse drag or arrow keys.
 *
 * Key decisions:
 *   - The width is the persisted `general.workspaceRailWidth` setting, so it
 *     survives restarts and is shared by every document window.
 *   - Same gesture contract as the sidebar's handle (useSidebarResize): during
 *     a drag the live width is painted straight onto the shell (the
 *     `--workspace-rail-width` var, the shell aside and `--shell-side-width`),
 *     and the setting is written once, when the drag ends. Writing it per
 *     mousemove would re-render the whole layout and persist on every pixel.
 *   - Bounds come from CLAMP_RANGES, the store's own clamp, so the ARIA range
 *     never advertises a value the store would reject.
 *
 * @coordinates-with stores/settingsStore/clamp.ts — the width bounds
 * @coordinates-with shell/shellChrome.ts — consumes the width in the layout maths
 * @coordinates-with hooks/useDocumentDrag.ts — document listener lifetime
 * @coordinates-with WorkspaceRail.tsx — renders it at the rail's right edge
 * @module components/WorkspaceRail/WorkspaceRailResizeHandle
 */

import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "@/stores/settingsStore";
import { CLAMP_RANGES } from "@/stores/settingsStore/clamp";
import { useDocumentDrag } from "@/hooks/useDocumentDrag";

const [MIN_RAIL_WIDTH, MAX_RAIL_WIDTH] = CLAMP_RANGES.general?.workspaceRailWidth ?? [120, 320];
const KEYBOARD_STEP = 8;
const KEYBOARD_STEP_LARGE = 32;

/** Clamp to the setting's bounds. */
export function clampRailWidth(width: number): number {
  return Math.round(Math.max(MIN_RAIL_WIDTH, Math.min(MAX_RAIL_WIDTH, width)));
}

function commitRailWidth(width: number): void {
  useSettingsStore.getState().updateGeneralSetting("workspaceRailWidth", clampRailWidth(width));
}

/**
 * Returns a painter that shows `width` in the layout around `handle` without
 * going through React. The aside's width minus the rail is constant during
 * the gesture (sidebar + card gutters), so it is read once from what React
 * rendered.
 */
function createLiveWidthPainter(handle: HTMLElement, startWidth: number): (width: number) => void {
  const aside = handle.closest<HTMLElement>(".app-shell__sidebar");
  const shell = handle.closest<HTMLElement>(".app-shell");
  const asideExtra = aside ? Number.parseFloat(aside.style.width) - startWidth : Number.NaN;

  return (width) => {
    shell?.style.setProperty("--workspace-rail-width", `${width}px`);
    if (aside && Number.isFinite(asideExtra)) {
      const side = `${asideExtra + width}px`;
      aside.style.width = side;
      aside.style.minWidth = side;
      shell?.style.setProperty("--shell-side-width", side);
    }
    handle.setAttribute("aria-valuenow", String(width));
  };
}

interface WorkspaceRailResizeHandleProps {
  /** Live rail width — drives aria-valuenow. */
  width: number;
}

/** Vertical separator that resizes the workspace rail column. */
export function WorkspaceRailResizeHandle({ width }: WorkspaceRailResizeHandleProps) {
  const { t } = useTranslation();
  const drag = useDocumentDrag();

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      e.preventDefault();
      drag.stop();
      const startX = e.clientX;
      const startWidth = useSettingsStore.getState().general.workspaceRailWidth;
      const paint = createLiveWidthPainter(e.currentTarget, startWidth);
      let liveWidth: number | null = null;

      drag.start({
        cursor: "col-resize",
        onMove: (move) => {
          const next = clampRailWidth(startWidth + move.clientX - startX);
          if (next === liveWidth) return;
          liveWidth = next;
          paint(next);
        },
        onEnd: () => {
          if (liveWidth !== null) commitRailWidth(liveWidth);
        },
      });
    },
    [drag],
  );

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const current = useSettingsStore.getState().general.workspaceRailWidth;
    const step = e.shiftKey ? KEYBOARD_STEP_LARGE : KEYBOARD_STEP;
    let next: number;
    switch (e.key) {
      case "ArrowLeft":
        next = current - step;
        break;
      case "ArrowRight":
        next = current + step;
        break;
      case "Home":
        next = MIN_RAIL_WIDTH;
        break;
      case "End":
        next = MAX_RAIL_WIDTH;
        break;
      default:
        return;
    }
    e.preventDefault();
    commitRailWidth(next);
  }, []);

  return (
    <div
      className="workspace-rail-resize-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label={t("workspaceRail.resize")}
      aria-valuenow={width}
      aria-valuemin={MIN_RAIL_WIDTH}
      aria-valuemax={MAX_RAIL_WIDTH}
      tabIndex={0}
      onMouseDown={handleMouseDown}
      onKeyDown={handleKeyDown}
    />
  );
}
