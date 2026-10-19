/**
 * RemoteShell — the whole window while a remote server is showing: the groups
 * column (the workspace rail's place), the file tree column (the sidebar's
 * place) and the read-only document column.
 *
 * Key decisions:
 *   - **The window's columns, not a page inside one.** Selecting a server
 *     replaces what the rail, the sidebar and the editor area RENDER. The
 *     local columns are unmounted, not destroyed with their state: tabs,
 *     unsaved edits and the sidebar all live in stores that outlive a render,
 *     so switching back is a return, not a restore.
 *   - **The same column states as this Mac, folded the same way.**
 *     `workspaceRailCollapsed` folds the groups column and `sidebarVisible`
 *     decides the file tree, so ⌘1/⌘2/⌘3 mean one thing in both surfaces. A
 *     folded column renders `CollapsedColumnStrip` — folded, never gone — and
 *     its WIDTH comes from `shellChrome.remoteLeadingColumns`, the same
 *     function `App.tsx` uses to size the column. Reading one state twice is
 *     what keeps "the width says 28px, the content says 240px" from coming back.
 *   - **A selected folder opens the tree.** `selectRoot` also calls
 *     `revealRemoteTree()`, because picking a folder is a request to browse it
 *     and a folded column would answer with a strip.
 *   - **The head of the groups column is `ServerSwitcher`**, exactly where the
 *     local rail puts it: without it a remote window had no way back.
 *   - **Nothing here writes.** There is no new/rename/delete/drag/paste, no
 *     terminal and no AI affordance: every one of those would need a local
 *     path that does not exist for another machine's folder.
 *   - **The tree loads one level at a time** (`RemoteTree`), so a deep folder
 *     costs one request per level the user opens.
 *   - **Failures are local to their region.** A group list that fails leaves
 *     the tree and the document usable and offers a retry; the window never
 *     becomes a blank rectangle.
 *
 * @coordinates-with shell/shellChrome.ts — the column widths it renders at
 * @coordinates-with components/RemoteBrowser/RemoteShellSection.tsx — a group
 * @coordinates-with components/RemoteBrowser/RemoteTree.tsx — the lazy tree
 * @coordinates-with components/RemoteBrowser/RemoteViewer.tsx — the document
 * @module components/RemoteBrowser/RemoteShell
 */

import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { FolderOpen, ListTree } from "lucide-react";
import { useRemoteBrowserStore } from "@/stores/remoteBrowserStore";
import { useRemoteServersStore } from "@/stores/remoteServersStore";
import { loadGroups, loadLevel } from "@/services/remoteServers/browse";
import { sidebarTextVars } from "@/utils/sidebarTextSize";
import { useSettingsStore, useShortcutsStore, formatKeyForDisplay } from "@/stores/settingsStore";
import { useUIStore } from "@/stores/uiStore";
import { remoteLeadingColumns } from "@/shell/shellChrome";
import { tooltipWithShortcut } from "@/utils/tooltipWithShortcut";
import { CollapsedColumnStrip } from "@/components/shared/CollapsedColumnStrip";
import { ServerSwitcher } from "@/components/WorkspaceRail/ServerSwitcher";
import { RemoteError, RemoteBanner } from "./RemoteChrome";
import { RemoteShellSection } from "./RemoteShellSection";
import { RemoteTree } from "./RemoteTree";
import { RemoteViewer } from "./RemoteViewer";
import "./remote-shell.css";

/** Which column the shell is: the rail's place, the sidebar's, or the document's. */
type RemoteRegion = "rail" | "sidebar" | "main";

interface RemoteShellProps {
  serverId: string;
  region: RemoteRegion;
  /** The window, for the server switcher's own selection. */
  windowLabel: string;
}

/**
 * Show the file tree column beside a remote server's groups.
 *
 * Called when a folder is selected: selecting is the user asking to browse that
 * folder, and a folded tree would answer with a strip. It sets the SAME state
 * the window already uses for this Mac (`sidebarVisible` + the `files` view),
 * exactly as the three-column preset does, so ⌘1/⌘2/⌘3 and the strip keep
 * working afterwards — and switching back returns to an open file tree, the
 * state the user last asked for.
 */
function revealRemoteTree(): void {
  const ui = useUIStore.getState();
  if (ui.sidebarVisible && ui.sidebarViewMode === "files") return;
  useUIStore.getState().showSidebarWithView("files");
}

