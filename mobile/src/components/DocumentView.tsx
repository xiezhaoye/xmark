/**
 * The main area: the open document in whatever form it has.
 *
 * Markdown and HTML are previewed (rendered / shown as a page) or shown as
 * highlighted source, per the session's mode; other text kinds are always
 * source; images are shown
 * whole. Pull down to reload from the Mac. The top bar scrolls with the
 * text; once it is gone, the mode switch floats at the top and a strip of
 * background keeps the text from running under the status bar.
 *
 * @module components/DocumentView
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import hljs from "highlight.js/lib/common";
import { useReaderStore } from "../state/readerStore";
import { errorText, t } from "../i18n";
import { HtmlPreview } from "./HtmlPreview";
import { MarkdownBody } from "./MarkdownBody";
import { ModeSwitch } from "./ModeSwitch";
import { TopBar } from "./TopBar";
import { PullToRefresh } from "./PullToRefresh";
import { StatusMessage } from "./StatusMessage";
import { useClient } from "./useClient";

const LANGUAGE_BY_EXT: Record<string, string> = { md: "markdown", markdown: "markdown", mdown: "markdown", mkd: "markdown", mdx: "markdown", htm: "html" };

function SourceView({ text, relPath }: { text: string; relPath: string }) {
  const ref = useRef<HTMLElement>(null);
  const raw = relPath.split(".").pop()?.toLowerCase() ?? "";
  const ext = LANGUAGE_BY_EXT[raw] ?? raw;
  useEffect(() => {
    if (ref.current && hljs.getLanguage(ext)) hljs.highlightElement(ref.current);
  }, [text, ext]);
  return (
    <pre className="source">
      <code ref={ref} className={hljs.getLanguage(ext) ? `language-${ext}` : undefined}>
        {text}
      </code>
    </pre>
  );
}

function ImageView({ rootId, relPath }: { rootId: string; relPath: string }) {
  const client = useClient();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!client) return;
    let made: string | null = null;
    let live = true;
    client
      .asset(rootId, relPath)
      .then((blob) => {
        made = URL.createObjectURL(blob);
        if (live) setUrl(made);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [client, rootId, relPath]);
  if (failed) return <StatusMessage tone="error" text={errorText("not_found")} />;
  if (!url) return <StatusMessage text={t("doc.loading")} />;
  return <img className="image-view" src={url} alt={relPath.split("/").pop() ?? t("doc.imageAlt")} />;
}

/** Past this the top bar is out of view and the floating switch shows. */
function topBarBottom(bar: HTMLElement | null): number {
  return bar ? bar.offsetTop + bar.offsetHeight : 48;
}

export function DocumentView() {
  const doc = useReaderStore((s) => s.doc);
  const docState = useReaderStore((s) => s.docState);
  const mode = useReaderStore((s) => s.docMode);
  const docKey = `${doc?.rootId}/${doc?.relPath}`;
  // Keyed by document, so a fresh document starts with the top bar in view;
  // switching preview/source keeps the place, and the switch stays reachable.
  const [scroll, setScroll] = useState({ key: "", past: false });
  const scrolledPast = scroll.key === docKey && scroll.past;
  const scroller = useRef<HTMLDivElement>(null);
  const isMarkdown = docState.status === "ready" && docState.content.kind === "markdown";
  const isHtml = docState.status === "ready" && /\.html?$/i.test(doc?.relPath ?? "");
  const previewable = isMarkdown || isHtml;

  // A new document starts at the top.
  useLayoutEffect(() => {
    const el = scroller.current?.querySelector(".document");
    if (el) el.scrollTop = 0;
  }, [docKey]);

  let body;
  if (!doc) body = <StatusMessage text={t("doc.none")} />;
  else if (docState.status === "loading" || docState.status === "idle") body = <StatusMessage text={t("doc.loading")} />;
  else if (docState.status === "error") body = <StatusMessage tone="error" text={errorText(docState.error)} onRetry={() => void useReaderStore.getState().reloadDoc()} />;
  else if (docState.status === "image") body = <ImageView key={`${doc.rootId}/${doc.relPath}`} rootId={doc.rootId} relPath={doc.relPath} />;
  else if (docState.content.kind === "markdown" && mode === "preview") body = <MarkdownBody rootId={doc.rootId} relPath={doc.relPath} text={docState.content.text} />;
  else if (isHtml && mode === "preview") body = <HtmlPreview rootId={doc.rootId} relPath={doc.relPath} html={docState.content.text} />;
  else body = <SourceView text={docState.content.text} relPath={doc.relPath} />;

  return (
    <div ref={scroller} className="document-frame">
      <PullToRefresh
        className="document"
        onRefresh={() => useReaderStore.getState().reloadDoc()}
        onScroll={(top) => setScroll({ key: docKey, past: top > topBarBottom(scroller.current?.querySelector<HTMLElement>(".topbar") ?? null) })}
      >
        <TopBar />
        <div className="document-body">{body}</div>
      </PullToRefresh>
      {scrolledPast && <div className="status-backdrop" aria-hidden="true" />}
      {scrolledPast && previewable && <ModeSwitch className="mode-float" />}
    </div>
  );
}
