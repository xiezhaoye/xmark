import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, type Client } from "../api/client";
import { treeKey, useReaderStore } from "./readerStore";
import { loadLastDoc, loadServers, saveActiveServerId, saveLastDoc, saveServers } from "./storage";

const TOKEN = "a".repeat(64);
const OTHER_TOKEN = "b".repeat(64);
const CONN = { host: "m4.ts.net", port: 8740, token: TOKEN };

/** Two paired Macs; the first is current. */
const PROFILE = { id: "s1", name: "书房 Mac", host: "m4.ts.net", port: 8740, token: TOKEN };
const OTHER = { id: "s2", name: "客厅 Mac", host: "100.66.175.80", port: 8740, token: OTHER_TOKEN };

const pairFirst = () => {
  saveServers([PROFILE]);
  saveActiveServerId(PROFILE.id);
};

const pairBoth = () => {
  saveServers([PROFILE, OTHER]);
  saveActiveServerId(OTHER.id);
};

function fakeClient(over: Partial<Client> = {}): Client {
  return {
    health: vi.fn(async () => ({ ok: true, version: "t" })),
    workspaces: vi.fn(async () => ({
      groups: [
        { id: "g1", name: "Wiki", folders: [{ rootId: "r1", name: "wiki", available: true }, { rootId: "r2", name: "gone", available: false }] },
      ],
    })),
    tree: vi.fn(async (_root: string, path: string) => ({
      path,
      entries: path === "" ? [{ name: "sub", kind: "dir" as const, relPath: "sub" }, { name: "a.md", kind: "markdown" as const, relPath: "a.md" }] : [],
    })),
    file: vi.fn(async () => ({ text: "# A", kind: "markdown" as const, size: 3, mtime: 1 })),
    asset: vi.fn(async () => new Blob()),
    search: vi.fn(async () => ({ results: [], truncated: false })),
    ...over,
  };
}

let client: Client;
beforeEach(() => {
  localStorage.clear();
  client = fakeClient();
  useReaderStore.getState().reset(() => client);
});

describe("bootstrap", () => {
  it("goes to settings when there is no pairing", async () => {
    await useReaderStore.getState().bootstrap();
    const s = useReaderStore.getState();
    expect(s.view).toBe("settings");
    expect(s.servers).toEqual([]);
    expect(s.connection).toBeNull();
  });

  it("loads groups and starts with the drawer closed even with no last document", async () => {
    pairFirst();
    await useReaderStore.getState().bootstrap();
    const s = useReaderStore.getState();
    expect(s.view).toBe("reader");
    expect(s.groups.map((g) => g.name)).toEqual(["Wiki"]);
    expect(s.drawerOpen).toBe(false);
    expect(s.servers.map((p) => p.id)).toEqual([PROFILE.id]);
    expect(s.connection).toEqual(CONN);
  });

  it("restores the last document of the current server with the drawer closed and selects its folder", async () => {
    pairFirst();
    saveLastDoc(PROFILE.id, { rootId: "r1", relPath: "a.md" });
    await useReaderStore.getState().bootstrap();
    const s = useReaderStore.getState();
    expect(s.drawerOpen).toBe(false);
    expect(s.doc).toEqual({ rootId: "r1", relPath: "a.md" });
    expect(s.selectedRootId).toBe("r1");
    expect(s.docState.status).toBe("ready");
  });

  it("drops a last document whose folder is no longer shared, for that server only", async () => {
    pairBoth();
    saveLastDoc(OTHER.id, { rootId: "gone", relPath: "a.md" });
    saveLastDoc(PROFILE.id, { rootId: "r1", relPath: "a.md" });
    await useReaderStore.getState().bootstrap();
    expect(useReaderStore.getState().doc).toBeNull();
    expect(useReaderStore.getState().drawerOpen).toBe(false);
    expect(loadLastDoc(OTHER.id)).toBeNull();
    expect(loadLastDoc(PROFILE.id)).toEqual({ rootId: "r1", relPath: "a.md" });
  });

  it("records a network failure as a groups error", async () => {
    pairFirst();
    client = fakeClient({ workspaces: vi.fn(async () => Promise.reject(new ApiError(0, "network"))) });
    await useReaderStore.getState().bootstrap();
    expect(useReaderStore.getState().groupsError).toBe("network");
  });

  it("migrates a single-pairing store into one server and opens it", async () => {
    localStorage.setItem("xmark-mobile.connection", JSON.stringify(CONN));
    localStorage.setItem("xmark-mobile.lastDoc", JSON.stringify({ rootId: "r1", relPath: "a.md" }));
    await useReaderStore.getState().bootstrap();
    const s = useReaderStore.getState();
    expect(s.view).toBe("reader");
    expect(s.servers).toHaveLength(1);
    expect(s.servers[0]).toMatchObject({ name: "m4.ts.net", host: "m4.ts.net", port: 8740, token: TOKEN });
    expect(s.activeServerId).toBe(s.servers[0].id);
    expect(s.connection).toEqual(CONN);
    expect(s.doc).toEqual({ rootId: "r1", relPath: "a.md" });
    expect(loadServers().servers).toHaveLength(1);
  });

  it("treats a corrupt server list as a fresh install", async () => {
    localStorage.setItem("xmark-mobile.servers", "{oops");
    await useReaderStore.getState().bootstrap();
    expect(useReaderStore.getState().view).toBe("settings");
  });
});

