/**
 * PreviewZoom — the −/100%/+ control at the top centre of a preview, and the
 * keyboard equivalent (← smaller, → larger).
 *
 * Purpose: a reading surface has one personal variable — how big the text is —
 * and it belongs to the reader, not to the file. The zoom is a single persisted
 * setting (`appearance.previewZoom`, percent) so it carries across documents and
 * across the markdown and split-pane surfaces alike.
 *
 * Key decisions:
 *   - **Percent, not pixels.** The editor's own type scale already comes from
 *     `appearance.fontSize`; a percentage multiplies whatever that produced, so
 *     changing the base size later does not undo the reader's zoom.
 *   - **CSS `zoom` on the content, never on the bar.** `zoom` scales layout and
 *     the HTML preview's iframe along with the text, which is exactly what
 *     "make it bigger" means here; the control sits OUTSIDE the zoomed node so
 *     it stays the same size at every level.
 *   - **Arrow keys skip editable targets.** Inside the WYSIWYG editor or a text
 *     field the arrows belong to the caret; stealing them would make typing
 *     impossible. Click elsewhere in the pane (or a preview that is not an
 *     editor) and they zoom.
 *
 * @coordinates-with stores/settingsStore — appearance.previewZoom persistence
 * @module components/PreviewZoom/PreviewZoom
 */

import { useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Minus, Plus } from "lucide-react";
import { useSettingsStore } from "@/stores/settingsStore";
import "./preview-zoom.css";

export const PREVIEW_ZOOM_MIN = 50;
export const PREVIEW_ZOOM_MAX = 300;
export const PREVIEW_ZOOM_STEP = 10;
/** The reader's own scale is 100%: the "reset" target. */
export const PREVIEW_ZOOM_DEFAULT = 100;

/** Snap to the step grid and clamp, so every path (button, key, reset) agrees. */
export function clampPreviewZoom(percent: number): number {
  const snapped = Math.round(percent / PREVIEW_ZOOM_STEP) * PREVIEW_ZOOM_STEP;
  return Math.min(PREVIEW_ZOOM_MAX, Math.max(PREVIEW_ZOOM_MIN, snapped));
}

export interface PreviewZoomControls {
  /** Percent, already clamped. */
  percent: number;
  /** The multiplier to hand to CSS `zoom`. */
  scale: number;
  set: (percent: number) => void;
  increase: () => void;
  decrease: () => void;
  reset: () => void;
}

export function usePreviewZoom(): PreviewZoomControls {
  const percent = clampPreviewZoom(
    useSettingsStore((state) => state.appearance.previewZoom ?? PREVIEW_ZOOM_DEFAULT),
  );
  const updateAppearanceSetting = useSettingsStore((state) => state.updateAppearanceSetting);
  const set = useCallback(
    (next: number) => updateAppearanceSetting("previewZoom", clampPreviewZoom(next)),
    [updateAppearanceSetting],
  );
  return {
    percent,
    scale: percent / 100,
    set,
    increase: () => set(percent + PREVIEW_ZOOM_STEP),
    decrease: () => set(percent - PREVIEW_ZOOM_STEP),
    reset: () => set(PREVIEW_ZOOM_DEFAULT),
  };
}

/**
 * True when the event belongs to a caret, not to the preview behind it.
 *
 * `isContentEditable` alone is not enough: it is unresolved in the test DOM, and
 * the editors here (ProseMirror, CodeMirror) both mark their editable element
 * with `contenteditable="true"` anyway — so the attribute walk is the reliable
 * half, with the property as a fallback for an inherited editable region.
 */
function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return true;
  if (el.isContentEditable === true) return true;
  return Boolean(el.closest?.('[contenteditable="true"], [contenteditable=""]'));
}

/**
 * The control. Mounting it also arms the arrow keys for this window, so a pane
 * that shows no control cannot be zoomed by a keystroke meant for something
 * else (one bar per preview surface, one listener).
 */
export function PreviewZoomBar() {
  const { t } = useTranslation("editor");
  const { percent, set, reset } = usePreviewZoom();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      if (isEditableTarget(event.target)) return;
      event.preventDefault();
      // Read through the store, not the closure: two presses in one frame must
      // step twice, not resolve against the same stale percent.
      const current = clampPreviewZoom(
        useSettingsStore.getState().appearance.previewZoom ?? PREVIEW_ZOOM_DEFAULT,
      );
      useSettingsStore
        .getState()
        .updateAppearanceSetting(
          "previewZoom",
          clampPreviewZoom(current + (event.key === "ArrowRight" ? PREVIEW_ZOOM_STEP : -PREVIEW_ZOOM_STEP)),
        );
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="preview-zoom" role="group" aria-label={t("preview.zoom")}>
      <button
        type="button"
        className="preview-zoom__btn"
        aria-label={t("preview.zoomOut")}
        title={t("preview.zoomOut")}
        disabled={percent <= PREVIEW_ZOOM_MIN}
        onClick={() => set(percent - PREVIEW_ZOOM_STEP)}
      >
        <Minus size={13} aria-hidden />
      </button>
      <button
        type="button"
        className="preview-zoom__value"
        aria-label={t("preview.zoomReset")}
        title={t("preview.zoomReset")}
        onClick={reset}
      >
        {percent}%
      </button>
      <button
        type="button"
        className="preview-zoom__btn"
        aria-label={t("preview.zoomIn")}
        title={t("preview.zoomIn")}
        disabled={percent >= PREVIEW_ZOOM_MAX}
        onClick={() => set(percent + PREVIEW_ZOOM_STEP)}
      >
        <Plus size={13} aria-hidden />
      </button>
    </div>
  );
}
