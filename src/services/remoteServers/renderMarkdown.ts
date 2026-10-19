/**
 * Markdown → sanitized HTML for the remote reader.
 *
 * Purpose: show a document fetched from another Mac without the editor's
 * ProseMirror stack (the document is not open here — it is a preview). The
 * pipeline is the one the project already ships a parser for: `unified` +
 * `remark-parse` + `remark-gfm` + `remark-math` + `remark-frontmatter`, and
 * KaTeX. No new dependency: the mdast → HTML walk below is a hundred lines,
 * where `remark-rehype` + `rehype-stringify` + `rehype-katex` would be three
 * more packages. `@@INLINE_MATH@@` placeholders are filled in with KaTeX's own
 * markup after the string is built, so the walk stays a pure tree transform.
 *
 * What is deliberately NOT parsed: raw HTML (escaped, not rendered) and
 * wikilinks. A remote document is untrusted input from another machine, and
 * the desktop editor's raw-HTML handling is the choice of an editor that
 * trusts what it opened. The escape-everything default is the safe half of a
 * read-only preview.
 *
 * Output is sanitized with DOMPurify before it reaches the DOM, with the
 * classes this file itself emits allow-listed.
 *
 * @coordinates-with components/RemoteBrowser/RemoteMarkdown.tsx — the renderer
 * @module services/remoteServers/renderMarkdown
 */

import DOMPurify from "dompurify";
import katex from "katex";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified } from "unified";

interface MdastNode {
  type: string;
  children?: MdastNode[];
  value?: string;
  depth?: number;
  ordered?: boolean;
  start?: number | null;
  lang?: string | null;
  url?: string;
  title?: string | null;
  alt?: string | null;
  checked?: boolean | null;
  identifier?: string;
  label?: string;
  data?: { hName?: string; hProperties?: Record<string, unknown> };
}

