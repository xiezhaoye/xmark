/**
 * The public reading page: one snapshot, one Download original action.
 *
 * Everything here is a single self-contained HTML document with no script:
 * the page is served on a public origin for Funnel, so a raw note must never
 * become active content at that origin. The CSP the route sends matches the
 * document — `default-src 'none'`, inline styles only — and the markdown body
 * is already script-free (see `renderMarkdown`).
 *
 * A PDF is shown in an `<object>` and an HTML file in a sandboxed `<iframe>`,
 * both pointing at `/s/:id/preview` — an inline route whose own CSP keeps the
 * framed document scriptless. Download original always points at `/s/:id/
 * download`, which is still an attachment; the two must never share a URL, or
 * a phone's viewer would save the file instead of showing it (or the reverse).
 *
 * Copy is bilingual through a local helper: the language follows
 * `Accept-Language`, falling back to English, and a reader whose language is
 * neither sees the two lines they need (the button and the file size).
 *
 * @module sharePage
 */
import { escapeHtml } from "./renderMarkdown";

export type Lang = "zh" | "en";

const STRINGS = {
  en: {
    download: "Download original",
    original: "Original file",
    size: "Size",
    shared: "Shared file",
    previewUnavailable: "This file type cannot be previewed here. Download it to open it.",
    previewInBrowser: "Open the PDF preview",
    previewHtml: "Open the page in a new tab",
    htmlNotice: "An HTML page shown in a sandboxed frame: scripts, forms and remote resources are blocked.",
    genericTitle: "XMark shared file",
    rootTitle: "XMark",
    rootBody: "A shared file lives at a private link. Ask the person who shared it.",
    notFound: "This link does not exist, or it was mistyped.",
  },
  zh: {
    download: "下载原文件",
    original: "原始文件",
    size: "大小",
    shared: "分享的文件",
    previewUnavailable: "此类文件无法在此预览，请下载后打开。",
    previewInBrowser: "在浏览器中预览 PDF",
    previewHtml: "在新标签页中打开页面",
    htmlNotice: "HTML 页面在沙箱框架中展示：脚本、表单与外部资源均被阻断。",
    genericTitle: "XMark 分享文件",
    rootTitle: "XMark",
    rootBody: "分享的文件在一个私密链接里，请向分享者索取。",
    notFound: "链接不存在，或输入有误。",
  },
} as const;

export type Strings = { readonly [K in keyof (typeof STRINGS)["en"]]: string };

/** `zh` for any Chinese preference, English otherwise. */
export function langFromHeader(header: string | undefined): Lang {
  if (!header) return "en";
  const first = header.split(",")[0]?.trim().toLowerCase() ?? "";
  return first.startsWith("zh") ? "zh" : "en";
}

export function strings(lang: Lang): Strings {
  return STRINGS[lang];
}