/**
 * Load the groups once per server.
 *
 * Keyed on the SERVER, not on the status: a column that folds and unfolds (or a
 * second column mounting) remounts this region, and keying on the status made
 * every remount read it — a `loading` status did not survive the round trip, so
 * the store was re-asked and the list never landed. `open()` resets this state
 * per server, so `idle` is the one signal that a load is still owed.
 *
 * The gates stay on the STATUS, so every effect run has a side effect and its
 * dependencies settle after it: an `error` is NOT retried here, because the
 * status does not change on a retry and the effect would run again with the
 * same inputs — an unbounded loop of requests, not a retry.
 */
function useGroups(serverId: string) {
  const status = useRemoteBrowserStore((s) => s.groupsStatus);
  const connection = useRemoteBrowserStore((s) => s.connection);
  useEffect(() => {
    // A column can mount BEFORE the shell pointed the store at the server
    // (child effects run first); the pending load waits for the connection.
    // An error is the region's own retry, not this effect's: see the note above.
    if (connection === null) return;
    if (status !== "idle") return;
    void loadGroups();
  }, [status, serverId, connection]);
  return status;
}

/** The server switcher at the column's head — the local rail's own row. */
function RemoteRailHead({ windowLabel }: { windowLabel: string }) {
  return (
    <div className="remote-rail__head">
      <ServerSwitcher windowLabel={windowLabel} />
    </div>
  );
}

function RailRegion({ serverId, windowLabel }: { serverId: string; windowLabel: string }) {
  const { t } = useTranslation("sidebar");
  const collapsed = useSettingsStore((s) => s.general.workspaceRailCollapsed);
  const groups = useRemoteBrowserStore((s) => s.groups);
  const status = useGroups(serverId);
  const message = useRemoteBrowserStore((s) => s.groupsMessage);
  const activeRootId = useRemoteBrowserStore((s) => s.activeRootId);
  const selectRoot = useRemoteBrowserStore((s) => s.selectRoot);
  const sidebarFontSize = useSettingsStore((s) => s.appearance.sidebarFontSize ?? 14);

  // Folded, not gone: the strip IS the way back, at the column's own foot, as
  // in the local rail.
  if (collapsed) {
    return (
      <CollapsedColumnStrip
        expandLabel={t("workspaceRail.expand")}
        onExpand={() => useSettingsStore.getState().updateGeneralSetting("workspaceRailCollapsed", false)}
      />
    );
  }

  return (
    <div className="remote-rail" style={sidebarTextVars(sidebarFontSize)} aria-label={t("remote.groups")}>
      <RemoteRailHead windowLabel={windowLabel} />
      <div className="remote-rail__list">
        {status === "error" ? (
          <RemoteError message={message ?? ""} onRetry={() => void loadGroups()} />
        ) : groups.length === 0 ? (
          <p className="remote-rail__empty">
            {status === "loading" ? t("remote.loading") : t("remote.noGroups")}
          </p>
        ) : (
          groups.map((group) => (
            <RemoteShellSection
              key={group.id}
              group={group}
              activeRootId={activeRootId}
              onSelect={(rootId) => {
                selectRoot(rootId);
                // Picking a folder asks to browse it: the tree column opens.
                revealRemoteTree();
                void loadLevel(rootId, "");
              }}
            />
          ))
        )}
      </div>
    </div>
  );
}

function SidebarRegion({ serverId }: { serverId: string }) {
  const { t } = useTranslation("sidebar");
  const groups = useRemoteBrowserStore((s) => s.groups);
  const status = useGroups(serverId);
  const activeRootId = useRemoteBrowserStore((s) => s.activeRootId);
  const sidebarFontSize = useSettingsStore((s) => s.appearance.sidebarFontSize ?? 14);
  const folder = groups.flatMap((g) => g.folders).find((f) => f.rootId === activeRootId);

  return (
    <div className="remote-sidebar" style={sidebarTextVars(sidebarFontSize)} aria-label={t("remote.files")}>
      <div className="remote-sidebar__header">
        <ListTree size={14} aria-hidden="true" />
        <span className="remote-sidebar__title">{folder?.name ?? t("remote.files")}</span>
      </div>
      <div className="remote-sidebar__body vm-scroll--thin">
        {status === "error" ? null : folder ? (
          <RemoteTree rootId={folder.rootId} available={folder.available} />
        ) : (
          <p className="remote-rail__empty">{t("remote.pickFolder")}</p>
        )}
      </div>
    </div>
  );
}

