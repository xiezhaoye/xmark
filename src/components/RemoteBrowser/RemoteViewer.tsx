/**
 * RemoteViewer — the main column while a remote server is showing: one
 * document, read-only.
 *
 * What each kind becomes:
 *   - **markdown** → `RemoteMarkdown` (sanitized, relative images and links
 *     resolved inside the same folder tree);
 *   - **text** (code, JSON, plain notes) → source, monospace, with hljs
 *     highlighting when the extension names a language; long files are capped
 *     for display, not for loading;
 *   - **image** → the bytes fetched with the token, as a blob URL;
 *   - **HTML** → a `sandbox=""` iframe with `srcdoc`: no script runs, no
 *     origin is granted, and relative resources are not resolved (the sandbox
 *     cannot send the token, and pretending otherwise would break the
 *     document silently).
 *
 * A load failure is a card with a retry, never a blank pane.
 *
 * @coordinates-with components/RemoteBrowser/RemoteShell.tsx — the caller
 * @module components/RemoteBrowser/RemoteViewer
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileQuestion } from "lucide-react";
import hljs from "highlight.js/lib/common";
import type { RemoteFile } from "@/services/remoteServers/client";
import { failureText, loadDocument, loadImage } from "@/services/remoteServers/browse";
import { asArrayBufferBacked } from "@/utils/binary";
import { useRemoteBrowserStore } from "@/stores/remoteBrowserStore";
import { RemoteMarkdown } from "./RemoteMarkdown";
import { RemoteError } from "./RemoteChrome";
import "./remote-viewer.css";

/** Extensions the server serves as `image` and the viewer shows as a picture. */
const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp", "ico"]);

/** Display cap for source text: the server sends up to 5 MB, the DOM gets 1 MB. */
const MAX_SOURCE_CHARS = 1_000_000;

type DocState =
  | { status: "loading" }
  | { status: "ready"; file: RemoteFile }
  | { status: "error"; message: string };

function SourceView({ text, ext }: { text: string; ext: string }) {
  const ref = useRef<HTMLElement>(null);
  const shown = text.length > MAX_SOURCE_CHARS ? text.slice(0, MAX_SOURCE_CHARS) : text;
  useEffect(() => {
    const el = ref.current;
    if (!el || !hljs.getLanguage(ext)) return;
    try {
      el.innerHTML = hljs.highlight(shown, { language: ext }).value;
    } catch {
      // Leave the plain text: highlighting is an enhancement, not the content.
    }
  }, [shown, ext]);
  return (
    <pre className="remote-source">
      <code ref={ref} className="remote-source__code">
        {shown}
      </code>
    </pre>
  );
}

function ImageView({ rootId, relPath }: { rootId: string; relPath: string }) {
  const { t } = useTranslation("sidebar");
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    void loadImage(rootId, relPath).then(
      (asset) => {
        if (!asset || cancelled) return;
        const view = asset.bytes instanceof Uint8Array ? asset.bytes : new Uint8Array(asset.bytes);
        url = URL.createObjectURL(new Blob([asArrayBufferBacked(view)], { type: asset.contentType }));
        setSrc(url);
      },
      (cause: unknown) => {
        if (!cancelled) setError(failureText(cause));
      },
    );
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [rootId, relPath]);

  if (error) return <RemoteError message={error} onRetry={() => setError(null)} />;
  if (!src) return <p className="remote-viewer__empty">{t("remote.loading")}</p>;
  return (
    <div className="remote-image">
      <img src={src} alt={relPath.slice(relPath.lastIndexOf("/") + 1)} />
    </div>
  );
}

/**
 * HTML in a sandbox with NO privileges: `sandbox=""` blocks scripts, forms,
 * popups and same-origin access alike. The server's CSP is a second lock.
 */
function HtmlView({ text }: { text: string }) {
  const srcdoc = useMemo(
    () => `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"></head><body>${text}</body></html>`,
    [text],
  );
  return <iframe className="remote-html" sandbox="" srcDoc={srcdoc} title="HTML preview" referrerPolicy="no-referrer" />;
}

export interface RemoteViewerProps {
  rootId: string;
  relPath: string;
}

/**
 * One remote document, read-only. Keyed by the document it shows, so a switch
 * remounts the loader: the "loading" state is then the loader's INITIAL state
 * rather than something an effect assigns — no render paints the previous
 * document's content under the new path.
 */
export function RemoteViewer({ rootId, relPath }: RemoteViewerProps) {
  return <LoadedDocument key={`${rootId}:${relPath}`} rootId={rootId} relPath={relPath} />;
}

function LoadedDocument({ rootId, relPath }: RemoteViewerProps) {
  const { t } = useTranslation("sidebar");
  // Both start at their only correct value for this document: nothing loaded,
  // first attempt. A new document is a new mount (see `RemoteViewer`).
  const [state, setState] = useState<DocState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const ext = relPath.slice(relPath.lastIndexOf(".") + 1).toLowerCase();

  useEffect(() => {
    // Only the async callbacks below set state: the reset is the remount.
    let cancelled = false;
    void loadDocument(rootId, relPath).then(
      (file) => {
        if (cancelled) return;
        if (!file) return;
        setState({ status: "ready", file });
      },
      (cause: unknown) => {
        if (!cancelled) setState({ status: "error", message: failureText(cause) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [rootId, relPath, attempt]);

  if (state.status === "loading") {
    return <p className="remote-viewer__empty">{t("remote.loading")}</p>;
  }
  if (state.status === "error") {
    return <RemoteError message={state.message} onRetry={() => setAttempt((n) => n + 1)} />;
  }

  const { file } = state;
  const isImage = IMAGE_EXTS.has(ext);
  // A relative link in markdown has already been requested by `RemoteMarkdown`;
  // this effect's re-run (on the new `relPath`) is what paints it.
  const openDoc = (next: string) => {
    if (next !== relPath) useRemoteBrowserStore.setState({ doc: { rootId, relPath: next, kind: "loading" } });
  };

  if (isImage) return <ImageView rootId={rootId} relPath={relPath} />;
  if (ext === "html" || ext === "htm") return <HtmlView text={file.text} />;
  if (file.kind === "markdown" || ext === "md" || ext === "markdown") {
    return <RemoteMarkdown rootId={rootId} relPath={relPath} text={file.text} onOpenDoc={openDoc} />;
  }
  if (!ext) {
    return (
      <p className="remote-viewer__empty">
        <FileQuestion size={14} aria-hidden="true" /> {t("remote.unknownKind")}
      </p>
    );
  }
  return <SourceView text={file.text} ext={ext} />;
}