/** Human-readable size in the reader's language; binary units, one decimal under 10. */
export function formatSize(bytes: number, lang: Lang): string {
  const units = lang === "zh" ? ["字节", "KB", "MB", "GB"] : ["bytes", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const shown = unit === 0 ? String(value) : value < 10 ? value.toFixed(1) : String(Math.round(value));
  return `${shown} ${units[unit]}`;
}

/**
 * The same policy the route sends as a header, repeated as a `<meta>` so the
 * page is inert even if it is ever served by something else (a saved copy, a
 * misconfigured proxy). No script source is allowed at all.
 */
export const SHARE_PAGE_CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "img-src 'self'",
  "object-src 'self'",
  "frame-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

const STYLE = `
:root{color-scheme:light dark;--bg:#fbfaf8;--fg:#1b1b1f;--muted:#6b6b76;--line:#e4e1dc;--accent:#2c6ecf;--code:#f1eeea;--card:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#16161a;--fg:#e9e7e3;--muted:#a0a0aa;--line:#2c2c33;--accent:#7aa7ee;--code:#1f1f25;--card:#1d1d22}}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{background:var(--bg);color:var(--fg);font:16px/1.65 -apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Segoe UI",system-ui,sans-serif;
  -webkit-text-size-adjust:100%}
.wrap{max-width:44rem;margin:0 auto;padding:20px 16px 64px}
header{display:flex;flex-direction:column;gap:6px;padding-bottom:16px;border-bottom:1px solid var(--line);margin-bottom:20px}
h1.title{font-size:1.25rem;line-height:1.35;margin:0;font-weight:600;overflow-wrap:anywhere;word-break:break-word}
.meta{color:var(--muted);font-size:.8125rem;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.download{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px;padding:0 18px;margin-top:12px;
  background:var(--accent);color:#fff;border-radius:10px;text-decoration:none;font-weight:600;font-size:.9375rem;width:100%}
.download:active{opacity:.85}
.download:focus-visible{outline:2px solid var(--fg);outline-offset:2px}
.subject{margin:28px 0 8px;color:var(--muted);font-size:.8125rem;letter-spacing:.02em;text-transform:uppercase}
.markdown-body{overflow-wrap:break-word;word-break:break-word}
.markdown-body h1,.markdown-body h2,.markdown-body h3,.markdown-body h4{line-height:1.3;margin:1.6em 0 .5em;font-weight:600}
.markdown-body h1{font-size:1.5rem}.markdown-body h2{font-size:1.3rem}.markdown-body h3{font-size:1.125rem}
.markdown-body p{margin:.75em 0}
.markdown-body a{color:var(--accent);text-decoration:underline;text-underline-offset:2px}
.markdown-body code{background:var(--code);padding:.12em .38em;border-radius:4px;font-size:.9em;
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere}
.markdown-body pre{background:var(--code);padding:12px;border-radius:8px;overflow-x:auto;font-size:.875rem}
.markdown-body pre code{background:none;padding:0}
.markdown-body img{max-width:100%;height:auto;border-radius:6px}
.markdown-body blockquote{margin:.8em 0;padding:.2em 0 .2em 12px;border-left:3px solid var(--line);color:var(--muted)}
.markdown-body ul,.markdown-body ol{padding-left:1.4em;margin:.6em 0}
.markdown-body table{border-collapse:collapse;width:100%;display:block;overflow-x:auto;font-size:.9375rem}
.markdown-body th,.markdown-body td{border:1px solid var(--line);padding:6px 10px;text-align:left}
.markdown-body th{background:var(--code)}
.markdown-body hr{border:0;border-top:1px solid var(--line);margin:1.6em 0}
pre.text{background:var(--code);padding:12px;border-radius:8px;overflow-x:auto;font-size:.875rem;
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
pre.text code{white-space:pre-wrap;overflow-wrap:anywhere}
figure.image{margin:0}
figure.image img{max-width:100%;height:auto;border-radius:8px}
.pdf{width:100%;height:70vh;min-height:320px;border:1px solid var(--line);border-radius:8px;background:var(--card)}
iframe.html-preview{width:100%;height:70vh;min-height:320px;border:1px solid var(--line);border-radius:8px;background:var(--card)}
.note{color:var(--muted);font-size:.875rem;margin:8px 0 0}
footer{margin-top:36px;padding-top:16px;border-top:1px solid var(--line);color:var(--muted);font-size:.75rem}
@media (min-width:30rem){.download{width:auto}}
@media (max-width:20rem){.wrap{padding:16px 12px 48px}h1.title{font-size:1.125rem}.download{padding:0 14px}}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
`.trim();

export interface PageInput {
  lang: Lang;
  title: string;
  /** Snapshot id — the only link component; no token, no path. */
  id: string;
  size: number;
  bodyHtml: string;
  kind: string;
  /** True when the PDF can be embedded (the file is small enough to preview inline). */
  embedPdf?: boolean;
}

function shell({ lang, title, head, body }: { lang: Lang; title: string; head: string; body: string }): string {
  return `<!doctype html>
<html lang="${lang === "zh" ? "zh-CN" : "en"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow,noarchive,nosnippet">
<meta name="referrer" content="no-referrer">
<meta name="color-scheme" content="light dark">
<meta http-equiv="Content-Security-Policy" content="${SHARE_PAGE_CSP}">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
${head}
</head>
<body>
<main class="wrap">
${body}
</main>
</body>
</html>
`;
}

/** The reading page for one snapshot. */
export function renderSharePage(page: PageInput): string {
  const t = strings(page.lang);
  const downloadHref = `/s/${page.id}/download`;
  const header = `<header>
<h1 class="title">${escapeHtml(page.title)}</h1>
<div class="meta"><span>${escapeHtml(t.size)} · ${escapeHtml(formatSize(page.size, page.lang))}</span></div>
<a class="download" href="${downloadHref}" download rel="nofollow">${escapeHtml(t.download)}</a>
</header>`;
  const body = `<section class="subject">${escapeHtml(t.shared)}</section>
${previewBody(page, t)}
<footer>XMark · ${escapeHtml(t.original)}</footer>`;
  return shell({ lang: page.lang, title: page.title, head: "", body: header + "\n" + body });
}

/**
 * The preview block. PDF and image point at the inline preview route; an HTML
 * file is framed with an empty `sandbox` (no scripts, no forms, no
 * same-origin access) and its own CSP is the second lock on the document.
 */
function previewBody(page: PageInput, t: Strings): string {
  const previewHref = `/s/${page.id}/preview`;
  if (page.kind === "pdf") {
    return page.embedPdf
      ? `<object class="pdf" data="${previewHref}" type="application/pdf"><p class="note"><a href="${previewHref}" rel="nofollow">${escapeHtml(t.previewInBrowser)}</a></p></object>`
      : `<p class="note">${escapeHtml(t.previewUnavailable)}</p>`;
  }
  if (page.kind === "image") {
    return `<figure class="image"><img src="${previewHref}" alt="${escapeHtml(page.title)}"></figure>`;
  }
  if (page.kind === "html") {
    return `<iframe class="html-preview" src="${previewHref}" sandbox="" referrerpolicy="no-referrer" title="${escapeHtml(page.title)}"></iframe>
<p class="note">${escapeHtml(t.htmlNotice)} <a href="${previewHref}" rel="nofollow noopener">${escapeHtml(t.previewHtml)}</a></p>`;
  }
  return `<article class="markdown-body">${page.bodyHtml}</article>`;
}

/** The site root: no listing, no hint about what exists. */
export function renderRootPage(lang: Lang): string {
  const t = strings(lang);
  return shell({
    lang,
    title: t.rootTitle,
    head: "",
    body: `<header><h1 class="title">${escapeHtml(t.rootTitle)}</h1></header>\n<p class="note">${escapeHtml(t.rootBody)}</p>`,
  });
}

/** A missing or malformed snapshot: the same page, never a hint about which. */
export function renderMissingPage(lang: Lang): string {
  const t = strings(lang);
  return shell({
    lang,
    title: t.genericTitle,
    head: "",
    body: `<header><h1 class="title">${escapeHtml(t.genericTitle)}</h1></header>\n<p class="note">${escapeHtml(t.notFound)}</p>`,
  });
}
