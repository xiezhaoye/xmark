import { describe, expect, it } from "vitest";
import { classifyFile, imageContentType } from "./fileKinds";

describe("classifyFile", () => {
  it.each([
    ["note.md", "markdown"],
    ["NOTE.MARKDOWN", "markdown"],
    ["deck.mdx", "markdown"],
    ["data.json", "text"],
    ["ci.yml", "text"],
    ["diagram.mmd", "text"],
    ["page.html", "text"],
    ["main.rs", "text"],
    ["photo.JPG", "image"],
    ["icon.svg", "image"],
    ["clip.mp4", null],
    ["song.mp3", null],
    ["archive.zip", null],
    ["Makefile", null],
    [".md", null],
  ])("%s → %s", (name, kind) => {
    expect(classifyFile(name)).toBe(kind);
  });
});

describe("imageContentType", () => {
  it.each([
    ["a.png", "image/png"],
    ["a.jpeg", "image/jpeg"],
    ["a.svg", "image/svg+xml"],
    ["a.heic", "image/heic"],
    ["a.txt", null],
  ])("%s → %s", (name, type) => {
    expect(imageContentType(name)).toBe(type);
  });
});
