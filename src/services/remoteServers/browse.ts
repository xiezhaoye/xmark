/**
 * The remote browser's data loading: groups, one tree level at a time, a
 * document, an image.
 *
 * Purpose: keep every `invoke` out of the components, so a render never has a
 * side effect and a failure always becomes a message a panel can show. Each
 * load is guarded by the store's `seq`, so an answer that arrives after the
 * user moved on (another folder, another server) is dropped.
 *
 * @coordinates-with stores/remoteBrowserStore.ts — the state these fill
 * @coordinates-with components/RemoteBrowser/RemoteShell.tsx — the caller
 * @module services/remoteServers/browse
 */

import { useRemoteBrowserStore, levelKey } from "@/stores/remoteBrowserStore";
import {
  classifyRemoteFailure,
  remoteAsset,
  remoteFile,
  remoteFailureKey,
  remoteTree,
  remoteWorkspaces,
  type RemoteAsset,
  type RemoteFile,
} from "./client";
import i18n from "@/i18n";

/** The message a user reads for a failure, from the shared vocabulary. */
export function failureText(error: unknown): string {
  return i18n.t(`settings:${remoteFailureKey(classifyRemoteFailure(error))}`);
}

/** Load the groups (and each group's folders) for the open server. */
export async function loadGroups(): Promise<void> {
  const { connection, serverId, setGroups, setGroupsStatus } = useRemoteBrowserStore.getState();
  if (!connection) return;
  setGroupsStatus("loading");
  try {
    const groups = await remoteWorkspaces(connection);
    // A server switch while this was in flight owns the store now.
    if (useRemoteBrowserStore.getState().serverId !== serverId) return;
    setGroups(groups);
  } catch (error) {
    if (useRemoteBrowserStore.getState().serverId !== serverId) return;
    setGroupsStatus("error", failureText(error));
  }
}

/**
 * Load one directory level. Called when a folder is expanded, and once for the
 * selected folder's own level. A level already `ready` is not refetched.
 */
export async function loadLevel(rootId: string, path: string, force = false): Promise<void> {
  const state = useRemoteBrowserStore.getState();
  const { connection, serverId, levels, setLevel } = state;
  if (!connection || !serverId) return;
  const key = levelKey(serverId, rootId, path);
  if (!force && levels[key]?.status === "ready") return;
  setLevel(key, { status: "loading" });
  try {
    const tree = await remoteTree(connection, rootId, path);
    if (useRemoteBrowserStore.getState().serverId !== serverId) return;
    setLevel(key, { status: "ready", entries: tree.entries });
  } catch (error) {
    if (useRemoteBrowserStore.getState().serverId !== serverId) return;
    setLevel(key, { status: "error", message: failureText(error) });
  }
}

/** A document's text, or null when the load was superseded. */
export async function loadDocument(rootId: string, relPath: string): Promise<RemoteFile | null> {
  const { connection, serverId, openDoc } = useRemoteBrowserStore.getState();
  if (!connection || !serverId) return null;
  const seq = openDoc({ rootId, relPath, kind: "loading" });
  try {
    const file = await remoteFile(connection, rootId, relPath);
    const now = useRemoteBrowserStore.getState();
    if (now.serverId !== serverId || now.seq !== seq) return null;
    useRemoteBrowserStore.setState({ doc: { rootId, relPath, kind: file.kind } });
    return file;
  } catch (error) {
    const now = useRemoteBrowserStore.getState();
    if (now.serverId !== serverId || now.seq !== seq) return null;
    useRemoteBrowserStore.setState({ doc: { rootId, relPath, kind: "error" } });
    throw error;
  }
}

/** An image's bytes, ready for a blob URL. */
export async function loadImage(rootId: string, relPath: string): Promise<RemoteAsset | null> {
  const { connection } = useRemoteBrowserStore.getState();
  if (!connection) return null;
  return remoteAsset(connection, rootId, relPath);
}
