// @vitest-environment node
/**
 * localStorageShim — verifies storage initialization in fresh Node processes,
 * including runtimes that expose an empty object instead of a Storage API.
 * @module test/localStorageShim.test
 */
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const shimUrl = new URL("./localStorageShim.ts", import.meta.url).href;

/** Each process initializes the shim once, before any other test setup. */
function runWithStorage(setup: string, assertion: string): void {
  const script = `
    import assert from "node:assert/strict";
    ${setup}
    await import(${JSON.stringify(shimUrl)});
    ${assertion}
  `;
  expect(() => execFileSync(process.execPath, [
    "--import", "tsx", "--input-type=module", "--eval", script,
  ], { encoding: "utf8", stdio: "pipe" })).not.toThrow();
}

const exerciseStorage = `
  localStorage.clear();
  assert.equal(localStorage.length, 0);
  assert.equal(localStorage.getItem("missing"), null);
  localStorage.setItem("客户/مرحبا", "日本語");
  localStorage.setItem("empty", "");
  localStorage.setItem("客户/مرحبا", "更新");
  assert.equal(localStorage.length, 2);
  assert.equal(localStorage.getItem("客户/مرحبا"), "更新");
  assert.equal(localStorage.getItem("empty"), "");
  assert.equal(localStorage.key(0), "客户/مرحبا");
  assert.equal(localStorage.key(2), null);
  localStorage.removeItem("客户/مرحبا");
  localStorage.removeItem("missing");
  assert.equal(localStorage.length, 1);
  localStorage.clear();
  assert.equal(localStorage.length, 0);
`;

describe("localStorageShim", () => {
  it("initializes storage with the runtime's default globals", () => {
    runWithStorage("", exerciseStorage);
  });

  it("installs storage when the global is absent", () => {
    runWithStorage("delete globalThis.localStorage;", exerciseStorage);
  });

  it.each(["{}", "null", "{ getItem: () => null }", "{ getItem: 1 }"])(
    "replaces an unusable storage global: %s",
    (value) => {
      runWithStorage(`Object.defineProperty(globalThis, "localStorage", {
        configurable: true, value: ${value},
      });`, exerciseStorage);
    },
  );

  it("installs storage when reading the global throws", () => {
    runWithStorage(`Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() { throw new DOMException("Denied", "SecurityError"); },
    });`, exerciseStorage);
  });

  it("preserves an existing complete storage API without invoking it", () => {
    runWithStorage(`
      const denied = () => { throw new DOMException("Denied", "SecurityError"); };
      const original = {
        getItem: denied, setItem: denied, removeItem: denied,
        clear: denied, key: denied, length: 0,
      };
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true, value: original,
      });
    `, `
      assert.equal(globalThis.localStorage, original);
      assert.throws(() => localStorage.getItem("x"), { name: "SecurityError" });
    `);
  });
});
