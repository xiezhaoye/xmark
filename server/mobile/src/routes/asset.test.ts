import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeFile } from "node:fs/promises";
import * as path from "node:path";
import { makeTestApp } from "../testFixtures.testUtils";

let t: Awaited<ReturnType<typeof makeTestApp>>;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
beforeEach(async () => {
  t = await makeTestApp();
  await writeFile(path.join(t.wiki, "图.png"), PNG);
  await writeFile(path.join(t.wiki, "v.svg"), "<svg/>");
  await writeFile(path.join(t.wiki, "n.md"), "x");
});
afterEach(() => t.cleanup());

const asset = (rel: string, headers?: Record<string, string>) =>
  t.get(`/api/asset?root=${t.rootId}&path=${encodeURIComponent(rel)}`, headers);

describe("GET /api/asset", () => {
  it("returns the bytes with the image content type and an ETag", async () => {
    const res = await asset("图.png");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await res.arrayBuffer())).toEqual(PNG);
    expect(res.headers.get("etag")).toMatch(/^"[^"]+"$/);
  });

  it("answers 304 when the ETag still matches", async () => {
    const etag = (await asset("图.png")).headers.get("etag")!;
    expect((await asset("图.png", { "If-None-Match": etag })).status).toBe(304);
  });

  it("sandboxes SVG with a restrictive CSP", async () => {
    const res = await asset("v.svg");
    expect(res.headers.get("content-type")).toBe("image/svg+xml");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
  });

  it("refuses non-images", async () => {
    expect((await asset("n.md")).status).toBe(415);
  });

  it("returns 404 for a missing image", async () => {
    expect((await asset("nope.png")).status).toBe(404);
  });
});
