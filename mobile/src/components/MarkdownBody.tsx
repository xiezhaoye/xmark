/**
 * A rendered markdown document: HTML, then images/code/diagrams, then link
 * handling and the jump to a search match.
 *
 * Links: a relative link opens that file in the reader (an extensionless
 * one means the `.md` note); `#anchor` scrolls to
 * the heading whose text slug matches; http(s)/mailto open outside the app;
 * anything else does nothing.
 *
 * @module components/MarkdownBody
 */
import { useEffect, useMemo, useRef, type MouseEvent } from "react";
import { renderMarkdown } from "../render/markdown";
import { enhanceDocument, revealText } from "../render/enhance";
import { asDocPath, classifyHref, resolveRelative } from "../render/paths";
import { useReaderStore } from "../state/readerStore";
import { openExternal } from "../platform";
import { t } from "../i18n";
import { useClient } from "./useClient";

const slug = (s: string) => s.trim().toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, "").replace(/\s+/g, "-");

export function MarkdownBody({ rootId, relPath, text }: { rootId: string; relPath: string; text: string }) {
  const ref = useRef<HTMLElement>(null);
  const client = useClient();
  const html = useMemo(
    () =>
      renderMarkdown(text, {
        alertTitles: { note: t("alert.note"), tip: t("alert.tip"), important: t("alert.important"), warning: t("alert.warning"), caution: t("alert.caution") },
      }),
    [text],
  );

  useEffect(() => {
    const el = ref.current;
    if (!el || !client) return;
    let release = () => {};
    let cancelled = false;
    void enhanceDocument(el, { rootId, docRelPath: relPath, asset: client.asset }).then((done) => {
      if (cancelled) done();
      else release = done;
      const query = useReaderStore.getState().revealQuery;
      if (query && !cancelled) {
        revealText(el, query);
        useReaderStore.getState().clearReveal();
      }
    });
    el.scrollTop = 0;
    return () => {
      cancelled = true;
      release();
    };
  }, [html, rootId, relPath, client]);

  const onClick = (e: MouseEvent<HTMLElement>) => {
    const a = (e.target as Element).closest("a");
    if (!a) return;
    e.preventDefault();
    const href = a.getAttribute("href") ?? "";
    const kind = classifyHref(href);
    if (kind === "external") void openExternal(href);
    else if (kind === "anchor") {
      const target = decodeURIComponent(href.slice(1));
      const heading = [...(ref.current?.querySelectorAll("h1,h2,h3,h4,h5,h6") ?? [])].find((h) => slug(h.textContent ?? "") === slug(target));
      heading?.scrollIntoView({ block: "start" });
    } else if (kind === "relative") {
      const rel = resolveRelative(relPath, href);
      if (rel) void useReaderStore.getState().openDoc(rootId, asDocPath(rel));
    }
  };

  return <article ref={ref} className="markdown" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
}
