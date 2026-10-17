import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, type Client } from "../api/client";
import { treeKey, useReaderStore } from "./readerStore";
import { loadLastDoc, saveConnection, saveLastDoc } from "./storage";

const CONN = { host: "m4.ts.net", port: 8740, token: "a".repeat(64) };

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
    expect(useReaderStore.getState().view).toBe("settings");
  });

  it("loads groups and starts with the drawer closed even with no last document", async () => {
    saveConnection(CONN);
    await useReaderStore.getState().bootstrap();
    const s = useReaderStore.getState();
    expect(s.view).toBe("reader");
    expect(s.groups.map((g) => g.name)).toEqual(["Wiki"]);
    expect(s.drawerOpen).toBe(false);
  });

  it("restores the last document with the drawer closed and selects its folder", async () => {
    saveConnection(CONN);
    saveLastDoc({ rootId: "r1", relPath: "a.md" });
    await useReaderStore.getState().bootstrap();
    const s = useReaderStore.getState();
    expect(s.drawerOpen).toBe(false);
    expect(s.doc).toEqual({ rootId: "r1", relPath: "a.md" });
    expect(s.selectedRootId).toBe("r1");
    expect(s.docState.status).toBe("ready");
  });

  it("drops a last document whose folder is no longer shared", async () => {
    saveConnection(CONN);
    saveLastDoc({ rootId: "gone", relPath: "a.md" });
    await useReaderStore.getState().bootstrap();
    expect(useReaderStore.getState().doc).toBeNull();
    expect(useReaderStore.getState().drawerOpen).toBe(false);
    expect(loadLastDoc()).toBeNull();
  });

  it("records a network failure as a groups error", async () => {
    saveConnection(CONN);
    client = fakeClient({ workspaces: vi.fn(async () => Promise.reject(new ApiError(0, "network"))) });
    await useReaderStore.getState().bootstrap();
    expect(useReaderStore.getState().groupsError).toBe("network");
  });
});

describe("tree", () => {
  beforeEach(async () => {
    saveConnection(CONN);
    await useReaderStore.getState().bootstrap();
  });

  it("loads a folder's root level when selected", async () => {
    await useReaderStore.getState().selectRoot("r1");
    expect(useReaderStore.getState().trees[treeKey("r1", "")]?.entries?.map((e) => e.name)).toEqual(["sub", "a.md"]);
  });

  it("toggles a subfolder open, loading it once, and closed again", async () => {
    await useReaderStore.getState().selectRoot("r1");
    await useReaderStore.getState().toggleDir("r1", "sub");
    expect(useReaderStore.getState().expanded[treeKey("r1", "sub")]).toBe(true);
    await useReaderStore.getState().toggleDir("r1", "sub");
    expect(useReaderStore.getState().expanded[treeKey("r1", "sub")]).toBe(false);
    await useReaderStore.getState().toggleDir("r1", "sub");
    expect(vi.mocked(client.tree).mock.calls.filter((c) => c[1] === "sub")).toHaveLength(1);
  });

  it("refreshes every loaded level of the selected folder", async () => {
    await useReaderStore.getState().selectRoot("r1");
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
    saveConnection(CONN);
    await useReaderStore.getState().bootstrap();
  });

  it("opening a file closes the drawer, remembers it and loads it", async () => {
    useReaderStore.getState().setDrawer(true);
    await useReaderStore.getState().openDoc("r1", "a.md");
    const s = useReaderStore.getState();
    expect(s.drawerOpen).toBe(false);
    expect(loadLastDoc()).toEqual({ rootId: "r1", relPath: "a.md" });
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

  it("saving a new pairing reloads the groups and returns to the reader", async () => {
    vi.mocked(client.workspaces).mockClear();
    await useReaderStore.getState().connect({ ...CONN, host: "other.ts.net" });
    expect(client.workspaces).toHaveBeenCalled();
    expect(useReaderStore.getState().view).toBe("reader");
    expect(useReaderStore.getState().drawerOpen).toBe(false);
  });
});

describe("view mode", () => {
  it("defaults to preview and switches for every document in the session", async () => {
    expect(useReaderStore.getState().docMode).toBe("preview");
    useReaderStore.getState().setDocMode("source");
    saveConnection(CONN);
    await useReaderStore.getState().bootstrap();
    await useReaderStore.getState().openDoc("r1", "a.md");
    expect(useReaderStore.getState().docMode).toBe("source");
  });
});

