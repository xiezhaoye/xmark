/**
 * What happens to the rendered HTML after it is in the page.
 *
 * - Relative images are fetched through the authenticated client and shown
 *   as blob URLs (an `<img>` cannot send the token); https images are kept;
 *   anything else is dropped. The returned disposer revokes the blob URLs.
 * - Code blocks are highlighted; Mermaid blocks are rendered (loaded lazily,
 *   it is the heaviest dependency) and their SVG sanitized; a diagram that
 *   fails to parse shows its source instead.
 *
 * @module render/enhance
 */
import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/common";
import { classifyHref, resolveRelative } from "./paths";

export interface EnhanceContext {
  rootId: string;
  docRelPath: string;
  asset: (rootId: string, relPath: string) => Promise<Blob>;
}

/** Point every `<img>` under `root` at a blob URL fetched with the token (also used for HTML previews). */
export async function loadImages(root: ParentNode, ctx: EnhanceContext, urls: string[]): Promise<void> {
  const jobs = [...root.querySelectorAll("img")].map(async (img) => {
    const src = img.getAttribute("src") ?? "";
    img.setAttribute("loading", "lazy");
    const kind = classifyHref(src);
    if (kind === "external" && /^https:/i.test(src)) return;
    img.removeAttribute("src");
    const rel = kind === "relative" ? resolveRelative(ctx.docRelPath, src) : null;
    if (!rel) {
      img.classList.add("img-failed");
      return;
    }
    try {
      const url = URL.createObjectURL(await ctx.asset(ctx.rootId, rel));
      urls.push(url);
      img.setAttribute("src", url);
    } catch {
      img.classList.add("img-failed");
    }
  });
  await Promise.all(jobs);
}

function highlightCode(root: HTMLElement): void {
  for (const code of root.querySelectorAll<HTMLElement>("pre > code")) {
    const lang = /language-([\w+#-]+)/.exec(code.className)?.[1];
    if (lang && !hljs.getLanguage(lang)) continue;
    hljs.highlightElement(code);
  }
}

let mermaidSeq = 0;

async function renderDiagrams(root: HTMLElement): Promise<void> {
  const blocks = [...root.querySelectorAll<HTMLElement>('pre[data-diagram="mermaid"]')];
  if (!blocks.length) return;
  const { default: mermaid } = await import("mermaid");
  const dark = typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
  mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: dark ? "dark" : "default" });
  for (const pre of blocks) {
    const source = pre.textContent ?? "";
    const box = document.createElement("div");
    try {
      const { svg } = await mermaid.render(`mmd-${++mermaidSeq}`, source);
      box.className = "diagram";
      box.innerHTML = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true }, ADD_TAGS: ["foreignObject"] });
    } catch {
      box.className = "diagram-error";
      const code = document.createElement("pre");
      code.textContent = source;
      box.appendChild(code);
    }
    pre.replaceWith(box);
  }
}

/** Enhance in place; the returned function releases blob URLs. */
export async function enhanceDocument(root: HTMLElement, ctx: EnhanceContext): Promise<() => void> {
  const urls: string[] = [];
  highlightCode(root);
  await Promise.all([loadImages(root, ctx, urls), renderDiagrams(root)]);
  return () => urls.forEach((u) => URL.revokeObjectURL(u));
}

/** Wrap the first match of `query` in <mark> and scroll to it. */
export function revealText(root: HTMLElement, query: string): boolean {
  const needle = query.toLowerCase();
  if (!needle) return false;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue ?? "";
    const at = text.toLowerCase().indexOf(needle);
    if (at === -1) continue;
    const range = document.createRange();
    range.setStart(node, at);
    range.setEnd(node, at + needle.length);
    const mark = document.createElement("mark");
    range.surroundContents(mark);
    mark.scrollIntoView?.({ block: "center" });
    return true;
  }
  return false;
}
