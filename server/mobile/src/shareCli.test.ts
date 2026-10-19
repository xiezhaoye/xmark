import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { makeTempDir } from "./testFixtures.testUtils";
import { groupIdFor, runShareCommand } from "./shareCli";
import { readShareFile } from "./shareFile";

let dir: string;
let cleanup: () => Promise<void>;
let shareFile: string;
let out: string[];
let err: string[];

const run = (...argv: string[]) =>
  runShareCommand(argv, { shareFile, stdout: (s) => out.push(s), stderr: (s) => err.push(s) });

async function makeDir(name: string): Promise<string> {
  const p = path.join(dir, name);
  await mkdir(p, { recursive: true });
  return p;
}

async function readFileRaw(): Promise<string> {
  return readFile(shareFile, "utf8");
}

beforeEach(async () => {
  ({ dir, cleanup } = await makeTempDir());
  shareFile = path.join(dir, "data", "mobile-share.json");
  out = [];
  err = [];
});
afterEach(async () => {
  await cleanup();
});

describe("share list", () => {
  it("says so when nothing is shared yet and creates no file", async () => {
    expect(await run("list")).toBe(0);
    expect(out.join("")).toMatch(/no shared folders/i);
    await expect(readFileRaw()).rejects.toThrow();
  });

  it("prints every group with its folders", async () => {
    const a = await makeDir("work");
    const b = await makeDir("笔记");
    await run("add", "工作", a);
    await run("add", "工作", b);
    out.length = 0;
    expect(await run("list")).toBe(0);
    expect(out.join("")).toBe(`工作\n  ${a}\n  ${b}\n`);
  });

  it("prints a group with no folders rather than skipping it", async () => {
    await mkdir(path.dirname(shareFile), { recursive: true });
    await writeFile(shareFile, JSON.stringify({ version: 1, groups: [{ id: "g", name: "Empty", folders: [] }] }));
    expect(await run("list")).toBe(0);
    expect(out.join("")).toContain("Empty\n  (no folders)\n");
  });

  it("refuses to print a corrupt file, and names it", async () => {
    await mkdir(path.dirname(shareFile), { recursive: true });
    await writeFile(shareFile, "{not json");
    expect(await run("list")).toBe(1);
    expect(err.join("")).toContain(shareFile);
    expect(err.join("")).toMatch(/not valid JSON/i);
  });

  it("rejects an unknown version instead of treating it as empty", async () => {
    await mkdir(path.dirname(shareFile), { recursive: true });
    await writeFile(shareFile, JSON.stringify({ version: 2, groups: [] }));
    expect(await run("list")).toBe(1);
    expect(err.join("")).toMatch(/corrupt/i);
  });
});