function MainRegion({ serverId }: { serverId: string }) {
  const { t } = useTranslation("sidebar");
  const doc = useRemoteBrowserStore((s) => s.doc);
  const serverName = useRemoteServersStore((s) => s.serverAt(serverId)?.name ?? "");
  void useGroups(serverId);

  return (
    <div className="remote-viewer">
      <RemoteBanner serverName={serverName} />
      <div className="remote-viewer__body vm-scroll--thin">
        {doc && doc.kind !== "loading" ? (
          <RemoteViewer rootId={doc.rootId} relPath={doc.relPath} />
        ) : (
          <p className="remote-viewer__empty">
            <FolderOpen size={14} aria-hidden="true" /> {doc ? t("remote.loading") : t("remote.pickFile")}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * The remote window as the shell mounts it: ONE surface, two columns.
 *
 * `column="leading"` is the leading card (the groups column beside the file
 * tree, exactly as the local rail and sidebar share one card);
 * `column="main"` is the document. One component, one entry, and the
 * `check-shell-slots` identity list names the feature once.
 *
 * Both leading columns ALSO read their own state here (`remoteLeadingColumns`):
 * the shell sizes the track from the same function, so the track and its
 * contents cannot disagree. Folding is live — ⌘1/⌘2/⌘3 re-render this surface
 * between a strip and the full column without a remount.
 */
export function RemoteWindowSurface({
  serverId,
  column,
  windowLabel,
}: {
  serverId: string;
  column: "leading" | "main";
  windowLabel: string;
}) {
  const railWidth = useSettingsStore((s) => s.general.workspaceRailWidth);
  const railCollapsed = useSettingsStore((s) => s.general.workspaceRailCollapsed);
  const sidebarVisible = useUIStore((s) => s.sidebarVisible);
  const sidebarWidth = useUIStore((s) => s.sidebarWidth);
  const columns = remoteLeadingColumns({ railWidth, railCollapsed, sidebarVisible, sidebarWidth });

  if (column === "main") return <RemoteShell serverId={serverId} region="main" windowLabel={windowLabel} />;
  return (
    <div className="app-sidebar-stack">
      <div className="app-sidebar-stack__rail" style={{ width: columns.railWidth, flexBasis: columns.railWidth }}>
        <RemoteShell serverId={serverId} region="rail" windowLabel={windowLabel} />
      </div>
      <div
        className="app-sidebar-stack__sidebar"
        style={{ width: columns.treeWidth, flex: `0 0 ${columns.treeWidth}px` }}
      >
        <RemoteShell serverId={serverId} region="sidebar" windowLabel={windowLabel} />
      </div>
    </div>
  );
}

/** The remote window: one region of it, chosen by where the shell mounts it. */
function RemoteShell({ serverId, region, windowLabel }: RemoteShellProps) {
  const { t } = useTranslation("sidebar");
  const open = useRemoteBrowserStore((s) => s.open);
  const connection = useRemoteServersStore((s) => s.serverAt(serverId));
  const treeCollapsed = useUIStore((s) => !s.sidebarVisible);
  const sidebarShortcut = useShortcutsStore((state) => state.getShortcut("toggleSidebar"));

  // A server removed from Settings while it was showing must not leave a shell
  // pointed at nothing; Settings also resets the window's selection.
  useEffect(() => {
    if (connection) open(serverId, { host: connection.host, port: connection.port, token: connection.token });
  }, [connection, open, serverId]);

  if (!connection) return null;
  if (region === "rail") {
    return <RailRegion serverId={serverId} windowLabel={windowLabel} />;
  }
  if (region === "sidebar") {
    if (treeCollapsed) {
      return (
        <CollapsedColumnStrip
          expandLabel={tooltipWithShortcut(t("expandSidebar"), formatKeyForDisplay(sidebarShortcut))}
          onExpand={revealRemoteTree}
        />
      );
    }
    // The column's width is its TRACK's (`RemoteWindowSurface` sizes it from
    // `remoteLeadingColumns`, the same state this fold reads), so the content
    // fills it and never states a second, disagreeing number.
    return <SidebarRegion serverId={serverId} />;
  }
  return <MainRegion serverId={serverId} />;
}
