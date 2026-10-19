/**
 * The reader's state: the paired Macs, the current one, its groups, the
 * drawer's tree and the open document.
 *
 * One store, because the pieces drive each other (opening a document closes
 * the drawer; a new pairing reloads everything). The drawer always starts
 * closed and its state is never persisted. The HTTP client is built by
 * an injected factory so tests swap the network out.
 *
 * Several Macs can be paired at once; `connection` is derived from the current
 * `ServerProfile` so callers keep using it unchanged. Switching servers clears
 * everything that belonged to the old one, and the tree keys carry the server
 * id, so two Macs sharing a root id never share a cached level. Requests are
 * guarded by a sequence number: a slow answer for a document the user already
 * left (or for the Mac the user already switched away from) is dropped instead
 * of replacing the current one.
 *
 * @module state/readerStore
 */
import { create } from "zustand";
import { ApiError, type Client } from "../api/client";
import { connectionOf, defaultServerName, newServerId, sameServer, type Connection, type FileContent, type ServerProfile, type TreeEntry, type WorkspaceGroup } from "../api/types";
import {
  DEFAULT_READING_SIZE,
  MAX_READING_SIZE,
  MIN_READING_SIZE,
  loadLastDoc,
  loadReadingSize,
  loadServers,
  saveActiveServerId,
  saveLastDoc,
  saveReadingSize,
  saveServers,
  type DocRef,
} from "./storage";

type View = "reader" | "search" | "settings";

/** How a markdown or HTML file is shown; other text files are always source. */
type DocMode = "preview" | "source";

interface TreeLevel {
  status: "loading" | "ready" | "error";
  entries?: TreeEntry[];
  error?: string;
}

type DocState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; content: FileContent }
  | { status: "image" }
  | { status: "error"; error: string };

export interface ReaderState {
  makeClient: (c: Connection) => Client;
  /** Every paired Mac, in the order the settings page lists them. */
  servers: ServerProfile[];
  activeServerId: string | null;
  /** The current Mac's connection; null when nothing is paired. */
  connection: Connection | null;
  view: View;
  drawerOpen: boolean;
  groups: WorkspaceGroup[];
  groupsLoading: boolean;
  groupsError: string | null;
  collapsedGroups: Record<string, boolean>;
  selectedRootId: string | null;
  trees: Record<string, TreeLevel>;
  expanded: Record<string, boolean>;
  doc: DocRef | null;
  docState: DocState;
  /** The document body's type size in px; the app's own chrome never changes. */
  readingSize: number;
  /** Text to find and reveal once the document renders (from search). */
  revealQuery: string | null;
  /** Preview or source for markdown; kept for the session, across documents. */
  docMode: DocMode;
}

interface ReaderActions {
  reset(makeClient: (c: Connection) => Client): void;
  bootstrap(): Promise<void>;
  /**
   * Saves a pairing. A Mac already paired at the same host and port is updated
   * — its name and token — instead of being added a second time; `name` is only
   * set when given. The first Mac ever paired becomes current and takes the
   * reader's place; later ones are only listed, the current one stays.
   */
  connect(c: Connection, name?: string | null): Promise<{ status: "added" | "updated"; name: string }>;
  /** Adds a Mac; `activate: false` lists it without switching to it. */
  addServer(input: { name: string; connection: Connection; activate?: boolean }): Promise<void>;
  /** Puts the Macs in the given order; ids it does not mention keep their place at the end. */
  reorderServers(ids: string[]): void;
  updateServer(id: string, patch: Partial<Pick<ServerProfile, "name" | "host" | "port" | "token">>): Promise<void>;
  /** Forgets a Mac, with the last document read on it. */
  removeServer(id: string): void;
  switchServer(id: string): Promise<void>;
  setView(v: View): void;
  setDrawer(open: boolean): void;
  toggleGroup(id: string): void;
  refreshWorkspaces(): Promise<void>;
  selectRoot(rootId: string): Promise<void>;
  toggleDir(rootId: string, relPath: string): Promise<void>;
  refreshTree(): Promise<void>;
  /**
   * Opens a document. It also brings the reader forward, unless `opts.keepView`
   * is set — a switch made from settings loads the document in the background
   * and leaves the page the user is on. It closes the drawer too, unless
   * `opts.keepDrawer` is set — a switch made from the drawer's sheet leaves the
   * groups, folders and their counts where the user found them.
   */
  openDoc(rootId: string, relPath: string, revealQuery?: string | null, opts?: { keepView?: boolean; keepDrawer?: boolean }): Promise<void>;
  reloadDoc(): Promise<void>;
  clearReveal(): void;
  setDocMode(mode: DocMode): void;
  /** Sets the document type size, kept within its range and remembered. */
  setReadingSize(size: number): void;
  /** Moves the document type size by `delta` px. */
  changeReadingSize(delta: number): void;
}

