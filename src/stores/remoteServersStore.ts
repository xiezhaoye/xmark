/**
 * remoteServersStore — the remote Macs this desktop has been paired with, in
 * the order the settings page and the server switcher list them.
 *
 * Key decisions:
 *   - **Another window's edit is picked up by READING THE KEY, not by
 *     rehydrating.** See `adoptStoredServers` at the bottom of this file: the
 *     storage is deliberately write-only, so zustand's hydration can only ever
 *     read `null` — a `storage` listener that called `persist.rehydrate()` did
 *     nothing at all.
 *   - **A NEW storage key, and nothing else touched.** The list lives under
 *     `xmark-remote-servers`, which no earlier build wrote. Every existing key
 *     (settings, groups, sessions) is left exactly as it was: this store never
 *     reads, migrates or deletes them.
 *   - **Corrupt data is preserved, not overwritten.** A persisted value that
 *     does not parse is kept byte-for-byte on disk and the list reads as empty
 *     (`corrupt: true`) until the user's next deliberate edit. The alternative —
 *     "repair" it by writing `[]` — destroys whatever was there, and the point
 *     of a new key is that the user's data survives a mistake in THIS one.
 *   - **Order is array order.** No rank field: reordering rewrites the array.
 *   - **The current server is not here.** Which server a window is showing is
 *     session state (`useRemoteSessionStore`), never persisted: every window
 *     starts on this Mac.
 *   - **The token lives in the settings storage tier** (localStorage, like the
 *     phone's own profile storage), not the keychain — the same decision the
 *     mobile app made, so both clients hold it in one place.
 *
 * @coordinates-with services/remoteServers/client.ts — how the token is used
 * @module stores/remoteServersStore
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { createSafeStorage } from "@/services/persistence/safeStorage";
import { defaultServerName, sameServer } from "@/services/remoteServers/serverIdentity";
import { remoteServerWarn } from "@/utils/debug";

/** The one key this feature owns. Never reused, never migrated into. */
const REMOTE_SERVERS_STORAGE_KEY = "xmark-remote-servers";

const STORAGE_VERSION = 1;

export interface RemoteServer {
  /** Local to this desktop; never sent to the server. */
  id: string;
  name: string;
  host: string;
  port: number;
  token: string;
}

export interface RemoteServersState {
  servers: RemoteServer[];
  /** The stored value could not be read; it was left untouched on disk. */
  corrupt: boolean;
}

export interface RemoteServersActions {
  /**
   * Save a pairing. A Mac already listed at the same host and port is UPDATED
   * (token and name) instead of listed twice; the report says which happened.
   */
  addServer: (input: { host: string; port: number; token: string; name?: string }) =>
    { status: "added" | "updated"; id: string };
  /** Rename; blanking the name returns the server to its default name. */
  renameServer: (id: string, name: string) => void;
  removeServer: (id: string) => void;
  /** Move the server at `index` by `delta` slots; out-of-range moves do nothing. */
  moveServer: (index: number, delta: number) => void;
  /** One server by id, BY REFERENCE: zustand calls this as a selector. */
  serverAt: (id: string) => RemoteServer | undefined;
  /** The match for a host/port pair, when one is already listed. */
  findByAddress: (host: string, port: number) => RemoteServer | undefined;
}

let idCounter = 0;

