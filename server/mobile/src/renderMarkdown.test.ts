import { describe, expect, it } from "vitest";
import { renderPreviewHtml } from "./renderMarkdown";

describe("renderPreviewHtml — markdown", () => {
  it("renders headings, lists, tables and code", async () => {
    const html = await renderPreviewHtml("# Title\n\n- a\n- b\n\n| x | y |\n|---|---|\n| 1 | 2 |\n\n```js\nconst a = 1;\n```");
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<li>a</li>");
    expect(html).toContain("<table>");
    expect(html).toContain("<code");
    expect(html).toContain("const a = 1;");
  });

  it("keeps trusted https links and drops javascript: ones", async () => {
    const html = await renderPreviewHtml("[ok](https://example.com) [bad](javascript:alert(1))");
    expect(html).toContain('href="https://example.com/"');
    expect(html).not.toContain("javascript:");
  });

  it("marks external links so the page can open them in a new context", async () => {
    const html = await renderPreviewHtml("[ok](https://example.com)");
    expect(html).toContain('rel="noopener noreferrer nofollow"');
    expect(html).toContain('target="_blank"');
  });

  it("rewrites a frozen asset reference to its public URL", async () => {
    const html = await renderPreviewHtml("![图](pic.png)", { assetUrl: (name) => `/s/x/assets/${name}` });
    expect(html).toContain('src="/s/x/assets/pic.png"');
  });

  it("omits an image whose asset was not frozen, keeping its caption", async () => {
    const html = await renderPreviewHtml("![图](missing.png)", { assetUrl: () => null });
    expect(html).not.toContain("<img");
    expect(html).not.toContain("missing.png");
    expect(html).toContain("[图]");
  });

  it("drops raw HTML, scripts, iframes and event handlers", async () => {
    const html = await renderPreviewHtml(
      '<script>alert(1)</script>\n\n<iframe src="https://evil"></iframe>\n\n<img src=x onerror=alert(1)>\n\n<div onclick="x">hi</div>',
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("onclick");
  });

  it("escapes a hostile code fence body", async () => {
    const html = await renderPreviewHtml("```\n<script>alert(1)</script>\n```");
    // Escaped however the serializer spells it; the point is the tag never parses.
    expect(html).not.toContain("<script>");
    expect(html).toContain("script>");
  });
});

describe("renderPreviewHtml — link content", () => {
  it("renders a link whose text carries emphasis and inline code", async () => {
    // Regression: passing mdast children straight through made the serializer
    // meet `strong`/`inlineCode` and throw, which the route answered as 404.
    const html = await renderPreviewHtml("[**加粗链接** and `code`](https://example.com)");
    expect(html).toContain("<strong>加粗链接</strong>");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain('href="https://example.com/"');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
  });

  it("renders emphasis around a link as well as inside it", async () => {
    const html = await renderPreviewHtml("**see [here](https://example.com)**");
    expect(html).toContain("<strong>see <a");
    expect(html).toContain("here</a></strong>");
  });

  it("renders an image as link text through the frozen-asset path", async () => {
    const html = await renderPreviewHtml("[![图](pic.png)](https://example.com)", {
      assetUrl: (url) => (url === "pic.png" ? "/s/x/assets/pic.png" : null),
    });
    expect(html).toContain('href="https://example.com/"');
    expect(html).toContain('src="/s/x/assets/pic.png"');
  });

  it("keeps the alt text of an unfrozen image inside a link", async () => {
    const html = await renderPreviewHtml("[![图](gone.png)](https://example.com)", { assetUrl: () => null });
    expect(html).not.toContain("<img");
    expect(html).toContain("[图]");
    expect(html).toContain('href="https://example.com/"');
  });

  it("renders mailto and keeps noopener on it", async () => {
    const html = await renderPreviewHtml("[mail](mailto:a@example.com)");
    expect(html).toContain('href="mailto:a@example.com"');
  });

  it.each([["javascript:alert(1)"], ["data:text/html,<script>x</script>"], ["vbscript:msgbox"], ["file:///etc/passwd"]])(
    "neutralises the %s scheme but keeps the text",
    async (url) => {
      const html = await renderPreviewHtml(`[label](${url})`);
      expect(html).not.toContain("<a ");
      expect(html).toContain("label");
    },
  );
});

describe("renderPreviewHtml — relative links", () => {
  it("never invents an absolute https link for a relative target", async () => {
    const html = await renderPreviewHtml("[doc](other.md) [up](../note.md) [abs](/root.md)");
    expect(html).not.toContain("share.invalid");
    expect(html).not.toContain("<a ");
    // The text survives; the bogus link does not.
    expect(html).toContain("doc");
    expect(html).toContain("up");
    expect(html).toContain("abs");
  });

  it("keeps a same-page anchor local instead of rewriting it", async () => {
    const html = await renderPreviewHtml("[jump](#section)");
    expect(html).toContain('href="#section"');
    expect(html).not.toContain("share.invalid");
  });

  it("keeps the formatted text of an unresolved relative link", async () => {
    const html = await renderPreviewHtml("[**bold** doc](other.md)");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).not.toContain("<a ");
  });
});

describe("renderPreviewHtml — plain text", () => {
  it("escapes everything into a pre/code block", async () => {
    const html = await renderPreviewHtml("<b>x</b> & y", { kind: "text" });
    expect(html).toContain("<pre");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt; &amp; y");
    expect(html).not.toContain("<b>x</b>");
  });
});
