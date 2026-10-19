/**
 * Status probes for the servers list.
 *
 * One `/api/health` per server when the settings page opens — never a poll.
 * The probe depends on a server's ADDRESS AND TOKEN, so a rename or a reorder
 * does not re-probe, while a re-pairing does.
 *
 * A probe is dropped when its server leaves the list mid-flight: an answer
 * about a server nobody lists any more must not paint a row.
 *
 * The classification, the states and the prober itself live in
 * `services/remoteServers/probe.ts`: the switcher runs the same probe from an
 * event handler, where a hook cannot be called. This module is the React
 * wrapper — the state a component subscribes to.
 *
 * @coordinates-with services/remoteServers/probe.ts — the shared probe
 * @coordinates-with pages/settings/ServersSettings.tsx — the only caller
 * @coordinates-with pages/settings/ServerRow.tsx — the state as text/dot
 * @module pages/settings/serverProbes
 */

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { RemoteServer } from "@/stores/remoteServersStore";
import { createServerProber, type ServerProber, type ServerState } from "@/services/remoteServers/probe";

export interface ServerProbes {
  status: Record<string, ServerState>;
  /** Probe every listed server once. */
  probeAll: () => void;
  /** Probe one server (after a re-pairing). */
  probeOne: (server: RemoteServer) => void;
}

/**
 * `servers` is read through a ref synced in a LAYOUT effect (not written during
 * render, which would mutate a ref while rendering), so `probeAll` keeps a
 * stable identity (the page runs it once, on open) and still probes the list as
 * it is at the moment it runs. The caller runs `probeAll` from an effect, so
 * the sync always precedes the read.
 */
export function useServerProbes(servers: RemoteServer[]): ServerProbes {
  const [status, setStatus] = useState<Record<string, ServerState>>({});
  const serversRef = useRef(servers);
  useLayoutEffect(() => {
    serversRef.current = servers;
  }, [servers]);

  // One prober for the life of the page: it publishes into `setStatus` (stable)
  // and asks `serversRef` whose answer still counts — both read at call time,
  // never during render.
  const proberRef = useRef<ServerProber | null>(null);
  const prober = () => {
    proberRef.current ??= createServerProber(
      (id, state) => setStatus((s) => ({ ...s, [id]: state })),
      (id) => serversRef.current.some((s) => s.id === id),
    );
    return proberRef.current;
  };

  const probeOne = useCallback((server: RemoteServer) => void prober().probe(server), []);
  const probeAll = useCallback(() => void prober().probeAll(serversRef.current), []);

  return { status, probeAll, probeOne };
}
