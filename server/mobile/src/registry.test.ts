import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, symlink, utimes, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { makeTempDir } from "./testFixtures.testUtils";
import { createRegistrySource, loadRegistry, publicWorkspaces } from "./registry";

let dir: string;
let cleanup: () => Promise<void>;
beforeEach(async () => ({ dir, cleanup } = await makeTempDir()));
afterEach(() => cleanup());

async function writeShare(groups: unknown[], file = path.join(dir, "mobile-share.json")) {
  await writeFile(file, JSON.stringify({ version: 1, groups }));
  return file;
}

describe("loadRegistry", () => {
  it("returns no groups when the desktop has not exported yet", async () => {
    const reg = await loadRegistry(path.join(dir, "absent.json"));
    expect(reg.groups).toEqual([]);
    expect(reg.roots.size).toBe(0);
  });

  it("resolves folders, marks missing ones unavailable, and gives stable opaque ids", async () => {
    const wiki = path.join(dir, "wiki");
    await mkdir(wiki);
    const file = await writeShare([{ id: "g", name: "Wiki", folders: [wiki, path.join(dir, "gone")] }]);
    const reg = await loadRegistry(file);
    const [present, missing] = reg.groups[0].folders;
    expect(present).toMatchObject({ name: "wiki", available: true });
    expect(missing).toMatchObject({ name: "gone", available: false });
    expect(present.rootId).toMatch(/^[0-9a-f]{16}$/);
    expect((await loadRegistry(file)).groups[0].folders[0].rootId).toBe(present.rootId);
    expect(reg.roots.get(present.rootId)?.absPath).toContain("wiki");
    expect(reg.roots.has(missing.rootId)).toBe(false);
  });

  it("treats a regular file listed as a folder as unavailable", async () => {
    const f = path.join(dir, "note.md");
    await writeFile(f, "x");
    const reg = await loadRegistry(await writeShare([{ id: "g", name: "G", folders: [f] }]));
    expect(reg.groups[0].folders[0].available).toBe(false);
  });

  it("gives a folder and a symlink to it the same id", async () => {
    const real = path.join(dir, "real");
    await mkdir(real);
    await symlink(real, path.join(dir, "link"));
    const reg = await loadRegistry(await writeShare([
      { id: "a", name: "A", folders: [real] },
      { id: "b", name: "B", folders: [path.join(dir, "link")] },
    ]));
    expect(reg.groups[0].folders[0].rootId).toBe(reg.groups[1].folders[0].rootId);
    expect(reg.roots.size).toBe(1);
  });

  it("NFC-normalizes display names", async () => {
    const nfd = path.join(dir, "Café");
    await mkdir(nfd);
    const reg = await loadRegistry(await writeShare([{ id: "g", name: "G", folders: [nfd] }]));
    expect(reg.groups[0].folders[0].name).toBe("Café");
  });
});

describe("publicWorkspaces", () => {
  it("never exposes absolute paths", async () => {
    const wiki = path.join(dir, "wiki");
    await mkdir(wiki);
    const reg = await loadRegistry(await writeShare([{ id: "g", name: "Wiki", folders: [wiki] }]));
    const json = JSON.stringify(publicWorkspaces(reg));
    expect(json).not.toContain(dir);
    expect(publicWorkspaces(reg)).toEqual({
      groups: [{ id: "g", name: "Wiki", folders: [{ rootId: expect.any(String), name: "wiki", available: true }] }],
    });
  });
});

describe("createRegistrySource", () => {
  it("reloads when the share file changes", async () => {
    const file = await writeShare([{ id: "g", name: "One", folders: [] }]);
    const source = await createRegistrySource(file);
    expect((await source.current()).groups[0].name).toBe("One");
    await writeShare([{ id: "g", name: "Two", folders: [] }]);
    const later = new Date(Date.now() + 5_000);
    await utimes(file, later, later);
    expect((await source.current()).groups[0].name).toBe("Two");
  });

  it("keeps the last good registry when the file becomes corrupt", async () => {
    const file = await writeShare([{ id: "g", name: "Good", folders: [] }]);
    const errors: string[] = [];
    const source = await createRegistrySource(file, (msg) => errors.push(msg));
    await writeFile(file, "{not json");
    const later = new Date(Date.now() + 5_000);
    await utimes(file, later, later);
    expect((await source.current()).groups[0].name).toBe("Good");
    expect(errors).toHaveLength(1);
  });

  it("starts empty and recovers once the file appears", async () => {
    const file = path.join(dir, "mobile-share.json");
    const source = await createRegistrySource(file);
    expect((await source.current()).groups).toEqual([]);
    await writeShare([{ id: "g", name: "Late", folders: [] }], file);
    expect((await source.current()).groups[0].name).toBe("Late");
  });

  it("notices folders created after the share file was read", async () => {
    const wiki = path.join(dir, "wiki");
    const file = await writeShare([{ id: "g", name: "G", folders: [wiki] }]);
    const source = await createRegistrySource(file, undefined, 0);
    expect((await source.current()).groups[0].folders[0].available).toBe(false);
    await mkdir(wiki);
    expect((await source.current()).groups[0].folders[0].available).toBe(true);
  });
});
