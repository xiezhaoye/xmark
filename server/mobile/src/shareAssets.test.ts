import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { assetNameFor, assetUrlFor, freezeAssets, referencedImages, sourceRefFor } from "./shareAssets";
import { makeTempDir } from "./testFixtures.testUtils";

let dir: string;
let cleanup: () => Promise<void>;
beforeEach(async () => ({ dir, cleanup } = await makeTempDir()));
afterEach(() => cleanup());

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01]);
const PNG_B = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x02]);

describe("referencedImages", () => {
  it("collects local image references once each, in order, as source references", () => {
    const md = "![a](a.png)\n![b](sub/b.jpg)\n![a again](a.png)\n";
    expect(referencedImages(md)).toEqual(["a.png", "sub/b.jpg"]);
  });

  it("collects images inside emphasis, links and tables", () => {
    const md = "**![a](a.png)**\n\n[![b](b.png)](https://example.com)\n\n| c |\n|---|\n| ![c](c.png) |\n";
    expect(referencedImages(md)).toEqual(["a.png", "b.png", "c.png"]);
  });

  it("collects reference-style images and their definitions", () => {
    const md = "![a][one]\n\n![b][]\n\n[one]: a.png\n[b]: sub/b.png \"title\"\n";
    expect(referencedImages(md)).toEqual(["a.png", "sub/b.png"]);
  });

  it("keeps the directory part, so two folders are two references", () => {
    expect(referencedImages("![a](a/pic.png) ![b](b/pic.png)")).toEqual(["a/pic.png", "b/pic.png"]);
  });

  it("keeps an angle-bracket URL with spaces and parentheses, decoded", () => {
    expect(referencedImages('![a](<a b.png> "title")')).toEqual(["a b.png"]);
    expect(referencedImages("![a](<图形 (1).png>)")).toEqual(["图形 (1).png"]);
    expect(referencedImages("![a](%E5%9B%BE%E5%BD%A2.png)")).toEqual(["图形.png"]);
  });

  it("drops the query and the fragment from a source reference", () => {
    expect(referencedImages("![a](pic.png?v=2#top)")).toEqual(["pic.png"]);
  });

  it("ignores remote, absolute and data URLs", () => {
    const md = "![r](https://example.com/a.png)\n![d](data:image/png;base64,AA)\n![p](/abs.png)\n![s](//cdn/a.png)";
    expect(referencedImages(md)).toEqual([]);
  });

  it("ignores plain links, fenced code and inline code", () => {
    const md = "[a](a.png)\n\n```\n![x](code.png)\n```\n\n`![y](inline.png)`\n\npic.png";
    expect(referencedImages(md)).toEqual([]);
  });

  it("ignores a refused reference such as a parent traversal", () => {
    expect(referencedImages("![s](../secret.png)")).toEqual([]);
  });
});

describe("sourceRefFor", () => {
  it.each([
    ["pic.png", "pic.png"],
    ["sub/pic.png", "sub/pic.png"],
    ["./sub//pic.png", "sub/pic.png"],
    ["%E5%9B%BE.png", "图.png"],
    ["pic.png?v=2#frag", "pic.png"],
    // Unlike a link, a reference must never step out of the note's folder.
    ["a/../b.png", null],
  ])("%s → %s", (url, ref) => {
    expect(sourceRefFor(url)).toBe(ref);
  });

  it.each([[""], [".."], ["../secret.png"], ["/abs.png"], ["//cdn/a.png"], ["https://e.com/a.png"], ["data:image/png,x"]])(
    "refuses %j",
    (url) => {
      expect(sourceRefFor(url)).toBeNull();
    },
  );
});

describe("assetNameFor", () => {
  it("derives a flat, unique name from a source reference", () => {
    const a = assetNameFor("a/pic.png");
    const b = assetNameFor("b/pic.png");
    expect(a).toMatch(/^[0-9a-f]{12}-pic\.png$/);
    expect(b).toMatch(/^[0-9a-f]{12}-pic\.png$/);
    expect(a).not.toBe(b);
  });

  it("keeps a CJK name readable and adds an id", () => {
    expect(assetNameFor("笔记/图.png")).toMatch(/^[0-9a-f]{12}-图\.png$/);
  });

  it("gives the same reference the same name twice", () => {
    expect(assetNameFor("sub/pic.png")).toBe(assetNameFor("./sub/pic.png"));
  });

  it.each([[""], [".."], [".hidden.png"], ["%ZZ.png"], [`${"a".repeat(201)}.png`], ["a/../.env.png"]])(
    "refuses %j",
    (url) => {
      expect(assetNameFor(url)).toBeNull();
    },
  );
});

