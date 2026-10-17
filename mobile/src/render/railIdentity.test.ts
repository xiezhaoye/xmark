// @vitest-environment node
import { describe, expect, it } from "vitest";
import { railColor, railGlyph } from "./railIdentity";

describe("railGlyph", () => {
  it.each([
    ["wiki", "W"],
    ["笔记", "笔"],
    [".config", "C"],
    ["🚀 project", "🚀"],
    ["", "?"],
  ])("%j → %s", (name, glyph) => expect(railGlyph(name)).toBe(glyph));
});

describe("railColor", () => {
  it("is stable for a seed and drawn from the rail palette", () => {
    expect(railColor("0029625c062af030")).toBe(railColor("0029625c062af030"));
    expect(railColor("abc")).toMatch(/^var\(--/);
  });

  it("spreads different seeds over more than one colour", () => {
    const colors = new Set(["a", "b", "c", "d", "e", "f", "g", "h"].map(railColor));
    expect(colors.size).toBeGreaterThan(1);
  });
});
