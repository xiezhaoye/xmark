import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, realpath, symlink, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { makeTempDir } from "./testFixtures.testUtils";
import { resolveInRoot, splitRelPath } from "./containment";

let dir: string;
let root: string;
let cleanup: () => Promise<void>;
beforeEach(async () => {
  ({ dir, cleanup } = await makeTempDir());
  root = path.join(await realpath(dir), "root");
  await mkdir(path.join(root, "笔记", "sub"), { recursive: true });
  await writeFile(path.join(root, "笔记", "a b%20c.md"), "x");
  await writeFile(path.join(dir, "secret.md"), "s");
});
afterEach(() => cleanup());

describe("splitRelPath", () => {
  it.each([
    ["", []],
    ["/", []],
    ["a/b.md", ["a", "b.md"]],
    ["./a//b/", ["a", "b"]],
  ])("%j → %j", (input, expected) => {
    expect(splitRelPath(input)).toEqual(expected);
  });

  it.each([["../x"], ["a/../../x"], ["a/\u0000"], [".git/config"], ["a/.hidden"], ["node_modules/x"], ["a\\..\\b"]])(
    "rejects %j",
    (input) => {
      expect(splitRelPath(input)).toBeNull();
    },
  );
});

describe("resolveInRoot", () => {
  it("resolves the root itself for an empty path", async () => {
    expect(await resolveInRoot(root, "")).toBe(root);
  });

  it("resolves CJK names and names containing a literal %20 without re-decoding", async () => {
    expect(await resolveInRoot(root, "笔记/a b%20c.md")).toBe(path.join(root, "笔记", "a b%20c.md"));
  });

  it("returns null for a missing entry", async () => {
    expect(await resolveInRoot(root, "笔记/nope.md")).toBeNull();
  });

  it("refuses a symlink that escapes the root", async () => {
    await symlink(path.join(dir, "secret.md"), path.join(root, "escape.md"));
    expect(await resolveInRoot(root, "escape.md")).toBeNull();
  });

  it("refuses a directory symlink that escapes the root", async () => {
    await symlink(dir, path.join(root, "up"));
    expect(await resolveInRoot(root, "up/secret.md")).toBeNull();
  });

  it("allows a symlink that stays inside the root", async () => {
    await symlink(path.join(root, "笔记", "a b%20c.md"), path.join(root, "alias.md"));
    expect(await resolveInRoot(root, "alias.md")).toBe(path.join(root, "笔记", "a b%20c.md"));
  });

  it("refuses traversal outright", async () => {
    expect(await resolveInRoot(root, "../secret.md")).toBeNull();
  });
});
