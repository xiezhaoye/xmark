/**
 * The `xmark-mobile-server` commands, with every side effect injected.
 *
 *   serve            bind the Tailscale IPv4 and serve (the agent entry point)
 *   pair [--name N]  print the pairing QR code and fields
 *   rotate-token     replace the token; the phone must pair again
 *   install-agent    install and start the login agent (launchd / systemd --user)
 *   uninstall-agent  stop and remove it
 *   share …          list, add or remove shared folders without the desktop app
 *
 * `serve` re-checks the Tailscale address every minute and exits when it
 * changes, letting the supervisor restart it on the new address.
 *
 * @module cliMain
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { userInfo } from "node:os";
import * as path from "node:path";
import { resolveConfig, type Env } from "./config";
import { createApp } from "./createApp";
import { buildLaunchAgentPlist, LAUNCH_AGENT_LABEL } from "./launchAgent";
import { renderPairing } from "./pairing";
import { createRegistrySource } from "./registry";
import { runShareCommand } from "./shareCli";
import { startServer as defaultStartServer, type RunningServer } from "./runtime";
import { findTailscaleDnsName, findTailscaleIPv4, waitForTailscaleIPv4, type RunCommand } from "./tailscale";
import { buildSystemdUnit, SYSTEMD_UNIT_NAME } from "./systemdUnit";
import { createTokenSource, loadOrCreateToken, rotateToken } from "./token";
import type { Hono } from "hono";

export interface CliDeps {
  env: Env;
  home: string;
  /** This Mac's Bonjour name, used as the default server name when pairing. */
  hostname: () => string;
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  run: RunCommand;
  sleep: (ms: number) => Promise<void>;
  version: string;
  nodePath: string;
  cliPath: string;
  uid: number;
  /** Which service manager `install-agent` uses: launchd on darwin, systemd otherwise. */
  platform: NodeJS.Platform;
  exit: (code: number) => void;
  /** Resolve the login user for the linger hint (tests pin it). */
  userName?: () => string;
  startServer?: (o: { app: Hono; hostname: string; port: number }) => Promise<RunningServer>;
  /** Run `fn` periodically; returns a canceller. */
  watch?: (fn: () => Promise<void>) => () => void;
  /** Receives a stopper for a started server (tests close it). */
  onStop?: (stop: () => Promise<void>) => void;
}

const USAGE = `Usage: xmark-mobile-server <command>

  serve            Serve shared workspace groups on the Tailscale address
  pair [--name N]  Show the pairing QR code for XMark Mobile (default name: this Mac's hostname)
  rotate-token     Replace the pairing token (the phone must pair again)
  install-agent    Start at login: launchd agent on macOS, systemd user service on Linux
  uninstall-agent  Remove that agent
  share list | add <group> <path> | remove <group> [path]
                   Edit the shared folders directly, for machines without the desktop app
`;

const IP_CHECK_MS = 60_000;

/**
 * Read `--name <value>` / `--name=<value>` out of a command's arguments.
 * Anything else is left alone: the CLI takes no other options.
 */
export function parsePairArgs(argv: string[]): { name?: string } {
  const i = argv.indexOf("--name");
  if (i >= 0) {
    const value = argv[i + 1];
    return value && !value.startsWith("--") ? { name: value } : {};
  }
  const inline = argv.find((a) => a.startsWith("--name="));
  return inline ? { name: inline.slice("--name=".length) } : {};
}

/** `My-MacBook-Pro.local` → `My-MacBook-Pro`; the phone's list reads better without the suffix. */
export function defaultServerName(hostname: string): string {
  const name = hostname.trim().replace(/\.local\.?$/i, "");
  return name || hostname.trim();
}

const defaultWatch = (fn: () => Promise<void>) => {
  const id = setInterval(() => void fn(), IP_CHECK_MS);
  return () => clearInterval(id);
};

