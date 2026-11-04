import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmod, mkdir, readdir, readFile, stat, symlink, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { makeTempDir } from "./testFixtures.testUtils";
import { createShareStore, isValidShareId, SHARE_ID_PATTERN } from "./shareStore";

let dir: string;
let cleanup: () => Promise<void>;
let store: Awaited<ReturnType<typeof createShareStore>>;

beforeEach(async () => {
  ({ dir, cleanup } = await makeTempDir());
  store = await createShareStore(path.join(dir, "shares"));
});
afterEach(() => cleanup());

const META = { name: "笔记.md", kind: "markdown" as const };

describe("isValidShareId", () => {
  it("accepts a 32-byte hex id", () => {
    expect(isValidShareId("a".repeat(64))).toBe(true);
  });

  it.each([
    ["short", "abc"],
    ["uppercase", "A".repeat(64)],
    ["non-hex", "g".repeat(64)],
    ["path", "../".padEnd(64, "a")],
    ["slash", `${"a".repeat(32)}/${"a".repeat(31)}`],
    ["empty", ""],
  ])("rejects %s", (_label, id) => {
    expect(isValidShareId(id)).toBe(false);
  });

  it("exposes the pattern the routes validate with", () => {
    expect(SHARE_ID_PATTERN.test("0".repeat(64))).toBe(true);
  });
});

describe("createShareStore save/read", () => {
  it("stores bytes byte-for-byte, BOM included", async () => {
    const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("你好\n", "utf8")]);
    const snap = await store.save({ bytes, ...META });
    expect(await store.read(snap.id)).toEqual(bytes);
    expect(await store.meta(snap.id)).toMatchObject({ name: "笔记.md", kind: "markdown", size: bytes.length });
  });

  it("uses an opaque 64-hex id that does not repeat", async () => {
    const a = await store.save({ bytes: Buffer.from("a"), ...META });
    const b = await store.save({ bytes: Buffer.from("a"), ...META });
    expect(a.id).toMatch(/^[0-9a-f]{64}$/);
    expect(a.id).not.toBe(b.id);
  });

  it("keeps the snapshot unchanged after the original is edited or deleted", async () => {
    const source = path.join(dir, "src", "note.md");
    await mkdir(path.dirname(source), { recursive: true });
    await writeFile(source, "# 原始\n");
    const snap = await store.save({ bytes: await readFile(source), ...META });
    await writeFile(source, "# 改过\n");
    expect((await store.read(snap.id))!.toString("utf8")).toBe("# 原始\n");
    expect((await store.read(snap.id))!.toString("utf8")).not.toContain("改过");
  });

  it("survives a restart: a fresh store over the same directory reads it", async () => {
    const snap = await store.save({ bytes: Buffer.from("持久"), ...META });
    const reopened = await createShareStore(path.join(dir, "shares"));
    expect((await reopened.read(snap.id))!.toString("utf8")).toBe("持久");
  });

  it("writes 0700 directories and 0600 files", async () => {
    const snap = await store.save({ bytes: Buffer.from("x"), ...META });
    const root = path.join(dir, "shares");
    expect((await stat(root)).mode & 0o777).toBe(0o700);
    expect((await stat(path.join(root, snap.id))).mode & 0o777).toBe(0o700);
    expect((await stat(path.join(root, snap.id, "original"))).mode & 0o777).toBe(0o600);
    expect((await stat(path.join(root, snap.id, "meta.json"))).mode & 0o777).toBe(0o600);
  });

  it("leaves no partial snapshot behind when writing fails", async () => {
    const bad = await createShareStore(path.join(dir, "ro"));
    await chmod(path.join(dir, "ro"), 0o500);
    await expect(bad.save({ bytes: Buffer.from("x"), ...META })).rejects.toThrow();
    await chmod(path.join(dir, "ro"), 0o700);
    // The root holds nothing beyond the store's own bookkeeping.
    const ids = (await readdir(path.join(dir, "ro"))).filter((n) => isValidShareId(n));
    expect(ids).toEqual([]);
  });

  it("does not overwrite an existing snapshot on a repeated write", async () => {
    const snap = await store.save({ bytes: Buffer.from("first"), ...META });
    await expect(store.save({ bytes: Buffer.from("second"), ...META }, snap.id)).rejects.toThrow();
    expect((await store.read(snap.id))!.toString("utf8")).toBe("first");
  });

  it("returns null for unknown or malformed ids", async () => {
    await expect(store.read("0".repeat(64))).resolves.toBeNull();
    await expect(store.read("../../etc/passwd")).resolves.toBeNull();
    await expect(store.meta("0".repeat(64))).resolves.toBeNull();
    await expect(store.read(path.join("..", "x"))).resolves.toBeNull();
  });

  it("never reads through a symlinked snapshot id", async () => {
    const outside = path.join(dir, "outside");
    await mkdir(outside);
    await writeFile(path.join(outside, "original"), "secret");
    const link = path.join(dir, "shares", "f".repeat(64));
    await symlink(outside, link);
    await expect(store.read("f".repeat(64))).resolves.toBeNull();
    await expect(store.meta("f".repeat(64))).resolves.toBeNull();
  });

  it("names its files original and meta.json, so a public GET never touches the workspace", async () => {
    const snap = await store.save({ bytes: Buffer.from("x"), ...META });
    const names = (await readdir(path.join(dir, "shares", snap.id))).sort();
    expect(names).toEqual(["meta.json", "original"]);
  });
});

