import { beforeEach, describe, expect, it, vi } from "vitest";
import { prepareHtml, readingScale } from "./htmlPreview";

beforeEach(() => {
  globalThis.URL.createObjectURL = vi.fn(() => "blob:img");
  globalThis.URL.revokeObjectURL = vi.fn();
});

const ctx = (over: Partial<Parameters<typeof prepareHtml>[1]> = {}) => ({
  rootId: "r1",
  docRelPath: "site/index.html",
  asset: vi.fn(async () => new Blob(["x"])),
  fileText: vi.fn(async () => "body { color: red; }"),
  ...over,
});

const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");

describe("prepareHtml", () => {
  it("loads relative images through the client and keeps https ones", async () => {
    const c = ctx();
    const { srcdoc, release } = await prepareHtml('<img src="img/a.png"><img src="https://x.org/b.png"><img src="file:///etc/c">', c);
    const imgs = parse(srcdoc).querySelectorAll("img");
    expect(c.asset).toHaveBeenCalledWith("r1", "site/img/a.png");
    expect(imgs[0].getAttribute("src")).toBe("blob:img");
    expect(imgs[1].getAttribute("src")).toBe("https://x.org/b.png");
    expect(imgs[2].hasAttribute("src")).toBe(false);
    release();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:img");
  });

  it("inlines relative stylesheets and keeps https ones", async () => {
    const c = ctx();
    const { srcdoc } = await prepareHtml('<link rel="stylesheet" href="../css/s.css"><link rel="stylesheet" href="https://cdn.x/s.css"><p>hi</p>', c);
    const doc = parse(srcdoc);
    expect(c.fileText).toHaveBeenCalledWith("r1", "css/s.css");
    expect(doc.querySelector("style")?.textContent).toContain("color: red");
    expect(doc.querySelector('link[href="https://cdn.x/s.css"]')).not.toBeNull();
    expect(doc.querySelector('link[href="../css/s.css"]')).toBeNull();
  });

  it("drops a stylesheet that cannot be read or escapes the root", async () => {
    const c = ctx({ fileText: vi.fn(async () => Promise.reject(new Error("404"))) });
    const { srcdoc } = await prepareHtml('<link rel="stylesheet" href="gone.css"><link rel="stylesheet" href="../../../x.css">', c);
    expect(parse(srcdoc).querySelectorAll("link, style")).toHaveLength(0);
    expect(c.fileText).toHaveBeenCalledTimes(1);
  });

  it("removes scripts, base and inline handlers, and adds a phone viewport", async () => {
    const { srcdoc } = await prepareHtml('<base href="https://evil.x/"><script>alert(1)</script><p onclick="x()">t</p>', ctx());
    const doc = parse(srcdoc);
    expect(doc.querySelector("script, base")).toBeNull();
    expect(doc.querySelector("p")?.hasAttribute("onclick")).toBe(false);
    expect(doc.querySelector('meta[name="viewport"]')?.getAttribute("content")).toContain("width=device-width");
  });

  it("keeps an existing viewport and a full document's head", async () => {
    const { srcdoc } = await prepareHtml('<!doctype html><html><head><title>T</title><meta name="viewport" content="width=500"></head><body>b</body></html>', ctx());
    const doc = parse(srcdoc);
    expect(doc.title).toBe("T");
    expect(doc.querySelectorAll('meta[name="viewport"]')).toHaveLength(1);
    expect(srcdoc.startsWith("<!doctype html>")).toBe(true);
  });

  it("handles an empty file", async () => {
    const { srcdoc } = await prepareHtml("", ctx());
    expect(parse(srcdoc).body.textContent).toBe("");
  });
});

describe("readingScale", () => {
  it("scales against the 16px base, and not at all at 16", () => {
    expect(readingScale(16)).toBe(1);
    expect(readingScale(24)).toBe(1.5);
    expect(readingScale(12)).toBe(0.75);
    expect(readingScale(20)).toBe(1.25);
  });
});
