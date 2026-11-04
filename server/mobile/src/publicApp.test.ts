import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { createPublicApp } from "./publicApp";
import { createShareStore } from "./shareStore";
import { makeTempDir } from "./testFixtures.testUtils";

let dir: string;
let cleanup: () => Promise<void>;
let store: Awaited<ReturnType<typeof createShareStore>>;

beforeEach(async () => {
  ({ dir, cleanup } = await makeTempDir());
  store = await createShareStore(path.join(dir, "shares"));
});
afterEach(() => cleanup());

const app = () => createPublicApp({ store });
const save = (bytes: Buffer | string, extra: Record<string, unknown> = {}) =>
  store.save({ bytes: Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes), name: "笔记.md", kind: "markdown", ...extra } as never);

describe("public app routes", () => {
  it("serves a reading page for a snapshot", async () => {
    const snap = await save("# 标题\n\n正文\n");
    const res = await app().request(`/s/${snap.id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("笔记.md");
    expect(html).toContain("<h1>标题</h1>");
    expect(html).toContain("Download original");
  });

  it("carries the security headers a public page needs", async () => {
    const snap = await save("x");
    const res = await app().request(`/s/${snap.id}`);
    const csp = res.headers.get("content-security-policy")!;
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("script-src");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("x-robots-tag")).toContain("noindex");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("downloads the original bytes as an attachment with the Unicode name", async () => {
    const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("原文\n")]);
    const snap = await save(bytes);
    const res = await app().request(`/s/${snap.id}/download`);
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer())).toEqual(bytes);
    expect(res.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(res.headers.get("content-disposition")).toContain("attachment;");
    expect(res.headers.get("content-disposition")).toContain("filename*=UTF-8''%E7%AC%94%E8%AE%B0.md");
  });

  it("serves a frozen image asset inline with a sandboxing CSP", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]);
    const snap = await store.save({
      bytes: Buffer.from("![a](a.png)"),
      name: "a.md",
      kind: "markdown",
      assets: [{ name: "a.png", source: "a.png", bytes: png, contentType: "image/png" }],
    });
    const res = await app().request(`/s/${snap.id}/assets/a.png`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(Buffer.from(await res.arrayBuffer())).toEqual(png);
    expect((await app().request(`/s/${snap.id}/assets/other.png`)).status).toBe(404);
  });

  it("renders assets in the page as same-origin relative URLs", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const snap = await store.save({
      bytes: Buffer.from("![图](pic.png)"),
      name: "a.md",
      kind: "markdown",
      assets: [{ name: "pic.png", source: "pic.png", bytes: png, contentType: "image/png" }],
    });
    const html = await (await app().request(`/s/${snap.id}`)).text();
    expect(html).toContain(`/s/${snap.id}/assets/pic.png`);
  });

  it("links a PDF's preview to the download and offers the browser preview", async () => {
    const snap = await store.save({ bytes: Buffer.from("%PDF-1.7\n"), name: "手册.pdf", kind: "pdf" });
    const html = await (await app().request(`/s/${snap.id}`)).text();
    expect(html).toContain(`/s/${snap.id}/download`);
    expect(html).toContain(`/s/${snap.id}/preview`);
    expect(html).toContain("手册.pdf");
  });

  it("escapes text files into a pre/code block", async () => {
    const snap = await store.save({
      bytes: Buffer.from("<script>alert(1)</script>"),
      name: "a.html",
      kind: "text",
    });
    const html = await (await app().request(`/s/${snap.id}`)).text();
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
  });

  it("strips active markup from markdown", async () => {
    const snap = await save("# 标题\n\n<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n");
    const html = await (await app().request(`/s/${snap.id}`)).text();
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror");
  });

  it("escapes a hostile filename in the page and the download header", async () => {
    const snap = await store.save({ bytes: Buffer.from("x"), name: '<img src=x onerror="alert(1)">.md', kind: "markdown" });
    const page = await (await app().request(`/s/${snap.id}`)).text();
    expect(page).not.toContain("<img src=x");
    const dl = await app().request(`/s/${snap.id}/download`);
    expect(dl.headers.get("content-disposition")).not.toContain("\n");
  });

  it("404s an unknown or malformed id", async () => {
    for (const id of ["0".repeat(64), "abc", "../../etc/passwd"]) {
      expect((await app().request(`/s/${id}`)).status).toBe(404);
      expect((await app().request(`/s/${id}/download`)).status).toBe(404);
      expect((await app().request(`/s/${id}/preview`)).status).toBe(404);
    }
  });

  it("registers no /api routes at all", async () => {
    const snap = await save("x");
    for (const url of ["/api/health", "/api/workspaces", `/api/download?root=x&path=y`, "/api/shares"]) {
      const res = await app().request(url, { method: url === "/api/shares" ? "POST" : "GET" });
      expect(res.status).toBe(404);
    }
    expect((await app().request(`/s/${snap.id}`)).status).toBe(200);
  });

  it("carries no token and no workspace path, only the snapshot id", async () => {
    const snap = await save("x");
    const html = await (await app().request(`/s/${snap.id}`)).text();
    expect(html).toContain(snap.id);
    expect(html).not.toMatch(/token/i);
    expect(html).not.toContain(dir);
  });

  it("points the site root at a friendly page that reveals nothing", async () => {
    const res = await app().request("/");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("XMark");
    expect(html).not.toContain("/Users/");
  });

  it("ignores a hostile Host header when building absolute links", async () => {
    const snap = await save("x");
    const res = await app().request(`/s/${snap.id}`, { headers: { Host: "evil.example.com" } });
    const html = await res.text();
    expect(html).not.toContain("evil.example.com");
  });
});

describe("public app snapshot stability", () => {
  it("keeps serving the snapshot after the workspace file is edited and deleted", async () => {
    const ws = path.join(dir, "ws");
    await mkdir(ws, { recursive: true });
    const src = path.join(ws, "n.md");
    await writeFile(src, "原始");
    const snap = await store.save({ bytes: Buffer.from("原始"), name: "n.md", kind: "markdown" });
    await writeFile(src, "改过");
    await (await import("node:fs/promises")).rm(src);
    const html = await (await app().request(`/s/${snap.id}`)).text();
    expect(html).toContain("原始");
    expect(html).not.toContain("改过");
  });
});

describe("GET /s/:id/preview", () => {
  it("serves a PDF inline, so a browser can render it, with framing allowed from this origin", async () => {
    const bytes = Buffer.from("%PDF-1.7\nbody\n");
    const snap = await store.save({ bytes, name: "手册.pdf", kind: "pdf" });
    const res = await app().request(`/s/${snap.id}/preview`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toMatch(/^inline;/);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    // An embedded object is framed by the page, so this route must allow it.
    expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'self'");
    expect(Buffer.from(await res.arrayBuffer())).toEqual(bytes);
  });

  it("serves an image inline with its image type", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01]);
    const snap = await store.save({ bytes: png, name: "图.png", kind: "image" });
    const res = await app().request(`/s/${snap.id}/preview`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("content-disposition")).toMatch(/^inline;/);
    expect(Buffer.from(await res.arrayBuffer())).toEqual(png);
  });

  it("keeps Download original an attachment even though the preview is inline", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x02]);
    const snap = await store.save({ bytes: png, name: "图.png", kind: "image" });
    const res = await app().request(`/s/${snap.id}/download`);
    expect(res.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });

  it("renders an HTML file inside a scriptless sandbox with its own CSP", async () => {
    const html = Buffer.from("<!doctype html><html><body><script>alert(1)</script><style>p{color:red}</style><p>hi</p></body></html>");
    const snap = await store.save({ bytes: html, name: "page.html", kind: "html" });
    const res = await app().request(`/s/${snap.id}/preview`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("content-disposition")).toMatch(/^inline;/);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    const csp = res.headers.get("content-security-policy")!;
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("style-src 'unsafe-inline'");
    expect(csp).toContain("img-src 'self' data:");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).toContain("script-src 'none'");
    expect(csp).toContain("form-action 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("sandbox");
    expect(await res.text()).toContain("<p>hi</p>");
  });

  it("keeps the HTML original downloadable byte for byte", async () => {
    const html = Buffer.from("<!doctype html><script>alert(1)</script>\n");
    const snap = await store.save({ bytes: html, name: "page.html", kind: "html" });
    const res = await app().request(`/s/${snap.id}/download`);
    expect(res.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(Buffer.from(await res.arrayBuffer())).toEqual(html);
  });

  it("frames an HTML preview from the reading page, scriptless", async () => {
    const snap = await store.save({ bytes: Buffer.from("<p>x</p>"), name: "page.html", kind: "html" });
    const page = await (await app().request(`/s/${snap.id}`)).text();
    expect(page).toContain(`<iframe class="html-preview" src="/s/${snap.id}/preview"`);
    expect(page).toMatch(/sandbox=""/);
    expect(page).not.toContain("<p>x</p>");
  });

  it("never renders HTML as live markup on a text-page route", async () => {
    const snap = await store.save({ bytes: Buffer.from("<script>alert(1)</script>"), name: "a.html", kind: "html" });
    const page = await (await app().request(`/s/${snap.id}`)).text();
    expect(page).not.toContain("<script>alert(1)</script>");
  });
});