describe("createShareStore assets", () => {
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

  it("keeps frozen preview assets beside the original", async () => {
    const snap = await store.save({
      bytes: Buffer.from("![a](a.png)\n"),
      ...META,
      assets: [{ name: "a.png", source: "a.png", bytes: PNG, contentType: "image/png" }],
    });
    expect(snap.assets).toEqual([{ name: "a.png", source: "a.png", contentType: "image/png" }]);
    expect((await store.meta(snap.id))!.assets).toEqual([{ name: "a.png", source: "a.png", contentType: "image/png" }]);
    expect(await store.readAsset(snap.id, "a.png")).toEqual(PNG);
    expect((await stat(path.join(dir, "shares", snap.id, "assets", "a.png"))).mode & 0o777).toBe(0o600);
  });

  it("serves only assets recorded in meta.json", async () => {
    const snap = await store.save({ bytes: Buffer.from("x"), ...META });
    await mkdir(path.join(dir, "shares", snap.id, "assets"), { recursive: true });
    await writeFile(path.join(dir, "shares", snap.id, "assets", "evil.png"), PNG);
    await expect(store.readAsset(snap.id, "evil.png")).resolves.toBeNull();
    await expect(store.readAsset(snap.id, "../meta.json")).resolves.toBeNull();
  });
});

describe("createShareStore metadata", () => {
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

  it("records the MIME the bytes are actually served with", async () => {
    const md = await store.save({ bytes: Buffer.from("# x"), ...META });
    expect(md.contentType).toBe("text/markdown; charset=utf-8");
    const pdf = await store.save({ bytes: Buffer.from("%PDF-1.7\n"), name: "手册.pdf", kind: "pdf" });
    expect(pdf.contentType).toBe("application/pdf");
    const html = await store.save({ bytes: Buffer.from("<p>x</p>"), name: "page.html", kind: "html" });
    expect(html.contentType).toBe("text/plain; charset=utf-8");
    const png = await store.save({ bytes: PNG, name: "图.png", kind: "image" });
    expect(png.contentType).toBe("image/png");
  });

  it("records the declared size of the bytes it stored", async () => {
    const snap = await store.save({ bytes: Buffer.from("你好\n"), ...META });
    expect(snap.size).toBe(7);
    expect((await store.meta(snap.id))!.size).toBe(7);
  });

  it("round-trips the asset source alongside its flat name", async () => {
    const snap = await store.save({
      bytes: Buffer.from("![a](a/pic.png)"),
      ...META,
      assets: [{ name: "35a49ddc30ac-pic.png", source: "a/pic.png", bytes: PNG, contentType: "image/png" }],
    });
    expect(await store.meta(snap.id)).toMatchObject({
      assets: [{ name: "35a49ddc30ac-pic.png", source: "a/pic.png", contentType: "image/png" }],
    });
  });
});

