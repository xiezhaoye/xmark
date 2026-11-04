/**
 * Opening — and closing — the two listeners `serve` binds.
 *
 * The private listener answers the phone on the Tailscale address; with a
 * public base URL configured, a second one binds loopback for
 * `tailscale funnel`. They are a pair: a failure to bind the second must
 * release the first, or the supervisor restarts into `EADDRINUSE`, and both
 * must close in one place when the process exits.
 *
 * Closing runs in reverse order and never rejects: the public listener is the
 * one an outside client may be mid-request on, and a close that throws must not
 * keep the other one open.
 *
 * @module serveListeners
 */
import type { Hono } from "hono";
import type { Config } from "./config";
import type { RunningServer } from "./runtime";

export type StartServer = (o: { app: Hono; hostname: string; port: number }) => Promise<RunningServer>;

export interface ListenerSpec {
  /** `private` or `public`, for the log line the caller prints. */
  role: "private" | "public";
  app: Hono;
  hostname: string;
  port: number;
}

export interface OpenListeners {
  /** Their URLs, in the order they were bound. */
  urls: string[];
  /** The running servers by role, so a caller can report where each listens. */
  servers: { private: RunningServer | null; public: RunningServer | null };
  close(): Promise<void>;
}

/**
 * The listeners `serve` binds: the private app on the resolved hostname
 * (Tailscale, or `XMARK_MOBILE_HOST`), plus the public app on loopback when
 * sharing is configured.
 */
export function listenerSpecs({
  cfg,
  privateApp,
  publicApp,
  hostname,
}: {
  cfg: Config;
  privateApp: Hono;
  publicApp: Hono | null;
  hostname: string;
}): ListenerSpec[] {
  const specs: ListenerSpec[] = [{ role: "private", app: privateApp, hostname, port: cfg.port }];
  if (publicApp) specs.push({ role: "public", app: publicApp, hostname: "127.0.0.1", port: cfg.publicPort });
  return specs;
}

/** Bind every spec in order; on failure close the ones already open and rethrow. */
export async function openListeners(specs: ListenerSpec[], start: StartServer): Promise<OpenListeners> {
  const servers: { private: RunningServer | null; public: RunningServer | null } = { private: null, public: null };
  const urls: string[] = [];
  let closed = false;

  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    await servers.public?.close().catch(() => {});
    await servers.private?.close().catch(() => {});
  };

  for (const spec of specs) {
    let server: RunningServer;
    try {
      server = await start({ app: spec.app, hostname: spec.hostname, port: spec.port });
    } catch (err) {
      await close();
      throw err;
    }
    servers[spec.role] = server;
    urls.push(server.url);
  }

  return { urls, servers, close };
}