/** Escape text and attribute values — raw HTML in the source is never trusted. */
const esc = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const attr = (value: string): string => esc(value).replace(/"/g, "&quot;");

const ALERT_KINDS = new Set(["note", "tip", "important", "warning", "caution"]);
const ALERT_RE = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/;

const SAFE_URL = /^(?:https?:|mailto:|tel:|#)/i;

/** A URL the preview may point at; relative paths are resolved by the view. */
const safeUrl = (url: string): string => (SAFE_URL.test(url) || !/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : "#");

function children(nodes: MdastNode[] | undefined, ctx: Ctx): string {
  return (nodes ?? []).map((n) => one(n, ctx)).join("");
}

interface Ctx {
  /** Collects inline-math HTML, keyed by placeholder id. */
  math: Map<string, string>;
}

function katexHtml(tex: string, displayMode: boolean): string | null {
  try {
    return katex.renderToString(tex, { displayMode, throwOnError: false, strict: false });
  } catch {
    return null;
  }
}

function mathPlaceholder(tex: string, displayMode: boolean, ctx: Ctx): string {
  const html = katexHtml(tex, displayMode);
  if (html === null) return esc(tex);
  const id = `M${ctx.math.size}`;
  ctx.math.set(id, html);
  return displayMode ? `<div class="remote-math">@@${id}@@</div>` : `<span class="remote-math">@@${id}@@</span>`;
}

/** A GFM alert (`> [!NOTE]`), whose first paragraph starts with the marker. */
function alert(node: MdastNode, ctx: Ctx): string | null {
  const first = node.children?.[0];
  if (!first || first.type !== "paragraph") return null;
  const lead = first.children?.[0];
  if (!lead || lead.type !== "text") return null;
  const match = ALERT_RE.exec(lead.value ?? "");
  if (!match) return null;
  const kind = match[1].toLowerCase();
  if (!ALERT_KINDS.has(kind)) return null;
  const rest: MdastNode = { type: "text", value: (lead.value ?? "").replace(ALERT_RE, "") };
  const paragraph: MdastNode = {
    type: "paragraph",
    children: [rest, ...((first.children ?? []).slice(1) as MdastNode[])],
  };
  const paragraphs: MdastNode[] = [paragraph, ...((node.children ?? []).slice(1) as MdastNode[])];
  const body = children(paragraphs, ctx);
  return `<div class="remote-alert remote-alert-${kind}">${body}</div>`;
}

function one(node: MdastNode, ctx: Ctx): string {
  switch (node.type) {
    case "root":
    case "blockquote":
      if (node.type === "blockquote") {
        const al = alert(node, ctx);
        if (al !== null) return al;
      }
      return node.type === "root" ? children(node.children, ctx) : `<blockquote>${children(node.children, ctx)}</blockquote>`;
    case "heading":
      return `<h${node.depth ?? 1}>${children(node.children, ctx)}</h${node.depth ?? 1}>`;
    case "paragraph":
      return `<p>${children(node.children, ctx)}</p>`;
    case "text":
      return esc(node.value ?? "");
    case "html":
      // Raw HTML is never executed or rendered: a remote file is untrusted.
      return `<pre class="remote-raw-html">${esc(node.value ?? "")}</pre>`;
    case "strong":
      return `<strong>${children(node.children, ctx)}</strong>`;
    case "emphasis":
      return `<em>${children(node.children, ctx)}</em>`;
    case "delete":
      return `<del>${children(node.children, ctx)}</del>`;
    case "inlineCode":
      return `<code>${esc(node.value ?? "")}</code>`;
    case "break":
      return "<br />";
    case "thematicBreak":
      return "<hr />";
    case "link": {
      const href = safeUrl(node.url ?? "");
      const title = node.title ? ` title="${attr(node.title)}"` : "";
      return `<a href="${attr(href)}"${title}>${children(node.children, ctx)}</a>`;
    }
    case "image": {
      const src = safeUrl(node.url ?? "");
      return `<img src="${attr(src)}" alt="${attr(node.alt ?? "")}" loading="lazy" />`;
    }
    case "list": {
      const tag = node.ordered ? "ol" : "ul";
      const start = node.ordered && node.start && node.start !== 1 ? ` start="${node.start}"` : "";
      const cls = (node.children ?? []).some(isTaskItem)
        ? ' class="remote-task-list"'
        : "";
      return `<${tag}${start}${cls}>${children(node.children, ctx)}</${tag}>`;
    }
    case "listItem": {
      if (!isTaskItem(node)) return `<li>${children(node.children, ctx)}</li>`;
      const box = `<input type="checkbox" disabled${node.checked ? " checked" : ""} /> `;
      return `<li class="remote-task${node.checked ? " remote-task-done" : ""}">${box}${children(node.children, ctx)}</li>`;
    }
    case "table":
      return `<div class="remote-table-scroll"><table>${children(node.children, ctx)}</table></div>`;
    case "tableRow":
      return `<tr>${children(node.children, ctx)}</tr>`;
    case "tableCell":
      return `<td>${children(node.children, ctx)}</td>`;
    case "code":
      return `<pre><code${node.lang ? ` class="language-${attr(node.lang)}"` : ""}>${esc(node.value ?? "")}</code></pre>`;
    case "math":
      return mathPlaceholder(node.value ?? "", true, ctx);
    case "inlineMath":
      return mathPlaceholder(node.value ?? "", false, ctx);
    case "yaml":
    case "toml":
    case "definition":
    case "footnoteDefinition":
      return "";
    case "footnoteReference":
      return `<sup class="remote-footnote">[${esc(node.label ?? node.identifier ?? "")}]</sup>`;
    default:
      // Anything else (footnote blocks, directives, gfm autolinks left over)
      // renders its children rather than disappearing silently.
      return node.children ? children(node.children, ctx) : "";
  }
}

/** GFM task list item: `checked` is `true`/`false` there and absent elsewhere. */
function isTaskItem(node: MdastNode): boolean {
  return node.type === "listItem" && typeof node.checked === "boolean";
}

function alertTitlesFrom(kind: (key: string) => string) {
  return {
    note: kind("note"),
    tip: kind("tip"),
    important: kind("important"),
    warning: kind("warning"),
    caution: kind("caution"),
  };
}

/** Render `markdown` to sanitized HTML ready for `dangerouslySetInnerHTML`. */
export function renderRemoteMarkdown(markdown: string, kind: (key: string) => string): string {
  if (!markdown.trim()) return "";
  const tree = unified()
    .use(remarkParse)
    .use(remarkFrontmatter, ["yaml", "toml"])
    .use(remarkGfm)
    .use(remarkMath)
    .parse(markdown) as unknown as MdastNode;
  const ctx: Ctx = { math: new Map() };
  const titles = alertTitlesFrom(kind);
  let html = children(tree.children, ctx);
  // Alert titles are language-dependent, so they are injected after the walk
  // rather than baked into a module-level table.
  html = html.replace(/<div class="remote-alert remote-alert-(\w+)">/g, (whole, name: string) => {
    const title = titles[name as keyof typeof titles];
    return `${whole}<p class="remote-alert-title">${esc(title)}</p>`;
  });
  for (const [id, rendered] of ctx.math) {
    html = html.split(`@@${id}@@`).join(rendered);
  }
  return DOMPurify.sanitize(html, {
    FORBID_TAGS: ["style", "form", "iframe", "object", "embed", "script"],
    FORBID_ATTR: ["style"],
  });
}