describe("createShareStore refuses hostile asset names at save time", () => {
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

  it.each([
    ["..", "dot-dot"],
    [".", "dot"],
    ["../original", "relative traversal"],
    ["../../meta.json", "deeper traversal"],
    ["a/b.png", "a nested path"],
    ["a\\b.png", "a Windows separator"],
    ["\u0000.png", "a NUL byte"],
    ["", "an empty name"],
    [`${"a".repeat(256)}.png`, "an over-long name"],
    [".hidden.png", "a hidden file"],
  ])("rejects %j (%s) before writing anything", async (name) => {
    await expect(
      store.save({ bytes: Buffer.from("x"), ...META, assets: [{ name, source: "a.png", bytes: PNG, contentType: "image/png" }] }),
    ).rejects.toThrow(/asset name/i);
    // Nothing was published, and the snapshot's own bytes were never replaced.
    const entries = (await readdir(path.join(dir, "shares"))).filter((n) => !n.startsWith("."));
    expect(entries).toEqual([]);
    await expect(readFile(path.join(dir, "shares", "original"))).rejects.toThrow();
  });

  it("rejects an asset whose recorded type is not an image", async () => {
    await expect(
      store.save({
        bytes: Buffer.from("x"),
        ...META,
        assets: [{ name: "a.png", source: "a.png", bytes: PNG, contentType: "text/html" }],
      }),
    ).rejects.toThrow(/content type/i);
  });
});

describe("createShareStore tolerates corrupted metadata", () => {
  const saveRaw = async (id: string, raw: string) => {
    const dirPath = path.join(dir, "shares", id);
    await mkdir(dirPath, { recursive: true });
    await writeFile(path.join(dirPath, "original"), "x");
    await writeFile(path.join(dirPath, "meta.json"), raw);
    return id;
  };

  it.each([
    ["the body is not JSON", "not json"],
    ["the body is an array", "[]"],
    ["the body is a string", '"x"'],
    ["there is no name", '{"kind":"markdown"}'],
    ["the recorded kind disagrees with the name", '{"name":"a.zip","kind":"markdown"}'],
    ["the name has no usable extension", '{"name":"Makefile","kind":"markdown"}'],
  ])("reads an unknown snapshot when %s", async (_label, raw) => {
    const id = await saveRaw("b".repeat(64), raw);
    await expect(store.meta(id)).resolves.toBeNull();
    await expect(store.readAsset(id, "a.png")).resolves.toBeNull();
  });

  it.each([
    ["assets is not an array", '{"name":"a.md","kind":"markdown","assets":"nope"}'],
    ["an asset entry is null", '{"name":"a.md","kind":"markdown","assets":[null]}'],
    ["an asset entry is a string", '{"name":"a.md","kind":"markdown","assets":["a.png"]}'],
    ["an asset entry has no name", '{"name":"a.md","kind":"markdown","assets":[{"contentType":"image/png"}]}'],
  ])("survives metas whose %s without crashing on assets.some", async (_label, raw) => {
    // The snapshot is still readable; only the untrusted asset list is emptied.
    const id = await saveRaw("f".repeat(64), raw);
    const meta = await store.meta(id);
    expect(meta).toMatchObject({ name: "a.md", kind: "markdown", assets: [] });
    await expect(store.readAsset(id, "a.png")).resolves.toBeNull();
  });

  it("normalises a valid entry that carries no source or type", async () => {
    const id = await saveRaw("c".repeat(64), '{"name":"a.md","kind":"markdown","assets":[{"name":"a.png"}]}');
    const meta = await store.meta(id);
    // An untyped PNG is still an image by extension; an unknown one is dropped.
    expect(meta?.assets).toEqual([{ name: "a.png", contentType: "image/png" }]);
  });

  it("drops an asset entry whose name is not a plain file name", async () => {
    const id = await saveRaw("d".repeat(64), '{"name":"a.md","kind":"markdown","assets":[{"name":"../original"}]}');
    expect((await store.meta(id))?.assets).toEqual([]);
  });

  it("fills in a missing size from the stored bytes", async () => {
    const id = await saveRaw("e".repeat(64), '{"name":"a.md","kind":"markdown"}');
    expect((await store.meta(id))?.size).toBe(1);
  });
});
