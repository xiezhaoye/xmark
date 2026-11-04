/**
 * A folder on this phone, as the reader's source.
 *
 * Behaviour under test: picking one adds a profile that carries its path and
 * makes it current; a relaunch re-registers every folder whose bookmark still
 * resolves, and does not duplicate those already known; removing the profile
 * also drops the native bookmark, so the grant does not outlive the row.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nfs = vi.hoisted(() => ({
  restoreLocalFolders: vi.fn(async (): Promise<Array<{ path: string; name: string; ok: boolean }>> => []),
  forgetLocalFolder: vi.fn(async () => {}),
  pickLocalFolder: vi.fn(async (): Promise<{ path: string; name: string; ok: boolean }> => ({ path: "", name: "", ok: true })),
  listLocalFolder: vi.fn(async () => []),
  readLocalText: vi.fn(async () => ""),
  readLocalBytesBase64: vi.fn(async () => ""),
}));
vi.mock("../platformLocalFS", () => nfs);

const { useReaderStore } = await import("./readerStore");
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

beforeEach(() => {
  localStorage.clear();
  nfs.restoreLocalFolders.mockResolvedValue([]);
  useReaderStore.getState().reset(() => fakeClient);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("folders on this phone", () => {
  it("becomes the current source when picked", async () => {
    await useReaderStore.getState().connectLocalFolder({ path: "/var/x/notes", name: "notes", activate: false });
    const [profile] = servers();
    expect(profile).toMatchObject({ name: "notes", localPath: "/var/x/notes" });
    // The connection carries the path, which is what selects the local client.
    expect(useReaderStore.getState().connection).toMatchObject({ localPath: "/var/x/notes" });
  });

  it("does not add the same folder twice", async () => {
    await useReaderStore.getState().connectLocalFolder({ path: "/var/x/notes", name: "notes", activate: false });
    await useReaderStore.getState().connectLocalFolder({ path: "/var/x/notes", name: "renamed", activate: false });
    expect(servers()).toHaveLength(1);
    expect(servers()[0].name).toBe("renamed");
  });

  it("re-registers a remembered folder at launch, once", async () => {
    nfs.restoreLocalFolders.mockResolvedValue([{ path: "/var/x/notes", name: "notes", ok: true }]);
    useReaderStore.getState().reset(() => fakeClient);
    await useReaderStore.getState().bootstrap();
    expect(servers().map((p) => p.localPath)).toEqual(["/var/x/notes"]);

    await useReaderStore.getState().bootstrap();
    expect(servers()).toHaveLength(1);
  });

  it("skips a folder whose bookmark no longer resolves", async () => {
    nfs.restoreLocalFolders.mockResolvedValue([{ path: "/var/x/gone", name: "gone", ok: false }]);
    await useReaderStore.getState().bootstrap();
    expect(servers()).toHaveLength(0);
  });

  it("drops the native bookmark when the folder is removed", async () => {
    await useReaderStore.getState().connectLocalFolder({ path: "/var/x/notes", name: "notes", activate: false });
    const id = servers()[0].id;
    useReaderStore.getState().removeServer(id);
    expect(nfs.forgetLocalFolder).toHaveBeenCalledWith("/var/x/notes");
    expect(servers()).toHaveLength(0);
  });
});
