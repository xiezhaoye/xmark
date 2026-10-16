import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFile, stat, writeFile, mkdir } from "node:fs/promises";
import * as path from "node:path";
import { makeTempDir } from "./testFixtures.testUtils";
import { createTokenSource, loadOrCreateToken, rotateToken, tokenMatches } from "./token";

let dir: string;
let cleanup: () => Promise<void>;
beforeEach(async () => ({ dir, cleanup } = await makeTempDir()));
afterEach(() => cleanup());

describe("loadOrCreateToken", () => {
  it("creates a 64-hex token with owner-only permissions in a new directory", async () => {
    const file = path.join(dir, "nested", "token");
    const token = await loadOrCreateToken(file);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect((await stat(path.dirname(file))).mode & 0o777).toBe(0o700);
  });

  it("returns the existing token unchanged, ignoring surrounding whitespace", async () => {
    const file = path.join(dir, "token");
    const first = await loadOrCreateToken(file);
    await writeFile(file, `  ${first}\n`);
    expect(await loadOrCreateToken(file)).toBe(first);
  });

  it("refuses a corrupt token file instead of silently replacing it", async () => {
    const file = path.join(dir, "token");
    await writeFile(file, "short");
    await expect(loadOrCreateToken(file)).rejects.toThrow(/corrupt/i);
  });

  it("refuses an empty token file", async () => {
    const file = path.join(dir, "token");
    await writeFile(file, "\n");
    await expect(loadOrCreateToken(file)).rejects.toThrow(/corrupt/i);
  });
});

describe("rotateToken", () => {
  it("replaces the token atomically with a different one, keeping 0600", async () => {
    const file = path.join(dir, "token");
    const before = await loadOrCreateToken(file);
    const after = await rotateToken(file);
    expect(after).not.toBe(before);
    expect((await readFile(file, "utf8")).trim()).toBe(after);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  it("works when no token exists yet", async () => {
    await mkdir(path.join(dir, "fresh"));
    const token = await rotateToken(path.join(dir, "fresh", "token"));
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("tokenMatches", () => {
  const good = "a".repeat(64);
  it.each([
    ["exact", good, true],
    ["different", "b".repeat(64), false],
    ["prefix", good.slice(0, 63), false],
    ["longer", good + "a", false],
    ["empty", "", false],
    ["missing", undefined, false],
  ])("%s → %s", (_label, presented, expected) => {
    expect(tokenMatches(good, presented)).toBe(expected);
  });
});

describe("createTokenSource", () => {
  it("picks up a rotation written by another process", async () => {
    const file = path.join(dir, "token");
    const first = await loadOrCreateToken(file);
    const source = await createTokenSource(file);
    expect(await source.current()).toBe(first);
    // Force a distinct mtime so the cache sees the change on coarse clocks.
    const rotated = await rotateToken(file);
    const { utimes } = await import("node:fs/promises");
    const later = new Date(Date.now() + 5_000);
    await utimes(file, later, later);
    expect(await source.current()).toBe(rotated);
  });

  it("keeps serving the last good token when the file vanishes", async () => {
    const file = path.join(dir, "token");
    const first = await loadOrCreateToken(file);
    const source = await createTokenSource(file);
    const { rm } = await import("node:fs/promises");
    await rm(file);
    expect(await source.current()).toBe(first);
  });
});
