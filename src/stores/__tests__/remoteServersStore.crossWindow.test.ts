/**
 * remoteServersStore — cross-window propagation.
 *
 * The list is edited in the Settings window and READ by the window that lists
 * it, so "another webview wrote it" has to reach memory here. The storage is
 * deliberately WRITE-ONLY (see `writeOnlyStorage`), which is why the listener
 * reads the key through `loadStoredServers` instead of calling
 * `persist.rehydrate()`: hydration asks a `getItem` that always answers `null`,
 * so a rehydrate-based listener could never see a new list.
 *
 * What is asserted:
 *   - a new list from another window arrives (the regression: it did not);
 *   - an unreadable value does NOT replace what is in memory, and is not
 *     rewritten;
 *   - the propagation is single-shot: B adopting A's write does not write back,
 *     so A gets no `storage` event of its own and there is no A→B→A loop.
 *
 * Two windows are simulated with the two halves jsdom can give one module
 * graph: this window's store, and "the other window" as a direct
 * `localStorage.setItem` plus the `storage` event jsdom does not fire.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const KEY = "xmark-remote-servers";
const TOKEN = "a".repeat(64);

const server = (id: string, host: string) => ({ id, name: id, host, port: 8740, token: TOKEN });

/** What any window's persist would write for `servers`. */
const blob = (servers: unknown[]) => JSON.stringify({ state: { servers }, version: 1 });

/** Load a fresh module graph: one window's store, plus its listener. */
async function freshStore() {
  vi.resetModules();
  return import("@/stores/remoteServersStore");
}

/**
 * Another window writes `value`, and this window receives the event.
 *
 * `storageArea` is deliberately NOT passed: it is not part of what a
 * `storage` listener reads here (`key`/`newValue` are), and jsdom 30 validates
 * that member against its OWN realm's `Storage` class. `window.localStorage` is
 * an instance of a different realm's `Storage`, so passing it throws
 *
 *   TypeError: parameter 2 has member 'storageArea' that is not of type 'Storage'
 *
 * before the event is ever dispatched — which is how this whole file silently
 * stopped testing anything under Node 25 (whose own `localStorage` makes
 * `localStorageShim` stand down). Omitting the member keeps the dispatch real
 * and the listener exercised.
 */
function otherWindowWrites(value: string | null): void {
  const oldValue = localStorage.getItem(KEY);
  if (value === null) localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, value);
  window.dispatchEvent(new StorageEvent("storage", { key: KEY, oldValue, newValue: value }));
}

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});

