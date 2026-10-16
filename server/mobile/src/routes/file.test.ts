import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeFile } from "node:fs/promises";
import * as path from "node:path";
import { makeTestApp, readJson } from "../testFixtures.testUtils";
import { MAX_TEXT_BYTES } from "./file";

let t: Awaited<ReturnType<typeof makeTestApp>>;
beforeEach(async () => (t = await makeTestApp()));
afterEach(() => t.cleanup());

const file = (rel: string) => t.get(`/api/file?root=${t.rootId}&path=${encodeURIComponent(rel)}`);

describe("GET /api/file", () => {
  it("returns markdown text with size and mtime", async () => {
    await writeFile(path.join(t.wiki, "中文.md"), "# 标题\n");
    const res = await file("中文.md");
    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual({ text: "# 标题\n", kind: "markdown", size: Buffer.byteLength("# 标题\n"), mtime: expect.any(Number) });
  });

  it("strips a UTF-8 BOM", async () => {
    await writeFile(path.join(t.wiki, "bom.md"), "﻿hi");
    expect((await readJson(await file("bom.md"))).text).toBe("hi");
  });

  it("serves plain-text kinds too", async () => {
    await writeFile(path.join(t.wiki, "a.yml"), "k: v\n");
    expect((await readJson(await file("a.yml"))).kind).toBe("text");
  });

  it("returns an empty file as empty text", async () => {
    await writeFile(path.join(t.wiki, "empty.md"), "");
    expect((await readJson(await file("empty.md"))).text).toBe("");
  });

  it("refuses non-UTF-8 content", async () => {
    await writeFile(path.join(t.wiki, "gbk.md"), Buffer.from([0xd6, 0xd0, 0xce, 0xc4]));
    const res = await file("gbk.md");
    expect(res.status).toBe(415);
    expect((await readJson(res)).error).toBe("not_utf8");
  });

  it("refuses images and unsupported kinds", async () => {
    await writeFile(path.join(t.wiki, "p.png"), "x");
    await writeFile(path.join(t.wiki, "c.mp4"), "x");
    expect((await file("p.png")).status).toBe(415);
    expect((await file("c.mp4")).status).toBe(415);
  });

  it("refuses files over the cap", async () => {
    await writeFile(path.join(t.wiki, "big.md"), Buffer.alloc(MAX_TEXT_BYTES + 1, 0x61));
    const res = await file("big.md");
    expect(res.status).toBe(413);
    expect((await readJson(res)).error).toBe("too_large");
  });

  it("returns 404 for a directory or a missing file", async () => {
    expect((await file("")).status).toBe(404);
    expect((await file("nope.md")).status).toBe(404);
  });
});
