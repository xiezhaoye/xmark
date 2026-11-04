# XMark Mobile

Read-only iPhone reader for the workspace groups on your Mac, served by
[`xmark-mobile-server`](../server/mobile/README.md) over Tailscale — plus the
folders that live ON the phone itself.

## What it reads

Two kinds of source, listed together and switched from the same place:

| Source | Where its content comes from | Notes |
|---|---|---|
| **Mac**（配对来的服务器） | `xmark-mobile-server` over Tailscale | read-only; groups and folders come from the Mac |
| **本机**（this iPhone） | folders the user picked in the system document picker | always first in the list; groups and folders belong to the phone |

「本机」 is one row, not one row per folder. Inside it: one fixed group
（「本机文件夹」）holding the picked folders. Folders can be added, renamed,
deleted and dragged between positions from the drawer; the group itself is not
editable.

Access to a picked folder is an iOS **security-scoped bookmark** (stored in
`plugins/localfs`, Swift side). The apps's list of folders/groups is separate
state (`src/state/localLibrary.ts`, localStorage); a bookmark that no longer
resolves is dropped from the list at launch, and removing a folder drops its
bookmark.

## Build and install (free Apple ID)

One-time on the Mac: Xcode, `rustup target add aarch64-apple-ios aarch64-apple-ios-sim`,
`brew install cocoapods`, then `pnpm --dir mobile tauri ios init`.
Set `bundle.iOS.developmentTeam` in `src-tauri/tauri.conf.json` to your team id,
and sign in to that Apple ID in **Xcode → Settings → Accounts** — a team entry
alone is not enough, and without the account `xcodebuild` fails with
`No Accounts: Add a new account in Accounts settings`.

```sh
export LANG=en_US.UTF-8
pnpm --dir mobile ios:device
unzip -oq mobile/src-tauri/gen/apple/build/arm64/XMark.ipa -d /tmp/xmark-ipa
xcrun devicectl device install app --device <udid> /tmp/xmark-ipa/Payload/XMark.app
xcrun devicectl device process launch --device <udid> app.xmark.mobile
```

A free-account build expires after 7 days; rebuild and reinstall. `pnpm --dir
mobile ios:sim` builds for the simulator. The device does not have to be plugged
in once it is paired for wireless debugging.

**Do not call `xcodebuild` directly** on the generated project: its
"Build Rust Code" phase reads a temporary options file that only exists while
`tauri ios build` is running, so a bare `xcodebuild` fails at that phase. Build
through the Tauri CLI and let it drive Xcode.

## Native plugins

`plugins/share`（system share sheet）and `plugins/localfs`（picked folders:
picker + bookmarks in Swift, listing/reads in Rust）. Adding a plugin needs a
re-run of `pnpm --dir mobile tauri ios init` so the Xcode project and the ACL
schema regenerate, and the Swift half must export
`@_cdecl("init_plugin_<plugin>")` — without it the link step fails with
`Undefined symbols: _init_plugin_<plugin>`.

Reading is deliberately lenient where a phone's files are messy: text decodes as
UTF-8 → GB18030 → lossy UTF-8（中文 `.txt` 常是 GBK）, and the local text ceiling
is 40 MB（a novel is bigger than the server's 5 MB bound）.

## Develop

`pnpm --dir mobile dev` serves the UI in a desktop browser (HTTP then uses
`window.fetch`, which the server's missing CORS headers will block — use the
simulator for real data). Tests: `pnpm --dir mobile test`. The local folder path
does nothing outside Tauri: every `platformLocalFS` call reports "no local
folders" so the rest of the app needs no platform branch.
