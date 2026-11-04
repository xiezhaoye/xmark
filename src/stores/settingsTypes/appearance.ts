/**
 * Appearance settings types — theme colors, fonts, spacing, editor width.
 *
 * Extracted from settingsTypes.ts, which remains the stable entry point.
 *
 * @module stores/settingsTypes/appearance
 */

import type { ThemeId } from "@/theme/themes";

// ---------------------------------------------------------------------------
// Theme types
// ---------------------------------------------------------------------------

/** Available theme identifiers for the editor color scheme. Re-exported here
 *  for backward compatibility; the canonical union lives in the theme module
 *  (`@/theme/themes`, derived from the `themes` catalog). Imported (not
 *  re-exported) so `ThemeId` is also bound locally for `AppearanceSettings`. */
export type { ThemeId };

/** Color palette for a single theme — background, foreground, link, and
 *  optional dark-mode overrides. The canonical definition lives in the theme
 *  module (`@/theme/themeColorsAdapter`); re-exported here so settings-side
 *  importers keep their stable path without a second drift-prone copy. */
export type { ThemeColors } from "@/theme/themeColorsAdapter";

// ---------------------------------------------------------------------------
// Appearance
// ---------------------------------------------------------------------------

/** CJK letter spacing in em units (0 = off). */
type CJKLetterSpacingValue = "0" | "0.02" | "0.03" | "0.05" | "0.08" | "0.10" | "0.12";

/** How strongly Focus Mode dims non-focused content (on top of the color
 *  shift): "standard" keeps the color-only look, "strong"/"stronger" add
 *  progressively lower opacity. */
export type FocusModeDim = "standard" | "strong" | "stronger";

/** Visual appearance preferences — theme, fonts, spacing, and editor width. */
export interface AppearanceSettings {
  theme: ThemeId;
  followSystemAppearance: boolean; // Auto-switch with the OS light/dark preference (#1125)
  systemLightTheme: ThemeId; // Theme used when the OS prefers light (follow-system on)
  systemDarkTheme: ThemeId; // Theme used when the OS prefers dark (follow-system on)
  latinFont: string;
  cjkFont: string;
  monoFont: string;
  fontSize: number;
  /**
   * Reading zoom for preview surfaces, in percent (50–300, step 10).
   * Multiplies `fontSize` for the previewed content only — see
   * components/PreviewZoom. Optional because state persisted before it existed
   * has no key; every read treats absent as 100.
   */
  previewZoom?: number;
  /**
   * Browser-style page zoom for the whole window (0.5–3, step 0.1). Two zoom
   * scales on purpose: this one is the native `pageZoom` (instant, ⌘+/⌘−),
   * `previewZoom` is the in-pane reflowing one. Optional so state persisted
   * before it existed stays valid; every read treats absent as 1.
   */
  windowZoom?: number;
  lineHeight: number;
  blockSpacing: number; // Visual gap between blocks in "lines" (1 = one line-height)
  cjkLetterSpacing: CJKLetterSpacingValue; // Letter spacing for CJK characters (em)
  editorWidth: number; // Max content width in em (0 = unlimited)
  /** Text size (px) of the workspace rail and the file tree; rows scale with it. */
  sidebarFontSize: number;
  showFilenameInTitlebar: boolean; // Show filename in window titlebar
  focusModeDim: FocusModeDim; // How strongly Focus Mode dims non-focused content
}
