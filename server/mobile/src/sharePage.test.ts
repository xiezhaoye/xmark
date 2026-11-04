import { describe, expect, it } from "vitest";
import { formatSize, langFromHeader, renderMissingPage, renderRootPage, renderSharePage, strings } from "./sharePage";

describe("langFromHeader", () => {
  it.each([
    ["zh-CN,zh;q=0.9,en;q=0.8", "zh"],
    ["zh", "zh"],
    ["en-US,en;q=0.9", "en"],
    ["fr", "en"],
    [undefined, "en"],
    ["", "en"],
  ])("%j → %s", (header, lang) => {
    expect(langFromHeader(header)).toBe(lang);
  });
});

describe("formatSize", () => {
  it.each([
    [512, "en", "512 bytes"],
    [512, "zh", "512 字节"],
    [2048, "en", "2.0 KB"],
    [15 * 1024, "en", "15 KB"],
    [3 * 1024 * 1024, "zh", "3.0 MB"],
    [5 * 1024 * 1024 * 1024, "en", "5.0 GB"],
  ])("%d %s → %s", (bytes, lang, shown) => {
    expect(formatSize(bytes, lang as "en" | "zh")).toBe(shown);
  });
});

describe("strings", () => {
  it("has a download label and a preview note in both languages", () => {
    for (const lang of ["en", "zh"] as const) {
      expect(strings(lang).download.length).toBeGreaterThan(0);
      expect(strings(lang).previewUnavailable.length).toBeGreaterThan(0);
    }
  });

  it("has an HTML-preview note in both languages", () => {
    for (const lang of ["en", "zh"] as const) {
      expect(strings(lang).previewHtml.length).toBeGreaterThan(0);
      expect(strings(lang).previewUnavailable.length).toBeGreaterThan(0);
    }
  });
});

describe("renderSharePage", () => {
  const base = { id: "a".repeat(64), size: 12, bodyHtml: "<p>x</p>" };
  const preview = `/s/${base.id}/preview`;
  const download = `/s/${base.id}/download`;

  it("embeds a small PDF from the preview route and keeps the download link", () => {
    const html = renderSharePage({ ...base, lang: "en", title: "手册.pdf", kind: "pdf", embedPdf: true });
    expect(html).toContain(`<object class="pdf" data="${preview}"`);
    // The Download original action still points at the attachment route.
    expect(html).toContain(`class="download" href="${download}"`);
  });

  it("offers only the download for a large PDF", () => {
    const html = renderSharePage({ ...base, lang: "en", title: "big.pdf", kind: "pdf", embedPdf: false });
    expect(html).not.toContain("<object");
    expect(html).not.toContain(preview);
    expect(html).toContain("Download original");
    expect(html).toContain("cannot be previewed");
  });

  it("shows an image through the preview route, not the attachment route", () => {
    const html = renderSharePage({ ...base, lang: "en", title: "a.png", kind: "image" });
    expect(html).toContain(`<img src="${preview}"`);
    expect(html).toContain(`class="download" href="${download}"`);
  });

  it("shows an HTML file in a scriptless sandboxed iframe with a link to open it", () => {
    const html = renderSharePage({ ...base, lang: "en", title: "page.html", kind: "html", bodyHtml: "" });
    expect(html).toContain(`<iframe class="html-preview" src="${preview}"`);
    expect(html).toContain('sandbox=""');
    expect(html).toContain(`href="${preview}"`);
    expect(html).toContain(`class="download" href="${download}"`);
    // No inline copy of the document: only the framed preview route serves it.
    expect(html).not.toContain("&lt;script&gt;");
  });

  it("escapes the title everywhere it appears", () => {
    const html = renderSharePage({ ...base, lang: "en", title: '<b>x</b>', kind: "markdown" });
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).not.toContain("<b>x</b>");
  });

  it("declares noindex, no-referrer and the reader's language", () => {
    const zh = renderSharePage({ ...base, lang: "zh", title: "笔记.md", kind: "markdown" });
    expect(zh).toContain('<html lang="zh-CN">');
    expect(zh).toContain("noindex");
    expect(zh).toContain('name="referrer" content="no-referrer"');
    expect(zh).toContain("下载原文件");
    expect(zh).not.toContain("<script");
  });

  it("ships no script tag; a body attribute would be blocked by the CSP as well", () => {
    const html = renderSharePage({ ...base, lang: "en", title: "a.md", kind: "markdown", bodyHtml: "<p onclick=x>y</p>" });
    expect(html).not.toMatch(/<script/i);
    // The meta the browser enforces matches the CSP header the route sends.
    expect(html).toContain('http-equiv="Content-Security-Policy"');
  });
});

describe("renderRootPage and renderMissingPage", () => {
  it("reveal no listing", () => {
    expect(renderRootPage("en")).not.toContain("/s/");
    expect(renderMissingPage("zh")).toContain("链接不存在");
  });
});
