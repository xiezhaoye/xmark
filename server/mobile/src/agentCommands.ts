/**
 * `install-agent` / `uninstall-agent`: the login service, per platform.
 *
 * macOS gets a launchd agent in `~/Library/LaunchAgents`, Linux a systemd user
 * unit; a platform with neither is refused clearly instead of half-installed.
 * A supervisor starts with almost no environment, so the PATH the service runs
 * with is written into the unit — `tailscale` is found through it.
 *
 * The installed command is always `<node> <cli.js> serve`: the agent exists to
 * run the server, and nothing here configures Tailscale itself.
 *
 * @module agentCommands
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { userInfo } from "node:os";
import * as path from "node:path";
import { buildLaunchAgentPlist, LAUNCH_AGENT_LABEL } from "./launchAgent";
import type { CliDeps } from "./cliMain";
import { buildSystemdUnit, SYSTEMD_UNIT_NAME } from "./systemdUnit";

const LAUNCHD_PATH_ENV = "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin";
const SYSTEMD_PATH_ENV = "/usr/local/bin:/usr/bin:/usr/sbin:/bin:/sbin";

function agentPaths(deps: CliDeps) {
  return {
    plist: path.join(deps.home, "Library", "LaunchAgents", `${LAUNCH_AGENT_LABEL}.plist`),
    log: path.join(deps.home, "Library", "Logs", "xmark-mobile-server.log"),
  };
}

function systemdPaths(deps: CliDeps) {
  return { unit: path.join(deps.home, ".config", "systemd", "user", SYSTEMD_UNIT_NAME) };
}

async function installLaunchAgent(deps: CliDeps): Promise<number> {
  const p = agentPaths(deps);
  const plist = buildLaunchAgentPlist({
    nodePath: deps.nodePath,
    cliPath: deps.cliPath,
    logPath: p.log,
    pathEnv: LAUNCHD_PATH_ENV,
  });
  await mkdir(path.dirname(p.plist), { recursive: true });
  await mkdir(path.dirname(p.log), { recursive: true });
  await deps.run("launchctl", ["bootout", `gui/${deps.uid}/${LAUNCH_AGENT_LABEL}`]).catch(() => "");
  await writeFile(p.plist, plist);
  await deps.run("launchctl", ["bootstrap", `gui/${deps.uid}`, p.plist]);
  deps.stdout(`Installed ${p.plist}\nLogs: ${p.log}\n`);
  return 0;
}

async function uninstallLaunchAgent(deps: CliDeps): Promise<number> {
  const p = agentPaths(deps);
  await deps.run("launchctl", ["bootout", `gui/${deps.uid}/${LAUNCH_AGENT_LABEL}`]).catch(() => "");
  await rm(p.plist, { force: true });
  deps.stdout(`Removed ${p.plist}\n`);
  return 0;
}

async function installSystemdUnit(deps: CliDeps): Promise<number> {
  const p = systemdPaths(deps);
  const unit = buildSystemdUnit({ nodePath: deps.nodePath, cliPath: deps.cliPath, pathEnv: SYSTEMD_PATH_ENV });
  await mkdir(path.dirname(p.unit), { recursive: true });
  await writeFile(p.unit, unit);
  // `daemon-reload` first: the unit is new on disk, and `enable --now` would
  // otherwise enable a file systemd has not read.
  await deps.run("systemctl", ["--user", "daemon-reload"]);
  await deps.run("systemctl", ["--user", "enable", "--now", SYSTEMD_UNIT_NAME]);
  const user = (deps.userName ?? (() => userInfo().username))();
  deps.stdout(
    `Installed ${p.unit}\n` +
      `Logs: journalctl --user -u ${SYSTEMD_UNIT_NAME.replace(/\.service$/, "")} -f\n` +
      `To keep the service running after you log out, run: sudo loginctl enable-linger ${user}\n`,
  );
  return 0;
}

async function uninstallSystemdUnit(deps: CliDeps): Promise<number> {
  const p = systemdPaths(deps);
  await deps.run("systemctl", ["--user", "disable", "--now", SYSTEMD_UNIT_NAME]).catch(() => "");
  await rm(p.unit, { force: true });
  await deps.run("systemctl", ["--user", "daemon-reload"]).catch(() => "");
  deps.stdout(`Removed ${p.unit}\n`);
  return 0;
}

interface AgentServices {
  install: (deps: CliDeps) => Promise<number>;
  uninstall: (deps: CliDeps) => Promise<number>;
}

/** Each platform's service: launchd on macOS, a systemd user unit everywhere else. */
function servicesFor(platform: NodeJS.Platform): AgentServices {
  if (platform === "darwin") return { install: installLaunchAgent, uninstall: uninstallLaunchAgent };
  return { install: installSystemdUnit, uninstall: uninstallSystemdUnit };
}

/** A platform with neither launchd nor systemd gets a clear refusal, not a half-install. */
function refuse(platform: NodeJS.Platform, command: string, deps: CliDeps): boolean {
  if (platform === "darwin" || platform === "linux") return false;
  deps.stderr(`${command} is not supported on ${platform}; only macOS (launchd) and Linux (systemd) are.\n`);
  return true;
}

/** `install-agent`, injected through `CliDeps` so a test never touches this Mac. */
export async function installAgent(_argv: string[], deps: CliDeps): Promise<number> {
  if (refuse(deps.platform, "install-agent", deps)) return 1;
  return servicesFor(deps.platform).install(deps);
}

/** `uninstall-agent`. */
export async function uninstallAgent(_argv: string[], deps: CliDeps): Promise<number> {
  if (refuse(deps.platform, "uninstall-agent", deps)) return 1;
  return servicesFor(deps.platform).uninstall(deps);
}
