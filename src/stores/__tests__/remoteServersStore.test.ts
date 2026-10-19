/**
 * remoteServersStore — pairing storage rules.
 *
 * The store's one absolute promise is that it never destroys data it cannot
 * read, so the corrupt-value cases here matter more than the CRUD ones.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const TOKEN = "a".repeat(64);

async function freshStore() {
  vi.resetModules();
  const mod = await import("@/stores/remoteServersStore");
  return mod;
}

beforeEach(() => {
  localStorage.clear();
});

describe("remoteServersStore", () => {
  it("starts empty and adds a server with its default name", async () => {
    const { useRemoteServersStore } = await freshStore();
    const store = useRemoteServersStore.getState();
    expect(store.servers).toEqual([]);
    const result = store.addServer({ host: "m4.tailc8e51.ts.net", port: 8740, token: TOKEN });
    expect(result.status).toBe("added");
    const [server] = useRemoteServersStore.getState().servers;
    expect(server).toMatchObject({ name: "m4", host: "m4.tailc8e51.ts.net", port: 8740, token: TOKEN });
    expect(server.id).toBeTruthy();
  });

  it("uses the link's name when it has one", async () => {
    const { useRemoteServersStore } = await freshStore();
    useRemoteServersStore.getState().addServer({ host: "m4.tailc8e51.ts.net", port: 8740, token: TOKEN, name: "书房" });
    expect(useRemoteServersStore.getState().servers[0].name).toBe("书房");
  });

  it("updates a server already paired at the same host and port, case-insensitively", async () => {
    const { useRemoteServersStore } = await freshStore();
    const first = useRemoteServersStore.getState().addServer({ host: "M4.tailc8e51.ts.net", port: 8740, token: TOKEN, name: "Studio" });
    const second = useRemoteServersStore.getState().addServer({ host: "m4.tailc8e51.ts.net", port: 8740, token: "b".repeat(64) });
    expect(second.status).toBe("updated");
    expect(second.id).toBe(first.id);
    const servers = useRemoteServersStore.getState().servers;
    expect(servers).toHaveLength(1);
    expect(servers[0].token).toBe("b".repeat(64));
    // A link that names nothing does not rename what the user already sees.
    expect(servers[0].name).toBe("Studio");
  });

  it("keeps two Macs that share a name apart", async () => {
    const { useRemoteServersStore } = await freshStore();
    const store = useRemoteServersStore.getState();
    store.addServer({ host: "m4.tailc8e51.ts.net", port: 8740, token: TOKEN });
    store.addServer({ host: "m4.tailc8e51.ts.net", port: 9000, token: TOKEN });
    expect(useRemoteServersStore.getState().servers).toHaveLength(2);
  });

  it("renames, and a blank rename returns the default name", async () => {
    const { useRemoteServersStore } = await freshStore();
    const { id } = useRemoteServersStore.getState().addServer({ host: "m4.tailc8e51.ts.net", port: 8740, token: TOKEN });
    useRemoteServersStore.getState().renameServer(id, "  Mac mini  ");
    expect(useRemoteServersStore.getState().servers[0].name).toBe("Mac mini");
    useRemoteServersStore.getState().renameServer(id, "   ");
    expect(useRemoteServersStore.getState().servers[0].name).toBe("m4");
  });

  it("renames to a CJK name unchanged", async () => {
    const { useRemoteServersStore } = await freshStore();
    const { id } = useRemoteServersStore.getState().addServer({ host: "m4.tailc8e51.ts.net", port: 8740, token: TOKEN });
    useRemoteServersStore.getState().renameServer(id, "楼上的 Mac");
    expect(useRemoteServersStore.getState().servers[0].name).toBe("楼上的 Mac");
  });

  it("removes by id and leaves the rest alone", async () => {
    const { useRemoteServersStore } = await freshStore();
    const store = useRemoteServersStore.getState();
    const a = store.addServer({ host: "m4.tailc8e51.ts.net", port: 8740, token: TOKEN });
    const b = store.addServer({ host: "m5.tailc8e51.ts.net", port: 8740, token: TOKEN });
    useRemoteServersStore.getState().removeServer(a.id);
    const servers = useRemoteServersStore.getState().servers;
    expect(servers.map((s) => s.id)).toEqual([b.id]);
  });

  it("moves a server up and down, and ignores moves off either end", async () => {
    const { useRemoteServersStore } = await freshStore();
    const store = useRemoteServersStore.getState();
    store.addServer({ host: "a.tailc8e51.ts.net", port: 8740, token: TOKEN });
    store.addServer({ host: "b.tailc8e51.ts.net", port: 8740, token: TOKEN });
    store.addServer({ host: "c.tailc8e51.ts.net", port: 8740, token: TOKEN });
    const names = () => useRemoteServersStore.getState().servers.map((s) => s.name);
    useRemoteServersStore.getState().moveServer(2, -1);
    expect(names()).toEqual(["a", "c", "b"]);
    useRemoteServersStore.getState().moveServer(0, 1);
    expect(names()).toEqual(["c", "a", "b"]);
    useRemoteServersStore.getState().moveServer(0, -1);
    expect(names()).toEqual(["c", "a", "b"]);
    useRemoteServersStore.getState().moveServer(2, 1);
    expect(names()).toEqual(["c", "a", "b"]);
  });

  it("reports the same server for a differently-cased address", async () => {
    const { useRemoteServersStore } = await freshStore();
    useRemoteServersStore.getState().addServer({ host: "m4.tailc8e51.ts.net", port: 8740, token: TOKEN });
    expect(useRemoteServersStore.getState().findByAddress("M4.TAILC8E51.TS.NET", 8740)).toBeDefined();
    expect(useRemoteServersStore.getState().findByAddress("m4.tailc8e51.ts.net", 8741)).toBeUndefined();
  });

  it("persists only the server list — the flag is session state", async () => {
    const { useRemoteServersStore } = await freshStore();
    const REMOTE_SERVERS_STORAGE_KEY = "xmark-remote-servers";
    useRemoteServersStore.getState().addServer({ host: "m4.tailc8e51.ts.net", port: 8740, token: TOKEN });
    const raw = JSON.parse(localStorage.getItem(REMOTE_SERVERS_STORAGE_KEY) ?? "{}");
    expect(Object.keys(raw.state)).toEqual(["servers"]);
  });

  it("reads a broken stored value as empty WITHOUT rewriting it", async () => {
    localStorage.setItem("xmark-remote-servers", "{not json");
    const { useRemoteServersStore } = await freshStore();
    // hydration happens on module evaluation under createJSONStorage
    expect(useRemoteServersStore.getState().servers).toEqual([]);
    expect(useRemoteServersStore.getState().corrupt).toBe(true);
    expect(localStorage.getItem("xmark-remote-servers")).toBe("{not json");
  });

  it("keeps a stored value whose `servers` is not a list", async () => {
    const stored = JSON.stringify({ state: { servers: "nope" }, version: 1 });
    localStorage.setItem("xmark-remote-servers", stored);
    const { useRemoteServersStore } = await freshStore();
    expect(useRemoteServersStore.getState().servers).toEqual([]);
    expect(useRemoteServersStore.getState().corrupt).toBe(true);
    expect(localStorage.getItem("xmark-remote-servers")).toBe(stored);
  });

  it("drops a malformed entry but keeps the valid ones", async () => {
    const stored = JSON.stringify({
      state: {
        servers: [
          { id: "ok", name: "Mac", host: "m4.tailc8e51.ts.net", port: 8740, token: TOKEN },
          { id: "bad-port", name: "X", host: "m5.tailc8e51.ts.net", port: "nope", token: TOKEN },
          { name: "no id", host: "m6.tailc8e51.ts.net", port: 8740, token: TOKEN },
          null,
        ],
      },
      version: 1,
    });
    localStorage.setItem("xmark-remote-servers", stored);
    const { useRemoteServersStore } = await freshStore();
    expect(useRemoteServersStore.getState().servers.map((s) => s.id)).toEqual(["ok"]);
    expect(useRemoteServersStore.getState().corrupt).toBe(false);
  });
});
