/**
 * sidebarTextSize — maps the user's sidebar text size (the workspace rail and
 * the file tree) to the CSS variables and the row height those columns use.
 *
 * Key decisions:
 *   - One input, `appearance.sidebarFontSize` (px); the row height is derived
 *     from it so larger text never crowds its row. The file tree needs the
 *     height as a NUMBER (react-arborist virtualizes by it), the CSS needs it
 *     as a variable — both come from here so they cannot disagree.
 *
 * @coordinates-with components/Sidebar/Sidebar.tsx — publishes the vars on the sidebar root
 * @coordinates-with components/WorkspaceRail/WorkspaceRail.tsx — publishes them on the rail
 * @coordinates-with components/Sidebar/FileExplorer/FileExplorer.tsx — tree row height
 * @module utils/sidebarTextSize
 */
/** The size presets offered in Settings → Appearance, in px. */
export const SIDEBAR_FONT_SIZES = [13, 14, 15, 16] as const;

/** Row height for a given sidebar text size: roomy enough for CJK glyphs. */
export function sidebarRowHeight(fontSize: number): number {
  return Math.round(fontSize * 2.15);
}

/** The CSS variables the rail and file tree read for their text and rows
 *  (a plain record — utils stay framework-free; spread it into a style). */
export function sidebarTextVars(fontSize: number): Record<string, string> {
  return {
    "--sidebar-font-size": `${fontSize}px`,
    "--sidebar-row-height": `${sidebarRowHeight(fontSize)}px`,
  };
}
