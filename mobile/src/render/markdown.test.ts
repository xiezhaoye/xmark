import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./markdown";

const html = (md: string) => renderMarkdown(md);

describe("renderMarkdown", () => {
  it("renders GFM tables, task lists and strikethrough", () => {
    const out = html("| a | b |\n|---|---|\n| 中文 | x |\n\n- [x] done\n\n~~gone~~");
    expect(out).toContain("<table>");
    expect(out).toContain("中文");
    expect(out).toMatch(/<input[^>]*checked/);
    expect(out).toContain("<del>gone</del>");
  });

  it("renders inline and display math with KaTeX", () => {
    const out = html("$E=mc^2$\n\n$$\\int_0^1 x\\,dx$$");
    expect(out.match(/class="katex"/g)?.length).toBe(2);
  });

  it("hides YAML frontmatter", () => {
    expect(html("---\ntitle: Secret\n---\n# Body")).not.toContain("Secret");
  });

  it("turns mermaid fences into diagram placeholders and keeps other code", () => {
    const out = html("```mermaid\nflowchart LR\n  A --> B\n```\n\n```ts\nconst a = 1;\n```");
    expect(out).toContain('data-diagram="mermaid"');
    expect(out).toContain('class="language-ts"');
  });

  it("renders GitHub alerts with a localized title", () => {
    const out = renderMarkdown("> [!WARNING]\n> careful", { alertTitles: { warning: "警告" } });
    expect(out).toContain("markdown-alert-warning");
    expect(out).toContain("警告");
    expect(out).toContain("careful");
  });

  it("strips scripts, event handlers and javascript: links", () => {
    const out = html('<script>alert(1)</script>\n\n<img src="x.png" onerror="alert(2)">\n\n[x](javascript:alert(3))');
    expect(out).not.toContain("<script");
    expect(out).not.toContain("onerror");
    expect(out).not.toContain("javascript:");
  });

  it("keeps relative image and link targets for the view to resolve", () => {
    const out = html("![p](img/中文.png)\n\n[next](other.md)");
    expect(out).toContain('src="img/%E4%B8%AD%E6%96%87.png"');
    expect(out).toContain('href="other.md"');
  });

  it("renders empty input as empty output", () => {
    expect(html("")).toBe("");
  });
});
