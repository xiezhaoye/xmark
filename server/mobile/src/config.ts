/**
 * Where the server reads its inputs, from the environment.
 *
 * Defaults follow the release desktop app (`app.xmark`). Point it at the dev
 * build with `XMARK_APP_IDENTIFIER=app.vmark.dev`. `XMARK_MOBILE_HOST`
 * replaces the Tailscale bind and is meant for local testing only.
 *
 * The default data directory is platform-aware: macOS keeps the desktop app's
 * `~/Library/Application Support/<appId>/`, Linux (and anything else) uses the
 * XDG data directory `$XDG_DATA_HOME/<appId>/` (`~/.local/share` when unset).
 * The file layout inside it is the same on both.
 *
 * `XMARK_MOBILE_CORS_ORIGINS` is the one web-facing knob: a comma-separated
 * list of origins a browser version of the reader may call from. Empty (the
 * default) keeps the server browser-hostile, which is the shipped behaviour.
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
  /** Origins allowed cross-origin (`scheme://host[:port]`); empty means no CORS at all. */
  corsOrigins: string[];
}

export type Env = Record<string, string | undefined>;

function parsePort(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_PORT;
  // 0 (OS-assigned) is accepted for tests; the phone needs a fixed port.
  const port = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!(port >= 0 && port <= 65535)) throw new Error(`Invalid XMARK_MOBILE_PORT ${JSON.stringify(raw)}`);
  return port;
}

/**
 * Parse the comma-separated origin list. Each entry must be a bare http(s)
 * origin — `URL.origin` is compared verbatim, so a path or a wildcard would
 * silently never match.
 */
function parseCorsOrigins(raw: string | undefined): string[] {
  if (raw === undefined) return [];
  const origins: string[] = [];
  for (const entry of raw.split(",")) {
    const item = entry.trim();
    if (!item) continue;
    const origin = parseOrigin(item);
    if (origin === null || origin !== item) {
      throw new Error(`Invalid XMARK_MOBILE_CORS_ORIGINS ${JSON.stringify(item)}`);
    }
    if (!origins.includes(origin)) origins.push(origin);
  }
  return origins;
}

function parseOrigin(item: string): string | null {
  try {
    const url = new URL(item);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * The per-app data directory the desktop app writes into.
 *
 * macOS keeps the Application Support location the desktop app uses; every
 * other platform gets the XDG data directory, where a Linux box has no
 * desktop app to share a convention with.
 */
export function defaultDataDir(env: Env, home: string, platform: NodeJS.Platform = process.platform): string {
  const identifier = env.XMARK_APP_IDENTIFIER ?? "app.xmark";
  if (!/^[A-Za-z0-9.-]+$/.test(identifier) || identifier.includes("..")) {
    throw new Error(`Invalid XMARK_APP_IDENTIFIER ${JSON.stringify(identifier)}`);
  }
  if (platform === "darwin") return path.join(home, "Library", "Application Support", identifier);
  const xdg = env.XDG_DATA_HOME;
  const dataHome = xdg && path.isAbsolute(xdg) ? xdg : path.join(home, ".local", "share");
  return path.join(dataHome, identifier);
}

export function resolveConfig(env: Env, home: string, platform: NodeJS.Platform = process.platform): Config {
  const support = defaultDataDir(env, home, platform);
  return {
    shareFile: env.XMARK_MOBILE_SHARE_FILE ?? path.join(support, "mobile-share.json"),
    tokenFile: env.XMARK_MOBILE_TOKEN_FILE ?? path.join(support, "mobile-server", "token"),
    port: parsePort(env.XMARK_MOBILE_PORT),
    host: env.XMARK_MOBILE_HOST ?? null,
    corsOrigins: parseCorsOrigins(env.XMARK_MOBILE_CORS_ORIGINS),
  };
}