async function serve(_argv: string[], deps: CliDeps): Promise<number> {
  const cfg = resolveConfig(deps.env, deps.home);
  const log = (m: string) => deps.stderr(`[xmark-mobile-server] ${m}\n`);
  const tokens = await createTokenSource(cfg.tokenFile);
  const registry = await createRegistrySource(cfg.shareFile, log);
  const hostname = cfg.host ?? (await waitForTailscaleIPv4(deps.run, { sleep: deps.sleep, log }));
  const app = createApp({ tokens, registry, version: deps.version, corsOrigins: cfg.corsOrigins });
  const server = await (deps.startServer ?? defaultStartServer)({ app, hostname, port: cfg.port });
  deps.stdout(`xmark-mobile-server ${deps.version} listening ${server.url}\n`);

  let cancel = () => {};
  if (!cfg.host) {
    cancel = (deps.watch ?? defaultWatch)(async () => {
      const now = await findTailscaleIPv4(deps.run);
      if (now && now !== hostname) {
        log(`Tailscale address changed ${hostname} → ${now}; exiting for a restart`);
        deps.exit(1);
      }
    });
  }
  deps.onStop?.(async () => {
    cancel();
    await server.close();
  });
  return 0;
}

async function pair(argv: string[], deps: CliDeps): Promise<number> {
  const cfg = resolveConfig(deps.env, deps.home);
  const host = (await findTailscaleDnsName(deps.run)) ?? (await findTailscaleIPv4(deps.run));
  if (!host) {
    deps.stderr("Tailscale is not running on this Mac; start it and try again.\n");
    return 1;
  }
  const token = await loadOrCreateToken(cfg.tokenFile);
  const { name } = parsePairArgs(argv);
  deps.stdout(await renderPairing({ host, port: cfg.port, token, name: name || defaultServerName(deps.hostname()) }));
  return 0;
}

async function rotate(_argv: string[], deps: CliDeps): Promise<number> {
  const cfg = resolveConfig(deps.env, deps.home);
  await rotateToken(cfg.tokenFile);
  deps.stdout("Token replaced. Run `xmark-mobile-server pair` and pair again on the phone.\n");
  return 0;
}

async function shareCommand(argv: string[], deps: CliDeps): Promise<number> {
  const cfg = resolveConfig(deps.env, deps.home, deps.platform);
  return runShareCommand(argv, { shareFile: cfg.shareFile, stdout: deps.stdout, stderr: deps.stderr });
}

function agentPaths(deps: CliDeps) {
  return {
    plist: path.join(deps.home, "Library", "LaunchAgents", `${LAUNCH_AGENT_LABEL}.plist`),
    log: path.join(deps.home, "Library", "Logs", "xmark-mobile-server.log"),
  };
}

/**
 * PATH for the installed service. A supervisor starts with almost no
 * environment, and the server finds `tailscale` through PATH.
 */
const LAUNCHD_PATH_ENV = "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin";
const SYSTEMD_PATH_ENV = "/usr/local/bin:/usr/bin:/usr/sbin:/bin:/sbin";

function systemdPaths(deps: CliDeps) {
  return {
    unit: path.join(deps.home, ".config", "systemd", "user", SYSTEMD_UNIT_NAME),
  };
}

/** The service manager for this platform, or an error message naming it. */
function unsupportedPlatform(platform: NodeJS.Platform): string | null {
  return platform === "darwin" || platform === "linux" ? null : platform;
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
function unsupported(platform: NodeJS.Platform, command: string, deps: CliDeps): boolean {
  const bad = unsupportedPlatform(platform);
  if (!bad) return false;
  deps.stderr(`${command} is not supported on ${bad}; only macOS (launchd) and Linux (systemd) are.\n`);
  return true;
}

async function installAgent(_argv: string[], deps: CliDeps): Promise<number> {
  if (unsupported(deps.platform, "install-agent", deps)) return 1;
  return servicesFor(deps.platform).install(deps);
}

async function uninstallAgent(_argv: string[], deps: CliDeps): Promise<number> {
  if (unsupported(deps.platform, "uninstall-agent", deps)) return 1;
  return servicesFor(deps.platform).uninstall(deps);
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

const COMMANDS: Record<string, (argv: string[], deps: CliDeps) => Promise<number>> = {
  serve,
  pair,
  "rotate-token": rotate,
  "install-agent": installAgent,
  "uninstall-agent": uninstallAgent,
  share: shareCommand,
};

export async function runCli(argv: string[], deps: CliDeps): Promise<number> {
  const name = argv[0] ?? "serve";
  if (name === "help" || name === "--help" || name === "-h") {
    deps.stdout(USAGE);
    return 0;
  }
  const command = COMMANDS[name];
  if (!command) {
    deps.stderr(`Unknown command ${JSON.stringify(name)}\n\n${USAGE}`);
    return 2;
  }
  try {
    return await command(argv.slice(1), deps);
  } catch (err) {
    deps.stderr(`${(err as Error).message}\n`);
    return 1;
  }
}
