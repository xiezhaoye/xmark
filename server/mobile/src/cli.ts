/**
 * Process entry point; all behaviour lives in `cliMain`.
 *
 * @module cli
 */
import { fileURLToPath } from "node:url";
import { homedir, hostname } from "node:os";
import { runCli } from "./cliMain";
import { runCommand } from "./tailscale";

declare const __VERSION__: string | undefined;

const code = await runCli(process.argv.slice(2), {
  env: process.env,
  home: homedir(),
  hostname,
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  run: runCommand,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  version: typeof __VERSION__ === "string" ? __VERSION__ : "dev",
  nodePath: process.execPath,
  cliPath: fileURLToPath(import.meta.url),
  uid: process.getuid?.() ?? 501,
  exit: (c) => process.exit(c),
});
if (code !== 0) process.exit(code);