describe("share add", () => {
  it("creates the file, the group and a 0600 file in a new directory", async () => {
    const wiki = await makeDir("wiki");
    expect(await run("add", "Wiki", wiki)).toBe(0);
    expect(out.join("")).toContain(`Sharing ${wiki} in Wiki`);
    const info = await stat(shareFile);
    expect(info.mode & 0o777).toBe(0o600);
    expect(await readShareFile(shareFile)).toEqual({ groups: [{ id: "wiki", name: "Wiki", folders: [wiki] }] });
  });

  it("writes the desktop app's format, version 1 with groups/id/name/folders", async () => {
    const wiki = await makeDir("wiki");
    await run("add", "Wiki", wiki);
    const parsed = JSON.parse(await readFileRaw()) as Record<string, unknown>;
    expect(parsed.version).toBe(1);
    expect(Object.keys(parsed).sort()).toEqual(["groups", "version"]);
    expect(Object.keys((parsed.groups as object[])[0] as object).sort()).toEqual(["folders", "id", "name"]);
  });

  it("appends to an existing group found by name", async () => {
    const a = await makeDir("a");
    const b = await makeDir("b");
    await run("add", "G", a);
    expect(await run("add", "G", b)).toBe(0);
    expect((await readShareFile(shareFile)).groups).toHaveLength(1);
    expect((await readShareFile(shareFile)).groups[0].folders).toEqual([a, b]);
  });

  it("does not add the same folder twice", async () => {
    const a = await makeDir("a");
    await run("add", "G", a);
    expect(await run("add", "G", a)).toBe(0);
    expect((await readShareFile(shareFile)).groups[0].folders).toEqual([a]);
    expect(out.at(-1)).toMatch(/already shared/);
  });

  it("treats a trailing slash as the same folder", async () => {
    const a = await makeDir("a");
    await run("add", "G", a);
    await run("add", "G", `${a}/`);
    expect((await readShareFile(shareFile)).groups[0].folders).toEqual([a]);
  });

  it("keeps a Chinese group name as the name and gives it a stable id", async () => {
    const wiki = await makeDir("wiki");
    await run("add", "我的笔记", wiki);
    await run("add", "我的笔记", await makeDir("kb"));
    const [group] = (await readShareFile(shareFile)).groups;
    expect(group.name).toBe("我的笔记");
    expect(group.id).toMatch(/^g-[0-9a-f]{8}$/);
    expect(group.folders).toHaveLength(2);
  });

  it("keeps names distinct when two names slug to the same id", async () => {
    await run("add", "Work", await makeDir("a"));
    await run("add", "work", await makeDir("b"));
    await run("add", "WORK", await makeDir("c"));
    expect((await readShareFile(shareFile)).groups.map((g) => g.id)).toEqual(["work", "work-2", "work-3"]);
  });

  it("rejects a relative path", async () => {
    expect(await run("add", "G", "relative/dir")).toBe(1);
    expect(err.join("")).toMatch(/absolute/i);
    await expect(readFileRaw()).rejects.toThrow();
  });

  it("rejects a path that does not exist and one that is a file", async () => {
    expect(await run("add", "G", path.join(dir, "missing"))).toBe(1);
    expect(err.join("")).toMatch(/existing directory/i);
    const file = path.join(dir, "file.txt");
    await writeFile(file, "x");
    expect(await run("add", "G", file)).toBe(1);
    await expect(readFileRaw()).rejects.toThrow();
  });

  it("rejects a NUL byte in the path", async () => {
    expect(await run("add", "G", "/tmp/a\u0000b")).toBe(1);
  });

  it("needs both a group and a path", async () => {
    expect(await run("add", "G")).toBe(2);
    expect(await run("add")).toBe(2);
    expect(err.join("")).toMatch(/share add <group> <path>/);
  });

  it("never overwrites a corrupt file", async () => {
    await mkdir(path.dirname(shareFile), { recursive: true });
    await writeFile(shareFile, "garbage");
    expect(await run("add", "G", await makeDir("a"))).toBe(1);
    expect(await readFileRaw()).toBe("garbage");
  });

  it("leaves no temp file behind", async () => {
    await run("add", "G", await makeDir("a"));
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(path.dirname(shareFile));
    expect(files).toEqual(["mobile-share.json"]);
  });

  it("preserves groups and folders written by someone else", async () => {
    await mkdir(path.dirname(shareFile), { recursive: true });
    await writeFile(
      shareFile,
      JSON.stringify({ version: 1, groups: [{ id: "desk", name: "Desktop", folders: ["/tmp"] }] }),
    );
    await run("add", "G", await makeDir("a"));
    const share = await readShareFile(shareFile);
    expect(share.groups[0]).toEqual({ id: "desk", name: "Desktop", folders: ["/tmp"] });
    expect(share.groups.map((g) => g.name)).toEqual(["Desktop", "G"]);
  });
});

