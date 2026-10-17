/**
 * Drawer column 1: workspace groups (collapsible) and their folders.
 *
 * Drawn like the Mac's workspace rail: a group is a larger, bold heading with
 * its folder count; each folder carries a coloured one-character glyph from
 * its name; the selected folder gets the accent fill and a coloured bar on
 * its left edge. A folder the Mac cannot serve shows an outlined glyph and,
 * when tapped, explains why. Long-pressing a name shows it in full.
 *
 * @module components/GroupColumn
 */
import { useRef, useState } from "react";
import { useReaderStore } from "../state/readerStore";
import { errorText, t } from "../i18n";
import { Icon } from "./Icon";
import { railColor, railGlyph } from "../render/railIdentity";
import type { CSSProperties } from "react";
import { StatusMessage } from "./StatusMessage";

const LONG_PRESS_MS = 500;

export function GroupColumn() {
  const groups = useReaderStore((s) => s.groups);
  const groupsError = useReaderStore((s) => s.groupsError);
  const collapsed = useReaderStore((s) => s.collapsedGroups);
  const selected = useReaderStore((s) => s.selectedRootId);
  const [hint, setHint] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pressStart = (full: string) => {
    timer.current = setTimeout(() => setHint(full), LONG_PRESS_MS);
  };
  const pressEnd = () => {
    if (timer.current) clearTimeout(timer.current);
  };

  if (groupsError) return <StatusMessage tone="error" text={errorText(groupsError)} onRetry={() => void useReaderStore.getState().refreshWorkspaces()} />;
  if (!groups.length) return <StatusMessage text={t("drawer.noGroups")} />;

  return (
    <nav className="groups" aria-label={t("drawer.groups")}>
      {hint && (
        <button type="button" className="hint" onClick={() => setHint(null)}>
          {hint}
        </button>
      )}
      {groups.map((g) => (
        <section key={g.id} className="group">
          <button type="button" className="group-title" aria-expanded={!collapsed[g.id]} onClick={() => useReaderStore.getState().toggleGroup(g.id)} onTouchStart={() => pressStart(g.name)} onTouchEnd={pressEnd} onTouchMove={pressEnd}>
            <span className={`chevron ${collapsed[g.id] ? "" : "open"}`}>
              <Icon name="chevron" size={14} />
            </span>
            <span className="label">{g.name}</span>
            <span className="group-count">{g.folders.length}</span>
          </button>
          {!collapsed[g.id] &&
            (g.folders.length ? (
              g.folders.map((f) => (
                <button
                  type="button"
                  key={f.rootId}
                  className={`folder ${selected === f.rootId ? "selected" : ""} ${f.available ? "" : "unavailable"}`}
                  aria-current={selected === f.rootId}
                  onClick={() => {
                    if (!f.available) setHint(t("drawer.unavailable"));
                    void useReaderStore.getState().selectRoot(f.rootId);
                  }}
                  onTouchStart={() => pressStart(f.name)}
                  onTouchEnd={pressEnd}
                  onTouchMove={pressEnd}
                  style={{ "--rail-color": railColor(f.rootId) } as CSSProperties}
                >
                  <span className="glyph" aria-hidden="true">
                    {railGlyph(f.name)}
                  </span>
                  <span className="label">{f.name}</span>
                </button>
              ))
            ) : (
              <p className="empty">{t("drawer.emptyGroup")}</p>
            ))}
        </section>
      ))}
    </nav>
  );
}
