import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async (_id: string, src: string) => {
      if (src.includes("bad")) throw new Error("parse error");
      return { svg: '<svg data-ok="1"><script>x</script></svg>' };
    }),
  },
}));

import { enhanceDocument, revealText } from "./enhance";

let root: HTMLElement;
beforeEach(() => {
  root = document.createElement("div");
  document.body.appendChild(root);
  globalThis.URL.createObjectURL = vi.fn(() => "blob:fake");
  globalThis.URL.revokeObjectURL = vi.fn();
});
afterEach(() => root.remove());

const ctx = (asset = vi.fn(async () => new Blob(["x"]))) => ({ rootId: "r1", docRelPath: "notes/a.md", asset });

describe("enhanceDocument", () => {
  it("loads relative images through the client and keeps https ones", async () => {
    root.innerHTML = '<img src="img/p.png"><img src="https://example.com/x.png"><img src="file:///etc/x">';
    const asset = vi.fn(async () => new Blob(["x"]));
    const done = await enhanceDocument(root, ctx(asset));
    const imgs = root.querySelectorAll("img");
    expect(asset).toHaveBeenCalledWith("r1", "notes/img/p.png");
    expect(imgs[0].getAttribute("src")).toBe("blob:fake");
    expect(imgs[1].getAttribute("src")).toBe("https://example.com/x.png");
    expect(imgs[2].hasAttribute("src")).toBe(false);
    done();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:fake");
  });

  it("marks an image that fails to load", async () => {
    root.innerHTML = '<img src="missing.png">';
    await enhanceDocument(root, ctx(vi.fn(async () => Promise.reject(new Error("404")))));
    expect(root.querySelector("img")?.classList.contains("img-failed")).toBe(true);
  });

  it("highlights code blocks", async () => {
    root.innerHTML = '<pre><code class="language-ts">const a = 1;</code></pre>';
    await enhanceDocument(root, ctx());
    expect(root.querySelector("code")?.classList.contains("hljs")).toBe(true);
  });

  it("renders mermaid to sanitized SVG and shows the source when it fails", async () => {
    root.innerHTML = '<pre data-diagram="mermaid">flowchart LR\n A--&gt;B</pre><pre data-diagram="mermaid">bad</pre>';
    await enhanceDocument(root, ctx());
    expect(root.querySelector("svg")?.getAttribute("data-ok")).toBe("1");
    expect(root.querySelector("script")).toBeNull();
    expect(root.querySelector(".diagram-error")?.textContent).toContain("bad");
  });
});

describe("revealText", () => {
  it("marks and scrolls to the first case-insensitive match", () => {
    root.innerHTML = "<p>first</p><p>Find ME here</p><p>find me again</p>";
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    expect(revealText(root, "find me")).toBe(true);
    expect(root.querySelector("mark")?.textContent).toBe("Find ME");
    expect(scroll).toHaveBeenCalled();
  });

  it("returns false when nothing matches", () => {
    root.innerHTML = "<p>nothing</p>";
    expect(revealText(root, "zzz")).toBe(false);
  });
});
