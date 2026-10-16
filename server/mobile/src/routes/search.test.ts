import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { makeTestApp, readJson } from "../testFixtures.testUtils";
import { MAX_QUERY_LENGTH } from "./search";

let t: Awaited<ReturnType<typeof makeTestApp>>;
beforeEach(async () => {
  t = await makeTestApp();
  await mkdir(path.join(t.wiki, "深"), { recursive: true });
  await writeFile(path.join(t.wiki, "a.md"), "Alpha line\nsecond Alpha\n");
  await writeFile(path.join(t.wiki, "深", "b.md"), "中文搜索 测试\n");
  await writeFile(path.join(t.wiki, "c.txt"), "Alpha in text\n");
  await mkdir(path.join(t.wiki, ".git"));
  await writeFile(path.join(t.wiki, ".git", "x.md"), "Alpha hidden\n");
});
afterEach(() => t.cleanup());

const search = (q: string, root?: string) =>
  t.get(`/api/search?q=${encodeURIComponent(q)}${root ? `&root=${root}` : ""}`);

describe("GET /api/search", () => {
  it("finds case-insensitive matches in markdown, with line numbers and root ids", async () => {
    const res = await search("alpha");
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.results).toEqual([
      {
        rootId: t.rootId,
        relPath: "a.md",
        matches: [
          { lineNumber: 1, lineContent: "Alpha line" },
          { lineNumber: 2, lineContent: "second Alpha" },
        ],
      },
    ]);
    expect(body.truncated).toBe(false);
  });

  it("finds CJK text in nested folders", async () => {
    const body = await readJson(await search("搜索", t.rootId));
    expect(body.results.map((r: { relPath: string }) => r.relPath)).toEqual(["深/b.md"]);
  });

  it("returns no results for a query that matches nothing", async () => {
    expect((await readJson(await search("zzz"))).results).toEqual([]);
  });

  it.each([
    ["empty", ""],
    ["whitespace", "   "],
    ["too long", "x".repeat(MAX_QUERY_LENGTH + 1)],
  ])("rejects a %s query", async (_label, q) => {
    const res = await search(q);
    expect(res.status).toBe(400);
  });

  it("rejects an unknown root", async () => {
    expect((await search("alpha", "0000000000000000")).status).toBe(404);
  });
});
