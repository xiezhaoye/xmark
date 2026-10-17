/**
 * The reader's UI strings, Chinese and English, chosen from the system
 * language. Every user-facing string goes through `t()`.
 *
 * @module i18n
 */

const zh = {
  "app.title": "XMark",
  "drawer.open": "打开分组与文件",
  "drawer.close": "收起",
  "drawer.groups": "分组",
  "drawer.files": "文件",
  "drawer.noGroups": "还没有分组。在 Mac 上的 XMark 里创建分组并加入文件夹。",
  "drawer.emptyGroup": "此分组没有文件夹",
  "drawer.pickFolder": "选择左侧的文件夹",
  "drawer.emptyFolder": "空文件夹",
  "drawer.unavailable": "该文件夹在 Mac 上不存在或无法访问",
  "doc.none": "从左侧打开一个文件",
  "doc.loading": "加载中…",
  "doc.imageAlt": "图片",
  "doc.mode": "显示方式",
  "doc.preview": "预览",
  "doc.source": "源码",
  "doc.refreshing": "刷新中…",
  "doc.pullToRefresh": "下拉刷新",
  "doc.releaseToRefresh": "松开刷新",
  "search.title": "搜索",
  "search.placeholder": "搜索内容",
  "search.scopeCurrent": "当前工作区",
  "search.scopeAll": "全部",
  "search.noResults": "没有结果",
  "search.truncated": "结果太多，只显示前一部分",
  "search.back": "返回",
  "settings.title": "连接 Mac",
  "settings.intro": "在 Mac 终端运行 xmark-mobile-server pair，然后扫描二维码，或复制它打印的链接后粘贴。",
  "settings.scan": "扫描二维码",
  "settings.paste": "粘贴配对链接",
  "settings.host": "主机",
  "settings.port": "端口",
  "settings.token": "令牌",
  "settings.save": "保存并连接",
  "settings.test": "测试连接",
  "settings.ok": "已连接，服务版本 {version}",
  "settings.badQr": "这不是 XMark 的配对二维码或链接",
  "settings.invalid": "请填写完整的主机、端口和 64 位令牌",
  "settings.back": "返回",
  "settings.open": "设置",
  "error.network": "连不上 Mac。确认 Mac 开着、Tailscale 已连接、服务在运行。",
  "error.timeout": "Mac 响应超时",
  "error.unauthorized": "令牌无效。请在 Mac 上重新运行 pair 并重新配对。",
  "error.unknown_root": "这个文件夹不再共享",
  "error.not_found": "文件不存在或已被移动",
  "error.bad_path": "路径无效",
  "error.too_large": "文件太大，手机上不显示",
  "error.not_utf8": "文件不是 UTF-8 编码，无法显示",
  "error.unsupported_kind": "手机上不支持这种文件",
  "error.bad_query": "搜索词为空或太长",
  "error.generic": "出错了（{code}）",
  "error.retry": "重试",
  "alert.note": "注意",
  "alert.tip": "提示",
  "alert.important": "重要",
  "alert.warning": "警告",
  "alert.caution": "小心",
} as const;

type Key = keyof typeof zh;

const en: Record<Key, string> = {
  "app.title": "XMark",
  "drawer.open": "Open groups and files",
  "drawer.close": "Close",
  "drawer.groups": "Groups",
  "drawer.files": "Files",
  "drawer.noGroups": "No groups yet. Create a group in XMark on your Mac and add folders to it.",
  "drawer.emptyGroup": "No folders in this group",
  "drawer.pickFolder": "Pick a folder on the left",
  "drawer.emptyFolder": "Empty folder",
  "drawer.unavailable": "This folder is missing or unreadable on the Mac",
  "doc.none": "Open a file from the drawer",
  "doc.loading": "Loading…",
  "doc.imageAlt": "Image",
  "doc.mode": "View as",
  "doc.preview": "Preview",
  "doc.source": "Source",
  "doc.refreshing": "Refreshing…",
  "doc.pullToRefresh": "Pull to refresh",
  "doc.releaseToRefresh": "Release to refresh",
  "search.title": "Search",
  "search.placeholder": "Search notes",
  "search.scopeCurrent": "This workspace",
  "search.scopeAll": "All",
  "search.noResults": "No results",
  "search.truncated": "Too many results; showing the first ones",
  "search.back": "Back",
  "settings.title": "Connect to your Mac",
  "settings.intro": "Run xmark-mobile-server pair in a terminal on the Mac, then scan the QR code or copy the link it prints and paste it.",
  "settings.scan": "Scan QR code",
  "settings.paste": "Paste pairing link",
  "settings.host": "Host",
  "settings.port": "Port",
  "settings.token": "Token",
  "settings.save": "Save and connect",
  "settings.test": "Test connection",
  "settings.ok": "Connected, server {version}",
  "settings.badQr": "That is not an XMark pairing code or link",
  "settings.invalid": "Enter a host, a port and the 64-character token",
  "settings.back": "Back",
  "settings.open": "Settings",
  "error.network": "Can't reach the Mac. Check that it is on, Tailscale is connected and the server is running.",
  "error.timeout": "The Mac took too long to answer",
  "error.unauthorized": "The token is not valid. Run pair on the Mac again and re-pair.",
  "error.unknown_root": "This folder is no longer shared",
  "error.not_found": "The file is missing or was moved",
  "error.bad_path": "Invalid path",
  "error.too_large": "Too large to show on the phone",
  "error.not_utf8": "Not UTF-8 text; cannot show it",
  "error.unsupported_kind": "This kind of file is not supported on the phone",
  "error.bad_query": "The search is empty or too long",
  "error.generic": "Something went wrong ({code})",
  "error.retry": "Retry",
  "alert.note": "Note",
  "alert.tip": "Tip",
  "alert.important": "Important",
  "alert.warning": "Warning",
  "alert.caution": "Caution",
};

let table: Record<Key, string> = typeof navigator !== "undefined" && !navigator.language.startsWith("zh") ? en : zh;

/** Test hook and the single switch point. */
export function setLanguage(lang: "zh" | "en"): void {
  table = lang === "zh" ? zh : en;
}

export function t(key: Key, vars: Record<string, string> = {}): string {
  return table[key].replace(/\{(\w+)\}/g, (_m, name: string) => vars[name] ?? "");
}

const ERROR_KEYS = new Set<string>(["network", "timeout", "unauthorized", "unknown_root", "not_found", "bad_path", "too_large", "not_utf8", "unsupported_kind", "bad_query"]);

/** User-facing text for an API error code. */
export function errorText(code: string): string {
  return ERROR_KEYS.has(code) ? t(`error.${code}` as Key) : t("error.generic", { code });
}

export const LOCALES = { zh, en };
