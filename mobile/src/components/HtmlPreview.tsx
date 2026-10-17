/**
 * An HTML file shown as a page, in a script-less sandbox (see
 * `render/htmlPreview`).
 *
 * The frame grows to its content's height so the reader's own scroll area
 * (and the top bar scrolling away) works as for markdown. Taps on links are
 * caught from outside the frame: relative links open in the reader,
 * http(s)/mailto open in the system browser, `#anchor` scrolls the frame.
 *
 * @module components/HtmlPreview
 */
import { useEffect, useRef, useState } from "react";
import { prepareHtml } from "../render/htmlPreview";
import { asDocPath, classifyHref, resolveRelative } from "../render/paths";
import { openExternal } from "../platform";
import { useReaderStore } from "../state/readerStore";
import { t } from "../i18n";
import { StatusMessage } from "./StatusMessage";
import { useClient } from "./useClient";

export function HtmlPreview({ rootId, relPath, html }: { rootId: string; relPath: string; html: string }) {
  const client = useClient();
  const frame = useRef<HTMLIFrameElement>(null);
  const [srcdoc, setSrcdoc] = useState<string | null>(null);
  const [height, setHeight] = useState(200);

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

  const onLoad = () => {
    const doc = frame.current?.contentDocument;
    if (!doc?.documentElement) return;
    // The frame is as tall as its page, so the page itself never scrolls.
    doc.documentElement.style.overflow = "hidden";
    const measure = () => setHeight(Math.max(doc.documentElement.scrollHeight, doc.body?.scrollHeight ?? 0));
    measure();
    if (typeof ResizeObserver === "function") new ResizeObserver(measure).observe(doc.documentElement);
    doc.addEventListener("click", (e) => {
      const a = (e.target as Element | null)?.closest?.("a");
      if (!a) return;
      e.preventDefault();
      const href = a.getAttribute("href") ?? "";
      const kind = classifyHref(href);
      if (kind === "external") void openExternal(href);
      else if (kind === "anchor") doc.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView({ block: "start" });
      else if (kind === "relative") {
        const rel = resolveRelative(relPath, href);
        if (rel) void useReaderStore.getState().openDoc(rootId, asDocPath(rel));
      }
    });
  };

  if (srcdoc === null) return <StatusMessage text={t("doc.loading")} />;
  return <iframe ref={frame} className="html-preview" title={relPath} sandbox="allow-same-origin" srcDoc={srcdoc} style={{ height }} onLoad={onLoad} />;
}
