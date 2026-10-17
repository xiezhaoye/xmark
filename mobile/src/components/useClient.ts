/**
 * The HTTP client for the current pairing, or null when unpaired.
 *
 * @module components/useClient
 */
import { useMemo } from "react";
import type { Client } from "../api/client";
import { useReaderStore } from "../state/readerStore";

export function useClient(): Client | null {
  const connection = useReaderStore((s) => s.connection);
  const makeClient = useReaderStore((s) => s.makeClient);
  return useMemo(() => (connection ? makeClient(connection) : null), [connection, makeClient]);
}