describe("servers", () => {
  it("adds a server, makes it current and loads its groups", async () => {
    pairFirst();
    await useReaderStore.getState().bootstrap();
    vi.mocked(client.workspaces).mockClear();
    await useReaderStore.getState().addServer({ name: "客厅", connection: { host: "10.ts.net", port: 9000, token: OTHER_TOKEN } });
    const s = useReaderStore.getState();
    expect(s.servers.map((p) => p.name)).toEqual(["书房 Mac", "客厅"]);
    expect(s.connection).toEqual({ host: "10.ts.net", port: 9000, token: OTHER_TOKEN });
    expect(client.workspaces).toHaveBeenCalled();
    expect(loadServers().activeServerId).toBe(s.activeServerId);
  });

  it("names a server after its host when given no name", async () => {
    await useReaderStore.getState().addServer({ name: "  ", connection: { host: "10.ts.net", port: 9000, token: OTHER_TOKEN } });
    expect(useReaderStore.getState().servers[0].name).toBe("10.ts.net");
  });

  it("caps a server name at its length limit", async () => {
    await useReaderStore.getState().addServer({ name: "长".repeat(80), connection: CONN });
    expect(useReaderStore.getState().servers[0].name).toHaveLength(40);
  });

  it("updates a server in place and reloads it when it is the current one", async () => {
    pairFirst();
    await useReaderStore.getState().bootstrap();
    await useReaderStore.getState().updateServer(PROFILE.id, { name: "改名了", token: OTHER_TOKEN });
    const s = useReaderStore.getState();
    expect(s.servers).toHaveLength(1);
    expect(s.servers[0]).toMatchObject({ name: "改名了", host: "m4.ts.net", token: OTHER_TOKEN });
    expect(s.connection).toEqual({ host: "m4.ts.net", port: 8740, token: OTHER_TOKEN });
    expect(loadServers().servers[0].token).toBe(OTHER_TOKEN);
  });

  it("refuses to give two servers the same host and port", async () => {
    pairFirst();
    await useReaderStore.getState().bootstrap();
    await useReaderStore.getState().addServer({ name: "客厅", connection: OTHER });
    await useReaderStore.getState().updateServer(OTHER.id, { host: "m4.ts.net" });
    expect(useReaderStore.getState().servers.map((p) => p.host)).toEqual(["m4.ts.net", "100.66.175.80"]);
  });

  it("switching clears everything that belonged to the old server and reloads", async () => {
    pairBoth();
    await useReaderStore.getState().bootstrap();
    useReaderStore.getState().setDrawer(true);
    await useReaderStore.getState().selectRoot("r1");
    await useReaderStore.getState().toggleDir("r1", "sub");
    await useReaderStore.getState().openDoc("r1", "a.md");
    expect(useReaderStore.getState().trees).not.toEqual({});

    vi.mocked(client.workspaces).mockClear();
    await useReaderStore.getState().switchServer(PROFILE.id);
    const s = useReaderStore.getState();
    expect(s.activeServerId).toBe(PROFILE.id);
    expect(s.connection).toEqual(CONN);
    expect(s.trees).toEqual({});
    expect(s.expanded).toEqual({});
    expect(s.selectedRootId).toBeNull();
    expect(s.doc).toBeNull();
    expect(s.docState).toEqual({ status: "idle" });
    expect(s.drawerOpen).toBe(false);
    expect(client.workspaces).toHaveBeenCalled();
    // The groups are the new server's, fetched afresh rather than kept.
    expect(s.groups.map((g) => g.name)).toEqual(["Wiki"]);
    expect(s.groupsError).toBeNull();
    expect(loadServers().activeServerId).toBe(PROFILE.id);
  });

  it("switching restores the other server's last document rather than the current one's", async () => {
    pairBoth();
    saveLastDoc(PROFILE.id, { rootId: "r1", relPath: "a.md" });
    saveLastDoc(OTHER.id, { rootId: "r1", relPath: "b.md" });
    await useReaderStore.getState().bootstrap();
    expect(useReaderStore.getState().doc).toEqual({ rootId: "r1", relPath: "b.md" });
    await useReaderStore.getState().switchServer(PROFILE.id);
    expect(useReaderStore.getState().doc).toEqual({ rootId: "r1", relPath: "a.md" });
  });

  it("switching to the current server does nothing", async () => {
    pairBoth();
    await useReaderStore.getState().bootstrap();
    vi.mocked(client.workspaces).mockClear();
    await useReaderStore.getState().switchServer(OTHER.id);
    expect(client.workspaces).not.toHaveBeenCalled();
  });

  it("ignores a switch to a server that is not listed", async () => {
    pairFirst();
    await useReaderStore.getState().bootstrap();
    await useReaderStore.getState().switchServer("nope");
    expect(useReaderStore.getState().activeServerId).toBe(PROFILE.id);
  });

  it("a document's slow answer is dropped once the server has changed", async () => {
    pairBoth();
    await useReaderStore.getState().bootstrap();
    let release!: () => void;
    client = fakeClient({
      file: vi.fn(async () => {
        await new Promise<void>((r) => (release = r));
        return { text: "old server", kind: "markdown" as const, size: 1, mtime: 1 };
      }),
    });
    useReaderStore.setState({ makeClient: () => client });
    const slow = useReaderStore.getState().openDoc("r1", "slow.md");
    await useReaderStore.getState().switchServer(PROFILE.id);
    release();
    await slow;
    expect(useReaderStore.getState().docState).toEqual({ status: "idle" });
  });

  it("drops a slow groups answer for the server the user already switched away from", async () => {
    pairBoth();
    await useReaderStore.getState().bootstrap();
    let release!: () => void;
    client = fakeClient({
      workspaces: vi.fn(async () => {
        await new Promise<void>((r) => (release = r));
        return { groups: [{ id: "old", name: "Old server's group", folders: [] }] };
      }),
    });
    useReaderStore.setState({ makeClient: () => client });
    const slow = useReaderStore.getState().refreshWorkspaces();
    // The switch's own fetch is issued behind the slow one; the slow answer
    // lands first and must be discarded.
    const switching = useReaderStore.getState().switchServer(PROFILE.id);
    release();
    await slow;
    await switching;
    expect(useReaderStore.getState().groups.map((g) => g.name)).toEqual(["Wiki"]);
    expect(useReaderStore.getState().groupsLoading).toBe(false);
  });

  it("keeps each server's tree levels apart even when their root ids match", async () => {
    pairBoth();
    await useReaderStore.getState().bootstrap();
    await useReaderStore.getState().selectRoot("r1");
    vi.mocked(client.tree).mockClear();
    await useReaderStore.getState().switchServer(PROFILE.id);
    await useReaderStore.getState().selectRoot("r1");
    expect(client.tree).toHaveBeenCalledWith("r1", "");
    expect(useReaderStore.getState().trees[treeKey(PROFILE.id, "r1", "")]?.status).toBe("ready");
  });

  it("removing the current server moves to the first remaining one", async () => {
    pairBoth();
    await useReaderStore.getState().bootstrap();
    useReaderStore.getState().removeServer(OTHER.id);
    const s = useReaderStore.getState();
    expect(s.servers.map((p) => p.id)).toEqual([PROFILE.id]);
    expect(s.activeServerId).toBe(PROFILE.id);
    expect(s.connection).toEqual(CONN);
    expect(s.view).toBe("reader");
    expect(loadLastDoc(OTHER.id)).toBeNull();
    await vi.waitFor(() => expect(useReaderStore.getState().groups).toHaveLength(1));
  });

  it("removing a server that is not current leaves the current one alone", async () => {
    pairBoth();
    await useReaderStore.getState().bootstrap();
    await useReaderStore.getState().openDoc("r1", "a.md");
    useReaderStore.getState().removeServer(PROFILE.id);
    const s = useReaderStore.getState();
    expect(s.activeServerId).toBe(OTHER.id);
    expect(s.doc).toEqual({ rootId: "r1", relPath: "a.md" });
  });

  it("removing the last server goes to settings", async () => {
    pairFirst();
    await useReaderStore.getState().bootstrap();
    useReaderStore.getState().removeServer(PROFILE.id);
    const s = useReaderStore.getState();
    expect(s.servers).toEqual([]);
    expect(s.connection).toBeNull();
    expect(s.view).toBe("settings");
  });
});

