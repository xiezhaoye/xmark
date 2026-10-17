/**
 * The reader's state: pairing, groups, the drawer's tree, the open document.
 *
 * One store, because the pieces drive each other (opening a document closes
 * the drawer; a new pairing reloads everything). The drawer always starts
 * closed and its state is never persisted. The HTTP client is built by
 * an injected factory so tests swap the network out. Requests are guarded by
 * a sequence number: a slow answer for a document the user already left is
 * dropped instead of replacing the current one.
 *
 * @module state/readerStore
 */
import { create } from "zustand";
import { ApiError, type Client } from "../api/client";
import type { Connection, FileContent, TreeEntry, WorkspaceGroup } from "../api/types";
import { loadConnection, loadLastDoc, saveConnection, saveLastDoc, type DocRef } from "./storage";

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
  /** Text to find and reveal once the document renders (from search). */
  revealQuery: string | null;
  /** Preview or source for markdown; kept for the session, across documents. */
  docMode: DocMode;
}

interface ReaderActions {
  reset(makeClient: (c: Connection) => Client): void;
  bootstrap(): Promise<void>;
  connect(c: Connection): Promise<void>;
  setView(v: View): void;
  setDrawer(open: boolean): void;
  toggleGroup(id: string): void;
  refreshWorkspaces(): Promise<void>;
  selectRoot(rootId: string): Promise<void>;
  toggleDir(rootId: string, relPath: string): Promise<void>;
  refreshTree(): Promise<void>;
  openDoc(rootId: string, relPath: string, revealQuery?: string | null): Promise<void>;
  reloadDoc(): Promise<void>;
  clearReveal(): void;
  setDocMode(mode: DocMode): void;
}

export const treeKey = (rootId: string, relPath: string) => `${rootId}\u0000${relPath}`;

const IMAGE_EXT = /\.(png|apng|jpe?g|jfif|gif|webp|bmp|ico|avif|heic|heif|tiff?|svg)$/i;

const codeOf = (err: unknown) => (err instanceof ApiError ? err.code : "network");

let docSeq = 0;

function initialState(makeClient: (c: Connection) => Client): ReaderState {
  return {
    makeClient,
    connection: null,
    view: "reader",
    drawerOpen: false,
    groups: [],
    groupsLoading: false,
    groupsError: null,
    collapsedGroups: {},
    selectedRootId: null,
    trees: {},
    expanded: {},
    doc: null,
    docState: { status: "idle" },
    revealQuery: null,
    docMode: "preview",
  };
}

const unconfigured = (): Client => {
  throw new Error("No HTTP client configured");
};

export const useReaderStore = create<ReaderState & ReaderActions>()((set, get) => {
  const client = (): Client | null => {
    const { connection, makeClient } = get();
    return connection ? makeClient(connection) : null;
  };

  const rootAvailable = (rootId: string) =>
    get().groups.some((g) => g.folders.some((f) => f.rootId === rootId && f.available));

  async function loadLevel(rootId: string, relPath: string): Promise<void> {
    const c = client();
    if (!c) return;
    const key = treeKey(rootId, relPath);
    set((s) => ({ trees: { ...s.trees, [key]: { ...s.trees[key], status: "loading" } } }));
    try {
      const { entries } = await c.tree(rootId, relPath);
      set((s) => ({ trees: { ...s.trees, [key]: { status: "ready", entries } } }));
    } catch (err) {
      set((s) => ({ trees: { ...s.trees, [key]: { status: "error", error: codeOf(err) } } }));
    }
  }

  return {
    ...initialState(unconfigured),

    reset: (makeClient) => set(initialState(makeClient)),

    async bootstrap() {
      const connection = loadConnection();
      if (!connection) {
        set({ connection: null, view: "settings" });
        return;
      }
      set({ connection, view: "reader" });
      await get().refreshWorkspaces();
      const last = loadLastDoc();
      if (last && rootAvailable(last.rootId)) {
        await get().selectRoot(last.rootId);
        await get().openDoc(last.rootId, last.relPath);
      } else if (last && !get().groupsError) {
        saveLastDoc(null);
      }
    },

    async connect(connection) {
      saveConnection(connection);
      set({ ...initialState(get().makeClient), connection, view: "reader" });
      await get().refreshWorkspaces();
    },

    setView: (view) => set({ view }),
    setDrawer: (drawerOpen) => set({ drawerOpen }),
    toggleGroup: (id) => set((s) => ({ collapsedGroups: { ...s.collapsedGroups, [id]: !s.collapsedGroups[id] } })),

    async refreshWorkspaces() {
      const c = client();
      if (!c) return;
      set({ groupsLoading: true });
      try {
        const { groups } = await c.workspaces();
        set({ groups, groupsLoading: false, groupsError: null });
      } catch (err) {
        set({ groupsLoading: false, groupsError: codeOf(err) });
      }
    },

    async selectRoot(rootId) {
      set({ selectedRootId: rootId });
      if (!rootAvailable(rootId)) return;
      if (get().trees[treeKey(rootId, "")]?.status !== "ready") await loadLevel(rootId, "");
    },

    async toggleDir(rootId, relPath) {
      const key = treeKey(rootId, relPath);
      const open = !get().expanded[key];
      set((s) => ({ expanded: { ...s.expanded, [key]: open } }));
      if (open && get().trees[key]?.status !== "ready") await loadLevel(rootId, relPath);
    },

    async refreshTree() {
      const rootId = get().selectedRootId;
      if (!rootId) return;
      await get().refreshWorkspaces();
      const { expanded } = get();
      const paths = [""];
      for (const key of Object.keys(expanded)) {
        const [r, p] = key.split("\u0000");
        if (r === rootId && expanded[key]) paths.push(p);
      }
      await Promise.all(paths.map((p) => loadLevel(rootId, p)));
    },

    async openDoc(rootId, relPath, revealQuery = null) {
      const seq = ++docSeq;
      const doc = { rootId, relPath };
      saveLastDoc(doc);
      set({ doc, drawerOpen: false, view: "reader", revealQuery });
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
  };
});
