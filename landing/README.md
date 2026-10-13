# XMark landing page

The download page at https://xmark.xiezhaoye.site, served as static assets
on Cloudflare Workers. Installers live in the R2 bucket `xmark-releases`,
served at https://xmark-dl.xiezhaoye.site.

| File | Purpose |
|---|---|
| `index.html` | Page template; `{{VERSION}}`, `{{DMG_URL}}`, `{{DMG_SIZE}}` are filled by `build.mjs` |
| `logo.svg` | Logo and favicon |
| `release.json` | The current release: file names, size, updater signature |
| `build.mjs` | Writes `dist/`, including `/update/latest.json` for the in-app updater |
| `release.mjs` | Publishes a built version to R2, this page and GitHub Releases |
| `wrangler.jsonc` | Cloudflare deployment config |

Release a new version (after bumping the version, tagging and running
`pnpm tauri build` with the updater key):

```bash
HTTPS_PROXY=http://127.0.0.1:7890 node landing/release.mjs
```

Change only the page: edit `index.html`, then `node landing/build.mjs` and
`npx wrangler deploy` from `landing/`.
