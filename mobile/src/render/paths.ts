/**
 * Resolving links and image sources inside a document.
 *
 * A relative `href`/`src` is resolved against the document's folder and must
 * stay inside the shared root; anything that would climb out is refused, the
 * same as the server would refuse it.
 *
 * @module render/paths
 */

export function dirOf(relPath: string): string {
  const i = relPath.lastIndexOf("/");
  return i === -1 ? "" : relPath.slice(0, i);
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
  for (const seg of decoded.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else {
      parts.push(seg);
    }
  }
  return parts.length ? parts.join("/") : null;
}

export type HrefKind = "external" | "anchor" | "relative" | "blocked";

export function classifyHref(href: string): HrefKind {
  if (href.startsWith("#")) return "anchor";
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(href)?.[1]?.toLowerCase();
  if (!scheme) return "relative";
  if (scheme === "http" || scheme === "https" || scheme === "mailto" || scheme === "tel") return "external";
  return "blocked";
}

/** A link target as a file: an extensionless note link (`[x](other)`) means `other.md`. */
export function asDocPath(relPath: string): string {
  const name = relPath.slice(relPath.lastIndexOf("/") + 1);
  return name.includes(".") ? relPath : `${relPath}.md`;
}
