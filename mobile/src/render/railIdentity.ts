/**
 * A folder's rail identity — the one-character glyph and the colour — the
 * same way the Mac's workspace rail draws it.
 *
 * The glyph comes from the desktop's own `workspaceRailGlyphs` (grapheme-safe:
 * CJK, emoji, dotfiles). The colour hash mirrors `colorForSeed` in
 * `src/components/WorkspaceRail/WorkspaceRailEntry.tsx`; the seed here is the
 * server's root id, so a folder keeps its colour across launches.
 *
 * @module render/railIdentity
 */
import { workspaceRailGlyphs } from "@desktop-utils/workspaceRailGlyphs";

const RAIL_COLORS = [
  "var(--accent-primary)",
  "var(--success-color)",
  "var(--warning-color)",
  "var(--error-color)",
  "var(--strong-color)",
  "var(--emphasis-color)",
] as const;

export function railColor(seed: string): string {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return RAIL_COLORS[hash % RAIL_COLORS.length];
}

export function railGlyph(name: string): string {
  return workspaceRailGlyphs([{ workspaceInstanceId: "x", displayName: name, kind: "workspace" }]).x;
}
