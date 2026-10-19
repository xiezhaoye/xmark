import { beforeEach, describe, expect, it } from "vitest";
import { loadLastDoc, loadServers, saveActiveServerId, saveLastDoc, saveServers } from "./storage";

const TOKEN = "a".repeat(64);
const OTHER_TOKEN = "b".repeat(64);
const LEGACY_KEY = "xmark-mobile.connection";

const PROFILE = { id: "s1", name: "书房 Mac", host: "m4.ts.net", port: 8740, token: TOKEN };

beforeEach(() => localStorage.clear());

describe("servers", () => {
  it("round-trips the server list and the current one", () => {
    saveServers([PROFILE, { ...PROFILE, id: "s2", name: "客厅", host: "100.66.175.80", token: OTHER_TOKEN }]);
    saveActiveServerId("s2");
    const loaded = loadServers();
    expect(loaded.servers.map((s) => s.name)).toEqual(["书房 Mac", "客厅"]);
    expect(loaded.activeServerId).toBe("s2");
  });

  it("falls back to the first server when the current id names none", () => {
    saveServers([PROFILE]);
    saveActiveServerId("gone");
    expect(loadServers().activeServerId).toBe("s1");
  });

  it("drops malformed entries and repeated ids, keeping the good ones", () => {
    localStorage.setItem(
      "xmark-mobile.servers",
      JSON.stringify([PROFILE, { id: "x", name: "no port", host: "a.ts.net", token: TOKEN }, { ...PROFILE }, "nonsense", null]),
    );
    saveActiveServerId("s1");
    expect(loadServers()).toEqual({ servers: [PROFILE], activeServerId: "s1" });
  });

  it("renames a saved server still named with its whole domain, and keeps the name it was given", () => {
    const wholeDomain = { ...PROFILE, id: "s2", name: "m1.tailc8e51.ts.net", host: "m1.tailc8e51.ts.net" };
    const custom = { ...PROFILE, id: "s3", name: "书房", host: "m2.tailc8e51.ts.net" };
    const ip = { ...PROFILE, id: "s4", name: "100.66.175.80", host: "100.66.175.80" };
    localStorage.setItem("xmark-mobile.servers", JSON.stringify([wholeDomain, custom, ip]));
    saveActiveServerId("s2");
    const loaded = loadServers();
    expect(loaded.servers.map((s) => s.name)).toEqual(["m1", "书房", "100.66.175.80"]);
    // Only the name changes; the id, address and token stay.
    expect(loaded.servers[0]).toEqual({ ...wholeDomain, name: "m1" });
    expect(loaded.activeServerId).toBe("s2");
  });

  it("matches a whole-domain name case-insensitively and leaves a name that is not the domain alone", () => {
    const upper = { ...PROFILE, id: "s2", name: "M1.TailC8E51.TS.Net", host: "m1.tailc8e51.ts.net" };
    const partial = { ...PROFILE, id: "s3", name: "m1.tailc8e51", host: "m1.tailc8e51.ts.net" };
    localStorage.setItem("xmark-mobile.servers", JSON.stringify([upper, partial]));
    expect(loadServers().servers.map((s) => s.name)).toEqual(["m1", "m1.tailc8e51"]);
  });

  it("treats a corrupt store as a fresh install", () => {
    localStorage.setItem("xmark-mobile.servers", "{oops");
    expect(loadServers()).toEqual({ servers: [], activeServerId: null });
  });

  it("clears the list when it is emptied", () => {
    saveServers([PROFILE]);
    saveServers([]);
    expect(localStorage.getItem("xmark-mobile.servers")).toBeNull();
    expect(loadServers().servers).toEqual([]);
  });
});

describe("migration from the single-pairing store", () => {
  beforeEach(() => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify({ host: "m4.ts.net", port: 8740, token: TOKEN }));
    localStorage.setItem("xmark-mobile.lastDoc", JSON.stringify({ rootId: "r1", relPath: "notes/中文.md" }));
  });

  it("turns the old pairing into one server named after its machine, and makes it current", () => {
    const loaded = loadServers();
    expect(loaded.servers).toHaveLength(1);
    expect(loaded.servers[0]).toMatchObject({ name: "m4", host: "m4.ts.net", port: 8740, token: TOKEN });
    expect(loaded.servers[0].id).toBeTruthy();
    expect(loaded.activeServerId).toBe(loaded.servers[0].id);
    // The old key is removed once it has been migrated.
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
    expect(loadLastDoc(loaded.activeServerId)).toEqual({ rootId: "r1", relPath: "notes/中文.md" });
  });

  it("does not run when the old pairing could not be read", () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify({ host: "m4.ts.net" }));
    expect(loadServers()).toEqual({ servers: [], activeServerId: null });
  });

  it("never overrides an existing server list", () => {
    saveServers([PROFILE]);
    saveActiveServerId(PROFILE.id);
    expect(loadServers().servers.map((s) => s.id)).toEqual([PROFILE.id]);
    expect(localStorage.getItem(LEGACY_KEY)).not.toBeNull();
  });
});

describe("last document per server", () => {
  it("keeps one document per server", () => {
    saveLastDoc("s1", { rootId: "r1", relPath: "a.md" });
    saveLastDoc("s2", { rootId: "r9", relPath: "b.md" });
    expect(loadLastDoc("s1")).toEqual({ rootId: "r1", relPath: "a.md" });
    expect(loadLastDoc("s2")).toEqual({ rootId: "r9", relPath: "b.md" });
    expect(loadLastDoc("s3")).toBeNull();
    expect(loadLastDoc(null)).toBeNull();
  });

  it("clears one server's document without touching the others", () => {
    saveLastDoc("s1", { rootId: "r1", relPath: "a.md" });
    saveLastDoc("s2", { rootId: "r9", relPath: "b.md" });
    saveLastDoc("s1", null);
    expect(loadLastDoc("s1")).toBeNull();
    expect(loadLastDoc("s2")).toEqual({ rootId: "r9", relPath: "b.md" });
    saveLastDoc("s2", null);
    expect(localStorage.getItem("xmark-mobile.lastDoc")).toBeNull();
  });

  it("treats corrupt or wrongly shaped values as absent", () => {
    localStorage.setItem("xmark-mobile.lastDoc", "{oops");
    expect(loadLastDoc("s1")).toBeNull();
    localStorage.setItem("xmark-mobile.lastDoc", JSON.stringify({ s1: { rootId: 1 }, s2: "x" }));
    expect(loadLastDoc("s1")).toBeNull();
    expect(loadLastDoc("s2")).toBeNull();
    localStorage.setItem("xmark-mobile.lastDoc", JSON.stringify({ s1: { rootId: "r", relPath: "中文.md" }, s2: { rootId: 1 } }));
    expect(loadLastDoc("s1")).toEqual({ rootId: "r", relPath: "中文.md" });
    expect(loadLastDoc("s2")).toBeNull();
  });
});

describe("writing with storage unavailable", () => {
  it("does not throw when localStorage refuses", () => {
    const setItem = localStorage.setItem.bind(localStorage);
    localStorage.setItem = () => {
      throw new Error("quota");
    };
    try {
      expect(() => saveServers([PROFILE])).not.toThrow();
      expect(() => saveLastDoc("s1", { rootId: "r", relPath: "a.md" })).not.toThrow();
    } finally {
      localStorage.setItem = setItem;
    }
  });
});
