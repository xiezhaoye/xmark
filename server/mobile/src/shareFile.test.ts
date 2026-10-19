import { describe, expect, it } from "vitest";
import { readFile, stat, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { makeTempDir } from "./testFixtures.testUtils";
import { parseShareFile, readShareFile, serializeShareFile, writeShareFile } from "./shareFile";

describe("parseShareFile", () => {
  it("parses a well-formed v1 file", () => {
    const share = parseShareFile({
      version: 1,
      groups: [{ id: "g1", name: "Wiki", folders: ["/Users/me/wiki", "/Users/me/kb"] }],
    });
    expect(share.groups).toEqual([{ id: "g1", name: "Wiki", folders: ["/Users/me/wiki", "/Users/me/kb"] }]);
  });

  it("keeps CJK and emoji names and paths intact", () => {
    const share = parseShareFile({ version: 1, groups: [{ id: "g", name: "笔记 📝", folders: ["/Users/me/文档"] }] });
    expect(share.groups[0]).toEqual({ id: "g", name: "笔记 📝", folders: ["/Users/me/文档"] });
  });

  it("drops relative, empty, NUL-bearing and non-string folders, and de-duplicates", () => {
    const share = parseShareFile({
      version: 1,
      groups: [{ id: "g", name: "G", folders: ["rel/path", "", "/a\u0000b", 42, "/ok", "/ok"] }],
    });
    expect(share.groups[0].folders).toEqual(["/ok"]);
  });

  it("drops groups without a string id or name, and ignores unknown fields", () => {
    const share = parseShareFile({
      version: 1,
      extra: true,
      groups: [{ id: 1, name: "x", folders: [] }, { id: "y", folders: [] }, { id: "z", name: "Z", folders: [], color: "red" }],
    });
    expect(share.groups).toEqual([{ id: "z", name: "Z", folders: [] }]);
  });

  it("treats a missing folders array as empty", () => {
    expect(parseShareFile({ version: 1, groups: [{ id: "g", name: "G" }] }).groups[0].folders).toEqual([]);
  });

  it.each([
    ["null", null],
    ["array", []],
    ["unknown version", { version: 2, groups: [] }],
    ["missing groups", { version: 1 }],
  ])("rejects %s", (_label, raw) => {
    expect(() => parseShareFile(raw)).toThrow();
  });
});

describe("share file read/write helpers", () => {
  it("round-trips through serializeShareFile, keeping order, CJK and version 1", async () => {
    const share = parseShareFile({
      version: 1,
      groups: [
        { id: "b", name: "笔记 📝", folders: ["/Users/me/文档"] },
        { id: "a", name: "Work", folders: ["/a", "/b"] },
      ],
    });
    const { dir, cleanup } = await makeTempDir();
    try {
      const file = path.join(dir, "sub", "mobile-share.json");
      await writeShareFile(file, share);
      expect(parseShareFile(JSON.parse(await readFile(file, "utf8")))).toEqual(share);
      expect(JSON.parse(serializeShareFile(share))).toHaveProperty("version", 1);
      expect(await readShareFile(file)).toEqual(share);
    } finally {
      await cleanup();
    }
  });

  it("writes a 0600 file, replacing an existing one", async () => {
    const { dir, cleanup } = await makeTempDir();
    try {
      const file = path.join(dir, "mobile-share.json");
      await writeFile(file, "old", { mode: 0o644 });
      await writeShareFile(file, { groups: [] });
      expect((await stat(file)).mode & 0o777).toBe(0o600);
    } finally {
      await cleanup();
    }
  });

  it("reads a missing file as an empty list", async () => {
    const { dir, cleanup } = await makeTempDir();
    try {
      expect(await readShareFile(path.join(dir, "nope.json"))).toEqual({ groups: [] });
    } finally {
      await cleanup();
    }
  });

  it("refuses invalid JSON and an unsupported version, without touching the file", async () => {
    const { dir, cleanup } = await makeTempDir();
    try {
      const file = path.join(dir, "mobile-share.json");
      for (const [raw, pattern] of [
        ["{oops", /not valid JSON/],
        ['{"version":9,"groups":[]}', /corrupt/],
        ['{"version":1}', /corrupt/],
      ] as const) {
        await writeFile(file, raw);
        await expect(readShareFile(file)).rejects.toThrow(pattern);
        expect(await readFile(file, "utf8")).toBe(raw);
      }
    } finally {
      await cleanup();
    }
  });
});
