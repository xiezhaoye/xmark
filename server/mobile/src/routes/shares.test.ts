import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { createApp } from "../createApp";
import { createShareStore } from "../shareStore";
import { makeTempDir, makeTestApp, readJson } from "../testFixtures.testUtils";

let t: Awaited<ReturnType<typeof makeTestApp>>;
let snapDir: string;
let store: Awaited<ReturnType<typeof createShareStore>>;
let closeStore: () => Promise<void>;

beforeEach(async () => {
  t = await makeTestApp();
  const tmp = await makeTempDir();
  snapDir = path.join(tmp.dir, "shares");
  store = await createShareStore(snapDir);
  closeStore = tmp.cleanup;
});
afterEach(async () => {
  await t.cleanup();
  await closeStore();
});

const BASE = "https://box.tail1234.ts.net";

function sharingApp(publicBaseUrl: string | null = BASE, readBytes?: (file: string, max: number) => Promise<Buffer>) {
  return createApp({
    tokens: { current: async () => t.token },
    registry: t.registry,
    version: "test",
    shares: { store, publicBaseUrl },
    readBytes,
  });
}

const post = (app: ReturnType<typeof createApp>, body: unknown, init: RequestInit = {}) =>
  app.request("/api/shares", {
    method: "POST",
    headers: { Authorization: `Bearer ${t.token}`, "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
    ...init,
  });

describe("POST /api/shares", () => {
  it("returns a public URL under the configured base", async () => {
    await writeFile(path.join(t.wiki, "笔记.md"), "# 标题\n");
    const res = await post(sharingApp(), { root: t.rootId, path: "笔记.md" });
    expect(res.status).toBe(200);
    const { url } = await readJson(res);
    expect(url).toMatch(/^https:\/\/box\.tail1234\.ts\.net\/s\/[0-9a-f]{64}$/);
  });

  it("stores the latest saved bytes, not a cached copy", async () => {
    await writeFile(path.join(t.wiki, "n.md"), "v1");
    const first = await readJson(await post(sharingApp(), { root: t.rootId, path: "n.md" }));
    await writeFile(path.join(t.wiki, "n.md"), "v2");
    const second = await readJson(await post(sharingApp(), { root: t.rootId, path: "n.md" }));
    const id = (u: string) => u.split("/s/")[1];
    expect((await store.read(id(first.url)))!.toString()).toBe("v1");
    expect((await store.read(id(second.url)))!.toString()).toBe("v2");
  });

  it("leaves the original file untouched", async () => {
    await writeFile(path.join(t.wiki, "n.md"), "keep 原样");
    await post(sharingApp(), { root: t.rootId, path: "n.md" });
    expect(await readFile(path.join(t.wiki, "n.md"), "utf8")).toBe("keep 原样");
  });

  it("answers 503 sharing_unavailable with no public base URL", async () => {
    await writeFile(path.join(t.wiki, "n.md"), "x");
    for (const base of [null]) {
      const res = await post(sharingApp(base), { root: t.rootId, path: "n.md" });
      expect(res.status).toBe(503);
      expect(await readJson(res)).toEqual({ error: "sharing_unavailable" });
    }
  });

  it("answers 503 sharing_unavailable without a store", async () => {
    const app = createApp({ tokens: { current: async () => t.token }, registry: t.registry, version: "test" });
    await writeFile(path.join(t.wiki, "n.md"), "x");
    const res = await post(app, { root: t.rootId, path: "n.md" });
    expect(res.status).toBe(503);
  });

  it("requires the token", async () => {
    await writeFile(path.join(t.wiki, "n.md"), "x");
    const res = await sharingApp().request("/api/shares", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ root: t.rootId, path: "n.md" }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects a non-JSON or oversized body", async () => {
    const app = sharingApp();
    expect((await post(app, "not json")).status).toBe(400);
    expect((await post(app, JSON.stringify({ root: t.rootId, path: "x".repeat(20_000) }))).status).toBe(413);
    expect((await post(app, JSON.stringify({ root: t.rootId, path: "a".repeat(4096) }))).status).toBe(400);
  });

  it("rejects an oversized body that never declares a Content-Length", async () => {
    // A streamed body: the limit has to be enforced while reading, not after
    // an unbounded `c.req.text()` has already allocated the whole thing.
    const chunk = new TextEncoder().encode("x".repeat(4096));
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= 64) return controller.close();
        sent += 1;
        controller.enqueue(chunk);
      },
    });
    const res = await sharingApp().request("/api/shares", {
      method: "POST",
      headers: { Authorization: `Bearer ${t.token}`, "Content-Type": "application/json" },
      body,
      duplex: "half",
    } as RequestInit);
    expect(res.status).toBe(413);
    expect(await readJson(res)).toEqual({ error: "too_large" });
    // Reading stopped once the (8 KiB) limit was passed rather than at the end.
    expect(sent).toBeLessThan(10);
  });

  it("rejects a body whose declared Content-Length is a lie", async () => {
    // A forged short Content-Length must not let a long body through, and a
    // missing one must not open the door either.
    const long = "x".repeat(20_000);
    const forged = await sharingApp().request("/api/shares", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${t.token}`,
        "Content-Type": "application/json",
        "Content-Length": "12",
      },
      body: long,
    });
    expect(forged.status).toBe(413);
    const missing = await sharingApp().request("/api/shares", {
      method: "POST",
      headers: { Authorization: `Bearer ${t.token}`, "Content-Type": "application/json" },
      body: long,
    });
    expect(missing.status).toBe(413);
  });

  it("refuses a body that is not JSON by content type", async () => {
    const app = sharingApp();
    for (const type of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x"]) {
      const res = await app.request("/api/shares", {
        method: "POST",
        headers: { Authorization: `Bearer ${t.token}`, "Content-Type": type },
        body: JSON.stringify({ root: t.rootId, path: "n.md" }),
      });
      expect(res.status).toBe(415);
      expect(await readJson(res)).toEqual({ error: "unsupported_content_type" });
    }
  });

  it("still accepts an application/json body with a charset parameter", async () => {
    await writeFile(path.join(t.wiki, "n.md"), "x");
    const res = await sharingApp().request("/api/shares", {
      method: "POST",
      headers: { Authorization: `Bearer ${t.token}`, "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ root: t.rootId, path: "n.md" }),
    });
    expect(res.status).toBe(200);
  });

  it("rejects a body that is not an object with string fields", async () => {
    const app = sharingApp();
    for (const body of ["[]", "null", '"x"', "{}", '{"root":1,"path":"a.md"}', '{"root":"","path":"a.md"}']) {
      expect((await post(app, body)).status).toBe(400);
    }
  });

  it("rejects an unknown root, a directory, traversal and symlinks", async () => {
    const app = sharingApp();
    await writeFile(path.join(t.wiki, "n.md"), "x");
    await mkdir(path.join(t.wiki, "sub"));
    const outside = path.join(t.base, "outside.md");
    await writeFile(outside, "secret");
    await symlink(outside, path.join(t.wiki, "link.md"));
    expect((await post(app, { root: "nope", path: "n.md" })).status).toBe(404);
    expect((await post(app, { root: t.rootId, path: "sub" })).status).toBe(404);
    // A refused segment is a bad request; a symlink that escapes the root is missing.
    expect((await post(app, { root: t.rootId, path: "../outside.md" })).status).toBe(400);
    expect((await post(app, { root: t.rootId, path: "link.md" })).status).toBe(404);
    expect((await post(app, { root: t.rootId, path: "" })).status).toBe(400);
  });

  it("rejects an unsupported type and an oversized file", async () => {
    const app = sharingApp();
    await writeFile(path.join(t.wiki, "a.zip"), Buffer.from([0x50, 0x4b]));
    expect((await post(app, { root: t.rootId, path: "a.zip" })).status).toBe(415);
    await writeFile(path.join(t.wiki, "big.txt"), Buffer.alloc(30 * 1024 * 1024 + 1, 0x61));
    expect((await post(app, { root: t.rootId, path: "big.txt" })).status).toBe(413);
  });

  it("never returns an absolute workspace path", async () => {
    await writeFile(path.join(t.wiki, "n.md"), "x");
    const body = await (await post(sharingApp(), { root: t.rootId, path: "n.md" })).text();
    expect(body).not.toContain(t.base);
    expect(body).not.toContain(t.wiki);
  });

  it("freezes referenced images and rewrites nothing in the source", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01, 0x02]);
    await writeFile(path.join(t.wiki, "pic.png"), png);
    await writeFile(path.join(t.wiki, "n.md"), "![图](pic.png)\n");
    const { url } = await readJson(await post(sharingApp(), { root: t.rootId, path: "n.md" }));
    const id = url.split("/s/")[1];
    const meta = await store.meta(id);
    expect(meta?.assets).toHaveLength(1);
    expect(meta?.assets[0]).toMatchObject({ source: "pic.png", contentType: "image/png" });
    // The frozen file is named by reference, never by the bare basename.
    expect(meta?.assets[0].name).not.toBe("pic.png");
    expect(meta?.assets[0].name).toMatch(/^[0-9a-f]{12}-pic\.png$/);
    expect(await readFile(path.join(t.wiki, "n.md"), "utf8")).toBe("![图](pic.png)\n");
  });

  it("shares a PDF and records its kind", async () => {
    await writeFile(path.join(t.wiki, "手册.pdf"), "%PDF-1.7\n");
    const { url } = await readJson(await post(sharingApp(), { root: t.rootId, path: "手册.pdf" }));
    expect(await store.meta(url.split("/s/")[1])).toMatchObject({ name: "手册.pdf", kind: "pdf" });
  });
});

describe("POST /api/shares — capturing the original", () => {
  it("snapshots the exact bytes the bounded reader returned", async () => {
    await writeFile(path.join(t.wiki, "n.md"), "on disk");
    const app = sharingApp(BASE, async () => Buffer.from("captured"));
    const { url } = await readJson(await post(app, { root: t.rootId, path: "n.md" }));
    expect((await store.read(url.split("/s/")[1]))!.toString()).toBe("captured");
  });

  it("answers 409 file_changed when the capture cannot be stabilised", async () => {
    await writeFile(path.join(t.wiki, "n.md"), "x");
    const app = sharingApp(BASE, async () => {
      throw Object.assign(new Error("changed"), { code: "CHANGED" });
    });
    const res = await post(app, { root: t.rootId, path: "n.md" });
    expect(res.status).toBe(409);
    expect(await readJson(res)).toEqual({ error: "file_changed" });
    // Nothing was published for a capture that never settled.
    const ids = (await (await import("node:fs/promises")).readdir(snapDir)).filter((n) => /^[0-9a-f]{64}$/.test(n));
    expect(ids).toEqual([]);
  });

  it("answers 413 when the file outgrew the limit during the capture", async () => {
    await writeFile(path.join(t.wiki, "n.md"), "x");
    const app = sharingApp(BASE, async () => {
      throw Object.assign(new Error("too_large"), { code: "TOO_LARGE" });
    });
    const res = await post(app, { root: t.rootId, path: "n.md" });
    expect(res.status).toBe(413);
    expect(await readJson(res)).toEqual({ error: "too_large" });
  });

  it("answers 404 for any other read failure, never a 500", async () => {
    await writeFile(path.join(t.wiki, "n.md"), "x");
    const app = sharingApp(BASE, async () => {
      throw new Error("no");
    });
    expect((await post(app, { root: t.rootId, path: "n.md" })).status).toBe(404);
  });
});
