/**
 * The phone's own folder library, as the reader's source.
 *
 * Behaviour under test: the library is ONE source named 本机 that sits first in
 * the list and holds many folders; picking adds a folder to it, removing the
 * source drops every bookmark; a relaunch re-registers what still resolves and
 * forgets what does not; and the groups/folders the reader sees carry each
 * folder's OWN name rather than the group's.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nfs = vi.hoisted(() => ({
  restoreLocalFolders: vi.fn(async (): Promise<Array<{ path: string; name: string; ok: boolean }>> => []),
  forgetLocalFolder: vi.fn(async () => {}),
  pickLocalFolder: vi.fn(async () => ({ path: "", name: "", ok: true })),
  listLocalFolder: vi.fn(async () => []),
  readLocalText: vi.fn(async () => ""),
  readLocalBytesBase64: vi.fn(async () => ""),
}));
vi.mock("../platformLocalFS", () => nfs);

const { useReaderStore, LOCAL_SOURCE_NAME } = await import("./readerStore");
const { useLocalLibrary } = await import("./localLibrary");
import { saveActiveServerId, saveServers } from "./storage";
import type { Client } from "../api/client";

const fakeClient: Client = {
  health: async () => ({ ok: true, version: "t" }),
  workspaces: async () => ({ groups: [] }),
  tree: async () => ({ path: "", entries: [] }),
  file: async () => ({ text: "", kind: "text", size: 0, mtime: 0 }),
  asset: async () => new Blob(),
  search: async () => ({ results: [], truncated: false }),
  download: async () => ({ bytes: new Uint8Array(), name: "", mimeType: "" }),
  createShare: async () => ({ url: "" }),
};

const servers = () => useReaderStore.getState().servers;
const library = () => useLocalLibrary.getState();

beforeEach(() => {
  localStorage.clear();
  nfs.restoreLocalFolders.mockResolvedValue([]);
  useLocalLibrary.getState().setGroups([]);
  useReaderStore.getState().reset(() => fakeClient);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("the local source", () => {
  it("is one row named 本机, whatever the folders are called", async () => {
    library().addFolder({ path: "/var/x/Documents", name: "Documents" });
    library().addFolder({ path: "/var/x/工作", name: "工作" });
    await useReaderStore.getState().connectLocal({ activate: false });
    expect(servers()).toHaveLength(1);
    expect(servers()[0]).toMatchObject({ name: LOCAL_SOURCE_NAME, local: true });
    expect(useReaderStore.getState().connection).toMatchObject({ local: true });
  });

  it("does not add a second row when it is already there", async () => {
    await useReaderStore.getState().connectLocal({ activate: false });
    await useReaderStore.getState().connectLocal({ activate: false });
    expect(servers()).toHaveLength(1);
  });

  it("sits first, even when a Mac was paired earlier", async () => {
    saveServers([{ id: "s1", name: "Study Mac", host: "m4.ts.net", port: 8740, token: "a".repeat(64) }]);
    saveActiveServerId("s1");
    library().addFolder({ path: "/var/x/Documents", name: "Documents" });
    await useReaderStore.getState().bootstrap();
    expect(servers().map((p) => p.name)).toEqual([LOCAL_SOURCE_NAME, "Study Mac"]);
  });

  it("keeps each folder's own name, not the group's", async () => {
    library().addFolder({ path: "/var/x/Documents", name: "Documents" });
    library().addFolder({ path: "/var/x/工作", name: "工作" });
    const groups = library().groups;
    expect(groups[0].name).toBe("本机文件夹");
    expect(groups[0].folders.map((f) => f.name)).toEqual(["Documents", "工作"]);
  });

  it("renames a display name without touching the path", async () => {
    library().addFolder({ path: "/var/x/Documents", name: "Documents" });
    library().renameFolder("/var/x/Documents", "我的文档");
    expect(library().groups[0].folders[0]).toMatchObject({ path: "/var/x/Documents", label: "我的文档" });
  });

  it("reorders and moves between groups", async () => {
    library().addFolder({ path: "/a", name: "a" });
    library().addFolder({ path: "/b", name: "b" });
    const other = library().addGroup("项目");
    library().moveFolder("/b", other, 0);
    expect(library().groups.find((g) => g.id === other)?.folders.map((f) => f.path)).toEqual(["/b"]);
    library().moveFolder("/b", "local:default", 0);
    expect(library().groups[0].folders.map((f) => f.path)).toEqual(["/b", "/a"]);
  });

  it("returns a deleted group's folders to the default group", () => {
    library().addFolder({ path: "/a", name: "a" });
    const other = library().addGroup("项目");
    library().moveFolder("/a", other, 0);
    library().removeGroup(other);
    expect(library().groups.map((g) => g.id)).toEqual(["local:default"]);
    expect(library().groups[0].folders.map((f) => f.path)).toEqual(["/a"]);
  });

  it("forgets every bookmark when the local source is removed", async () => {
    library().addFolder({ path: "/var/x/Documents", name: "Documents" });
    await useReaderStore.getState().connectLocal({ activate: false });
    const id = servers()[0].id;
    useReaderStore.getState().removeServer(id);
    expect(nfs.forgetLocalFolder).toHaveBeenCalledWith("/var/x/Documents");
    expect(servers()).toHaveLength(0);
  });

  it("re-registers a remembered folder at launch, once", async () => {
    nfs.restoreLocalFolders.mockResolvedValue([{ path: "/var/x/notes", name: "notes", ok: true }]);
    await useReaderStore.getState().bootstrap();
    await useReaderStore.getState().bootstrap();
    expect(library().groups[0].folders.map((f) => f.path)).toEqual(["/var/x/notes"]);
  });

  it("drops a folder whose bookmark no longer resolves", async () => {
    library().addFolder({ path: "/var/x/gone", name: "gone" });
    nfs.restoreLocalFolders.mockResolvedValue([{ path: "/var/x/gone", name: "gone", ok: false }]);
    await useReaderStore.getState().bootstrap();
    expect(library().groups[0].folders).toHaveLength(0);
  });
});