describe("freezeAssets", () => {
  it("copies the referenced images with their types, keyed by full reference", async () => {
    await writeFile(path.join(dir, "pic.png"), PNG);
    const assets = await freezeAssets({ dir, markdown: "![图](pic.png)" });
    expect(assets).toHaveLength(1);
    expect(assets[0].bytes).toEqual(PNG);
    expect(assets[0].contentType).toBe("image/png");
    expect(assets[0].source).toBe("pic.png");
    expect(assets[0].name).toBe(assetNameFor("pic.png"));
  });

  it("never collides two same-basename images in different folders", async () => {
    await mkdir(path.join(dir, "a"));
    await mkdir(path.join(dir, "b"));
    await writeFile(path.join(dir, "a", "pic.png"), PNG);
    await writeFile(path.join(dir, "b", "pic.png"), PNG_B);
    const assets = await freezeAssets({ dir, markdown: "![a](a/pic.png)\n![b](b/pic.png)" });
    expect(assets).toHaveLength(2);
    expect(new Set(assets.map((a) => a.name)).size).toBe(2);
    const bySource = new Map(assets.map((a) => [a.source, a.bytes]));
    expect(bySource.get("a/pic.png")).toEqual(PNG);
    expect(bySource.get("b/pic.png")).toEqual(PNG_B);
  });

  it("resolves an encoded Chinese name with a space and a query", async () => {
    await writeFile(path.join(dir, "图形 图.png"), PNG);
    const assets = await freezeAssets({ dir, markdown: "![a](%E5%9B%BE%E5%BD%A2%20%E5%9B%BE.png?raw=1)" });
    expect(assets).toHaveLength(1);
    expect(assets[0].source).toBe("图形 图.png");
    expect(assets[0].bytes).toEqual(PNG);
  });

  it("copies the source bytes unchanged, whatever the name", async () => {
    const bytes = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from("payload")]);
    await writeFile(path.join(dir, "a b.png"), bytes);
    const [asset] = await freezeAssets({ dir, markdown: "![x](<a b.png>)" });
    expect(asset.bytes).toEqual(bytes);
  });

  it("skips a reference that is missing, hidden or of an unknown type", async () => {
    await writeFile(path.join(dir, "note.txt"), "x");
    const assets = await freezeAssets({ dir, markdown: "![a](gone.png) ![b](note.txt) ![c](.hidden.png)" });
    expect(assets).toEqual([]);
  });

  it("never follows a reference out of the note's directory", async () => {
    const outside = await makeTempDir("xmark-outside-");
    await writeFile(path.join(outside.dir, "secret.png"), PNG);
    try {
      const assets = await freezeAssets({ dir, markdown: "![s](../secret.png)" });
      expect(assets).toEqual([]);
    } finally {
      await outside.cleanup();
    }
  });

  it("refuses a symlink pointing outside the folder", async () => {
    const outside = await makeTempDir("xmark-outside-");
    await writeFile(path.join(outside.dir, "secret.png"), PNG);
    await symlink(path.join(outside.dir, "secret.png"), path.join(dir, "link.png"));
    try {
      expect(await freezeAssets({ dir, markdown: "![s](link.png)" })).toEqual([]);
    } finally {
      await outside.cleanup();
    }
  });

  it("refuses an oversized image", async () => {
    await writeFile(path.join(dir, "big.png"), Buffer.alloc(8 * 1024 * 1024 + 1));
    expect(await freezeAssets({ dir, markdown: "![b](big.png)" })).toEqual([]);
  });

  it("returns nothing for a directory that does not exist", async () => {
    expect(await freezeAssets({ dir: path.join(dir, "nope"), markdown: "![a](a.png)" })).toEqual([]);
  });

  it("stops at the asset count ceiling", async () => {
    const names: string[] = [];
    for (let i = 0; i < 45; i += 1) {
      const name = `p${i}.png`;
      names.push(name);
      await writeFile(path.join(dir, name), PNG);
    }
    const md = names.map((n) => `![](${n})`).join("\n");
    expect((await freezeAssets({ dir, markdown: md })).length).toBe(40);
  });

  it("freezes only image nodes: a fenced block that looks like one is left alone", async () => {
    await writeFile(path.join(dir, "code.png"), PNG);
    const assets = await freezeAssets({ dir, markdown: "```\n![x](code.png)\n```\n" });
    expect(assets).toEqual([]);
  });

  it("fetches nothing over the network: a remote same-basename URL freezes nothing", async () => {
    await writeFile(path.join(dir, "pic.png"), PNG);
    const assets = await freezeAssets({ dir, markdown: "![a](https://cdn.example.com/pic.png)" });
    expect(assets).toEqual([]);
  });
});

describe("assetUrlFor", () => {
  it("maps exactly the frozen source references, not their basenames", async () => {
    await mkdir(path.join(dir, "a"));
    await mkdir(path.join(dir, "b"));
    await writeFile(path.join(dir, "a", "pic.png"), PNG);
    const assets = await freezeAssets({ dir, markdown: "![a](a/pic.png)" });
    const resolve = assetUrlFor("a".repeat(64), assets);
    expect(resolve("a/pic.png")).toBe(`/s/${"a".repeat(64)}/assets/${encodeURIComponent(assets[0].name)}`);
    // A different file that merely shares the basename must not render this one.
    expect(resolve("b/pic.png")).toBeNull();
    expect(resolve("https://cdn.example.com/a/pic.png")).toBeNull();
    expect(resolve("./a/pic.png")).toBe(resolve("a/pic.png"));
  });

  it("accepts entries that carry only a name (older metadata)", () => {
    const resolve = assetUrlFor("a".repeat(64), [{ name: "图.png" }]);
    expect(resolve("图.png")).toBe(`/s/${"a".repeat(64)}/assets/${encodeURIComponent("图.png")}`);
    expect(resolve("other.png")).toBeNull();
  });
});
