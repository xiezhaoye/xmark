// One-command XMark release, run after `pnpm tauri build` has produced the
// signed bundle (TAURI_SIGNING_PRIVATE_KEY set). From the repo root:
//
//   HTTPS_PROXY=http://127.0.0.1:7890 node landing/release.mjs
//
// It publishes the version in src-tauri/tauri.conf.json to both channels:
//   1. Cloudflare: uploads the .dmg and the updater archive to the R2 bucket
//      behind xmark-dl.xiezhaoye.site, rewrites landing/release.json, rebuilds
//      the landing page and deploys it (download button + /update/latest.json).
//   2. GitHub: creates release vX.Y.Z (tag must already be pushed) with the
//      CHANGELOG section as notes and its own latest.json pointing at GitHub.
// Pass --skip-github to publish to Cloudflare only.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const bundle = join(root, "src-tauri/target/release/bundle");
const BUCKET = "xmark-releases";
const REPO = "xiezhaoye/xmark";
const skipGithub = process.argv.includes("--skip-github");

const run = (cmd, args, opts = {}) => {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  return execFileSync(cmd, args, { stdio: "inherit", cwd: root, ...opts });
};

const { version } = JSON.parse(readFileSync(join(root, "src-tauri/tauri.conf.json"), "utf8"));
const dmgName = `XMark_${version}_aarch64.dmg`;
const dmgPath = join(bundle, "dmg", dmgName);
const archivePath = join(bundle, "macos", "XMark.app.tar.gz");
const signature = readFileSync(`${archivePath}.sig`, "utf8").trim();
const archiveKey = `v${version}/XMark_aarch64.app.tar.gz`;
const notes = execFileSync("node", ["scripts/extract-changelog-section.mjs", version], {
  cwd: root,
  encoding: "utf8",
}).trim();
const today = new Date().toISOString().slice(0, 10);

// 1. Cloudflare
run("npx", ["wrangler", "r2", "object", "put", `${BUCKET}/${dmgName}`, "--remote",
  "--file", dmgPath, "--content-type", "application/x-apple-diskimage",
  "--content-disposition", `attachment; filename="${dmgName}"`]);
run("npx", ["wrangler", "r2", "object", "put", `${BUCKET}/${archiveKey}`, "--remote",
  "--file", archivePath, "--content-type", "application/gzip"]);

const release = {
  version,
  date: today,
  dmgFile: dmgName,
  dmgSizeMB: Math.round(statSync(dmgPath).size / 1024 / 1024),
  updaterFile: archiveKey,
  updaterSignature: signature,
  notes: `XMark ${version}`,
};
writeFileSync(join(root, "landing/release.json"), `${JSON.stringify(release, null, 2)}\n`);
run("node", ["landing/build.mjs"]);
run("npx", ["wrangler", "deploy"], { cwd: join(root, "landing") });

// 2. GitHub
if (!skipGithub) {
  const work = mkdtempSync(join(tmpdir(), "xmark-release-"));
  const archiveAsset = join(work, "XMark_aarch64.app.tar.gz");
  writeFileSync(archiveAsset, readFileSync(archivePath));
  writeFileSync(join(work, "latest.json"), `${JSON.stringify({
    version,
    notes: release.notes,
    pub_date: `${today}T00:00:00Z`,
    platforms: { "darwin-aarch64": {
      signature,
      url: `https://github.com/${REPO}/releases/download/v${version}/XMark_aarch64.app.tar.gz`,
    } },
  }, null, 2)}\n`);
  writeFileSync(join(work, "notes.md"), `${notes}\n\n## 首次打开 / First launch\n\n`
    + "安装包未经 Apple 公证。首次打开时请到「系统设置 → 隐私与安全性」点「仍要打开」，或在终端执行：\n"
    + "`xattr -dr com.apple.quarantine /Applications/XMark.app`\n\n"
    + "Not notarized: on first launch, use System Settings → Privacy & Security → Open Anyway.\n");
  // Create as a draft, upload one file at a time, then publish: a failed
  // upload inside `gh release create` deletes the whole release.
  run("gh", ["release", "create", `v${version}`, "-R", REPO, "--draft", "--verify-tag",
    "--title", `XMark ${version}`, "--notes-file", join(work, "notes.md")]);
  for (const file of [dmgPath, archiveAsset, `${archivePath}.sig`, join(work, "latest.json")]) {
    run("gh", ["release", "upload", `v${version}`, "-R", REPO, "--clobber", file]);
  }
  run("gh", ["release", "edit", `v${version}`, "-R", REPO, "--draft=false", "--latest"]);
}
console.log(`\nXMark ${version} published.`);
