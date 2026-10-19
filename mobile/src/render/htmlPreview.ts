/**
 * An HTML file made ready for a sandboxed, script-less preview.
 *
 * The page is shown in an `<iframe sandbox="allow-same-origin" srcdoc>`:
 * no script runs in it (no `allow-scripts`), and same-origin only lets the
 * reader measure its height and catch link taps. What the sandbox cannot do
 * is send the token, so before it is shown:
 *   - relative images become blob URLs fetched through the client (https
 *     images are kept, anything else dropped), as in markdown;
 *   - relative stylesheets are read through the client and inlined (https
 *     ones are kept; unreadable or escaping ones are dropped);
 *   - scripts, `<base>` and inline `on*` handlers are removed;
 *   - a phone viewport is added when the page has none.
 *
 * @module render/htmlPreview
 */
import { loadImages, type EnhanceContext } from "./enhance";
import { classifyHref, resolveRelative } from "./paths";

/** The page `body` size the rest of the app is laid out at, in px. */
const BASE_SIZE = 16;

/**
 * How much an HTML page is scaled for a reading size: whole, so the page's
 * own relative sizes keep their proportions. A document shown at 16 is not
 * scaled at all.
 */
export const readingScale = (readingSize: number): number => readingSize / BASE_SIZE;

export interface HtmlContext extends EnhanceContext {
  fileText: (rootId: string, relPath: string) => Promise<string>;
}

async function inlineStylesheets(doc: Document, ctx: HtmlContext): Promise<void> {
  const links = [...doc.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"]')];
  await Promise.all(
    links.map(async (link) => {
      const href = link.getAttribute("href") ?? "";
      const kind = classifyHref(href);
      if (kind === "external" && /^https:/i.test(href)) return;
      const rel = kind === "relative" ? resolveRelative(ctx.docRelPath, href) : null;
      if (!rel) {
        link.remove();
        return;
      }
      try {
        const style = doc.createElement("style");
        style.textContent = await ctx.fileText(ctx.rootId, rel);
        link.replaceWith(style);
      } catch {
        link.remove();
      }
    }),
  );
}

function stripActive(doc: Document): void {
  doc.querySelectorAll("script, base").forEach((el) => el.remove());
  for (const el of doc.querySelectorAll("*")) {
    for (const attr of [...el.attributes]) if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
  }
}

function ensureViewport(doc: Document): void {
  if (doc.querySelector('meta[name="viewport"]')) return;
  const meta = doc.createElement("meta");
  meta.name = "viewport";
  meta.content = "width=device-width, initial-scale=1";
  doc.head.prepend(meta);
}

/** Build the `srcdoc`; `release` frees the image blob URLs. */
export async function prepareHtml(html: string, ctx: HtmlContext): Promise<{ srcdoc: string; release: () => void }> {
  const doc = new DOMParser().parseFromString(html, "text/html");
  stripActive(doc);
  ensureViewport(doc);
  const urls: string[] = [];
  await Promise.all([loadImages(doc, ctx, urls), inlineStylesheets(doc, ctx)]);
  return {
    srcdoc: `<!doctype html>${doc.documentElement.outerHTML}`,
    release: () => urls.forEach((u) => URL.revokeObjectURL(u)),
  };
}
