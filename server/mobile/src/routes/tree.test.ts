import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { makeTestApp, readJson } from "../testFixtures.testUtils";

let t: Awaited<ReturnType<typeof makeTestApp>>;
beforeEach(async () => {
  t = await makeTestApp();
  await mkdir(path.join(t.wiki, "笔记"));
  await mkdir(path.join(t.wiki, "Archive"));
  await mkdir(path.join(t.wiki, ".git"));
  await mkdir(path.join(t.wiki, "node_modules"));
  await writeFile(path.join(t.wiki, "note10.md"), "# ten");
  await writeFile(path.join(t.wiki, "note2.md"), "# two");
  await writeFile(path.join(t.wiki, "pic.png"), "png");
  await writeFile(path.join(t.wiki, "data.json"), "{}");
  await writeFile(path.join(t.wiki, "clip.mp4"), "v");
  await writeFile(path.join(t.wiki, ".hidden.md"), "h");
  await writeFile(path.join(t.wiki, "笔记", "第一篇.md"), "一");
  await symlink(t.base, path.join(t.wiki, "escape"));
});
afterEach(() => t.cleanup());

const tree = (q: string) => t.get(`/api/tree?${q}`);

describe("GET /api/tree", () => {
  it("lists one level: folders first, natural order, supported files only", async () => {
    const res = await tree(`root=${t.rootId}`);
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.path).toBe("");
    expect(body.entries.map((e: { name: string; kind: string }) => [e.name, e.kind])).toEqual([
      ["Archive", "dir"],
      ["笔记", "dir"],
      ["data.json", "text"],
      ["note2.md", "markdown"],
      ["note10.md", "markdown"],
      ["pic.png", "image"],
    ]);
  });

  it("gives each entry a root-relative path", async () => {
    const body = await readJson(await tree(`root=${t.rootId}&path=${encodeURIComponent("笔记")}`));
    expect(body.entries).toEqual([
      { name: "第一篇.md", kind: "markdown", relPath: "笔记/第一篇.md", size: 3, mtime: expect.any(Number) },
    ]);
  });

  it("returns an empty list for an empty folder", async () => {
    const body = await readJson(await tree(`root=${t.rootId}&path=Archive`));
    expect(body.entries).toEqual([]);
  });

  it.each([
    ["missing root", "", 400, "bad_request"],
    ["unknown root", "root=0000000000000000", 404, "unknown_root"],
    ["traversal", "path=..", 400, "bad_path"],
    ["hidden dir", "path=.git", 400, "bad_path"],
    ["symlink escape", "path=escape", 404, "not_found"],
    ["missing dir", "path=nope", 404, "not_found"],
    ["a file, not a dir", "path=note2.md", 404, "not_found"],
  ])("%s → %i %s", async (_label, q, status, error) => {
    const query = q.startsWith("path=") ? `root=${t.rootId}&${q}` : q;
    const res = await tree(query);
    expect(res.status).toBe(status);
    expect((await readJson(res)).error).toBe(error);
  });
});