/** A fresh id, unique on this desktop. */
function newRemoteServerId(): string {
  idCounter += 1;
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch {
    // Fall through to the counter form below.
  }
  return `rs${Date.now().toString(36)}${idCounter.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function isServer(value: unknown): value is RemoteServer {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    v.id !== "" &&
    typeof v.name === "string" &&
    typeof v.host === "string" &&
    v.host !== "" &&
    typeof v.port === "number" &&
    Number.isInteger(v.port) &&
    v.port >= 1 &&
    v.port <= 65535 &&
    typeof v.token === "string"
  );
}

/**
 * Accept only what this store wrote. Fields this build does not know are
 * dropped (they belong to a newer build and are never re-read here), and one
 * malformed entry does not take the others down with it — the user keeps the
 * servers that still make sense.
 */
function sanitize(raw: unknown): { servers: RemoteServer[]; corrupt: boolean } {
  if (raw === undefined || raw === null) return { servers: [], corrupt: false };
  if (typeof raw !== "object") return { servers: [], corrupt: true };
  const list = (raw as { servers?: unknown }).servers;
  if (!Array.isArray(list)) return { servers: [], corrupt: true };
  return { servers: list.filter(isServer), corrupt: false };
}

/**
 * Read the ONE key's raw bytes and decide what the store may show — and
 * whether the bytes are still the only copy of the truth.
 *
 * This exists because zustand's hydration SWALLOWS a parse error: the store
 * paints an empty list, indistinguishable from "nothing was ever paired", and
 * the user's bytes are still on disk — to be overwritten by the next write,
 * since `set()` serializes the whole state. The bytes are therefore inspected
 * here, BEFORE anything loads, and an unreadable value is reported as `corrupt`
 * and left exactly as it is.
 *
 * The store then hydrates from memory (`storage: undefined`), so no path —
 * including zustand's own unreadable-value fallback, which it reports as
 * "nothing stored" — can quietly replace what it could not read.
 */
/** The safe writer, created once — quota warnings are per key, so one instance suffices. */
let writer: ReturnType<typeof createSafeStorage> | null = null;
const writeOnlyStorage = () => {
  writer ??= createSafeStorage();
  const w = writer;
  return {
    getItem: () => null,
    setItem: (name: string, value: string) => w.setItem(name, value),
    removeItem: (name: string) => w.removeItem(name),
  };
};

/** The sanitized form of the raw value the last `loadStoredServers` read. */
let lastInput: string | null = null;

/** The form a write of `servers` takes in the key — what `partialize` stores. */
function storedForm(servers: RemoteServer[]): string {
  return JSON.stringify({ state: { servers }, version: STORAGE_VERSION });
}

function loadStoredServers(): { servers: RemoteServer[]; corrupt: boolean } {
  // Every call resets it, so a value that is unreadable, absent, or
  // unmodeled below can never leave a stale one behind.
  lastInput = null;
  let raw: string | null;
  try {
    raw = localStorage.getItem(REMOTE_SERVERS_STORAGE_KEY);
  } catch {
    // Storage is unavailable (private mode, a locked profile): keep the
    // defaults in memory and do not pretend the user's list is corrupt.
    return { servers: [], corrupt: false };
  }
  if (raw === null) return { servers: [], corrupt: false };
  try {
    const envelope = JSON.parse(raw) as { state?: { servers?: unknown } };
    const result = sanitize(envelope?.state);
    // What a write of `result` would serialize to — see `adoptStoredServers`.
    lastInput = storedForm(result.servers);
    return result;
  } catch {
    remoteServerWarn(`${REMOTE_SERVERS_STORAGE_KEY} is unreadable; left untouched`);
    return { servers: [], corrupt: true };
  }
}

export const useRemoteServersStore = create<RemoteServersState & RemoteServersActions>()(
  persist(
    (set, get) => ({
      ...loadStoredServers(),

      addServer: ({ host, port, token, name }) => {
        const trimmedName = (name ?? "").trim();
        const existing = get().findByAddress(host, port);
        if (existing) {
          // An update keeps the name the user already sees when the link names
          // nothing — a pairing must not silently rename their server.
          set((s) => ({
            servers: s.servers.map((srv) =>
              srv.id === existing.id
                ? { ...srv, token, name: trimmedName || srv.name }
                : srv,
            ),
            corrupt: false,
          }));
          return { status: "updated", id: existing.id };
        }
        const id = newRemoteServerId();
        set((s) => ({
          servers: [
            ...s.servers,
            { id, host: host.trim(), port, token, name: trimmedName || defaultServerName(host) },
          ],
          corrupt: false,
        }));
        return { status: "added", id };
      },

      renameServer: (id, name) =>
        set((s) => ({
          servers: s.servers.map((srv) =>
            srv.id === id ? { ...srv, name: name.trim() || defaultServerName(srv.host) } : srv,
          ),
        })),

      removeServer: (id) => set((s) => ({ servers: s.servers.filter((srv) => srv.id !== id) })),

      moveServer: (index, delta) =>
        set((s) => {
          const to = index + delta;
          if (index < 0 || index >= s.servers.length || to < 0 || to >= s.servers.length) return s;
          const next = s.servers.slice();
          const [moved] = next.splice(index, 1);
          next.splice(to, 0, moved as RemoteServer);
          return { servers: next };
        }),

      serverAt: (id) => get().servers.find((srv) => srv.id === id),
      findByAddress: (host, port) => get().servers.find((srv) => sameServer(srv, { host, port })),
    }),
    {
      name: REMOTE_SERVERS_STORAGE_KEY,
      version: STORAGE_VERSION,
      // Session memory only (see `loadStoredServers`): the value was read at
      // module load, and every write still goes to the key through `setItem`.
      // A `getItem` that always answers `null` is what stops zustand's own
      // hydration from REPLACING the just-read state — including for the
      // unreadable value it would otherwise report as "nothing stored".
      storage: createJSONStorage(() => writeOnlyStorage()),
      partialize: (s) => ({ servers: s.servers }),
    },
  ),
);

/**
 * Another window wrote the list: adopt its version.
 *
 * The read goes through `loadStoredServers` — the same raw read and sanitize the
 * store does at module load — because the persist middleware's own storage is
 * WRITE-ONLY by design (`writeOnlyStorage`), so `persist.rehydrate()` would
 * read `null` and change nothing. That was the bug this fixes: a server added
 * in the Settings window never reached the window that lists it.
 *
 * Three rules keep the propagation single-shot and non-destructive:
 *   - **Only a DIFFERENCE is adopted.** `setState` runs only when the incoming
 *     list differs from memory, so the persist write-back never fires for an
 *     unchanged list — and a write that changes nothing fires no `storage`
 *     event in the other window, so there is no A→B→A loop.
 *   - **An unreadable value is not adopted.** `corrupt` leaves memory exactly
 *     as it is (and writes nothing): the bytes belong to a newer or a broken
 *     writer, and overwriting the live list with an empty one would lose it.
 *   - **The same JSON for the same list.** `partialize` persists `servers` and
 *     nothing else, so comparing `JSON.stringify(servers)` is comparing the
 *     stored form — and so is comparing against the value the read just
 *     produced. A raw record whose fields this build drops would otherwise
 *     look "different" from memory and be overwritten with the sanitized
 *     version: a write, and therefore an event back to the writer.
 *
 * Returns the list the store now holds — what a caller (the switcher's
 * Refresh) then probes, without a second store read.
 */
export function adoptStoredServers(): RemoteServer[] {
  const persisted = loadStoredServers();
  // A write is ALSO how the adopting window re-serializes its state, which is
  // what a `storage` listener in the other window would hear. So the value on
  // disk has to equal the sanitized one before this window may write at all;
  // an unreadable record, or one with fields this build drops, is left as it
  // is — and comparing against memory would not do it: an empty memory over a
  // list of dropped-by-sanitize entries is "different" yet must not be written.
  // "This value was written by a writer that stores exactly what it lists."
  if (persisted.corrupt || lastInput !== storedForm(persisted.servers)) {
    return useRemoteServersStore.getState().servers;
  }
  const current = useRemoteServersStore.getState().servers;
  if (JSON.stringify(current) === JSON.stringify(persisted.servers)) return current;
  useRemoteServersStore.setState({ servers: persisted.servers, corrupt: false });
  return persisted.servers;
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    // `key === null` is a `clear()` from another window; nothing to adopt.
    if (event.key === REMOTE_SERVERS_STORAGE_KEY) adoptStoredServers();
  });
}
