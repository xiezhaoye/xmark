/**
 * Finding this Mac's Tailscale address and MagicDNS name.
 *
 * The server binds the Tailscale IPv4 only, so nothing on the LAN can reach
 * it. Under launchd the PATH is minimal, so several known install locations
 * of the CLI are tried in turn.
 *
 * @module tailscale
 */
import { execFile } from "node:child_process";

export type RunCommand = (cmd: string, args: string[]) => Promise<string>;

const TAILSCALE_CANDIDATES = [
  "tailscale",
  "/usr/local/bin/tailscale",
  "/opt/homebrew/bin/tailscale",
  "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
];

export const runCommand: RunCommand = (cmd, args) =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 5_000 }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });

async function firstOutput(run: RunCommand, args: string[]): Promise<string | null> {
  for (const bin of TAILSCALE_CANDIDATES) {
    try {
      return await run(bin, args);
    } catch {
      // Try the next location.
    }
  }
  return null;
}

/** True for 100.64.0.0/10, the range Tailscale assigns. */
function isTailscaleIPv4(ip: string): boolean {
  const m = /^100\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return false;
  const [b, c, d] = m.slice(1).map(Number);
  return b >= 64 && b <= 127 && c <= 255 && d <= 255;
}

export async function findTailscaleIPv4(run: RunCommand = runCommand): Promise<string | null> {
  const out = await firstOutput(run, ["ip", "-4"]);
  return out?.split(/\s+/).find(isTailscaleIPv4) ?? null;
}

export async function findTailscaleDnsName(run: RunCommand = runCommand): Promise<string | null> {
  const out = await firstOutput(run, ["status", "--json"]);
  if (!out) return null;
  try {
    const name = (JSON.parse(out) as { Self?: { DNSName?: unknown } }).Self?.DNSName;
    return typeof name === "string" && name ? name.replace(/\.$/, "") : null;
  } catch {
    return null;
  }
}

/** Block until Tailscale is up (at login it can start after launchd runs us). */
export async function waitForTailscaleIPv4(
  run: RunCommand,
  { sleep, log, retryMs = 5_000 }: { sleep: (ms: number) => Promise<void>; log: (m: string) => void; retryMs?: number },
): Promise<string> {
  let logged = false;
  for (;;) {
    const ip = await findTailscaleIPv4(run);
    if (ip) return ip;
    if (!logged) {
      log("Waiting for Tailscale to come up…");
      logged = true;
    }
    await sleep(retryMs);
  }
}
