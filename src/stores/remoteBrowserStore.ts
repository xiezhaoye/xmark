/**
 * The remote browser's session state: which server, which folder, which
 * document — and the lazily loaded levels of each tree.
 *
 * Key decisions:
 *   - **One level per request.** `/api/tree` answers one directory, so a
 *     folder is fetched the first time it is EXPANDED and never again (a
 *     forced reload clears the level and refetches). That is what keeps a
 *     deep tree cheap over Tailscale.
 *   - **Levels are keyed by server + root + path.** Two Macs can share a
 *     `rootId` prefix and a path; sharing a cache entry between them would
 *     show one machine's files under the other's folder.
 *   - **Answers are dropped when they are stale.** Every load carries a
 *     sequence number and the server it belongs to; a slow answer for a
 *     folder — or a server — the user already left is discarded rather than
 *     painted.
 *   - **Nothing here is persisted.** Switching back to this Mac, or quitting,
 *     leaves no trace and touches no other store.
 *
 * @coordinates-with components/RemoteBrowser/RemoteShell.tsx — the renderer
 * @coordinates-with services/remoteServers/client.ts — the commands
 * @module stores/remoteBrowserStore
 */

import { create } from "zustand";
import type { RemoteConnection, RemoteGroup, RemoteTreeEntry } from "@/services/remoteServers/client";

type LevelState =
  | { status: "loading" }
  | { status: "ready"; entries: RemoteTreeEntry[] }
  | { status: "error"; message: string };

interface RemoteDoc {
  rootId: string;
  relPath: string;
  kind: string;
}

export interface RemoteBrowserState {
  /** The server this slice is showing; null keeps it inert (on this Mac). */
  serverId: string | null;
  connection: RemoteConnection | null;
  groups: RemoteGroup[];
  groupsStatus: "idle" | "loading" | "ready" | "error";
  groupsMessage: string | null;
  /** Which folder's tree column is showing. */
  activeRootId: string | null;
  /** The file whose preview fills the main column. */
  doc: RemoteDoc | null;
  /** `${serverId}\u0000${rootId}\u0000${relPath}` → one directory level. */
  levels: Record<string, LevelState>;
  expanded: Record<string, boolean>;
  /** Bumped on every open, so a stale document answer is dropped. */
  seq: number;
}

interface RemoteBrowserActions {
  /** Point the browser at a server (or at nothing: this Mac). */
  open: (serverId: string, connection: RemoteConnection) => void;
  close: () => void;
  setGroups: (groups: RemoteGroup[]) => void;
  setGroupsStatus: (status: RemoteBrowserState["groupsStatus"], message?: string | null) => void;
  selectRoot: (rootId: string) => void;
  setLevel: (key: string, level: LevelState) => void;
  setExpanded: (key: string, expanded: boolean) => void;
  openDoc: (doc: RemoteDoc | null) => number;
}

/** The cache key of one directory level. */
export function levelKey(serverId: string, rootId: string, path: string): string {
  return `${serverId}\u0000${rootId}\u0000${path}`;
}

const INITIAL: RemoteBrowserState = {
  serverId: null,
  connection: null,
  groups: [],
  groupsStatus: "idle",
  groupsMessage: null,
  activeRootId: null,
  doc: null,
  levels: {},
  expanded: {},
  seq: 0,
};

export const useRemoteBrowserStore = create<RemoteBrowserState & RemoteBrowserActions>()((set, get) => ({
  ...INITIAL,

  open: (serverId, connection) =>
    set((s) =>
      s.serverId === serverId
        ? s
        : { ...INITIAL, serverId, connection, groupsStatus: "loading" },
    ),
  close: () => set({ ...INITIAL }),

  setGroups: (groups) => set({ groups, groupsStatus: "ready", groupsMessage: null }),
  setGroupsStatus: (groupsStatus, groupsMessage = null) => set({ groupsStatus, groupsMessage }),
  selectRoot: (activeRootId) => set({ activeRootId, doc: null, seq: get().seq + 1 }),

  setLevel: (key, level) => set((s) => ({ levels: { ...s.levels, [key]: level } })),
  setExpanded: (key, expanded) => set((s) => ({ expanded: { ...s.expanded, [key]: expanded } })),
  openDoc: (doc) => {
    const seq = get().seq + 1;
    set({ doc, seq });
    return seq;
  },
}));
