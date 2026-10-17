// @vitest-environment node
import { describe, expect, it } from "vitest";
import { asDocPath, classifyHref, dirOf, resolveRelative } from "./paths";

describe("dirOf", () => {
  it.each([
    ["a.md", ""],
    ["x/y/a.md", "x/y"],
  ])("%s → %j", (p, d) => expect(dirOf(p)).toBe(d));
});

describe("resolveRelative", () => {
  it.each([
    ["notes/a.md", "b.md", "notes/b.md"],
    ["notes/a.md", "./img/p.png", "notes/img/p.png"],
    ["notes/a.md", "../top.md", "top.md"],
    ["notes/a.md", "/abs.md", "abs.md"],
    ["a.md", "%E4%B8%AD%E6%96%87.md", "中文.md"],
    ["a.md", "b.md#section", "b.md"],
    ["a.md", "b.md?x=1", "b.md"],
    ["a.md", "my%20file.md", "my file.md"],
  ])("%s + %s → %s", (from, href, to) => {
    expect(resolveRelative(from, href)).toBe(to);
  });

  it.each([["a.md", "../out.md"], ["x/a.md", "../../out.md"], ["a.md", "%E4%zz"], ["a.md", ""]])(
    "%s + %s → null",
    (from, href) => {
      expect(resolveRelative(from, href)).toBeNull();
    },
  );
});

describe("classifyHref", () => {
  it.each([
    ["https://example.com", "external"],
    ["http://x.y", "external"],
    ["mailto:a@b.c", "external"],
    ["#heading", "anchor"],
    ["other.md", "relative"],
    ["javascript:alert(1)", "blocked"],
    ["data:text/html,x", "blocked"],
    ["file:///etc/passwd", "blocked"],
  ])("%s → %s", (href, kind) => {
    expect(classifyHref(href)).toBe(kind);
  });
});

describe("asDocPath", () => {
  it.each([
    ["notes/other", "notes/other.md"],
    ["a.md", "a.md"],
    ["img/p.png", "img/p.png"],
    ["v1.2/readme", "v1.2/readme.md"],
  ])("%s → %s", (input, out) => expect(asDocPath(input)).toBe(out));
});
