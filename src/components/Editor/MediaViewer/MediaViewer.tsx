/**
 * Media tab surface — the component Editor.tsx mounts for kind:"media".
 *
 * Purpose: Bridge the tab/document store to the store-agnostic <MediaView>
 *   render core. Reads the tab's absolute filePath via a store selector
 *   (never destructured) and wraps the preview in a full-width, read-only
 *   container. A media tab's document `content` is always empty — the bytes
 *   reach the webview through the Tauri asset protocol inside MediaView.
 *
 * @coordinates-with components/Editor/Editor.tsx — kind:"media" dispatch
 * @coordinates-with components/Editor/MediaView/MediaView.tsx — render core
 * @coordinates-with stores/documentStore.ts — per-tab filePath + documentId
 *
 * @module components/Editor/MediaViewer/MediaViewer
 */

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useDocumentStore } from "@/stores/documentStore";
import { MediaView } from "@/components/Editor/MediaView/MediaView";
import { replaceTabWithMediaFile } from "@/services/navigation/openMediaFile";
import { imageSiblings, isImagePath, stepSibling } from "./imageSiblings";
import "./MediaViewer.css";

export interface MediaViewerProps {
  /** Active tab id — keyed the same way as the wysiwyg / split-pane surfaces. */
  tabId: string;
}

/**
 * Full-width read-only surface that previews the tab's media file.
 *
 * For a picture it also walks the folder: ← / → (and the arrows drawn over the
 * image) move to the previous / next image in the SAME tab, so reading a folder
 * of photos does not litter the tab bar with one tab per photo.
 */
export function MediaViewer({ tabId }: MediaViewerProps) {
  const { t } = useTranslation("editor");
  const filePath = useDocumentStore(
    (state) => state.documents?.[tabId]?.filePath ?? null,
  );
  // `documentId` means "this document was replaced from outside" — for a text
  // document it remounts the editor, and for a binary one it is the only signal
  // that the bytes moved, since a media tab's content never enters the store.
  // `markBinaryFileChanged` advances it from the fs watcher (issue #1328).
  const reloadKey = useDocumentStore(
    (state) => state.documents?.[tabId]?.documentId ?? 0,
  );

  const [siblings, setSiblings] = useState<string[]>([]);

  // The folder's images, re-read when the shown file changes. A failure leaves
  // an empty list: no arrows, no hint, and the picture still renders.
  useEffect(() => {
    let live = true;
    setSiblings([]);
    if (!filePath || !isImagePath(filePath)) return;
    void imageSiblings(filePath).then((list) => {
      if (live) setSiblings(list);
    });
    return () => {
      live = false;
    };
  }, [filePath]);

  const step = useCallback(
    (offset: -1 | 1) => {
      if (!filePath) return;
      const next = stepSibling(siblings, filePath, offset);
      if (next) replaceTabWithMediaFile(tabId, next);
    },
    [siblings, filePath, tabId],
  );

  // Keyboard: only while this surface owns the window and nothing editable has
  // focus (an arrow in a text field belongs to the caret).
  useEffect(() => {
    if (siblings.length < 2) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || target?.tagName === "INPUT" || target?.tagName === "TEXTAREA") return;
      event.preventDefault();
      step(event.key === "ArrowLeft" ? -1 : 1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [siblings.length, step]);

  // A media tab always carries a filePath (opened from disk). Guard anyway:
  // an empty untitled media tab has nothing to render.
  if (!filePath) return null;

  const many = siblings.length > 1;
  return (
    <div className="media-viewer" role="group">
      <MediaView path={filePath} reloadKey={reloadKey} />
      {many && (
        <>
          <button type="button" className="media-viewer__arrow media-viewer__arrow--prev" aria-label={t("media.previousImage")} onClick={() => step(-1)}>
            <ChevronLeft size={28} aria-hidden="true" />
          </button>
          <button type="button" className="media-viewer__arrow media-viewer__arrow--next" aria-label={t("media.nextImage")} onClick={() => step(1)}>
            <ChevronRight size={28} aria-hidden="true" />
          </button>
          <p className="media-viewer__hint">{t("media.keyboardHint")}</p>
        </>
      )}
    </div>
  );
}
