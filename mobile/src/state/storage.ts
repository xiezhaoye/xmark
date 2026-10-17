/**
 * The two things the reader remembers between launches: the pairing and the
 * last document. Stored in the app's own WebView storage; every access is
 * guarded, so a blocked or corrupt store behaves like a fresh install.
 *
 * @module state/storage
 */
import type { Connection } from "../api/types";

const CONNECTION_KEY = "xmark-mobile.connection";
const LAST_DOC_KEY = "xmark-mobile.lastDoc";

export interface DocRef {
  rootId: string;
  relPath: string;
}

function read<T>(key: string, valid: (v: unknown) => v is T): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    return valid(value) ? value : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable: the app still works for this session.
  }
}

const isConnection = (v: unknown): v is Connection =>
  !!v && typeof v === "object" && typeof (v as Connection).host === "string" && typeof (v as Connection).port === "number" && typeof (v as Connection).token === "string";

const isDocRef = (v: unknown): v is DocRef =>
  !!v && typeof v === "object" && typeof (v as DocRef).rootId === "string" && typeof (v as DocRef).relPath === "string";

export const loadConnection = () => read(CONNECTION_KEY, isConnection);
export const saveConnection = (c: Connection | null) => write(CONNECTION_KEY, c);
export const loadLastDoc = () => read(LAST_DOC_KEY, isDocRef);
export const saveLastDoc = (d: DocRef | null) => write(LAST_DOC_KEY, d);
