/**
 * Markdown → sanitized HTML for the reader.
 *
 * GFM, math (KaTeX), frontmatter (hidden), GitHub alerts (the content
 * server's own remark plugin), raw HTML allowed and then sanitized with
 * DOMPurify. Mermaid fences become `<pre data-diagram="mermaid">`
 * placeholders that `enhance.ts` renders after mount. Relative `src`/`href`
 * values are left for the view to resolve against the document's folder.
 *
 * @module render/markdown
 */
import DOMPurify from "dompurify";
import rehypeKatex from "rehype-katex";
import rehypeStringify from "rehype-stringify";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import remarkRehype, { type Options as RehypeOptions } from "remark-rehype";
import { unified } from "unified";
import { remarkAlerts, type AlertNode } from "@content-server/render/remarkAlerts";

type AlertTitles = Partial<Record<AlertNode["kind"], string>>;

export interface RenderOptions {
  alertTitles?: AlertTitles;
}

const DEFAULT_TITLES: Record<AlertNode["kind"], string> = {
  note: "Note",
  tip: "Tip",
  important: "Important",
  warning: "Warning",
  caution: "Caution",
};

type HastState = { all: (node: unknown) => unknown[] };
const text = (value: string) => ({ type: "text", value });

function handlers(titles: AlertTitles): NonNullable<RehypeOptions["handlers"]> {
  return {
    alert(state: unknown, node: unknown) {
      const n = node as AlertNode;
      return {
        type: "element",
        tagName: "div",
        properties: { className: ["markdown-alert", `markdown-alert-${n.kind}`], dataKind: n.kind },
        children: [
          { type: "element", tagName: "p", properties: { className: ["markdown-alert-title"] }, children: [text(titles[n.kind] ?? DEFAULT_TITLES[n.kind])] },
          ...(state as HastState).all(node),
        ],
      };
    },
    code(_state: unknown, node: unknown) {
      const n = node as { lang?: string | null; value: string };
      const lang = (n.lang ?? "").toLowerCase();
      if (lang === "mermaid") {
        return { type: "element", tagName: "pre", properties: { dataDiagram: "mermaid" }, children: [text(n.value)] };
      }
      const code = {
        type: "element",
        tagName: "code",
        properties: lang ? { className: [`language-${lang}`] } : {},
        children: [text(n.value)],
      };
      return { type: "element", tagName: "pre", properties: {}, children: [code] };
    },
  } as unknown as NonNullable<RehypeOptions["handlers"]>;
}

export function renderMarkdown(markdown: string, options: RenderOptions = {}): string {
  if (!markdown.trim()) return "";
  const html = String(
    unified()
      .use(remarkParse)
      .use(remarkFrontmatter, ["yaml", "toml"])
      .use(remarkGfm)
      .use(remarkMath)
      .use(remarkAlerts)
      .use(remarkRehype, { allowDangerousHtml: true, handlers: handlers(options.alertTitles ?? {}) })
      .use(rehypeKatex, { throwOnError: false, strict: false })
      .use(rehypeStringify, { allowDangerousHtml: true })
      .processSync(markdown),
  );
  return DOMPurify.sanitize(html, {
    ADD_ATTR: ["data-diagram", "data-kind"],
    FORBID_TAGS: ["style", "form", "iframe", "object", "embed"],
  });
}