describe("connect", () => {
  it("adds a pairing and returns to the reader", async () => {
    await useReaderStore.getState().connect({ ...CONN, host: "other.ts.net" });
    const s = useReaderStore.getState();
    expect(s.servers).toHaveLength(1);
    expect(s.servers[0]).toMatchObject({ name: "other.ts.net", host: "other.ts.net", port: 8740 });
    expect(client.workspaces).toHaveBeenCalled();
    expect(s.view).toBe("reader");
    expect(s.drawerOpen).toBe(false);
  });

  it("takes the name it is given", async () => {
    await useReaderStore.getState().connect(CONN, "书房 Mac");
    expect(useReaderStore.getState().servers[0].name).toBe("书房 Mac");
  });

  it("updates instead of duplicating a server already paired at the same host and port", async () => {
    pairFirst();
    await useReaderStore.getState().bootstrap();
    await useReaderStore.getState().connect({ ...CONN, token: OTHER_TOKEN }, "改了名");
    const s = useReaderStore.getState();
    expect(s.servers).toHaveLength(1);
    expect(s.servers[0]).toMatchObject({ id: PROFILE.id, name: "改了名", token: OTHER_TOKEN });
    expect(s.connection?.token).toBe(OTHER_TOKEN);
  });

  it("keeps the name when a re-pairing link carries none", async () => {
    pairFirst();
    await useReaderStore.getState().bootstrap();
    await useReaderStore.getState().connect({ ...CONN, token: OTHER_TOKEN });
    expect(useReaderStore.getState().servers[0]).toMatchObject({ name: "书房 Mac", token: OTHER_TOKEN });
  });

  it("treats a host differing only in case as the same Mac", async () => {
    pairFirst();
    await useReaderStore.getState().bootstrap();
    await useReaderStore.getState().connect({ ...CONN, host: "M4.ts.net" });
    expect(useReaderStore.getState().servers).toHaveLength(1);
  });
});

