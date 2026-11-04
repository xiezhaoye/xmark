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
 * With `XMARK_MOBILE_PUBLIC_BASE_URL` set, `serve` also opens the public
 * listener on `127.0.0.1:<publicPort>` for `tailscale funnel` to proxy to. It
 * is a different app (see `publicApp`): snapshots only, no `/api`, no token.
 * Both listeners are closed together, including when the second fails to
 * start. Tailscale is never configured or run from here.
 *
 * @module cliMain
 */
import { installAgent, uninstallAgent } from "./agentCommands";
import { resolveConfig, type Env } from "./config";
import { createApp } from "./createApp";
import { renderPairing } from "./pairing";
import { createPublicApp } from "./publicApp";
import { createRegistrySource } from "./registry";
import { startServer as defaultStartServer, type RunningServer } from "./runtime";
import { listenerSpecs, openListeners } from "./serveListeners";
import { runShareCommand } from "./shareCli";
import { createShareStore } from "./shareStore";
import { findTailscaleDnsName, findTailscaleIPv4, waitForTailscaleIPv4, type RunCommand } from "./tailscale";
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

Share links need XMARK_MOBILE_PUBLIC_BASE_URL (an https origin). The public
listener then binds 127.0.0.1:$XMARK_MOBILE_PUBLIC_PORT (default 8741) for
tailscale funnel to proxy to; the private server keeps the Tailscale bind.
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
  const shares =
    cfg.publicBaseUrl === null
      ? undefined
      : { store: await createShareStore(cfg.sharesDir), publicBaseUrl: cfg.publicBaseUrl };
  const hostname = cfg.host ?? (await waitForTailscaleIPv4(deps.run, { sleep: deps.sleep, log }));
  const app = createApp({ tokens, registry, version: deps.version, corsOrigins: cfg.corsOrigins, shares });
  // Private app always; the public one only when sharing is configured, on
  // loopback (Funnel terminates TLS). Binding, and releasing what was bound on
  // failure, lives in `serveListeners`.
  const publicApp = shares ? createPublicApp({ store: shares.store }) : null;
  const specs = listenerSpecs({ cfg, privateApp: app, publicApp, hostname });
  const opened = await openListeners(specs, deps.startServer ?? defaultStartServer);
  deps.stdout(`xmark-mobile-server ${deps.version} listening ${opened.servers.private!.url}\n`);
  if (opened.servers.public && cfg.publicBaseUrl) {
    deps.stdout(`Share links: ${cfg.publicBaseUrl} → ${opened.servers.public.url}\n`);
  }

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
    await opened.close();
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
