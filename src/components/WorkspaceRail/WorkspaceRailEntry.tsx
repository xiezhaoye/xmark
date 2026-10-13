/**
 * WorkspaceRailEntry — one row of the workspace rail: an open workspace
 * instance or a closed folder bookmark inside a group, shown as a coloured
 * glyph plus the full name.
 *
 * Key decisions:
 *   - An open instance keeps its stable automation hooks
 *     (`data-rail-action="activate"` + `data-instance-id`, e2e/lib/rail.mjs);
 *     a closed bookmark is `data-rail-action="open-folder"` + `data-folder-path`.
 *   - A closed bookmark is drawn with an OUTLINED glyph, so "open in this
 *     window" and "saved, not open" read apart at a glance.
 *   - Rows are NOT draggable. A trackpad press that drifts a few pixels
 *     started an HTML5 drag instead of a click, so the first click often did
 *     nothing; moving a workspace to a new window is in the context menu.
 *
 * @coordinates-with WorkspaceRail.tsx — owns the menu and the actions
 * @module components/WorkspaceRail/WorkspaceRailEntry
 */
import type { CSSProperties, MouseEvent } from "react";
import { FileStack } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { RailEntry } from "./workspaceRailModel";

const WORKSPACE_RAIL_COLORS = [
  "var(--accent-primary)",
  "var(--success-color)",
  "var(--warning-color)",
  "var(--error-color)",
  "var(--strong-color)",
  "var(--emphasis-color)",
] as const;

type EntryStyle = CSSProperties & { "--workspace-rail-color": string };

function colorForSeed(seed: string): string {
  let hash = 0;
  for (const char of seed) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return WORKSPACE_RAIL_COLORS[hash % WORKSPACE_RAIL_COLORS.length];
}

interface WorkspaceRailEntryProps {
  entry: RailEntry;
  glyph: string | undefined;
  /** Identity the colour hashes from — the root id, so a bookmark and its
   *  opened workspace share a colour. */
  colorSeed: string;
  active: boolean;
  onActivate: () => void;
  onContextMenu: (event: MouseEvent<HTMLButtonElement>) => void;
}

export function WorkspaceRailEntry({
  entry,
  glyph,
  colorSeed,
  active,
  onActivate,
  onContextMenu,
}: WorkspaceRailEntryProps) {
  const { t } = useTranslation();
  const instance = entry.instance;
  const instanceId = instance?.workspaceInstanceId;
  const closed = instance === null;

  return (
    <div
      className="workspace-rail__entry"
      role="listitem"
      style={{ "--workspace-rail-color": colorForSeed(colorSeed) } as EntryStyle}
    >
      <button
        type="button"
        className={`workspace-rail__item${closed ? " workspace-rail__item--closed" : ""}`}
        {...(instanceId
          ? { "data-rail-action": "activate", "data-instance-id": instanceId }
          : { "data-rail-action": "open-folder", "data-folder-path": entry.path ?? "" })}
        aria-label={t(closed ? "workspaceRail.openSaved" : "workspaceRail.activate", { name: entry.label })}
        aria-pressed={closed ? undefined : active}
        title={entry.path ?? entry.label}
        onClick={onActivate}
        onContextMenu={onContextMenu}
      >
        {instance?.kind === "loose" ? (
          <span className="workspace-rail__loose" aria-hidden="true">
            <FileStack size={14} />
          </span>
        ) : (
          // aria-hidden: the button's aria-label already carries the full name.
          <span className="workspace-rail__glyph" aria-hidden="true">
            {glyph}
          </span>
        )}
        <span className="workspace-rail__name" aria-hidden="true">
          {entry.label}
        </span>
      </button>
    </div>
  );
}
