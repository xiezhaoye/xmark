/**
 * RemoteShellSection — one workspace group in the remote rail: the same visual
 * as the local rail's group (a heading with a folder count, then its folders),
 * with no editing affordances.
 *
 * A folder row carries the coloured first-character glyph the local rail uses,
 * so a folder keeps its identity across the two shells; selecting one points
 * the tree column at it.
 *
 * @coordinates-with components/RemoteBrowser/RemoteShell.tsx — the rail region
 * @coordinates-with components/WorkspaceRail/WorkspaceRailEntry.tsx — the local visual this mirrors
 * @module components/RemoteBrowser/RemoteShellSection
 */

import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { RemoteGroup } from "@/services/remoteServers/client";
import { workspaceRailGlyphs } from "@/utils/workspaceRailGlyphs";

export interface RemoteShellSectionProps {
  group: RemoteGroup;
  activeRootId: string | null;
  onSelect: (rootId: string) => void;
}

export function RemoteShellSection({ group, activeRootId, onSelect }: RemoteShellSectionProps) {
  const { t } = useTranslation("sidebar");
  const [open, setOpen] = useState(true);
  const Chevron = open ? ChevronDown : ChevronRight;
  // One glyph per folder, from the same derivation the local rail uses.
  const glyphs = workspaceRailGlyphs(
    group.folders.map((folder) => ({
      workspaceInstanceId: folder.rootId,
      displayName: folder.name,
      kind: "workspace" as const,
    })),
  );

  return (
    <section className="remote-rail__section" aria-label={group.name}>
      <button
        type="button"
        className="remote-rail__header"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Chevron size={12} aria-hidden="true" />
        <span className="remote-rail__title">{group.name}</span>
        <span className="remote-rail__count">
          {t("remote.folderCount", { count: group.folders.length })}
        </span>
      </button>
      {open && (
        <ul className="remote-rail__entries">
          {group.folders.map((folder) => (
            <li key={folder.rootId}>
              <button
                type="button"
                className={`remote-rail__entry${folder.rootId === activeRootId ? " remote-rail__entry--active" : ""}`}
                aria-current={folder.rootId === activeRootId ? "true" : undefined}
                title={folder.name}
                onClick={() => onSelect(folder.rootId)}
              >
                <span className="remote-rail__glyph" aria-hidden="true">
                  {glyphs[folder.rootId] ?? folder.name.slice(0, 1)}
                </span>
                <span className="remote-rail__name">{folder.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
