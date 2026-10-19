/**
 * Layout preset commands — the three fixed shapes `Mod+1`, `Mod+2` and
 * `Mod+3` select: document only, file tree + document, and groups + file tree
 * + document.
 *
 * Key decisions:
 *   - **No new state.** A preset is a function of the mechanisms the window
 *     already has: the workspace rail's `workspaceRailCollapsed` setting, the
 *     sidebar's `sidebarVisible`, and the sidebar's view. Inventing a
 *     "layout mode" would mean two sources of truth for the same pixels — the
 *     column would have to consult both, and they would disagree the first
 *     time a user folded a column by hand.
 *   - **Presets are idempotent, not toggles.** Pressing `Mod+2` twice leaves
 *     the window in the same shape; a toggle would bounce between layouts the
 *     user never asked for.
 *   - The rail STATUS is separate from its visibility: `workspaceRailMode`
 *     decides whether a document window has a rail at all. A preset only folds
 *     it, so a window with the rail turned off never grows one.
 *
 * @coordinates-with shell/shellChrome.ts — sizes the columns this drives
 * @coordinates-with services/commands/viewCommands.ts — registers these
 * @module services/commands/layoutCommands
 */

import { useSettingsStore } from "@/stores/settingsStore";
import { useUIStore } from "@/stores/uiStore";
import type { CommandDefinition } from "./CommandBus";
import i18n from "@/i18n";

/** The three presets, in the order the shortcut registry lists them. */
export type LayoutPreset = "oneColumn" | "twoColumns" | "threeColumns";

/**
 * Apply a preset. Pure over the two stores, so a test drives it without a
 * component tree; the caller is the command bus.
 */
export function applyLayoutPreset(preset: LayoutPreset): void {
  const general = useSettingsStore.getState();
  const ui = useUIStore.getState();
  // Two columns is "group column gone, file tree beside the document"; three
  // columns is the full window. Only the first FOLDS the rail.
  const foldRail = preset !== "threeColumns";
  if (general.general.workspaceRailCollapsed !== foldRail) {
    general.updateGeneralSetting("workspaceRailCollapsed", foldRail);
  }
  if (preset === "oneColumn") {
    if (ui.sidebarVisible) {
      // Folding, not hiding: the column becomes its strip, which keeps the way
      // back where the column was (App renders it for every document window).
      useUIStore.getState().toggleSidebar();
    }
    return;
  }
  // Two and three columns both show the FILE TREE; `showSidebarWithView` also
  // re-opens a folded sidebar in one step.
  if (!ui.sidebarVisible || ui.sidebarViewMode !== "files") {
    useUIStore.getState().showSidebarWithView("files");
  }
}

/** The three command specs, registered by `registerViewCommands`. */
export function layoutCommandSpecs(): CommandDefinition[] {
  const spec = (id: string, preset: LayoutPreset, titleKey: string): CommandDefinition => ({
    id,
    title: () => i18n.t(titleKey),
    category: "view",
    run: () => applyLayoutPreset(preset),
  });
  return [
    spec("view.layoutOneColumn", "oneColumn", "commands:view.layoutOneColumn"),
    spec("view.layoutTwoColumns", "twoColumns", "commands:view.layoutTwoColumns"),
    spec("view.layoutThreeColumns", "threeColumns", "commands:view.layoutThreeColumns"),
  ];
}
