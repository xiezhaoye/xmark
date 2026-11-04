/**
 * The image URLs a markdown document actually references.
 *
 * Parsed with the same remark/rehype stack the page renderer uses, so the list
 * matches what the page would try to draw. A regular expression over the
 * source cannot do that: `<a b.png>` is a legal destination, `图形 (1).png`
 * carries balanced parentheses, `![a][one]` has its URL somewhere else, and a
 * fenced code block that happens to contain `![x](y.png)` is not a reference
 * at all.
 *
 * Only `image` nodes are collected — a plain link to a `.png` is a link, not
 * an image — and a reference-style image (`![alt][label]`) is reported with the
 * URL from its definition, which is what the note means.
 *
 * Failures are silent and empty: a markdown file that does not parse simply
 * freezes no assets, and the page keeps the captions.
 *
 * @module markdownImages
 */
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

/** The subset of an mdast node this walk reads. */
interface MdastNode {
  type?: string;
  url?: unknown;
  identifier?: unknown;
  children?: unknown;
}

/** First definition wins, as it does in every markdown renderer. */
function definitions(tree: MdastNode): Map<string, string> {
  const map = new Map<string, string>();
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const n = node as MdastNode;
    if (n.type === "definition" && typeof n.identifier === "string" && typeof n.url === "string") {
      if (!map.has(n.identifier)) map.set(n.identifier, n.url);
    }
    if (Array.isArray(n.children)) for (const child of n.children) walk(child);
  };
  walk(tree);
  return map;
}

function collect(node: unknown, defs: Map<string, string>, found: string[]): void {
  if (!node || typeof node !== "object") return;
  const n = node as MdastNode;
  if (n.type === "image" && typeof n.url === "string" && n.url.trim() !== "") found.push(n.url.trim());
  // `![alt][label]` carries no URL of its own: the definition holds it.
  if (n.type === "imageReference" && typeof n.identifier === "string") {
    const url = defs.get(n.identifier);
    if (url && url.trim() !== "") found.push(url.trim());
  }
  if (!Array.isArray(n.children)) return;
  for (const child of n.children) collect(child, defs, found);
}

/** Image URLs in document order, duplicates included. */
export function imageUrls(markdown: string): string[] {
  const tree = unified().use(remarkParse).use(remarkGfm, { singleTilde: false }).parse(markdown) as MdastNode;
  const found: string[] = [];
  collect(tree, definitions(tree), found);
  return found;
}
