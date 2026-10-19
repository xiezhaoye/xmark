// @vitest-environment node
import { describe, expect, it } from "vitest";
import { asDocPath, classifyHref, dirOf, headingSlug, resolveRelative } from "../paths";

describe("dirOf", () => {
  it.each([
    ["notes/a.md", "notes"],
    ["a.md", ""],
    ["deep/nested/a.md", "deep/nested"],
  ])("%s → %s", (path, expected) => {
    expect(dirOf(path)).toBe(expected);
  });
});

describe("resolveRelative", () => {
  it.each([
    ["docs/a.md", "b.md", "docs/b.md"],
    ["docs/a.md", "../b.md", "b.md"],
    ["docs/a.md", "./sub/b.md", "docs/sub/b.md"],
    ["docs/a.md", "/root.md", "root.md"],
    ["a.md", "%E6%96%87%E7%A8%BF/b.md", "文稿/b.md"],
    ["a.md", "b.md#section", "b.md"],
    ["a.md", "b.md?x=1", "b.md"],
  ])("%s + %s → %s", (from, href, expected) => {
    expect(resolveRelative(from, href)).toBe(expected);
  });

  it.each([
    ["a.md", "../../etc/passwd"],
    ["a.md", "#anchor"],
    ["a.md", "?only"],
    ["a.md", "%E0%A4%A"],
  ])("%s + %s is refused", (from, href) => {
    expect(resolveRelative(from, href)).toBeNull();
  });
});

describe("classifyHref", () => {
  it.each([
    ["https://example.com", "external"],
    ["mailto:a@b.c", "external"],
    ["#heading", "anchor"],
    ["other.md", "relative"],
    ["javascript:alert(1)", "blocked"],
    ["file:///etc/passwd", "blocked"],
  ])("%s → %s", (href, expected) => {
    expect(classifyHref(href)).toBe(expected);
  });
});

describe("asDocPath", () => {
  it("adds .md to an extensionless note link only", () => {
    expect(asDocPath("notes/other")).toBe("notes/other.md");
    expect(asDocPath("notes/other.md")).toBe("notes/other.md");
    expect(asDocPath("img/photo.png")).toBe("img/photo.png");
  });
});

describe("headingSlug", () => {
  it("matches GitHub's rule closely enough for our own headings", () => {
    expect(headingSlug("Hello, World!")).toBe("hello-world");
    expect(headingSlug("中文 标题")).toBe("中文-标题");
  });
});
