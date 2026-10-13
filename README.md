# XMark

**English** · [简体中文](README.zh-CN.md)

**A plain-text workspace for you and your AI, organized around your folders.**

XMark is a free, local-first editor for macOS. You and your AI assistant read
and write the same files — Markdown, YAML, JSON, TOML, Mermaid, SVG, HTML and
code — and XMark keeps many project folders at hand in a three-column layout:
workspaces, file tree, document.

**[Download for macOS](https://github.com/xiezhaoye/xmark/releases/latest)** · **[Changelog](CHANGELOG.md)** · **[Report a problem](https://github.com/xiezhaoye/xmark/issues)**

> XMark is an unofficial fork of [VMark](https://github.com/xiaolai/vmark) by
> Xiaolai Li. It is not affiliated with or endorsed by the original author.
> Please report problems with XMark in **this** repository, not upstream.

---

## What XMark adds

**Three columns** — workspaces · file tree · document

- The first column lists your open workspaces by their **full folder name**
  (hover for the full path). Drag its edge to resize it.
- Duplicate, move to a new window and close live in the right-click menu,
  so nothing gets clicked by accident.

**Workspace groups**

- Click **New Group** at the bottom of the first column. Add folders from a
  workspace's right-click menu or the group's **+** button; one folder can be
  in several groups.
- Click a group's name to expand or collapse it. Groups are remembered across
  restarts; a folder that is not open yet is shown outlined and opens with a
  click.
- Open workspaces that belong to no group are listed under **Ungrouped**.

**Columns that fold away**

- Each side column folds into a thin strip. Click anywhere on the strip to
  bring the column back; `Cmd+\` toggles the file column.

**Smaller touches**

- **Settings → Appearance → Sidebar text size** (13–16 px) for the first two
  columns.
- In the file tree, click a folder's row to open or close it. Rows cannot be
  dragged, so trackpad taps work the first time.
- A tidier file-tree toolbar, with the Files / Outline / History switcher at
  the bottom and an eye icon for showing every file.

## Also in XMark

These come from VMark and work the same way in XMark.

- **Multi-Format** — Edit Markdown visually or as source, plus JSON / JSONL, YAML, TOML, Mermaid, SVG, sandboxed HTML and plain text. Code files (.ts, .py, .rs, .go, .css, …) open highlighted and read-only; switch to editing with one click or hand them to your `$EDITOR`.
- **Smart previews for config files** — A GitHub Actions workflow shows up as a job graph; `Cargo.toml`, `package.json` and `pyproject.toml` show their dependencies as a tree; any other JSON, YAML or TOML gets a tree you can browse.
- **AI-Native** — Connect Claude Desktop, Claude Code, Codex CLI, Antigravity CLI, Grok CLI, and opencode over MCP so they can work in the same files you do. Built-in AI Genies help with writing right where you type.
- **Three ways to write Markdown** — Visual editing, a quick look at the source with `F5`, or a full source editor with `F6`.
- **Multi-Cursor** — `Mod + D` adds the next match, `Alt + Click` places extra cursors, `Mod + Alt + ↑↓` adds cursors above or below.
- **Smart brackets** — Brackets and quotes close themselves; Tab jumps past the closing one.
- **Built for CJK** — More than 20 formatting rules for mixing Chinese, Japanese or Korean with Latin text.
- **10 Languages** — English · 简体中文 · 繁體中文 · 日本語 · 한국어 · Deutsch · Español · Français · Italiano · Português (Brasil).
- **6 Themes** — White, Paper, Mint, Sepia, Night, Solarized on macOS; Windows and Linux offer White and Night.
- **Local-first** — No cloud, no account, no tracking. Your files stay on your Mac.
- **Shortcuts** — Change any of them in Settings.

---

## Download

Get the latest `.dmg` from
[Releases](https://github.com/xiezhaoye/xmark/releases/latest). XMark is built
for Macs with Apple silicon (M1 or later).

XMark is not notarized by Apple, so macOS blocks the **first** launch. After
dragging XMark into Applications, open it once, then go to **System Settings →
Privacy & Security** and click **Open Anyway** next to the XMark message. Or
run this in Terminal:

```bash
xattr -dr com.apple.quarantine /Applications/XMark.app
```

After that, XMark opens normally and updates itself from inside the app. It
can be installed next to VMark: the two keep separate settings and updates.

---

## AI Integration

XMark connects to AI assistants through [MCP](https://modelcontextprotocol.io/).
Open **Settings → Integrations** and click **Install** next to an assistant.

Supported: Claude Desktop, Claude Code, Codex CLI, Antigravity CLI, Grok CLI, opencode.

XMark adds itself to each assistant's settings as `xmark`, so it does not
clash with an installed VMark.

---

## Feedback

Found a bug or have an idea? Open an
[issue](https://github.com/xiezhaoye/xmark/issues). Please describe what you
did, what you expected and what happened instead; a screenshot helps.

---

## Building from Source

**You need:** [Node.js](https://nodejs.org/) 22 or 24 (Node 25 is refused by
some dependencies), [pnpm](https://pnpm.io/) 10, [Rust](https://www.rust-lang.org/tools/install)
1.89 or newer, and the [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/).

```bash
git clone https://github.com/xiezhaoye/xmark.git
cd xmark
pnpm install

# Build the MCP helper once; a fresh clone does not include it.
pnpm --dir server/mcp build:sidecar

pnpm tauri:dev        # run a development build
pnpm tauri build      # build the app
```

**Built with:** Tauri v2 (Rust), React 19, TypeScript, Zustand v5, Tiptap,
CodeMirror 6, Tailwind CSS v4.

---

## Credits and License

XMark is built on [VMark](https://github.com/xiaolai/vmark) by Xiaolai Li —
thank you for making it open source.

XMark uses the same [ISC License](LICENSE) as VMark: free to use, copy, modify
and distribute. The original copyright notice is kept; XMark's changes are
Copyright (c) 2026 xiezhaoye.
