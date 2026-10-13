// Builds the XMark landing page into landing/dist from index.html and
// release.json: fills in the download link and writes the updater manifest
// served at /update/latest.json (its archive URL points at the R2 download
// domain, so updates work without reaching GitHub).
import { copyFileSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const here = import.meta.dirname;
const dist = join(here, "dist");
const DOWNLOAD_ORIGIN = "https://xmark-dl.xiezhaoye.site";

const release = JSON.parse(readFileSync(join(here, "release.json"), "utf8"));
const html = readFileSync(join(here, "index.html"), "utf8")
  .replaceAll("{{VERSION}}", release.version)
  .replaceAll("{{DMG_URL}}", `${DOWNLOAD_ORIGIN}/${release.dmgFile}`)
  .replaceAll("{{DMG_SIZE}}", String(release.dmgSizeMB));
if (html.includes("{{")) throw new Error("index.html has an unfilled placeholder");

const manifest = {
  version: release.version,
  notes: release.notes,
  pub_date: `${release.date}T00:00:00Z`,
  platforms: {
    "darwin-aarch64": {
      signature: release.updaterSignature,
      url: `${DOWNLOAD_ORIGIN}/${release.updaterFile}`,
    },
  },
};

rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, "update"), { recursive: true });
writeFileSync(join(dist, "index.html"), html);
copyFileSync(join(here, "logo.svg"), join(dist, "logo.svg"));
cpSync(join(here, "screenshots"), join(dist, "screenshots"), { recursive: true });
writeFileSync(join(dist, "update", "latest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(
  join(dist, "_headers"),
  "/update/*\n  Cache-Control: no-cache\n  Access-Control-Allow-Origin: *\n",
);
console.log(`built landing/dist for XMark ${release.version}`);
