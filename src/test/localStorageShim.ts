/**
 * localStorageShim — installs a Map-backed `localStorage` when the test
 * environment lacks a complete Storage API, so storage works under node.
 *
 * @module test/localStorageShim
 */

const storage = new Map<string, string>();

let hasLocalStorage: boolean;
try {
  // Some runtimes expose an empty object when no storage file is configured.
  // Inspect methods without calling them: a real API may deny storage access.
  const candidate = globalThis.localStorage;
  hasLocalStorage = [
    candidate?.clear,
    candidate?.getItem,
    candidate?.key,
    candidate?.removeItem,
    candidate?.setItem,
  ].every((method) => typeof method === "function");
} catch {
  hasLocalStorage = false;
}

if (!hasLocalStorage) {
  if (typeof globalThis.Storage === "undefined") {
    class StorageShim {}
    Object.defineProperty(globalThis, "Storage", {
      configurable: true,
      value: StorageShim,
    });
  }

  Object.defineProperties(Storage.prototype, {
    clear: {
      configurable: true,
      value: () => storage.clear(),
    },
    getItem: {
      configurable: true,
      value: (key: string) => storage.get(key) ?? null,
    },
    key: {
      configurable: true,
      value: (index: number) => Array.from(storage.keys())[index] ?? null,
    },
    removeItem: {
      configurable: true,
      value: (key: string) => storage.delete(key),
    },
    setItem: {
      configurable: true,
      value: (key: string, value: string) => storage.set(key, value),
    },
  });

  const localStorageShim = Object.create(Storage.prototype) as Storage;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: localStorageShim,
  });
  Object.defineProperty(localStorageShim, "length", {
    configurable: true,
    get: () => storage.size,
  });
}
