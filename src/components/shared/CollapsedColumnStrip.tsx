/**
 * CollapsedColumnStrip — what a folded leading column (the workspace rail or
 * the sidebar) leaves behind: a thin strip that IS the "expand" control.
 *
 * Key decisions:
 *   - The whole strip is one button, not a strip holding a small button: the
 *     strip is the obvious target, so hovering anywhere on it shows the
 *     affordance (fill + a nudging chevron) and a click anywhere expands.
 *     The panel icon stays at the foot, where the column's own collapse
 *     button sat.
 *   - Each strip is inset inside its column with rounded ends, so two folded
 *     columns side by side read as two separate strips, not one thick bar.
 *
 * @coordinates-with components/WorkspaceRail/WorkspaceRail.tsx — the folded rail
 * @coordinates-with components/Sidebar/Sidebar.tsx — the folded sidebar
 * @coordinates-with shell/shellChrome.ts — COLLAPSED_STRIP_WIDTH sizes it
 * @module components/shared/CollapsedColumnStrip
 */
import { ChevronsRight, PanelLeftOpen } from "lucide-react";
import "./CollapsedColumnStrip.css";

interface CollapsedColumnStripProps {
  /** Tooltip and accessible name, e.g. "Expand Sidebar (⌘\\)". */
  expandLabel: string;
  onExpand: () => void;
}

export function CollapsedColumnStrip({ expandLabel, onExpand }: CollapsedColumnStripProps) {
  return (
    <div className="collapsed-column-strip">
      <button
        type="button"
        className="collapsed-column-strip__bar"
        aria-label={expandLabel}
        aria-expanded={false}
        title={expandLabel}
        onClick={onExpand}
      >
        <ChevronsRight className="collapsed-column-strip__hint" size={14} aria-hidden="true" />
        <PanelLeftOpen className="collapsed-column-strip__icon" size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
