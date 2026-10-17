/**
 * The `xmark-mobile-server` commands, with every side effect injected.
 *
 *   serve            bind the Tailscale IPv4 and serve (the launchd entry point)
 *   pair             print the pairing QR code and fields
 *   rotate-token     replace the token; the phone must pair again
 *   install-agent    install and start the launchd agent
 *   uninstall-agent  stop and remove it
 *
 * `serve` re-checks the Tailscale address every minute and exits when it
 * changes, letting launchd restart it on the new address.
 *
 * @module cliMain
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { resolveConfig, type Env } from "./config";
import { createApp } from "./createApp";
import { buildLaunchAgentPlist, LAUNCH_AGENT_LABEL } from "./launchAgent";
import { renderPairing } from "./pairing";
import { createRegistrySource } from "./registry";
import { startServer as defaultStartServer, type RunningServer } from "./runtime";
import { findTailscaleDnsName, findTailscaleIPv4, waitForTailscaleIPv4, type RunCommand } from "./tailscale";
import { createTokenSource, loadOrCreateToken, rotateToken } from "./token";
import type { Hono } from "hono";

export interface CliDeps {
  env: Env;
  home: string;
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  run: RunCommand;
  sleep: (ms: number) => Promise<void>;
  version: string;
  nodePath: string;
  cliPath: string;
  uid: number;
  exit: (code: number) => void;
  startServer?: (o: { app: Hono; hostname: string; port: number }) => Promise<RunningServer>;
  /** Run `fn` periodically; returns a canceller. */
  watch?: (fn: () => Promise<void>) => () => void;
  /** Receives a stopper for a started server (tests close it). */
  onStop?: (stop: () => Promise<void>) => void;
}

const USAGE = `Usage: xmark-mobile-server <command>

  serve            Serve shared workspace groups on the Tailscale address
  pair             Show the pairing QR code for XMark Mobile
  rotate-token     Replace the pairing token (the phone must pair again)
  install-agent    Start at login via launchd
  uninstall-agent  Remove the launchd agent
`;

const IP_CHECK_MS = 60_000;

const defaultWatch = (fn: () => Promise<void>) => {
  const id = setInterval(() => void fn(), IP_CHECK_MS);
  return () => clearInterval(id);
};

async function serve(deps: CliDeps): Promise<number> {
  const cfg = resolveConfig(deps.env, deps.home);
  const log = (m: string) => deps.stderr(`[xmark-mobile-server] ${m}\n`);
  const tokens = await createTokenSource(cfg.tokenFile);
  const registry = await createRegistrySource(cfg.shareFile, log);
  const hostname = cfg.host ?? (await waitForTailscaleIPv4(deps.run, { sleep: deps.sleep, log }));
  const app = createApp({ tokens, registry, version: deps.version });
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

async function pair(deps: CliDeps): Promise<number> {
  const cfg = resolveConfig(deps.env, deps.home);
  const host = (await findTailscaleDnsName(deps.run)) ?? (await findTailscaleIPv4(deps.run));
  if (!host) {
    deps.stderr("Tailscale is not running on this Mac; start it and try again.\n");
    return 1;
  }
  const token = await loadOrCreateToken(cfg.tokenFile);
  deps.stdout(await renderPairing({ host, port: cfg.port, token }));
  return 0;
}

async function rotate(deps: CliDeps): Promise<number> {
  const cfg = resolveConfig(deps.env, deps.home);
  await rotateToken(cfg.tokenFile);
  deps.stdout("Token replaced. Run `xmark-mobile-server pair` and pair again on the phone.\n");
  return 0;
}

function agentPaths(deps: CliDeps) {
  return {
    plist: path.join(deps.home, "Library", "LaunchAgents", `${LAUNCH_AGENT_LABEL}.plist`),
    log: path.join(deps.home, "Library", "Logs", "xmark-mobile-server.log"),
  };
}

async function installAgent(deps: CliDeps): Promise<number> {
  const p = agentPaths(deps);
  const plist = buildLaunchAgentPlist({
    nodePath: deps.nodePath,
    cliPath: deps.cliPath,
    logPath: p.log,
    pathEnv: "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin",
  });
  await mkdir(path.dirname(p.plist), { recursive: true });
  await mkdir(path.dirname(p.log), { recursive: true });
  await deps.run("launchctl", ["bootout", `gui/${deps.uid}/${LAUNCH_AGENT_LABEL}`]).catch(() => "");
  await writeFile(p.plist, plist);
  await deps.run("launchctl", ["bootstrap", `gui/${deps.uid}`, p.plist]);
  deps.stdout(`Installed ${p.plist}\nLogs: ${p.log}\n`);
  return 0;
}

async function uninstallAgent(deps: CliDeps): Promise<number> {
  const p = agentPaths(deps);
  await deps.run("launchctl", ["bootout", `gui/${deps.uid}/${LAUNCH_AGENT_LABEL}`]).catch(() => "");
  await rm(p.plist, { force: true });
  deps.stdout(`Removed ${p.plist}\n`);
  return 0;
}

const COMMANDS: Record<string, (deps: CliDeps) => Promise<number>> = {
  serve,
  pair,
  "rotate-token": rotate,
  "install-agent": installAgent,
  "uninstall-agent": uninstallAgent,
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
    return await command(deps);
  } catch (err) {
    deps.stderr(`${(err as Error).message}\n`);
    return 1;
  }
}
