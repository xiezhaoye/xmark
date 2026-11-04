import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { symlink, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { createApp } from "../createApp";
import { DOWNLOAD_LIMIT } from "./download";
import { makeTestApp, readJson } from "../testFixtures.testUtils";

let t: Awaited<ReturnType<typeof makeTestApp>>;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
beforeEach(async () => {
  t = await makeTestApp();
  await writeFile(path.join(t.wiki, "图.png"), PNG);
  await writeFile(path.join(t.wiki, "note.md"), "# hi\n");
  await writeFile(path.join(t.wiki, "报告.pdf"), "%PDF-1.7\n");
});
afterEach(() => t.cleanup());

const download = (rel: string) =>
  t.get(`/api/download?root=${t.rootId}&path=${encodeURIComponent(rel)}`);

/** The RFC 6987 `filename*` value, decoded. */
const utf8Name = (disposition: string | null): string | null => {
  const m = /filename\*=UTF-8''([^;]+)/i.exec(disposition ?? "");
  return m ? decodeURIComponent(m[1]) : null;
};

describe("GET /api/download", () => {
  it("returns the original bytes with the file's content type", async () => {
    const res = await download("图.png");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await res.arrayBuffer())).toEqual(PNG);
  });

  it("names the file as UTF-8 in an attachment disposition", async () => {
    const res = await download("报告.pdf");
    expect(res.headers.get("content-type")).toBe("application/pdf");
    const disposition = res.headers.get("content-disposition");
    expect(disposition).toMatch(/^attachment;/);
    expect(utf8Name(disposition)).toBe("报告.pdf");
    // An ASCII-only fallback for clients that ignore filename*.
    expect(disposition).toMatch(/filename="[^"]*"/);
    expect(Buffer.from(await res.arrayBuffer())).toEqual(Buffer.from("%PDF-1.7\n"));
  });

  it("uses a text content type for a markdown note", async () => {
    const res = await download("note.md");
    expect(res.headers.get("content-type")).toMatch(/^text\//);
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("answers 404 for a missing file or a directory", async () => {
    expect((await download("nope.pdf")).status).toBe(404);
    expect((await download("")).status).toBe(404);
    expect((await readJson(await download("nope.pdf"))).error).toBe("not_found");
  });

  it("refuses paths outside the shared folder", async () => {
    const res = await t.get(`/api/download?root=${t.rootId}&path=${encodeURIComponent("../../etc/passwd")}`);
    expect(res.status).toBe(400);
  });
});

describe("GET /api/download with a bounded reader", () => {
  /** The real app with the production reader swapped for one the test controls. */
  const appWith = (readBytes: (file: string, max: number) => Promise<Buffer>) =>
    createApp({ tokens: { current: async () => t.token }, registry: t.registry, version: "test", readBytes });

  it("serves the bytes the reader returned, with the download ceiling", async () => {
    let seenMax = 0;
    const app = appWith(async (_file, max) => {
      seenMax = max;
      return Buffer.from("exact");
    });
    const res = await app.request(`/api/download?root=${t.rootId}&path=note.md`, {
      headers: { Authorization: `Bearer ${t.token}` },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("exact");
    expect(seenMax).toBe(DOWNLOAD_LIMIT);
  });

  it("answers 413 when the reader reports a file that outgrew the limit", async () => {
    const tooLarge = Object.assign(new Error("too_large"), { code: "TOO_LARGE" });
    const app = appWith(async () => {
      throw tooLarge;
    });
    const res = await app.request(`/api/download?root=${t.rootId}&path=note.md`, {
      headers: { Authorization: `Bearer ${t.token}` },
    });
    expect(res.status).toBe(413);
    expect(await readJson(res)).toEqual({ error: "too_large" });
  });

  it("answers 409 when the file changed while it was captured", async () => {
    const app = appWith(async () => {
      throw Object.assign(new Error("changed"), { code: "CHANGED" });
    });
    const res = await app.request(`/api/download?root=${t.rootId}&path=note.md`, {
      headers: { Authorization: `Bearer ${t.token}` },
    });
    expect(res.status).toBe(409);
    expect(await readJson(res)).toEqual({ error: "file_changed" });
  });

  it("answers 404 for any other read failure, never a 500", async () => {
    const app = appWith(async () => {
      throw new Error("boom");
    });
    const res = await app.request(`/api/download?root=${t.rootId}&path=note.md`, {
      headers: { Authorization: `Bearer ${t.token}` },
    });
    expect(res.status).toBe(404);
  });

  it("refuses a file that is a symlink pointing out of the root", async () => {
    const outside = path.join(t.base, "outside.md");
    await writeFile(outside, "secret");
    await symlink(outside, path.join(t.wiki, "link.md"));
    const res = await download("link.md");
    expect(res.status).toBe(404);
  });
});
