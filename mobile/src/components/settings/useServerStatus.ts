/**
 * Whether each paired server answers right now: one health request per
 * server when the list is shown, again when a server is added or its address
 * or token changes. Not polled.
 *
 * @module components/settings/useServerStatus
 */
import { useEffect, useState } from "react";
import { ApiError } from "../../api/client";
import type { ServerProfile } from "../../api/types";
import { useReaderStore } from "../../state/readerStore";

export type ServerState = "checking" | "online" | "offline" | "unauthorized";

export function useServerStatus(servers: ServerProfile[]): Record<string, ServerState> {
  const [status, setStatus] = useState<Record<string, ServerState>>({});
  // Re-probe only when what a probe depends on changes — not on a rename or a reorder.
  const key = JSON.stringify(servers.map(({ id, host, port, token }) => ({ id, host, port, token })));

  useEffect(() => {
    let live = true;
    const { makeClient } = useReaderStore.getState();
    const set = (id: string, state: ServerState) => live && setStatus((s) => ({ ...s, [id]: state }));
    for (const p of JSON.parse(key) as Array<Pick<ServerProfile, "id" | "host" | "port" | "token">>) {
      set(p.id, "checking");
      makeClient({ host: p.host, port: p.port, token: p.token })
        .health()
        .then(
          () => set(p.id, "online"),
          (err: unknown) => set(p.id, err instanceof ApiError && err.code === "unauthorized" ? "unauthorized" : "offline"),
        );
    }
    return () => {
      live = false;
    };
  }, [key]);

  return status;
}
