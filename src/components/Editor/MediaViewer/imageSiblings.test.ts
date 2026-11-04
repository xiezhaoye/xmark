/**
 * Walking a folder of pictures from inside one image tab.
 *
 * Behaviour under test: siblings are the directory's own IMAGE files in natural
 * name order (photo2 < photo10), a failed read degrades to "just this file" so
 * no arrows appear, and stepping clamps at both ends instead of wrapping.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const fs = vi.hoisted(() => ({ readDir: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => fs);

const { imageSiblings, isImagePath, parentDirectory, stepSibling } = await import("./imageSiblings");

const DIR = "/Users/me/Pictures/trip";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("parentDirectory", () => {
  it("handles both separators and a file at the root", () => {
    expect(parentDirectory(`${DIR}/photo.jpg`)).toBe(DIR);
    expect(parentDirectory("C:\\pics\\photo.jpg")).toBe("C:\\pics");
    expect(parentDirectory("/photo.jpg")).toBe("/");
  });
});

describe("isImagePath", () => {
  it("accepts pictures and rejects the other media kinds", () => {
    expect(isImagePath("/a/photo.HEIC")).toBe(true);
    expect(isImagePath("/a/icon.svg")).toBe(true);
    expect(isImagePath("/a/clip.mp4")).toBe(false);
    expect(isImagePath("/a/track.mp3")).toBe(false);
    expect(isImagePath("/a/notes.md")).toBe(false);
  });
});

describe("imageSiblings", () => {
  it("lists only images, in natural name order, as absolute paths", async () => {
    fs.readDir.mockResolvedValue([
      { name: "photo10.jpg", isFile: true },
      { name: "photo2.jpg", isFile: true },
      { name: "notes.md", isFile: true },
      { name: "clip.mp4", isFile: true },
      { name: "sub", isFile: false },
    ]);
    const list = await imageSiblings(`${DIR}/photo10.jpg`);
    // photo2 before photo10: numeric collation, not lexicographic.
    expect(list).toEqual([`${DIR}/photo2.jpg`, `${DIR}/photo10.jpg`]);
  });

  it("keeps the current file even when the listing did not contain it", async () => {
    fs.readDir.mockResolvedValue([{ name: "other.png", isFile: true }]);
    const list = await imageSiblings(`${DIR}/photo.jpg`);
    expect(list[0]).toBe(`${DIR}/photo.jpg`);
  });

  it("degrades to just this file when the directory cannot be read", async () => {
    fs.readDir.mockRejectedValue(new Error("denied"));
    expect(await imageSiblings(`${DIR}/photo.jpg`)).toEqual([`${DIR}/photo.jpg`]);
  });
});

describe("stepSibling", () => {
  const list = ["/a/1.jpg", "/a/2.jpg", "/a/3.jpg"];

  it("walks in both directions", () => {
    expect(stepSibling(list, "/a/2.jpg", -1)).toBe("/a/1.jpg");
    expect(stepSibling(list, "/a/2.jpg", 1)).toBe("/a/3.jpg");
  });

  it("clamps at the ends instead of wrapping", () => {
    expect(stepSibling(list, "/a/1.jpg", -1)).toBeNull();
    expect(stepSibling(list, "/a/3.jpg", 1)).toBeNull();
  });

  it("does nothing with a single sibling or an unknown current", () => {
    expect(stepSibling(["/a/1.jpg"], "/a/1.jpg", 1)).toBeNull();
    expect(stepSibling(list, "/a/other.jpg", 1)).toBeNull();
  });
});
