# XMark Mobile

Read-only iPhone reader for the workspace groups on your Mac, served by
[`xmark-mobile-server`](../server/mobile/README.md) over Tailscale.

## Build and install (free Apple ID)

One-time on the Mac: Xcode, `rustup target add aarch64-apple-ios aarch64-apple-ios-sim`,
`brew install cocoapods`, then `pnpm --dir mobile tauri ios init`.
Set `bundle.iOS.developmentTeam` in `src-tauri/tauri.conf.json` to your team id.

```sh
export LANG=en_US.UTF-8
pnpm --dir mobile ios:device
unzip -oq mobile/src-tauri/gen/apple/build/arm64/XMark.ipa -d /tmp/xmark-ipa
xcrun devicectl device install app --device <udid> /tmp/xmark-ipa/Payload/XMark.app
```

A free-account build expires after 7 days; rebuild and reinstall.
`pnpm --dir mobile ios:sim` builds for the simulator.

## Develop

`pnpm --dir mobile dev` serves the UI in a desktop browser (HTTP then uses
`window.fetch`, which the server's missing CORS headers will block — use the
simulator for real data). Tests: `pnpm --dir mobile test`.
