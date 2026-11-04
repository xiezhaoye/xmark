import { describe, expect, it } from "vitest";
import {
  classifyFile,
  contentDisposition,
  contentTypeFor,
  imageContentType,
  isPreviewable,
  previewContentTypeFor,
} from "./fileKinds";

describe("classifyFile", () => {
  it.each([
    ["note.md", "markdown"],
    ["NOTE.MARKDOWN", "markdown"],
    ["deck.mdx", "markdown"],
    ["data.json", "text"],
    ["ci.yml", "text"],
    ["diagram.mmd", "text"],
    ["main.rs", "text"],
    ["photo.JPG", "image"],
    ["icon.svg", "image"],
    ["doc.pdf", "pdf"],
    ["SCAN.PDF", "pdf"],
    ["clip.mp4", null],
    ["song.mp3", null],
    ["archive.zip", null],
    ["Makefile", null],
    [".md", null],
  ])("%s → %s", (name, kind) => {
    expect(classifyFile(name)).toBe(kind);
  });
});

describe("imageContentType", () => {
  it.each([
    ["a.png", "image/png"],
    ["a.jpeg", "image/jpeg"],
    ["a.svg", "image/svg+xml"],
    ["a.heic", "image/heic"],
    ["a.txt", null],
  ])("%s → %s", (name, type) => {
    expect(imageContentType(name)).toBe(type);
  });
});

describe("classifyFile pdf", () => {
  it("lists a PDF as the pdf kind", () => {
    expect(classifyFile("手册.pdf")).toBe("pdf");
  });
});

describe("contentTypeFor", () => {
  it.each([
    ["a.md", "text/markdown; charset=utf-8"],
    ["a.txt", "text/plain; charset=utf-8"],
    ["a.json", "text/plain; charset=utf-8"],
    ["a.html", "text/plain; charset=utf-8"],
    ["a.png", "image/png"],
    ["a.svg", "image/svg+xml"],
    ["a.pdf", "application/pdf"],
    ["a.zip", null],
    ["a.mp4", null],
  ])("%s → %s", (name, type) => {
    expect(contentTypeFor(name)).toBe(type);
  });
});

describe("isPreviewable", () => {
  it.each([
    ["a.md", true],
    ["a.txt", true],
    ["a.pdf", true],
    ["a.png", true],
    ["a.zip", false],
  ])("%s → %s", (name, ok) => {
    expect(isPreviewable(name)).toBe(ok);
  });
});

describe("contentDisposition", () => {
  it("keeps a plain ASCII name and quotes it", () => {
    expect(contentDisposition("note.md")).toBe('attachment; filename="note.md"; filename*=UTF-8\'\'note.md');
  });

  it("emits an RFC 5987 UTF-8 filename* for a Chinese name, with an ASCII fallback", () => {
    const value = contentDisposition("中文 笔记.md");
    expect(value).toContain("filename*=UTF-8''%E4%B8%AD%E6%96%87%20%E7%AC%94%E8%AE%B0.md");
    const fallback = /filename="([^"]*)"/.exec(value)![1];
    expect(fallback).toMatch(/^[\x20-\x7e]*$/);
    expect(fallback).toContain(".md");
  });

  it("strips a path and control characters from the fallback", () => {
    const value = contentDisposition('a/b\\c"d\r\ne.md');
    expect(value).not.toMatch(/[\r\n]/);
    expect(/filename="([^"]*)"/.exec(value)![1]).not.toContain("\\");
  });

  it("uses inline disposition when asked", () => {
    expect(contentDisposition("a.png", "inline")).toMatch(/^inline; /);
  });
});

describe("classifyFile html", () => {
  it.each([
    ["page.html", "html"],
    ["PAGE.HTM", "html"],
    ["no-ext", null],
  ])("%s → %s", (name, kind) => {
    expect(classifyFile(name)).toBe(kind);
  });
});

describe("previewContentTypeFor", () => {
  it.each([
    ["a.html", "text/html; charset=utf-8"],
    ["a.htm", "text/html; charset=utf-8"],
    ["a.pdf", "application/pdf"],
    ["a.png", "image/png"],
    ["a.md", "text/markdown; charset=utf-8"],
    ["a.zip", null],
  ])("%s → %s", (name, type) => {
    expect(previewContentTypeFor(name)).toBe(type);
  });

  it("keeps the download type of an HTML file inert", () => {
    // The live text/html type exists on the sandboxed preview route only.
    expect(contentTypeFor("a.html")).toBe("text/plain; charset=utf-8");
  });
});
