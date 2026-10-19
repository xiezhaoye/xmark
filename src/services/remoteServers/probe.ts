/**
 * A server's reachability, as one of four states — shared by Settings → Servers
 * and the workspace rail's server menu.
 *
 * Purpose: the two surfaces describe the same probe (`/api/health`),
 * so "green means online, grey means unreachable, orange means the token was
 * rejected" has ONE definition. The probe is done, not polled: Settings runs it
 * on open, the switcher when its menu opens and when the user asks for a
 * refresh.
 *
 * Key decisions:
 *   - **The classification lives here, not in a hook.** A hook can only be
 *     called from a component; the switcher's refresh is an event handler, so
 *     the plumbing (`createServerProber`) is plain, and the hook is a thin
 *     React wrapper over it.
 *   - **One probe per server id per run.** The prober reports `checking` before
 *     the request and drops an answer for a server that left the list
 *     mid-flight: a row somebody deleted must not be painted.
 *   - **Re-pairing re-probes**, since the answer depends on address AND token.
 *
 * @coordinates-with pages/settings/serverProbes.ts — the settings-page hook
 * @coordinates-with components/WorkspaceRail/ServerSwitcher.tsx — the menu
 * @module services/remoteServers/probe
 */

import type { RemoteServer } from "@/stores/remoteServersStore";
import { classifyRemoteFailure, remoteHealth } from "./client";

export type ServerState = "checking" | "online" | "offline" | "unauthorized";

/** Every failure the client can classify, as the dot's state. */
const STATE_BY_FAILURE = {
  unauthorized: "unauthorized",
  network: "offline",
  timeout: "offline",
  http: "offline",
  tooLarge: "offline",
  hostRejected: "offline",
  badAddress: "offline",
  server: "offline",
  unknown: "offline",
} as const satisfies Record<ReturnType<typeof classifyRemoteFailure>, ServerState>;

/** i18n key of a state, in the `settings` namespace (the shared vocabulary). */
export const SERVER_STATE_KEY: Record<ServerState, string> = {
  checking: "servers.status.checking",
  online: "servers.status.online",
  offline: "servers.status.offline",
  unauthorized: "servers.status.unauthorized",
};

/** The dot's fill: online green, unreachable grey, token rejected orange. */
export const SERVER_STATE_DOT: Record<ServerState, string> = {
  checking: "bg-[var(--text-tertiary)]",
  online: "bg-[var(--success-color)]",
  offline: "bg-[var(--text-tertiary)]",
  unauthorized: "bg-[var(--warning-color)]",
};

/**
 * Probe `server` once. Resolves to its state; never rejects (a failure IS an
 * answer here). Module-private: every caller is a `ServerProber`, and a second
 * public entry point would be a second place the "checking" state is missing.
 */
async function probeServer(server: RemoteServer): Promise<ServerState> {
  try {
    await remoteHealth({ host: server.host, port: server.port, token: server.token });
    return "online";
  } catch (error) {
    return STATE_BY_FAILURE[classifyRemoteFailure(error)];
  }
}

export interface ServerProber {
  /** Probe one server, reporting `checking` first and dropping stale answers. */
  probe: (server: RemoteServer) => Promise<void>;
  /** Probe every server in `list`. */
  probeAll: (list: RemoteServer[]) => Promise<void>;
}

/**
 * A prober over one status map.
 *
 * `isListed` decides whose answer counts: the settings page keeps the live
 * list in a ref, the switcher owns a snapshot for the menu's lifetime. Answers
 * are dropped through it, not through a sequence number, because a list is the
 * only thing either caller can compare against cheaply.
 */
export function createServerProber(
  publish: (id: string, state: ServerState) => void,
  isListed: (id: string) => boolean,
): ServerProber {
  const probe = async (server: RemoteServer): Promise<void> => {
    publish(server.id, "checking");
    const state = await probeServer(server);
    if (isListed(server.id)) publish(server.id, state);
  };
  const probeAll = async (list: RemoteServer[]): Promise<void> => {
    await Promise.all(list.map((server) => probe(server)));
  };
  return { probe, probeAll };
}