/** A tree level is cached per Mac: two machines may share a root id. */
export const treeKey = (serverId: string, rootId: string, relPath: string) => `${serverId}\u0000${rootId}\u0000${relPath}`;

/** Room for `xmark-mobile-server pair` to print a name without truncating one. */
export const SERVER_NAME_MAX = 40;

/** A server's display name, as typed: trimmed, capped, and never empty. */
export function serverName(raw: string, fallback: Pick<ServerProfile, "host">): string {
  const name = raw.replace(/\s+/g, " ").trim().slice(0, SERVER_NAME_MAX);
  return name || defaultServerName(fallback.host);
}

const IMAGE_EXT = /\.(png|apng|jpe?g|jfif|gif|webp|bmp|ico|avif|heic|heif|tiff?|svg)$/i;

const codeOf = (err: unknown) => (err instanceof ApiError ? err.code : "network");

let docSeq = 0;
/** Bumped by every change of current Mac, so its answers can be told apart. */
let switchSeq = 0;

/** Everything that belongs to one Mac; cleared whenever the current Mac changes. */
const noServer = {
  groups: [] as WorkspaceGroup[],
  groupsLoading: false,
  groupsError: null as string | null,
  collapsedGroups: {} as Record<string, boolean>,
  selectedRootId: null as string | null,
  trees: {} as Record<string, TreeLevel>,
  expanded: {} as Record<string, boolean>,
  doc: null as DocRef | null,
  docState: { status: "idle" } as DocState,
  revealQuery: null as string | null,
};

function initialState(makeClient: (c: Connection) => Client): ReaderState {
  return {
    makeClient,
    servers: [],
    activeServerId: null,
    connection: null,
    view: "reader",
    drawerOpen: false,
    ...noServer,
    readingSize: DEFAULT_READING_SIZE,
    docMode: "preview",
  };
}

const unconfigured = (): Client => {
  throw new Error("No HTTP client configured");
};

const activeProfile = (s: ReaderState) =>
  s.servers.find((p) => p.id === s.activeServerId) ?? null;

/** The current Mac, for the drawer's server picker; null when nothing is paired. */
export const useActiveProfile = (): ServerProfile | null => useReaderStore((s) => activeProfile(s));

/** Writes the list and the current id, deriving `connection` from them. */
function profilesPatch(servers: ServerProfile[], activeServerId: string | null): Pick<ReaderState, "servers" | "activeServerId" | "connection"> {
  saveServers(servers);
  saveActiveServerId(activeServerId);
  const active = servers.find((p) => p.id === activeServerId);
  return { servers, activeServerId: active ? active.id : null, connection: active ? connectionOf(active) : null };
}

