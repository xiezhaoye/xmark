/**
 * renderRemoteMarkdown — a remote file is untrusted input from another
 * machine, so the security properties matter more than the formatting ones:
 * raw HTML is never rendered, scripts never survive, and a link can only be a
 * scheme a click can act on.
 */
import { describe, expect, it } from "vitest";
import { renderRemoteMarkdown } from "../renderMarkdown";

const t = (key: string) => ({ note: "Note", tip: "Tip", important: "Important", warning: "Warning", caution: "Caution" })[key] ?? key;

const render = (md: string) => renderRemoteMarkdown(md, t);

describe("renderRemoteMarkdown", () => {
  it("renders the block structure", () => {
    expect(render("# Title")).toContain("<h1>Title</h1>");
    expect(render("- a\n- b")).toContain("<ul>");
    expect(render("1. a\n2. b")).toContain("<ol>");
    expect(render("> quote")).toContain("<blockquote>");
    expect(render("| a | b |\n|---|---|\n| 1 | 2 |")).toContain("<table>");
    expect(render("---")).toContain("<hr");
    expect(render("**bold** *it* ~~gone~~ `code`")).toContain("<strong>bold</strong>");
  });

  it("escapes code instead of interpreting it", () => {
    expect(render("```js\nconst a = 1 < 2;\n```")).toContain("const a = 1 &lt; 2;");
  });

  it("hides frontmatter", () => {
    expect(render("---\ntitle: secret\n---\n\nbody")).not.toContain("title: secret");
  });

  it("never renders raw HTML", () => {
    const html = render('<img src=x onerror="alert(1)">\n\n<script>alert(1)</script>');
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;img");
  });

  it("drops a link whose scheme is not actionable", () => {
    expect(render("[x](javascript:alert(1))")).toContain('href="#"');
  });

  it("keeps http(s), mailto, anchors and relative links", () => {
    expect(render("[x](https://example.com)")).toContain('href="https://example.com"');
    expect(render("[x](mailto:a@b.c)")).toContain('href="mailto:a@b.c"');
    expect(render("[x](#anchor)")).toContain('href="#anchor"');
    expect(render("[x](other.md)")).toContain('href="other.md"');
  });

  it("renders math with KaTeX, inline and display", () => {
    expect(render("inline $x^2$")).toContain("katex");
    expect(render("$$\na+b\n$$")).toContain("katex-display");
  });

  it("renders task list items as checkboxes", () => {
    const html = render("- [x] done\n- [ ] todo");
    expect(html).toContain("remote-task-done");
    expect(html).toContain('type="checkbox"');
  });

  it("titles a GFM alert in the caller's language", () => {
    const html = render("> [!WARNING]\n> careful");
    expect(html).toContain("remote-alert-warning");
    expect(html).toContain(">Warning<");
  });

  it("returns nothing for empty input", () => {
    expect(render("")).toBe("");
    expect(render("   \n\n")).toBe("");
  });

  it("renders CJK text unchanged", () => {
    expect(render("# 中文标题")).toContain("中文标题");
  });
});