describe("tree", () => {
  beforeEach(async () => {
    pairBoth();
    await useReaderStore.getState().bootstrap();
    await useReaderStore.getState().selectRoot("r1");
  });

  const key = (relPath: string) => treeKey(OTHER.id, "r1", relPath);

  it("loads a folder's root level when selected", async () => {
    expect(useReaderStore.getState().trees[key("")]?.entries?.map((e) => e.name)).toEqual(["sub", "a.md"]);
  });

  it("toggles a subfolder open, loading it once, and closed again", async () => {
    await useReaderStore.getState().toggleDir("r1", "sub");
    expect(useReaderStore.getState().expanded[key("sub")]).toBe(true);
    await useReaderStore.getState().toggleDir("r1", "sub");
    expect(useReaderStore.getState().expanded[key("sub")]).toBe(false);
    await useReaderStore.getState().toggleDir("r1", "sub");
    expect(vi.mocked(client.tree).mock.calls.filter((c) => c[1] === "sub")).toHaveLength(1);
  });

  it("refreshes every loaded level of the selected folder", async () => {
    await useReaderStore.getState().toggleDir("r1", "sub");
    vi.mocked(client.tree).mockClear();
    await useReaderStore.getState().refreshTree();
    expect(vi.mocked(client.tree).mock.calls.map((c) => c[1]).sort()).toEqual(["", "sub"]);
  });

  it("does not load an unavailable folder", async () => {
    await useReaderStore.getState().selectRoot("r2");
    expect(client.tree).not.toHaveBeenCalledWith("r2", "");
  });
});

