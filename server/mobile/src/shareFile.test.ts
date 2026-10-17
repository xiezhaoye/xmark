import { describe, expect, it } from "vitest";
import { parseShareFile } from "./shareFile";

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
