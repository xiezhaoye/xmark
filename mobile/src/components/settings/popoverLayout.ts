/**
 * Where the settings popover sits: under its icon, hanging from the icon's
 * own edge, roughly half the screen wide and never outside the viewport.
 *
 * Pure arithmetic over rects, so the layout is tested without a browser: the
 * caller passes the icon's rect, the visual viewport (which shrinks when the
 * soft keyboard opens) and the screen width.
 *
 * @module components/settings/popoverLayout
 */

/** The smallest gap between the popover and the screen's edge. */
const EDGE_GAP = 8;
/** The gap between the icon's bottom and the popover's top. */
const ANCHOR_GAP = 6;
/** Half the screen is the target; this is the narrowest it may become. */
const MIN_WIDTH = 176;

export interface PopoverGeometry {
  top: number;
  right: number;
  width: number;
  maxHeight: number;
  /** Which corner is square-ish (tucked under the icon). */
  corner: "top-right" | "top-left";
}

export interface AnchorInput {
  /** The icon's viewport rect. */
  anchor: { top: number; bottom: number; left: number; right: number };
  /** The visual viewport: height shrinks with the keyboard, top moves as iOS scrolls the page. */
  viewport: { width: number; height: number; top: number };
  /** The screen's width, for the half-screen rule. */
  viewportWidth: number;
}

export function anchorPopover({ anchor, viewport, viewportWidth }: AnchorInput): PopoverGeometry {
  const width = Math.min(Math.max(MIN_WIDTH, Math.round(viewportWidth / 2)), viewport.width - EDGE_GAP * 2);
  const onRight = anchor.left > viewportWidth / 2;
  // Hanging from the icon's outer edge keeps the popover under its own icon;
  // an icon at the left edge hangs from its left edge instead.
  const left = onRight ? anchor.right - width : anchor.left;
  const right = viewportWidth - Math.max(EDGE_GAP, Math.min(left, viewportWidth - width - EDGE_GAP)) - width;
  const top = Math.max(viewport.top + EDGE_GAP, Math.min(anchor.bottom + ANCHOR_GAP, viewport.top + viewport.height - EDGE_GAP * 2));
  const available = viewport.top + viewport.height - top - EDGE_GAP;
  return {
    top,
    right: Math.max(0, right),
    width,
    maxHeight: Math.max(0, available),
    corner: onRight ? "top-right" : "top-left",
  };
}

/** The class naming the corner the popover squares off against its icon. */
export const cornerClass = (corner: PopoverGeometry["corner"]): string => `corner-${corner}`;
