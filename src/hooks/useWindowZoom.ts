/**
 * useWindowZoom — ⌘+ / ⌘− / ⌘0 as the browser's own page zoom.
 *
 * Why this exists next to `PreviewZoom`: the preview control has to RELAYOUT
 * (CSS `zoom` resizes the pane, and an HTML preview's iframe then reflows a
 * whole subdocument), which costs in proportion to the document. Browsers feel
 * instant because they do something different — `WKWebView.pageZoom`, a
 * native view-level scale that needs no reflow. This hook drives that same
 * mechanism through Tauri's `setZoom`, so the chord behaves exactly like the
 * one in Safari: the whole window, immediately.
 *
 * The two are complementary, not duplicates: ⌘+ makes everything bigger now;
 * the in-pane control changes only the preview and keeps text reflowed.
 *
 * @coordinates-with components/PreviewZoom/PreviewZoom — the per-pane control
 * @coordinates-with stores/settingsStore — appearance.windowZoom persistence
 * @module hooks/useWindowZoom
 */

import { useEffect } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useSettingsStore } from "@/stores/settingsStore";

export const WINDOW_ZOOM_STEP = 0.1;
export const WINDOW_ZOOM_MIN = 0.5;
export const WINDOW_ZOOM_MAX = 3;
export const WINDOW_ZOOM_DEFAULT = 1;

/** Snap to 0.1 and clamp, so a held key cannot drift into a useless scale. */
export function clampWindowZoom(scale: number): number {
  if (!Number.isFinite(scale)) return WINDOW_ZOOM_DEFAULT;
  return Math.min(WINDOW_ZOOM_MAX, Math.max(WINDOW_ZOOM_MIN, Math.round(scale * 10) / 10));
}

/**
 * The next scale for a chord's `key`, or null when the chord is not a zoom.
 *
 * `=` is the unshifted key on a US layout (⌘+ is ⌘⇧=), so both spellings arrive
 * here. `0` resets — the same reset Safari and Chrome bind.
 */
export function windowZoomForKey(key: string, current: number): number | null {
  if (key === "=" || key === "+") return clampWindowZoom(current + WINDOW_ZOOM_STEP);
  if (key === "-" || key === "_") return clampWindowZoom(current - WINDOW_ZOOM_STEP);
  if (key === "0") return WINDOW_ZOOM_DEFAULT;
  return null;
}

export function useWindowZoom(): void {
  const scale = clampWindowZoom(
    useSettingsStore((state) => state.appearance.windowZoom ?? WINDOW_ZOOM_DEFAULT),
  );
  const updateAppearanceSetting = useSettingsStore((state) => state.updateAppearanceSetting);

  // Applied on mount too, so a persisted scale survives a restart.
  useEffect(() => {
    const win = getCurrentWebviewWindow() as unknown as {
      setZoom?: (value: number) => Promise<void>;
    };
    // The API is absent outside a real window (unit tests, a webview torn down
    // mid-effect). Treated as "nothing to zoom" rather than a thrown error:
    // this hook runs in the app shell, so a throw here took the whole tree down.
    if (typeof win.setZoom !== "function") return;
    void win.setZoom(scale).catch(() => {
      /* a window torn down mid-effect has nothing to zoom */
    });
  }, [scale]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      const current = useSettingsStore.getState().appearance.windowZoom ?? WINDOW_ZOOM_DEFAULT;
      const next = windowZoomForKey(event.key, current);
      if (next === null) return;
      event.preventDefault();
      updateAppearanceSetting("windowZoom", next);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [updateAppearanceSetting]);
}
