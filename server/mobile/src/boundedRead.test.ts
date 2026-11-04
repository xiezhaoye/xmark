import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmod, mkdir, symlink, truncate, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { makeTempDir } from "./testFixtures.testUtils";
import { readFileBounded } from "./boundedRead";

let dir: string;
let cleanup: () => Promise<void>;
beforeEach(async () => ({ dir, cleanup } = await makeTempDir()));
afterEach(() => cleanup());

const file = (name: string) => path.join(dir, name);
const LIMIT = 1024;

describe("readFileBounded", () => {
  it("reads a regular file exactly", async () => {
    const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("你好\n")]);
    await writeFile(file("a.md"), bytes);
    const result = await readFileBounded(file("a.md"), LIMIT);
    expect(result).toEqual({ ok: true, bytes });
  });

  it("reads an empty file", async () => {
    await writeFile(file("empty.md"), "");
    expect(await readFileBounded(file("empty.md"), LIMIT)).toEqual({ ok: true, bytes: Buffer.alloc(0) });
  });

  it("accepts a file that is exactly the limit", async () => {
    await writeFile(file("exact.bin"), Buffer.alloc(LIMIT, 0x61));
    const result = await readFileBounded(file("exact.bin"), LIMIT);
    expect(result.ok).toBe(true);
  });

  it("refuses a file one byte over the limit without reading it", async () => {
    await writeFile(file("big.bin"), Buffer.alloc(LIMIT + 1, 0x61));
    expect(await readFileBounded(file("big.bin"), LIMIT)).toEqual({ ok: false, reason: "too_large" });
  });

  it("refuses a file that grows past the limit while it is read", async () => {
    const target = file("grow.bin");
    await writeFile(target, Buffer.alloc(4, 0x61));
    // Grow the file between the handle's fstat and the read: the capture stops
    // at MAX+1 bytes instead of allocating whatever the file became, and a file
    // that is still growing is a conflict, not a snapshot.
    const result = await readFileBounded(target, 8, {
      beforeRead: async () => {
        await truncate(target, 4096);
      },
    });
    expect(result).toEqual({ ok: false, reason: "too_large" });
  });

  it("refuses a file that changes size while it is captured", async () => {
    const target = file("shrink.bin");
    await writeFile(target, Buffer.alloc(64, 0x61));
    const result = await readFileBounded(target, LIMIT, { captureAttempts: 1, beforeRead: () => writeFile(target, "ab") });
    expect(result).toEqual({ ok: false, reason: "changed" });
  });

  it("succeeds on the retry when the file settled", async () => {
    const target = file("settle.bin");
    await writeFile(target, Buffer.alloc(64, 0x61));
    let calls = 0;
    const result = await readFileBounded(target, LIMIT, {
      beforeRead: async () => {
        calls += 1;
        if (calls === 1) await writeFile(target, Buffer.alloc(70, 0x61));
      },
    });
    expect(result.ok).toBe(true);
    expect(calls).toBe(2);
  });

  it("reports a missing file", async () => {
    expect(await readFileBounded(file("gone.md"), LIMIT)).toEqual({ ok: false, reason: "missing" });
  });

  it("refuses a directory", async () => {
    await mkdir(file("dir"));
    expect(await readFileBounded(file("dir"), LIMIT)).toEqual({ ok: false, reason: "not_a_file" });
  });

  it("refuses a non-regular file such as a fifo", async () => {
    // A device or a fifo can block forever or be endless; only a regular file
    // is a snapshot.
    await writeFile(file("real.md"), "x");
    await symlink("/dev/zero", file("zero"));
    expect(await readFileBounded(file("zero"), LIMIT)).toEqual({ ok: false, reason: "not_a_file" });
  });

  it("refuses to follow a final symlink when asked", async () => {
    await writeFile(file("secret.md"), "x");
    await symlink(file("secret.md"), file("link.md"));
    expect(await readFileBounded(file("link.md"), LIMIT, { followFinalSymlink: false })).toEqual({
      ok: false,
      reason: "not_a_file",
    });
    // Default stays compatible: a link to a regular file reads normally.
    expect((await readFileBounded(file("link.md"), LIMIT)).ok).toBe(true);
  });

  it("reports a permission error instead of throwing", async () => {
    const target = file("locked.md");
    await writeFile(target, "x");
    await chmod(target, 0o000);
    const result = await readFileBounded(target, LIMIT);
    // Root (some CI containers) can read anything; then the read simply works.
    if (process.getuid?.() !== 0) expect(result).toEqual({ ok: false, reason: "unreadable" });
    await chmod(target, 0o600);
  });

  it("closes the handle even when the read fails", async () => {
    const target = file("closed.md");
    await writeFile(target, Buffer.alloc(32, 0x61));
    const result = await readFileBounded(target, LIMIT, {
      beforeRead: async () => {
        // A same-size rewrite: the read still succeeds, but the capture saw the
        // file change, so it is retried and then reported rather than served.
        await writeFile(target, "AB");
      },
    });
    expect(result).toEqual({ ok: false, reason: "changed" });
    await writeFile(target, "again");
    expect((await readFileBounded(target, LIMIT)).ok).toBe(true);
  });

  it("propagates no partial bytes on failure", async () => {
    await writeFile(file("big.bin"), Buffer.alloc(LIMIT + 5, 0x61));
    const result = await readFileBounded(file("big.bin"), LIMIT);
    expect(result).toEqual({ ok: false, reason: "too_large" });
    expect(result).not.toHaveProperty("bytes");
  });
});
