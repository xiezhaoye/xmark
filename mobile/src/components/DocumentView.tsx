/**
 * The main area: the open document in whatever form it has.
 *
 * Markdown and HTML are previewed (rendered / shown as a page) or shown as
 * highlighted source, per the session's mode; other text kinds are always
 * source; images are shown
 * whole. Scrolling stops at the top without moving the preview. The top bar scrolls with the
 * text; once it is gone, the mode switch floats at the top and a strip of
 * background keeps the text from running under the status bar.
 *
 * @module components/DocumentView
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import hljs from "highlight.js/lib/common";
import { useReaderStore } from "../state/readerStore";
import { errorText, t } from "../i18n";
import { HtmlPreview } from "./HtmlPreview";
import { MarkdownBody } from "./MarkdownBody";
import { ReadingStepper } from "./ReadingStepper";
import { Icon } from "./Icon";
import { PdfView } from "./PdfView";
import { TopBar, type TopBarProps } from "./TopBar";
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

export interface DocumentViewProps extends TopBarProps {
  /** Whether the settings popover is up; the top bar's icon says so. */
  settingsOpen?: boolean;
}

export function DocumentView({ settingsButton, onSettings, settingsOpen }: DocumentViewProps) {
  const doc = useReaderStore((s) => s.doc);
  const docState = useReaderStore((s) => s.docState);
  const mode = useReaderStore((s) => s.docMode);
  const hasServer = useReaderStore((s) => s.servers.length > 0);
  const readingSize = useReaderStore((s) => s.readingSize);
  const docKey = `${doc?.rootId}/${doc?.relPath}`;
  // A reload of the same document is a fresh read of the Mac's bytes.
  const [reloadCount, setReloadCount] = useState({ key: "", count: 0 });
  const reloadToken = reloadCount.key === docKey ? reloadCount.count : 0;
  // Keyed by document, so a fresh document starts with the top bar in view;
  // switching preview/source keeps the place, and the switch stays reachable.
  const [scroll, setScroll] = useState({ key: "", past: false });
  const scrolledPast = scroll.key === docKey && scroll.past;
  const scroller = useRef<HTMLDivElement>(null);
  const isHtml = docState.status === "ready" && /\.html?$/i.test(doc?.relPath ?? "");

  // A new document starts at the top.
  useLayoutEffect(() => {
    const el = scroller.current?.querySelector(".document");
    if (el) el.scrollTop = 0;
  }, [docKey]);

  // A non-passive listener also stops iOS rubber-banding at the top. Keep
  // horizontal drawer gestures and multi-touch zoom available.
  useEffect(() => {
    const el = scroller.current?.querySelector<HTMLElement>(".document");
    if (!el) return;
    let previous: { x: number; y: number } | null = null;
    const start = (e: TouchEvent) => {
      const touch = e.touches.length === 1 ? e.touches[0] : null;
      previous = touch ? { x: touch.clientX, y: touch.clientY } : null;
    };
    const move = (e: TouchEvent) => {
      const touch = e.touches.length === 1 ? e.touches[0] : null;
      if (!touch || !previous) { previous = null; return; }
      const dx = touch.clientX - previous.x;
      const dy = touch.clientY - previous.y;
      previous = { x: touch.clientX, y: touch.clientY };
      if (el.scrollTop <= 0 && dy > 0 && dy > Math.abs(dx) && e.cancelable) e.preventDefault();
    };
    const end = () => { previous = null; };
    el.addEventListener("touchstart", start, { passive: true });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", end);
    el.addEventListener("touchcancel", end);
    return () => {
      el.removeEventListener("touchstart", start);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", end);
      el.removeEventListener("touchcancel", end);
    };
  }, []);

  /** Reads the open document again — a refresh reads a PDF's bytes again too. */
  const reload = () => {
    setReloadCount((n) => ({ key: docKey, count: (n.key === docKey ? n.count : 0) + 1 }));
    return useReaderStore.getState().reloadDoc();
  };

  let body;
  if (!hasServer) body = <StatusMessage text={t("doc.noServer")} action={{ label: t("doc.addServer"), onClick: () => useReaderStore.getState().setView("settings") }} />;
  else if (!doc) body = <StatusMessage text={t("doc.none")} />;
  else if (docState.status === "loading" || docState.status === "idle") body = <StatusMessage text={t("doc.loading")} />;
  else if (docState.status === "error") body = <StatusMessage tone="error" text={errorText(docState.error)} onRetry={() => void useReaderStore.getState().reloadDoc()} />;
  else if (docState.status === "image") body = <ImageView key={`${doc.rootId}/${doc.relPath}`} rootId={doc.rootId} relPath={doc.relPath} />;
  else if (docState.status === "pdf") body = <PdfView rootId={doc.rootId} relPath={doc.relPath} reloadToken={reloadToken} onRetry={() => void reload()} />;
  else if (docState.content.kind === "markdown" && mode === "preview") body = <MarkdownBody rootId={doc.rootId} relPath={doc.relPath} text={docState.content.text} />;
  else if (isHtml && mode === "preview") body = <HtmlPreview rootId={doc.rootId} relPath={doc.relPath} html={docState.content.text} />;
  else body = <SourceView text={docState.content.text} relPath={doc.relPath} />;

  // The document's own type size: only the scrolling document is inside this
  // scope, so the drawer, the settings page and the search page keep theirs.
  const style = { "--reading-size": `${readingSize}px` } as CSSProperties;

  return (
    <div ref={scroller} className="document-frame" style={style}>
      <div
        className="scroll document"
        onScroll={(e) => setScroll({ key: docKey, past: e.currentTarget.scrollTop > topBarBottom(scroller.current?.querySelector<HTMLElement>(".topbar") ?? null) })}
      >
        <TopBar settingsButton={settingsButton} onSettings={onSettings} settingsOpen={settingsOpen} />
        <div className="document-body">{body}</div>
      </div>
      {scrolledPast && <div className="status-backdrop" aria-hidden="true" />}
      {scrolledPast && <ReadingStepper className="mode-float" />}
      {/* Once the text has scrolled past the top bar, one tap returns to the top.
          It appears with the same condition as the pill, bottom-right, and is
          translucent so it never competes with the text under it. */}
      {scrolledPast && (
        <button
          type="button"
          className="to-top"
          aria-label={t("doc.toTop")}
          onClick={() => {
            // The smooth part is `.document { scroll-behavior: smooth }`; setting
            // scrollTop keeps this working where that API is absent (tests).
            const el = scroller.current?.querySelector<HTMLElement>(".document");
            if (el) el.scrollTop = 0;
          }}
        >
          <Icon name="arrowUp" size={18} />
        </button>
      )}
    </div>
  );
}
