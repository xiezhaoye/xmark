/**
 * An HTML file shown as a page, in a script-less sandbox (see
 * `render/htmlPreview`).
 *
 * The frame grows to its content's height so the reader's own scroll area
 * (and the top bar scrolling away) works as for markdown.
 *
 * The page is scaled by the reading size. `zoom` would be the obvious tool,
 * but iOS's WKWebView does not lay a zoomed document out reliably, so the
 * page's root element is transformed instead: `scale(s)` from the top-left
 * corner, with its width widened to `100% / s` so the content reflows against
 * the zoomed viewport and never scrolls sideways. The frame's height is the
 * page's own height times `s`, which is what the scaled page actually covers.
 * At 16 (s = 1) nothing is transformed.
 *
 * Taps on links are caught from outside the frame: relative links open in the
 * reader, http(s)/mailto open in the system browser, `#anchor` scrolls the
 * frame. The listener is kept so a new document (or a re-created one) can be
 * let go of instead of stacking a second one on top.
 *
 * @module components/HtmlPreview
 */
import { useEffect, useRef, useState } from "react";
import { prepareHtml, readingScale } from "../render/htmlPreview";
import { asDocPath, classifyHref, resolveRelative } from "../render/paths";
import { openExternal } from "../platform";
import { useReaderStore } from "../state/readerStore";
import { t } from "../i18n";
import { StatusMessage } from "./StatusMessage";
import { useClient } from "./useClient";

/** How the links of the frame's document are handled. */
function onFrameClick(next: Document, rootId: string, relPath: string) {
  return (e: Event) => {
    const a = (e.target as Element | null)?.closest?.("a");
    if (!a) return;
    e.preventDefault();
    const href = a.getAttribute("href") ?? "";
    const kind = classifyHref(href);
    if (kind === "external") void openExternal(href);
    else if (kind === "anchor") next.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView({ block: "start" });
    else if (kind === "relative") {
      const rel = resolveRelative(relPath, href);
      if (rel) void useReaderStore.getState().openDoc(rootId, asDocPath(rel));
    }
  };
}

export function HtmlPreview({ rootId, relPath, html }: { rootId: string; relPath: string; html: string }) {
  const client = useClient();
  // The page is scaled by the reading size, so a larger setting makes it
  // larger exactly as it makes markdown larger.
  const readingSize = useReaderStore((s) => s.readingSize);
  const scale = readingScale(readingSize);
  const frame = useRef<HTMLIFrameElement>(null);
  const [srcdoc, setSrcdoc] = useState<string | null>(null);
  const [height, setHeight] = useState(200);
  // The frame's own document and the tap listener attached to it, in refs:
  // they belong to the document, not to a render.
  const doc = useRef<Document | null>(null);
  const detach = useRef<(() => void) | null>(null);
  // The document is new after every load, and re-measuring waits for that.
  const [loaded, setLoaded] = useState(0);

  useEffect(() => {
    if (!client) return;
    let release = () => {};
    let live = true;
    void prepareHtml(html, {
      rootId,
      docRelPath: relPath,
      asset: client.asset,
      fileText: async (r, p) => (await client.file(r, p)).text,
    }).then((ready) => {
      if (!live) return ready.release();
      release = ready.release;
      setSrcdoc(ready.srcdoc);
    });
    return () => {
      live = false;
      release();
    };
  }, [client, rootId, relPath, html]);

  // A previous document's listener is dropped before a new one is attached,
  // so reloading never leaves a tap handled twice.
  useEffect(
    () => () => {
      detach.current?.();
      detach.current = null;
    },
    [],
  );

  const onLoad = () => {
    const next = frame.current?.contentDocument;
    if (!next?.documentElement) return;
    detach.current?.();
    const handler = onFrameClick(next, rootId, relPath);
    next.addEventListener("click", handler);
    detach.current = () => next.removeEventListener("click", handler);
    doc.current = next;
    setLoaded((n) => n + 1);
  };

  // The frame is as tall as its scaled page, so the page itself never
  // scrolls. Scaling re-runs this: the page's metrics changed underneath it.
  useEffect(() => {
    const page = doc.current;
    const root = page?.documentElement;
    if (!page || !root) return;
    root.style.overflow = "hidden";
    const scrollHeight = () => Math.max(root.scrollHeight, page.body?.scrollHeight ?? 0);
    let measure: () => void;
    if (scale === 1) {
      // The reading size is the page's own: no transform at all.
      root.style.transform = "";
      root.style.transformOrigin = "";
      root.style.width = "";
      measure = () => setHeight(scrollHeight());
    } else {
      root.style.transformOrigin = "0 0";
      root.style.transform = `scale(${scale})`;
      // The viewport the page lays itself out in, before the transform.
      root.style.width = `calc(100% / ${scale})`;
      // The part of the layout box the scaled page covers, which is what the
      // reader must be able to scroll: never just the transformed height.
      const clientHeight = () => Math.max(root.clientHeight, page.body?.clientHeight ?? 0);
      measure = () => setHeight(Math.ceil(Math.max(scrollHeight() * scale, clientHeight() * scale)));
    }
    measure();
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, [loaded, scale]);

  if (srcdoc === null) return <StatusMessage text={t("doc.loading")} />;
  return <iframe ref={frame} className="html-preview" title={relPath} sandbox="allow-same-origin" srcDoc={srcdoc} style={{ height }} onLoad={onLoad} />;
}
