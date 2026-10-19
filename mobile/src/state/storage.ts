/**
 * What the reader remembers between launches: the paired Macs, which one is
 * current, and the last document read on each. Stored in the app's own WebView
 * storage; every access is guarded, so a blocked or corrupt store behaves like
 * a fresh install. A store written by a single-server build is migrated on
 * read: its connection becomes one profile named after the host, and its last
 * document becomes that profile's.
 *
 * @module state/storage
 */
import { newServerId, type Connection, type ServerProfile } from "../api/types";

/** A single pairing; only a store from before multiple servers still has one. */
const LEGACY_CONNECTION_KEY = "xmark-mobile.connection";
const SERVERS_KEY = "xmark-mobile.servers";
const ACTIVE_SERVER_KEY = "xmark-mobile.activeServerId";
/** Last document per server, as `{[serverId]: DocRef}`. */
const LAST_DOC_KEY = "xmark-mobile.lastDoc";

export interface DocRef {
  rootId: string;
  relPath: string;
}

/** Everything the reader restores at launch. */
export interface StoredState {
  servers: ServerProfile[];
  activeServerId: string | null;
}

function readRaw(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function read<T>(key: string, valid: (v: unknown) => v is T): T | null {
  const value = readRaw(key);
  return valid(value) ? value : null;
}

function write(key: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable: the app still works for this session.
  }
}

const hasShape = <T extends object>(v: unknown, keys: (keyof T)[]): v is T =>
  !!v && typeof v === "object" && keys.every((k) => typeof (v as Record<string, unknown>)[k as string] === "string");

const isConnection = (v: unknown): v is Connection =>
  hasShape<Connection>(v, ["host", "token"]) && typeof (v as Connection).port === "number";

const isServerProfile = (v: unknown): v is ServerProfile => hasShape<ServerProfile>(v, ["id", "name", "host", "token"]) && typeof (v as ServerProfile).port === "number";

const isDocRef = (v: unknown): v is DocRef => hasShape<DocRef>(v, ["rootId", "relPath"]);

const isDocMap = (v: unknown): v is Record<string, DocRef> => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * The one-time bridge from the single-pairing store. It runs as long as the
 * old key exists, so a device that is offline the first time it launches this
 * build still gets its Mac once it can reach the network (the connection is
 * only dropped after the groups load). The old key is then removed, and the
 * old last document becomes the new server's.
 */
function migrateLegacy(): ServerProfile | null {
  const legacy = read(LEGACY_CONNECTION_KEY, isConnection);
  if (!legacy) {
    write(LEGACY_CONNECTION_KEY, null);
    return null;
  }
  const profile: ServerProfile = { id: newServerId(), name: legacy.host, host: legacy.host, port: legacy.port, token: legacy.token };
  const legacyDoc = read(LAST_DOC_KEY, isDocRef);
  write(SERVERS_KEY, [profile]);
  write(ACTIVE_SERVER_KEY, profile.id);
  write(LAST_DOC_KEY, legacyDoc ? { [profile.id]: legacyDoc } : null);
  write(LEGACY_CONNECTION_KEY, null);
  return profile;
}

/** The paired servers and the current one; the current one is always in the list. */
export function loadServers(): StoredState {
  const stored = readRaw(SERVERS_KEY);
  let servers = Array.isArray(stored) ? stored.filter(isServerProfile) : [];
  if (stored !== null) {
    // Drop malformed entries; drop repeated ids, which would share its keys.
    const seen = new Set<string>();
    servers = servers.filter((s) => !seen.has(s.id) && seen.add(s.id));
  }
  if (!servers.length) {
    const migrated = migrateLegacy();
    servers = migrated ? [migrated] : [];
    if (migrated) return { servers, activeServerId: migrated.id };
  }
  const active = read<string>(ACTIVE_SERVER_KEY, (v): v is string => typeof v === "string");
  const activeServerId = active && servers.some((s) => s.id === active) ? active : (servers[0]?.id ?? null);
  return { servers, activeServerId };
}

export const saveServers = (servers: ServerProfile[]) => write(SERVERS_KEY, servers.length ? servers : null);
export const saveActiveServerId = (id: string | null) => write(ACTIVE_SERVER_KEY, id);

/** The last document read on one server, or on the current one. */
export function loadLastDoc(serverId: string | null): DocRef | null {
  if (!serverId) return null;
  const map = read(LAST_DOC_KEY, isDocMap);
  const doc = map?.[serverId];
  return isDocRef(doc) ? doc : null;
}

export function saveLastDoc(serverId: string | null, doc: DocRef | null): void {
  if (!serverId) return;
  const map = read(LAST_DOC_KEY, isDocMap) ?? {};
  const next: Record<string, DocRef> = { ...map };
  if (doc) next[serverId] = doc;
  else delete next[serverId];
  write(LAST_DOC_KEY, Object.keys(next).length ? next : null);
}
