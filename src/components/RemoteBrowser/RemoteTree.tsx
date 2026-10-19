/**
 * RemoteTree — the remote file tree, one level at a time.
 *
 * Key decisions:
 *   - **Rows are the file explorer's rows**, restyled for the remote column
 *     (`remote-tree__row`, the sidebar's text size and row height), so the
 *     column reads as the same tree it replaces.
 *   - **A folder is fetched when it is first EXPANDED**, and never twice: the
 *     level lives in the store keyed by server + root + path.
 *   - **A folder the server marks unavailable** still lists (the server says
 *     it is missing; the user may have unshared it) and says so.
 *   - Files carry their kind as an icon and never open anything that writes:
 *     a click only sets the document the viewer shows.
 *
 * @coordinates-with stores/remoteBrowserStore.ts — the cached levels
 * @coordinates-with components/RemoteBrowser/RemoteShell.tsx — the caller
 * @module components/RemoteBrowser/RemoteTree
 */

import { useEffect } from "react";
import { ChevronDown, ChevronRight, FileCode, FileText, Folder, Image as ImageIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { levelKey, useRemoteBrowserStore } from "@/stores/remoteBrowserStore";
import { loadLevel } from "@/services/remoteServers/browse";
import type { RemoteTreeEntry } from "@/services/remoteServers/client";
import { RemoteError } from "./RemoteChrome";

/**
 * A row's kind as its icon. A stable module-level COMPONENT, not a factory that
 * returns one: building a component inside the render (`const Icon =
 * iconFor(kind)`) hands React a new component type every render, which
 * remounts the subtree instead of updating it.
 */
function EntryIcon({ kind }: { kind: RemoteTreeEntry["kind"] }) {
  const props = { size: 14, "aria-hidden": true, className: "remote-tree__icon" } as const;
  switch (kind) {
    case "dir":
      return <Folder {...props} />;
    case "image":
      return <ImageIcon {...props} />;
    case "text":
      return <FileCode {...props} />;
    default:
      return <FileText {...props} />;
  }
}

interface LevelProps {
  rootId: string;
  path: string;
  /** Depth, for the indent only — the DOM nesting is shallow by design. */
  depth: number;
}

function Level({ rootId, path, depth }: LevelProps) {
  const { t } = useTranslation("sidebar");
  const serverId = useRemoteBrowserStore((s) => s.serverId ?? "");
  const key = levelKey(serverId, rootId, path);
  const level = useRemoteBrowserStore((s) => s.levels[key]);

  if (!level || level.status === "loading") {
    return <p className="remote-tree__hint">{t("remote.loading")}</p>;
  }
  if (level.status === "error") {
    return <RemoteError message={level.message} onRetry={() => void loadLevel(rootId, path, true)} />;
  }
  if (level.entries.length === 0) {
    return <p className="remote-tree__hint">{t("remote.emptyFolder")}</p>;
  }
  return (
    <ul className="remote-tree__level" role="group">
      {level.entries.map((entry, index) => (
        <Node key={`${entry.relPath}:${index}`} entry={entry} rootId={rootId} depth={depth} />
      ))}
    </ul>
  );
}

function Node({ entry, rootId, depth }: { entry: RemoteTreeEntry; rootId: string; depth: number }) {
  const serverId = useRemoteBrowserStore((s) => s.serverId ?? "");
  const key = levelKey(serverId, rootId, entry.relPath);
  const expanded = useRemoteBrowserStore((s) => s.expanded[key] === true);
  const doc = useRemoteBrowserStore((s) => s.doc);
  const isDir = entry.kind === "dir";
  const active = !isDir && doc?.rootId === rootId && doc.relPath === entry.relPath;
  const indent = { paddingLeft: `calc(${depth} * var(--space-3) + var(--space-1-5))` };

  const toggle = () => {
    const store = useRemoteBrowserStore.getState();
    const next = !expanded;
    store.setExpanded(key, next);
    if (next) void loadLevel(rootId, entry.relPath);
  };

  const open = () => {
    if (isDir) {
      toggle();
      return;
    }
    const store = useRemoteBrowserStore.getState();
    store.openDoc({ rootId, relPath: entry.relPath, kind: entry.kind });
  };

  return (
    <li className="remote-tree__node">
      <button
        type="button"
        className={`remote-tree__row${active ? " remote-tree__row--active" : ""}`}
        style={indent}
        onClick={open}
        aria-expanded={isDir ? expanded : undefined}
        aria-current={active ? "true" : undefined}
        title={entry.relPath}
      >
        {isDir ? (
          expanded ? (
            <ChevronDown size={12} aria-hidden="true" />
          ) : (
            <ChevronRight size={12} aria-hidden="true" />
          )
        ) : (
          <span className="remote-tree__arrow" />
        )}
        <EntryIcon kind={entry.kind} />
        <span className="remote-tree__name">{entry.name}</span>
      </button>
      {isDir && expanded && <Level rootId={rootId} path={entry.relPath} depth={depth + 1} />}
    </li>
  );
}

export interface RemoteTreeProps {
  rootId: string;
  available: boolean;
}

/** One folder's tree, starting at its root. */
export function RemoteTree({ rootId, available }: RemoteTreeProps) {
  const { t } = useTranslation("sidebar");
  const serverId = useRemoteBrowserStore((s) => s.serverId ?? "");
  const key = levelKey(serverId, rootId, "");
  const level = useRemoteBrowserStore((s) => s.levels[key]);

  // The root level is requested once per server+root: the store keeps it, so a
  // remount, a re-expand or a document switch never refetches it.
  useEffect(() => {
    if (level === undefined) void loadLevel(rootId, "");
  }, [level, rootId]);

  return (
    <div className="remote-tree">
      {!available && <p className="remote-tree__hint">{t("remote.unavailableFolder")}</p>}
      <Level rootId={rootId} path="" depth={0} />
    </div>
  );
}
