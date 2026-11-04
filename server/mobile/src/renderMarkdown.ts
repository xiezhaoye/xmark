/**
 * Markdown → preview HTML for a share page, without a DOM.
 *
 * The content server renders through `rehype-katex` and DOMPurify over jsdom.
 * Neither belongs in this bundle: jsdom is megabytes of assets the single-file
 * CLI would have to inline, and the share page never runs scripts anyway.
 *
 * Safety here comes from the pipeline shape instead of a sanitizer. Raw HTML
 * is *not* allowed through (`allowDangerousHtml` is off), so an inline
 * `<script>`, an `onerror` attribute or an `<iframe>` is escaped as text
 * rather than parsed; a `javascript:` link is dropped by the URL filter; and
 * every image is replaced by a `null` (omitted) unless the exact asset was
 * frozen into the snapshot. Code fences keep their text, escaped, so a source
 * file that happens to contain markup is shown rather than run.
 *
 * The two custom handlers are the only places a URL, or a subtree, reaches
 * the document. Both route children through `state.all(node)`: a link whose
 * text is `**bold** and `code`` has mdast children (`strong`, `inlineCode`),
 * and handing those to the HAST serializer made it throw on an unknown node —
 * which the page route reported as a missing share.
 *
 * Relative link targets are *not* resolved against an invented base. A share
 * page has no sibling documents, so `other.md` becomes plain text and an
 * in-page `#anchor` stays local.
 *
 * @module renderMarkdown
 */
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype, { type Options as RehypeOptions } from "remark-rehype";
import { unified } from "unified";

export interface PreviewOptions {
  kind?: "markdown" | "text" | "image" | "pdf";
  /** Public URL for a referenced image, or null to omit it. */
  assetUrl?: (url: string) => string | null;
}

const SAFE_LINK_SCHEMES = ["http:", "https:", "mailto:"];
/** Schemes are matched case-insensitively, as browsers parse them. */
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * An absolute `http`/`https`/`mailto` href, a same-page `#fragment`, or null.
 *
 * Null means "render the text, not a link": a dangerous scheme and a
 * relative target are both refused here, and no base URL is synthesised for
 * the relative case.
 */
export function safeHref(href: string): string | null {
  if (href.startsWith("#")) return href;
  if (!HAS_SCHEME.test(href)) return null;
  try {
    const url = new URL(href);
    return SAFE_LINK_SCHEMES.includes(url.protocol.toLowerCase()) ? url.href : null;
  } catch {
    return null;
  }
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

type Handlers = NonNullable<RehypeOptions["handlers"]>;

/** The mdast fields these handlers read; everything else is passed through. */
interface ImageNode {
  url?: string;
  alt?: string | null;
}

interface LinkNode {
  url?: string;
}

/** `state.all(node)` turns mdast children into HAST — never the nodes themselves. */
type AllChildren = (node: never) => unknown[];

/** Image and link handlers: the only two places a URL reaches the document. */
function handlers(assetUrl: ((url: string) => string | null) | undefined): Handlers {
  return {
    image(_state: unknown, node: unknown) {
      const n = node as ImageNode;
      const resolved = n.url ? assetUrl?.(n.url) : null;
      // Not frozen → the caption alone; never a request the page cannot serve.
      if (!resolved) return { type: "text", value: n.alt ? `[${n.alt}]` : "" };
      return {
        type: "element",
        tagName: "img",
        properties: { src: resolved, alt: n.alt ?? "", loading: "lazy" },
        children: [],
      };
    },
    link(state: unknown, node: unknown) {
      const n = node as LinkNode;
      const all = (state as { all: AllChildren }).all;
      const children = all(node as never);
      const href = n.url ? safeHref(n.url) : null;
      // Refused target → the formatted text stays, the link does not.
      if (!href) return { type: "element", tagName: "span", properties: {}, children };
      return {
        type: "element",
        tagName: "a",
        properties: {
          href,
          rel: "noopener noreferrer nofollow",
          target: "_blank",
        },
        children,
      };
    },
  } as Handlers;
}

function markdownProcessor(assetUrl: ((url: string) => string | null) | undefined) {
  return unified()
    .use(remarkParse)
    .use(remarkGfm, { singleTilde: false })
    .use(remarkRehype, {
      // No raw HTML: everything a note writes as markup arrives as text.
      allowDangerousHtml: false,
      handlers: handlers(assetUrl),
    })
    .use(rehypeStringify, { allowDangerousHtml: false });
}

/**
 * Render markdown to a script-free HTML fragment.
 *
 * `kind: "text"` (and any non-markdown kind) is escaped wholesale into a
 * `<pre><code>` block: a source file, an HTML page or a log reads as text and
 * never as markup.
 */
export async function renderPreviewHtml(content: string, options: PreviewOptions = {}): Promise<string> {
  const kind = options.kind ?? "markdown";
  if (kind !== "markdown") return `<pre class="text"><code>${escapeHtml(content)}</code></pre>`;
  const file = await markdownProcessor(options.assetUrl).process(content);
  return String(file);
}
