# xmark-mobile-server

Read-only HTTP server that lets the XMark Mobile iPhone app browse the
folders in XMark's workspace groups, over Tailscale.

- Reads `~/Library/Application Support/app.xmark/mobile-share.json`, which
  XMark desktop rewrites whenever the workspace groups change. Only folders
  in a group are served; "Ungrouped" workspaces never are.
- Binds the Mac's Tailscale IPv4 only (port 8740) and requires a bearer
  token on every request. No CORS.

## Use

```sh
pnpm --dir server/mobile build
node server/mobile/dist/cli.js install-agent   # start now and at every login (launchd)
node server/mobile/dist/cli.js pair            # QR code for the phone
```

| Command | Does |
|---|---|
| `serve` | Serve (what the launchd agent runs) |
| `pair` | Print the pairing QR code and fields |
| `rotate-token` | Replace the token; the phone must pair again |
| `install-agent` / `uninstall-agent` | Manage `~/Library/LaunchAgents/app.xmark.mobile-server.plist` |

Logs: `~/Library/Logs/xmark-mobile-server.log`.

| Variable | Default |
|---|---|
| `XMARK_APP_IDENTIFIER` | `app.xmark` (`app.vmark.dev` for the dev build) |
| `XMARK_MOBILE_PORT` | `8740` |
| `XMARK_MOBILE_SHARE_FILE`, `XMARK_MOBILE_TOKEN_FILE` | under the app's support directory |
| `XMARK_MOBILE_HOST` | the Tailscale IPv4 (override for local testing only) |

## API

All `GET`, all need `Authorization: Bearer <token>`:
`/api/health`, `/api/workspaces`, `/api/tree?root&path`, `/api/file?root&path`,
`/api/asset?root&path`, `/api/search?q&root?`.
