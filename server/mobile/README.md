# xmark-mobile-server

Read-only HTTP server that lets the XMark Mobile iPhone app browse the
folders in XMark's workspace groups, over Tailscale.

- Reads `~/Library/Application Support/app.xmark/mobile-share.json`, which
  XMark desktop rewrites whenever the workspace groups change. Only folders
  in a group are served; "Ungrouped" workspaces never are.
- Binds the Mac's Tailscale IPv4 only (port 8740) and requires a bearer
  token on every request. No CORS unless `XMARK_MOBILE_CORS_ORIGINS` lists
  the origins a browser build may call from (off by default).

## Use

```sh
pnpm --dir server/mobile build
node server/mobile/dist/cli.js install-agent   # start now and at every login (launchd)
node server/mobile/dist/cli.js pair            # QR code for the phone (named after this Mac)
node server/mobile/dist/cli.js pair --name 书房 # or pick the name shown in the app
```

| Command | Does |
|---|---|
| `serve` | Serve (what the launchd agent runs) |
| `pair [--name <名称>]` | Print the pairing QR code and fields; the name defaults to this Mac's hostname (without `.local`) |
| `rotate-token` | Replace the token; the phone must pair again |
| `install-agent` / `uninstall-agent` | Manage `~/Library/LaunchAgents/app.xmark.mobile-server.plist` |

Logs: `~/Library/Logs/xmark-mobile-server.log`.

| Variable | Default |
|---|---|
| `XMARK_APP_IDENTIFIER` | `app.xmark` (`app.vmark.dev` for the dev build) |
| `XMARK_MOBILE_PORT` | `8740` |
| `XMARK_MOBILE_SHARE_FILE`, `XMARK_MOBILE_TOKEN_FILE` | under the app's support directory |
| `XMARK_MOBILE_HOST` | the Tailscale IPv4 (override for local testing only) |
| `XMARK_MOBILE_CORS_ORIGINS` | empty — no CORS; a comma-separated list of `http(s)://host[:port]` origins to allow (browser build) |

## API

All `GET`, all need `Authorization: Bearer <token>`:
`/api/health`, `/api/workspaces`, `/api/tree?root&path`, `/api/file?root&path`,
`/api/asset?root&path`, `/api/search?q&root?`.
