/**
 * Resolving links and image sources inside a remote document.
 *
 * A relative `href`/`src` is resolved against the document's own folder and
 * must stay inside the shared root; anything that would climb out is refused
 * — the server refuses it too, and a path that never leaves is the only one
 * that came from the document's own text.
 *
 * This is the desktop's copy of the rule the phone applies
 * (`mobile/src/render/paths.ts`); the two packages share no code, but they
 * must agree about which links open, because a document is the same document
 * on both.
 *
 * @module services/remoteServers/paths
 */

export function dirOf(relPath: string): string {
  const at = relPath.lastIndexOf("/");
  return at === -1 ? "" : relPath.slice(0, at);
}

/** Resolve `href` relative to the document at `fromRelPath`; null when it escapes or is malformed. */
export function resolveRelative(fromRelPath: string, href: string): string | null {
  const bare = href.split("#")[0].split("?")[0];
  if (!bare) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(bare);
  } catch {
    return null;
  }
  const parts = decoded.startsWith("/") ? [] : dirOf(fromRelPath).split("/").filter(Boolean);
  for (const segment of decoded.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else {
      parts.push(segment);
    }
  }
  return parts.length ? parts.join("/") : null;
}

export type HrefKind = "external" | "anchor" | "relative" | "blocked";

/** What a link does: leave the app, scroll within the document, or open a file. */
export function classifyHref(href: string): HrefKind {
  if (href.startsWith("#")) return "anchor";
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(href)?.[1]?.toLowerCase();
  if (!scheme) return "relative";
  if (scheme === "http" || scheme === "https" || scheme === "mailto" || scheme === "tel") return "external";
  return "blocked";
}

/** An extensionless note link (`[x](other)`) means `other.md`, as in the editor. */
export function asDocPath(relPath: string): string {
  const name = relPath.slice(relPath.lastIndexOf("/") + 1);
  return name.includes(".") ? relPath : `${relPath}.md`;
}

/** The heading slug a `#anchor` scrolls to (GitHub's rule, enough for our own headings). */
export function headingSlug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-");
}
