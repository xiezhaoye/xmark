/**
 * Drawer column 2: the selected folder's file tree, expanded in place.
 *
 * Levels load lazily from `/api/tree`; expansion lasts for the session.
 *
 * @module components/TreeColumn
 */
import type { TreeEntry } from "../api/types";
import { treeKey, useReaderStore } from "../state/readerStore";
import { errorText, t } from "../i18n";
import { Icon } from "./Icon";
import { PullToRefresh } from "./PullToRefresh";
import { StatusMessage } from "./StatusMessage";

function Level({ serverId, rootId, relPath, depth }: { serverId: string; rootId: string; relPath: string; depth: number }) {
  const key = treeKey(serverId, rootId, relPath);
  const level = useReaderStore((s) => s.trees[key]);
  if (!level || (level.status === "loading" && !level.entries)) return <p className="tree-note">{t("doc.loading")}</p>;
  if (level.status === "error") return <p className="tree-note error">{errorText(level.error ?? "network")}</p>;
  if (!level.entries?.length) return depth === 0 ? <StatusMessage text={t("drawer.emptyFolder")} /> : null;
  return (
    <ul className="tree" role={depth === 0 ? "tree" : "group"}>
      {level.entries.map((e) => (
        <Node key={e.relPath} serverId={serverId} rootId={rootId} entry={e} depth={depth} />
      ))}
    </ul>
  );
}

function Node({ serverId, rootId, entry, depth }: { serverId: string; rootId: string; entry: TreeEntry; depth: number }) {
  const open = useReaderStore((s) => !!s.expanded[treeKey(serverId, rootId, entry.relPath)]);
  const current = useReaderStore((s) => s.doc?.rootId === rootId && s.doc.relPath === entry.relPath);
  const isDir = entry.kind === "dir";
  return (
    <li role="treeitem" aria-expanded={isDir ? open : undefined} aria-selected={current}>
      <button
        type="button"
        className={`tree-row ${current ? "selected" : ""}`}
        style={{ paddingLeft: 6 + depth * 12 }}
        onClick={() => {
          const s = useReaderStore.getState();
          if (isDir) void s.toggleDir(rootId, entry.relPath);
          else void s.openDoc(rootId, entry.relPath);
        }}
      >
        {isDir ? (
          <span className={`chevron ${open ? "open" : ""}`}>
            <Icon name="chevron" size={12} />
          </span>
        ) : (
          <span className="chevron-space" />
        )}
        <Icon name={isDir ? "folder" : entry.kind === "image" ? "image" : "file"} size={16} />
        <span className="label">{entry.name}</span>
      </button>
      {isDir && open && <Level serverId={serverId} rootId={rootId} relPath={entry.relPath} depth={depth + 1} />}
    </li>
  );
}

export function TreeColumn() {
  const serverId = useReaderStore((s) => s.activeServerId);
  const rootId = useReaderStore((s) => s.selectedRootId);
  const folder = useReaderStore((s) => s.groups.flatMap((g) => g.folders).find((f) => f.rootId === rootId));
  if (!rootId || !serverId || !folder) return <StatusMessage text={t("drawer.pickFolder")} />;
  if (!folder.available) return <StatusMessage text={t("drawer.unavailable")} />;
  return (
    <PullToRefresh className="tree-scroll" onRefresh={() => useReaderStore.getState().refreshTree()}>
      <h2 className="tree-title">{folder.name}</h2>
      <Level serverId={serverId} rootId={rootId} relPath="" depth={0} />
    </PullToRefresh>
  );
}