describe("documents", () => {
  beforeEach(async () => {
    pairFirst();
    await useReaderStore.getState().bootstrap();
  });

  it("opening a file closes the drawer, remembers it and loads it", async () => {
    useReaderStore.getState().setDrawer(true);
    await useReaderStore.getState().openDoc("r1", "a.md");
    const s = useReaderStore.getState();
    expect(s.drawerOpen).toBe(false);
    expect(loadLastDoc(PROFILE.id)).toEqual({ rootId: "r1", relPath: "a.md" });
    expect(s.docState).toMatchObject({ status: "ready", content: { text: "# A" } });
  });

  it("keeps an image document without fetching text", async () => {
    await useReaderStore.getState().openDoc("r1", "p.png");
    expect(client.file).not.toHaveBeenCalledWith("r1", "p.png");
    expect(useReaderStore.getState().docState.status).toBe("image");
  });

  it("records a file error code", async () => {
    client = fakeClient({ file: vi.fn(async () => Promise.reject(new ApiError(415, "not_utf8"))) });
    useReaderStore.setState({ makeClient: () => client });
    await useReaderStore.getState().openDoc("r1", "gbk.md");
    expect(useReaderStore.getState().docState).toEqual({ status: "error", error: "not_utf8" });
  });

  it("ignores a slow response for a document the user already left", async () => {
    let release!: () => void;
    client = fakeClient({
      file: vi.fn(async (_r: string, p: string) => {
        if (p === "slow.md") await new Promise<void>((r) => (release = r));
        return { text: p, kind: "markdown" as const, size: 1, mtime: 1 };
      }),
    });
    useReaderStore.setState({ makeClient: () => client });
    const slow = useReaderStore.getState().openDoc("r1", "slow.md");
    await useReaderStore.getState().openDoc("r1", "fast.md");
    release();
    await slow;
    expect(useReaderStore.getState().docState).toMatchObject({ content: { text: "fast.md" } });
  });
});

describe("view mode", () => {
  it("defaults to preview and switches for every document in the session", async () => {
    expect(useReaderStore.getState().docMode).toBe("preview");
    useReaderStore.getState().setDocMode("source");
    pairFirst();
    await useReaderStore.getState().bootstrap();
    await useReaderStore.getState().openDoc("r1", "a.md");
    expect(useReaderStore.getState().docMode).toBe("source");
  });
});
