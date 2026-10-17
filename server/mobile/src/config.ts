/**
 * Where the server reads its inputs, from the environment.
 *
 * Defaults follow the release desktop app (`app.xmark`). Point it at the dev
 * build with `XMARK_APP_IDENTIFIER=app.vmark.dev`. `XMARK_MOBILE_HOST`
 * replaces the Tailscale bind and is meant for local testing only.
 *
 * @module config
 */
import * as path from "node:path";

export const DEFAULT_PORT = 8740;

export interface Config {
  shareFile: string;
  tokenFile: string;
  port: number;
  /** Explicit bind address, or null to bind the Tailscale IPv4. */
  host: string | null;
}

export type Env = Record<string, string | undefined>;

function parsePort(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_PORT;
  // 0 (OS-assigned) is accepted for tests; the phone needs a fixed port.
  const port = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!(port >= 0 && port <= 65535)) throw new Error(`Invalid XMARK_MOBILE_PORT ${JSON.stringify(raw)}`);
  return port;
}

export function resolveConfig(env: Env, home: string): Config {
  const identifier = env.XMARK_APP_IDENTIFIER ?? "app.xmark";
  if (!/^[A-Za-z0-9.-]+$/.test(identifier) || identifier.includes("..")) {
    throw new Error(`Invalid XMARK_APP_IDENTIFIER ${JSON.stringify(identifier)}`);
  }
  const support = path.join(home, "Library", "Application Support", identifier);
  return {
    shareFile: env.XMARK_MOBILE_SHARE_FILE ?? path.join(support, "mobile-share.json"),
    tokenFile: env.XMARK_MOBILE_TOKEN_FILE ?? path.join(support, "mobile-server", "token"),
    port: parsePort(env.XMARK_MOBILE_PORT),
    host: env.XMARK_MOBILE_HOST ?? null,
  };
}
