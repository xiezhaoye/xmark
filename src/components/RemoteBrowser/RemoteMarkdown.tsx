/**
 * RemoteMarkdown — a Markdown document rendered read-only, with its relative
 * images fetched through the remote client and its relative links opening the
 * linked document in the same folder tree.
 *
 * Key decisions:
 *   - **Rendering is `renderRemoteMarkdown`** (one `unified` pass, sanitized);
 *     this file only owns what happens AFTER it: hljs highlighting, images and
 *     link routing — because a pure function cannot fetch.
 *   - **Images are blob URLs**, fetched with the token (an `<img>` cannot send
 *     one), and revoked on unmount or when the document changes.
 *   - **Relative links stay inside the server**: an extensionless target means
 *     `.md`, as in the editor. External links open in the system browser; every
 *     other scheme is ignored.
 *
 * @coordinates-with services/remoteServers/renderMarkdown.ts — the HTML
 * @module components/RemoteBrowser/RemoteMarkdown
 */

import { useEffect, useMemo, useRef, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import hljs from "highlight.js/lib/common";
import { openUrl } from "@tauri-apps/plugin-opener";
import { renderRemoteMarkdown } from "@/services/remoteServers/renderMarkdown";
import { asDocPath, classifyHref, headingSlug, resolveRelative } from "@/services/remoteServers/paths";
import { loadDocument, loadImage } from "@/services/remoteServers/browse";
import { remoteServerWarn } from "@/utils/debug";
import { asArrayBufferBacked } from "@/utils/binary";

/** The bytes as a Blob of the server's media type (a zero-copy view). */
function assetBlob(bytes: number[] | Uint8Array, contentType: string): Blob {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return new Blob([asArrayBufferBacked(view)], { type: contentType });
}

export interface RemoteMarkdownProps {
  rootId: string;
  relPath: string;
  text: string;
  /** Called when a relative link resolves to another document. */
  onOpenDoc: (relPath: string, kind: "markdown" | "unknown") => void;
}

export function RemoteMarkdown({ rootId, relPath, text, onOpenDoc }: RemoteMarkdownProps) {
  const { t } = useTranslation("sidebar");
  const bodyRef = useRef<HTMLDivElement>(null);
  const html = useMemo(
    () =>
      renderRemoteMarkdown(text, (key) => t(`remote.alert.${key}`)),
    [text, t],
  );

  // Highlighting, then images: both are DOM work that must not run in render.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    for (const code of el.querySelectorAll<HTMLElement>("pre > code[class*='language-']")) {
      const lang = /language-([\w+#.-]+)/.exec(code.className)?.[1];
      if (!lang || !hljs.getLanguage(lang)) continue;
      try {
        hljs.highlightElement(code);
      } catch (error) {
        // A block that cannot be highlighted is still readable as text.
        remoteServerWarn("highlight failed:", error);
      }
    }
  }, [html]);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const urls: string[] = [];
    let cancelled = false;
    const load = async () => {
      const images = [...el.querySelectorAll("img")];
      await Promise.all(
        images.map(async (img) => {
          const src = img.getAttribute("src") ?? "";
          const kind = classifyHref(src);
          if (kind === "external" && /^https:/i.test(src)) return;
          img.removeAttribute("src");
          const rel = kind === "relative" ? resolveRelative(relPath, src) : null;
          if (!rel) {
            img.classList.add("remote-img-failed");
            return;
          }
          try {
            const asset = await loadImage(rootId, rel);
            if (!asset || cancelled) return;
            const url = URL.createObjectURL(assetBlob(asset.bytes, asset.contentType));
            urls.push(url);
            img.setAttribute("src", url);
          } catch {
            img.classList.add("remote-img-failed");
          }
        }),
      );
    };
    void load();
    el.scrollTop = 0;
    return () => {
      cancelled = true;
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [html, rootId, relPath]);

  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    const anchor = (event.target as Element).closest("a");
    if (!anchor) return;
    event.preventDefault();
    const href = anchor.getAttribute("href") ?? "";
    const kind = classifyHref(href);
    if (kind === "external") {
      void openUrl(href).catch((error) => remoteServerWarn("openUrl failed:", error));
      return;
    }
    if (kind === "anchor") {
      const target = decodeURIComponent(href.slice(1));
      const heading = [...(bodyRef.current?.querySelectorAll("h1,h2,h3,h4,h5,h6") ?? [])].find(
        (h) => headingSlug(h.textContent ?? "") === headingSlug(target),
      );
      heading?.scrollIntoView({ block: "start" });
      return;
    }
    if (kind !== "relative") return;
    const resolved = resolveRelative(relPath, href);
    if (!resolved) return;
    const docPath = asDocPath(resolved);
    onOpenDoc(docPath, docPath.endsWith(".md") ? "markdown" : "unknown");
    void loadDocument(rootId, docPath).catch(() => {
      // The viewer shows the failure; a link to a missing note is not a crash.
    });
  };

  return (
    <div
      ref={bodyRef}
      className="remote-doc remote-doc--markdown"
      onClick={onClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
