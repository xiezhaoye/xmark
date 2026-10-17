import { describe, expect, it } from "vitest";
import { pairUrl, renderPairing } from "./pairing";

describe("pairUrl", () => {
  it("encodes host, port and token", () => {
    expect(pairUrl({ host: "m4.tailc8e51.ts.net", port: 8740, token: "ab" })).toBe(
      "xmark-mobile://pair?host=m4.tailc8e51.ts.net&port=8740&token=ab",
    );
  });
});

describe("renderPairing", () => {
  it("renders a terminal QR block plus the manual fields", async () => {
    const text = await renderPairing({ host: "h.ts.net", port: 1, token: "t".repeat(64) });
    expect(text).toContain("h.ts.net");
    expect(text).toContain(`xmark-mobile://pair?host=h.ts.net&port=1&token=${"t".repeat(64)}`);
    expect(text).toContain("t".repeat(64));
    expect(text.split("\n").length).toBeGreaterThan(10);
  });
});
