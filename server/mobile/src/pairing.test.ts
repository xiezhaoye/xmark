import { describe, expect, it } from "vitest";
import { pairUrl, renderPairing } from "./pairing";

describe("pairUrl", () => {
  it("encodes host, port and token", () => {
    expect(pairUrl({ host: "m4.tailc8e51.ts.net", port: 8740, token: "ab" })).toBe(
      "xmark-mobile://pair?host=m4.tailc8e51.ts.net&port=8740&token=ab",
    );
  });

  it("is unchanged when name is absent, empty or whitespace", () => {
    const expected = "xmark-mobile://pair?host=h.ts.net&port=1&token=ab";
    expect(pairUrl({ host: "h.ts.net", port: 1, token: "ab", name: undefined })).toBe(expected);
    expect(pairUrl({ host: "h.ts.net", port: 1, token: "ab", name: "" })).toBe(expected);
  });

  it("appends the name last, so the old parameters keep their order", () => {
    expect(pairUrl({ host: "h.ts.net", port: 1, token: "ab", name: "M4" })).toBe(
      "xmark-mobile://pair?host=h.ts.net&port=1&token=ab&name=M4",
    );
  });

  it("percent-encodes a non-ASCII name and a name with reserved characters", () => {
    const name = "书房 Mac & co/y";
    const url = pairUrl({ host: "h.ts.net", port: 1, token: "ab", name });
    const query = new URLSearchParams(url.slice(url.indexOf("?") + 1));
    expect(query.get("name")).toBe(name);
    expect(query.get("host")).toBe("h.ts.net");
    expect(query.get("token")).toBe("ab");
    // Encoded, not raw: the link travels through a QR code and a paste field.
    expect(url).not.toContain(name);
    expect(url).toContain("name=%E4%B9%A6%E6%88%BF+Mac+%26+co%2Fy");
  });

  it("round-trips through the app's parser shape", () => {
    const url = pairUrl({ host: "h.ts.net", port: 8740, token: "t", name: "办公室" });
    const query = new URLSearchParams(url.replace("xmark-mobile://pair?", ""));
    expect(Object.fromEntries(query)).toEqual({ host: "h.ts.net", port: "8740", token: "t", name: "办公室" });
  });
});

describe("renderPairing", () => {
  it("renders a terminal QR block plus the manual fields", async () => {
    const text = await renderPairing({ host: "h.ts.net", port: 1, token: "t".repeat(64) });
    expect(text).toContain("h.ts.net");
    expect(text).toContain(`xmark-mobile://pair?host=h.ts.net&port=1&token=${"t".repeat(64)}`);
    expect(text).toContain("t".repeat(64));
    expect(text.split("\n").length).toBeGreaterThan(10);
    expect(text).not.toContain("Name:");
  });

  it("shows a Name line only when a name is given", async () => {
    const without = await renderPairing({ host: "h.ts.net", port: 1, token: "t" });
    const with_ = await renderPairing({ host: "h.ts.net", port: 1, token: "t", name: "书房 Mac" });
    expect(without).not.toContain("Name:");
    expect(with_).toContain("  Name:  书房 Mac");
    const nameLine = with_.split("\n").findIndex((line) => line.startsWith("  Name:"));
    expect(nameLine).toBeGreaterThan(0);
    expect(with_.split("\n")[nameLine + 1]).toBe("  Host:  h.ts.net");
    expect(with_).toContain("name=%E4%B9%A6%E6%88%BF+Mac");
  });
});