export const useReaderStore = create<ReaderState & ReaderActions>()((set, get) => {
  const client = (): Client | null => {
    const { connection, makeClient } = get();
    return connection ? makeClient(connection) : null;
  };

  const rootAvailable = (rootId: string) =>
    get().groups.some((g) => g.folders.some((f) => f.rootId === rootId && f.available));

  async function loadLevel(rootId: string, relPath: string): Promise<void> {
    const c = client();
    const serverId = get().activeServerId;
    if (!c || !serverId) return;
    const current = switchSeq;
    const key = treeKey(serverId, rootId, relPath);
    set((s) => ({ trees: { ...s.trees, [key]: { ...s.trees[key], status: "loading" } } }));
    try {
      const { entries } = await c.tree(rootId, relPath);
      if (current !== switchSeq) return;
      set((s) => ({ trees: { ...s.trees, [key]: { status: "ready", entries } } }));
    } catch (err) {
      if (current !== switchSeq) return;
      set((s) => ({ trees: { ...s.trees, [key]: { status: "error", error: codeOf(err) } } }));
    }
  }

  /**
   * Opens the document a Mac was last reading, if its folder is still shared.
   * `keepView` loads it without pulling the reader forward, for a switch made
   * from another page; `keepDrawer` leaves the drawer as it is, for a switch
   * made from the drawer itself.
   */
  async function restoreLastDoc(serverId: string, opts: { keepView?: boolean; keepDrawer?: boolean } = {}): Promise<void> {
    const last = loadLastDoc(serverId);
    if (last && rootAvailable(last.rootId)) {
      await get().selectRoot(last.rootId);
      await get().openDoc(last.rootId, last.relPath, null, opts);
    } else if (last && !get().groupsError) {
      saveLastDoc(serverId, null);
    }
  }

  /** Makes `id` current from a clean slate and loads its groups. */
  async function activate(id: string | null): Promise<void> {
    docSeq += 1;
    switchSeq += 1;
    set({ ...profilesPatch(get().servers, id), ...noServer });
    // The view is left alone: switching from settings stays in settings.
    if (!id) {
      set({ view: "reader" });
      return;
    }
    await get().refreshWorkspaces();
  }
  return {
    ...initialState(unconfigured),

    reset: (makeClient) => {
      docSeq += 1;
      switchSeq += 1;
      set(initialState(makeClient));
    },

    async bootstrap() {
      const { servers, activeServerId } = loadServers();
      set({ ...profilesPatch(servers, activeServerId), readingSize: loadReadingSize() });
      if (!activeServerId || !servers.length) {
        docSeq += 1;
        switchSeq += 1;
        // Nothing paired: the reader shows an "add a server" button.
        set({ ...noServer, view: "reader" });
        return;
      }
      set({ ...noServer, view: "reader" });
      await get().refreshWorkspaces();
      await restoreLastDoc(activeServerId);
    },

    async connect(connection, name = null) {
      const known = get().servers.find((p) => sameServer(p, connection));
      if (known) {
        await get().updateServer(known.id, { token: connection.token, ...(name ? { name: serverName(name, connection) } : {}) });
        return { status: "updated", name: get().servers.find((p) => p.id === known.id)?.name ?? known.name };
      }
      const first = !get().activeServerId;
      const profileName = serverName(name ?? "", connection);
      await get().addServer({ name: profileName, connection, activate: first });
      if (first) set({ view: "reader" });
      return { status: "added", name: profileName };
    },

    async addServer({ name, connection, activate: makeCurrent = true }) {
      const profile: ServerProfile = {
        id: newServerId(),
        name: serverName(name, connection),
        host: connection.host,
        port: connection.port,
        token: connection.token,
      };
      if (!makeCurrent) {
        set((s) => profilesPatch([...s.servers, profile], s.activeServerId));
        return;
      }
      set((s) => profilesPatch([...s.servers, profile], profile.id));
      await activate(profile.id);
    },

    reorderServers(ids) {
      const { servers, activeServerId } = get();
      const byId = new Map(servers.map((p) => [p.id, p]));
      const ordered: ServerProfile[] = [];
      for (const id of ids) {
        const p = byId.get(id);
        if (p) {
          ordered.push(p);
          byId.delete(id);
        }
      }
      ordered.push(...byId.values());
      set(profilesPatch(ordered, activeServerId));
    },

    async updateServer(id, patch) {
      const { servers, activeServerId } = get();
      const current = servers.find((p) => p.id === id);
      if (!current) return;
      // A Mac is one profile: changing host/port onto another profile's
      // address would leave two entries for it.
      if ((patch.host ?? current.host) !== current.host || (patch.port ?? current.port) !== current.port) {
        const twin = servers.find((p) => p.id !== id && sameServer(p, { host: patch.host ?? current.host, port: patch.port ?? current.port }));
        if (twin) return;
      }
      const next: ServerProfile = { ...current, ...patch };
      next.name = serverName(next.name, next);
      set(profilesPatch(servers.map((p) => (p.id === id ? next : p)), activeServerId));
      // A rename must not reload the Mac being read; only a changed address or
      // token does.
      const reconnect = next.host !== current.host || next.port !== current.port || next.token !== current.token;
      if (id === activeServerId && reconnect) await activate(id);
    },

    removeServer(id) {
      const { servers, activeServerId } = get();
      if (!servers.some((p) => p.id === id)) return;
      saveLastDoc(id, null);
      const rest = servers.filter((p) => p.id !== id);
      const nextId = activeServerId === id ? (rest[0]?.id ?? null) : activeServerId;
      set(() => ({ ...profilesPatch(rest, nextId), ...(activeServerId === id ? noServer : {}) }));
      if (activeServerId === id) {
        docSeq += 1;
        switchSeq += 1;
        // Removal happens in settings, which stays open.
        if (nextId) void get().refreshWorkspaces().then(() => restoreLastDoc(nextId, { keepView: true }));
      }
    },

    async switchServer(id) {
      if (id === get().activeServerId) return;
      if (!get().servers.some((p) => p.id === id)) return;
      const keepView = get().view === "settings";
      // A switch made from the drawer's sheet keeps the drawer open: the
      // groups and folders stay in sight while the last document loads behind.
      const keepDrawer = get().drawerOpen;
      await activate(id);
      await restoreLastDoc(id, { keepView, keepDrawer });
    },

    setView: (view) => set({ view }),
    setDrawer: (drawerOpen) => set({ drawerOpen }),
    toggleGroup: (id) => set((s) => ({ collapsedGroups: { ...s.collapsedGroups, [id]: !s.collapsedGroups[id] } })),

    async refreshWorkspaces() {
      const c = client();
      if (!c) return;
      const current = switchSeq;
      set({ groupsLoading: true });
      try {
        const { groups } = await c.workspaces();
        if (current !== switchSeq) return;
        set({ groups, groupsLoading: false, groupsError: null });
      } catch (err) {
        if (current !== switchSeq) return;
        set({ groupsLoading: false, groupsError: codeOf(err) });
      }
    },

    async selectRoot(rootId) {
      set({ selectedRootId: rootId });
      if (!rootAvailable(rootId)) return;
      const serverId = get().activeServerId;
      if (!serverId) return;
      if (get().trees[treeKey(serverId, rootId, "")]?.status !== "ready") await loadLevel(rootId, "");
    },

    async toggleDir(rootId, relPath) {
      const serverId = get().activeServerId;
      if (!serverId) return;
      const key = treeKey(serverId, rootId, relPath);
      const open = !get().expanded[key];
      set((s) => ({ expanded: { ...s.expanded, [key]: open } }));
      if (open && get().trees[key]?.status !== "ready") await loadLevel(rootId, relPath);
    },

    async refreshTree() {
      const rootId = get().selectedRootId;
      const serverId = get().activeServerId;
      if (!rootId || !serverId) return;
      await get().refreshWorkspaces();
      const { expanded } = get();
      const prefix = `${serverId}\u0000${rootId}\u0000`;
      const paths = [""];
      for (const key of Object.keys(expanded)) {
        if (key.startsWith(prefix) && expanded[key]) paths.push(key.slice(prefix.length));
      }
      await Promise.all(paths.map((p) => loadLevel(rootId, p)));
    },

    async openDoc(rootId, relPath, revealQuery = null, opts = {}) {
      const seq = ++docSeq;
      const serverId = get().activeServerId;
      const doc = { rootId, relPath };
      saveLastDoc(serverId, doc);
      set({ doc, ...(opts.keepDrawer && get().drawerOpen ? {} : { drawerOpen: false }), revealQuery, ...(opts.keepView ? {} : { view: "reader" as const }) });
      if (IMAGE_EXT.test(relPath)) {
        set({ docState: { status: "image" } });
        return;
      }
      const c = client();
      if (!c) return;
      set({ docState: { status: "loading" } });
      try {
        const content = await c.file(rootId, relPath);
        if (seq === docSeq) set({ docState: { status: "ready", content } });
      } catch (err) {
        if (seq === docSeq) set({ docState: { status: "error", error: codeOf(err) } });
      }
    },

    async reloadDoc() {
      const { doc } = get();
      if (doc) await get().openDoc(doc.rootId, doc.relPath);
    },

    clearReveal: () => set({ revealQuery: null }),
    setDocMode: (docMode) => set({ docMode }),

    setReadingSize(size) {
      const next = Math.min(MAX_READING_SIZE, Math.max(MIN_READING_SIZE, Math.round(size)));
      if (next === get().readingSize) return;
      saveReadingSize(next);
      set({ readingSize: next });
    },

    changeReadingSize(delta) {
      get().setReadingSize(get().readingSize + delta);
    },
  };
});