describe("remoteServersStore — another window's list", () => {
  it("adopts a server paired in the other window", async () => {
    const { useRemoteServersStore } = await freshStore();
    expect(useRemoteServersStore.getState().servers).toEqual([]);

    otherWindowWrites(blob([server("s1", "m4.tailc8e51.ts.net")]));

    expect(useRemoteServersStore.getState().servers).toEqual([server("s1", "m4.tailc8e51.ts.net")]);
    expect(useRemoteServersStore.getState().corrupt).toBe(false);
  });

  it("adopts a rename, a reorder and a delete the same way", async () => {
    const { useRemoteServersStore } = await freshStore();
    const a = server("s1", "m4.tailc8e51.ts.net");
    const b = server("s2", "m5.tailc8e51.ts.net");
    otherWindowWrites(blob([a, b]));
    expect(useRemoteServersStore.getState().servers.map((s) => s.id)).toEqual(["s1", "s2"]);

    otherWindowWrites(blob([{ ...b, name: "书房" }, a]));
    expect(useRemoteServersStore.getState().servers.map((s) => s.name)).toEqual(["书房", "s1"]);

    otherWindowWrites(blob([{ ...b, name: "书房" }]));
    expect(useRemoteServersStore.getState().servers.map((s) => s.id)).toEqual(["s2"]);
  });

  it("keeps the in-memory list when the other window's value is unreadable", async () => {
    const { useRemoteServersStore } = await freshStore();
    const mine = server("s1", "m4.tailc8e51.ts.net");
    useRemoteServersStore.setState({ servers: [mine], corrupt: false });

    otherWindowWrites("{not json");

    expect(useRemoteServersStore.getState().servers).toEqual([mine]);
    // Not adopted AND not rewritten: the bytes stay exactly as the other window
    // left them, so a newer build's record survives this one seeing it.
    expect(localStorage.getItem(KEY)).toBe("{not json");
  });

  it("also keeps the in-memory list when the value parses but holds no list", async () => {
    const { useRemoteServersStore } = await freshStore();
    const mine = server("s1", "m4.tailc8e51.ts.net");
    useRemoteServersStore.setState({ servers: [mine], corrupt: false });

    otherWindowWrites(JSON.stringify({ state: { servers: "nope" }, version: 1 }));

    expect(useRemoteServersStore.getState().servers).toEqual([mine]);
  });

  it("writes nothing when the list it reads already matches", async () => {
    const { useRemoteServersStore, adoptStoredServers } = await freshStore();
    const list = [server("s1", "m4.tailc8e51.ts.net")];
    // Another window paired exactly this server.
    localStorage.setItem(KEY, blob(list));
    // This window is in step with it (a fresh store hydrates at load; the test
    // writes the same state in, through the persisting `set`).
    useRemoteServersStore.setState({ servers: list.map((s) => ({ ...s })) });
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    try {
      adoptStoredServers();
      // An equal list is NOT written back: no setState → no persist write → no
      // `storage` event in the other window, so the two windows cannot keep
      // answering each other.
      expect(setItem).not.toHaveBeenCalled();
    } finally {
      setItem.mockRestore();
    }
    expect(useRemoteServersStore.getState().servers).toEqual(list);
  });

  it("adopts an equal list at most once and writes back only that same value", async () => {
    const { adoptStoredServers, useRemoteServersStore } = await freshStore();
    const list = [server("s1", "m4.tailc8e51.ts.net")];
    localStorage.setItem(KEY, blob(list));

    // NOTE ON WRITE COUNTING: this file loads a FRESH module graph per test
    // (`vi.resetModules()`), and the store registers its `storage` listener at
    // module top level — a listener `resetModules` does not unbind. Every test
    // before this one therefore leaves one more live instance answering the
    // same event, so a process-wide write count is not this window's count.
    // The property asserted here is therefore WHAT gets written (what makes the
    // propagation terminate) and how often THIS store notifies.
    //
    // The spy is installed on the PROTOTYPE, not the instance: under Node 24
    // `localStorageShim` defines `setItem` on `Storage.prototype`, so an
    // instance-level spy captures nothing there (it did under Node 25, whose
    // native localStorage carries its own). The prototype sees both.
    const ownSetItem = vi.spyOn(Storage.prototype, "setItem");
    let notifications = 0;
    const unsubscribe = useRemoteServersStore.subscribe((state, prev) => {
      if (state.servers !== prev.servers) notifications += 1;
    });
    try {
      // Window B wrote `list`; A receives the event and adopts it once.
      window.dispatchEvent(new StorageEvent("storage", { key: KEY, newValue: blob(list) }));
      expect(notifications).toBe(1);

      // Adopting re-serializes (`setState` → persist writes), and that is by
      // design. What stops an A→B→A loop is not silence but IDENTITY: every
      // write carries exactly the value that was adopted, so the writer's
      // listener can only ever observe an unchanged list and stop there.
      expect(ownSetItem).toHaveBeenCalled();
      for (const [, written] of ownSetItem.mock.calls as [string, string][]) {
        expect(written).toBe(blob(list));
      }
      expect(localStorage.getItem(KEY)).toBe(blob(list));

      // Hop 2 — the other window receiving that write — sees a value equal to
      // its memory: no change, no notification, no further write. Re-delivering
      // the same event to this window is the same situation.
      window.dispatchEvent(new StorageEvent("storage", { key: KEY, newValue: blob(list) }));
      expect(notifications).toBe(1);

      // An unchanged read is an unchanged read: no setState, so THIS window
      // contributes no write of its own.
      const writesBeforeAdopt = ownSetItem.mock.calls.length;
      expect(adoptStoredServers()).toEqual(list);
      expect(notifications).toBe(1);
      expect(ownSetItem.mock.calls.length).toBe(writesBeforeAdopt);
    } finally {
      unsubscribe();
      ownSetItem.mockRestore();
    }
  });
});