describe("share remove", () => {
  it("removes one folder and keeps the group", async () => {
    const a = await makeDir("a");
    const b = await makeDir("b");
    await run("add", "G", a);
    await run("add", "G", b);
    expect(await run("remove", "G", a)).toBe(0);
    expect((await readShareFile(shareFile)).groups).toEqual([{ id: "g", name: "G", folders: [b] }]);
  });

  it("drops the group once its last folder goes", async () => {
    const a = await makeDir("a");
    await run("add", "G", a);
    await run("add", "H", await makeDir("b"));
    expect(await run("remove", "G", a)).toBe(0);
    expect((await readShareFile(shareFile)).groups.map((g) => g.name)).toEqual(["H"]);
  });

  it("removes the whole group without a path", async () => {
    await run("add", "G", await makeDir("a"));
    await run("add", "G", await makeDir("b"));
    expect(await run("remove", "G")).toBe(0);
    expect((await readShareFile(shareFile)).groups).toEqual([]);
    expect(out.join("")).toMatch(/Removed group G/);
  });

  it("fails for an unknown group", async () => {
    await run("add", "G", await makeDir("a"));
    expect(await run("remove", "Nope")).toBe(1);
    expect(err.join("")).toMatch(/No group named "Nope"/);
    expect((await readShareFile(shareFile)).groups).toHaveLength(1);
  });

  it("fails for a path the group does not hold", async () => {
    await run("add", "G", await makeDir("a"));
    expect(await run("remove", "G", path.join(dir, "b"))).toBe(1);
    expect(err.join("")).toMatch(/not shared/i);
    expect((await readShareFile(shareFile)).groups[0].folders).toHaveLength(1);
  });

  it("reports an unknown group when there is no share file at all", async () => {
    expect(await run("remove", "G")).toBe(1);
    expect(err.join("")).toMatch(/No group named "G"/);
  });

  it("needs a group name", async () => {
    expect(await run("remove")).toBe(2);
    expect(err.join("")).toMatch(/share remove <group>/);
  });

  it("never overwrites a corrupt file", async () => {
    await mkdir(path.dirname(shareFile), { recursive: true });
    await writeFile(shareFile, "garbage");
    expect(await run("remove", "G")).toBe(1);
    expect(await readFileRaw()).toBe("garbage");
  });
});

describe("runShareCommand dispatch", () => {
  it("prints usage for no subcommand and for help", async () => {
    for (const argv of [[], ["help"], ["--help"], ["-h"]]) {
      out.length = 0;
      expect(await run(...argv)).toBe(0);
      expect(out.join("")).toMatch(/share add <group> <path>/);
      expect(out.join("")).toMatch(/last write wins/i);
    }
  });

  it("returns 2 for an unknown subcommand", async () => {
    expect(await run("bogus")).toBe(2);
    expect(err.join("")).toContain("bogus");
  });

  it("returns 1 with the message when an I/O error escapes", async () => {
    // A directory where the file should be: readFile fails with EISDIR.
    await mkdir(shareFile, { recursive: true });
    expect(await run("list")).toBe(1);
    expect(err.join("")).not.toBe("");
  });

  it("round-trips add → list → remove", async () => {
    const a = await makeDir("目录");
    await run("add", "测试", a);
    out.length = 0;
    await run("list");
    expect(out.join("")).toBe(`测试\n  ${a}\n`);
    expect(await run("remove", "测试")).toBe(0);
    expect((await readShareFile(shareFile)).groups).toEqual([]);
  });
});

describe("groupIdFor", () => {
  it("slugs an ASCII name", () => {
    expect(groupIdFor("My Work", [])).toBe("my-work");
    expect(groupIdFor("  A  B  ", [])).toBe("a-b");
  });

  it("falls back to a hash for names with no ASCII letters", () => {
    expect(groupIdFor("我的笔记", [])).toMatch(/^g-[0-9a-f]{8}$/);
    expect(groupIdFor("📝", [])).toMatch(/^g-[0-9a-f]{8}$/);
    expect(groupIdFor("", [])).toMatch(/^g-[0-9a-f]{8}$/);
  });

  it("is stable for the same name", () => {
    expect(groupIdFor("我的笔记", [])).toBe(groupIdFor("我的笔记", []));
  });

  it("suffixes a collision in a predictable order", () => {
    expect(groupIdFor("Work", ["work"])).toBe("work-2");
    expect(groupIdFor("Work", ["work", "work-2"])).toBe("work-3");
  });

  it("does not treat a taken hash id as free", () => {
    const first = groupIdFor("笔记", []);
    expect(groupIdFor("笔记", [first])).toBe(`${first}-2`);
  });
});
