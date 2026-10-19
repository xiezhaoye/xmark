# xmark-mobile-server

Read-only HTTP server that lets the XMark Mobile iPhone app browse the
folders in XMark's workspace groups, over Tailscale.

- Reads `mobile-share.json`, which XMark desktop rewrites whenever the
  workspace groups change. On macOS it lives in
  `~/Library/Application Support/app.xmark/`; on Linux the data directory is
  `$XDG_DATA_HOME/app.xmark/` (`~/.local/share/app.xmark/` by default), where
  no desktop app writes it — `share add` does (see below). Only folders in a
  group are served; "Ungrouped" workspaces never are.
- Binds the machine's Tailscale IPv4 only (port 8740) and requires a bearer
  token on every request. No CORS unless `XMARK_MOBILE_CORS_ORIGINS` lists
  the origins a browser build may call from (off by default).

## Use

```sh
pnpm --dir server/mobile build
node server/mobile/dist/cli.js install-agent   # start now and at every login (launchd / systemd)
node server/mobile/dist/cli.js pair            # QR code for the phone (named after this machine)
node server/mobile/dist/cli.js pair --name 书房 # or pick the name shown in the app
```

| Command | Does |
|---|---|
| `serve` | Serve (what the login agent runs) |
| `pair [--name <名称>]` | Print the pairing QR code and fields; the name defaults to this machine's hostname (without `.local`) |
| `rotate-token` | Replace the token; the phone must pair again |
| `install-agent` / `uninstall-agent` | Manage the login agent: `~/Library/LaunchAgents/app.xmark.mobile-server.plist` on macOS, a systemd user unit on Linux |
| `share list` / `add` / `remove` | Edit the shared folders directly, for a machine without the desktop app |

macOS logs: `~/Library/Logs/xmark-mobile-server.log`.

### Linux (systemd user service)

Needs Node ≥ 22 and Tailscale. `install-agent` writes
`~/.config/systemd/user/xmark-mobile-server.service` and runs
`systemctl --user daemon-reload && systemctl --user enable --now xmark-mobile-server`.

```sh
node server/mobile/dist/cli.js install-agent
node server/mobile/dist/cli.js share add 笔记 ~/notes   # no desktop app? pick the folders here
node server/mobile/dist/cli.js pair
journalctl --user -u xmark-mobile-server -f              # logs
```

A user unit stops when the last session ends. To keep the server up after
logout, run `sudo loginctl enable-linger <user>` once — the installer only
prints this hint, it never enables lingering itself.

`uninstall-agent` stops and disables the service and removes the unit.

### `share` — shared folders without the desktop app

On a machine with the desktop app, XMark writes `mobile-share.json` and these
commands would fight it: both write the same file and the last write wins.
Use them only where the desktop app does not run.

```sh
node server/mobile/dist/cli.js share list
node server/mobile/dist/cli.js share add <分组> <绝对路径>   # the folder must exist
node server/mobile/dist/cli.js share remove <分组> [路径]    # no path: drop the whole group
```

The format is the desktop app's (`{"version":1,"groups":[…]}`), written
atomically with mode 0600; a running server picks the change up without a
restart. A file that does not parse is reported and left untouched.

| Variable | Default |
|---|---|
| `XMARK_APP_IDENTIFIER` | `app.xmark` (`app.vmark.dev` for the dev build) |
| `XMARK_MOBILE_PORT` | `8740` |
| `XMARK_MOBILE_SHARE_FILE`, `XMARK_MOBILE_TOKEN_FILE` | under the app's data directory (macOS: `~/Library/Application Support/<appId>/`, Linux: `$XDG_DATA_HOME/<appId>/`, i.e. `~/.local/share/<appId>/`) |
| `XDG_DATA_HOME` | Linux only: the data directory root (`~/.local/share`) |
| `XMARK_MOBILE_HOST` | the Tailscale IPv4 (override for local testing only) |
| `XMARK_MOBILE_CORS_ORIGINS` | empty — no CORS; a comma-separated list of `http(s)://host[:port]` origins to allow (browser build) |

## API

All `GET`, all need `Authorization: Bearer <token>`:
`/api/health`, `/api/workspaces`, `/api/tree?root&path`, `/api/file?root&path`,
`/api/asset?root&path`, `/api/search?q&root?`.
