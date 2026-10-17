// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parsePairUrl } from "./parsePairUrl";

const TOKEN = "a".repeat(64);

describe("parsePairUrl", () => {
  it("parses the link the Mac prints", () => {
    expect(parsePairUrl(`xmark-mobile://pair?host=m4.tailc8e51.ts.net&port=8740&token=${TOKEN}`)).toEqual({
      host: "m4.tailc8e51.ts.net",
      port: 8740,
      token: TOKEN,
    });
  });

  it("accepts a Tailscale IPv4 host and surrounding whitespace", () => {
    expect(parsePairUrl(`  xmark-mobile://pair?host=100.66.175.80&port=8740&token=${TOKEN}\n`)?.host).toBe("100.66.175.80");
  });

  it.each([
    ["another scheme", `https://pair?host=a.ts.net&port=1&token=${TOKEN}`],
    ["another action", `xmark-mobile://open?host=a.ts.net&port=1&token=${TOKEN}`],
    ["no host", `xmark-mobile://pair?port=1&token=${TOKEN}`],
    ["bad port", `xmark-mobile://pair?host=a.ts.net&port=99999&token=${TOKEN}`],
    ["short token", "xmark-mobile://pair?host=a.ts.net&port=1&token=abc"],
    ["garbage", "hello"],
    ["empty", ""],
  ])("rejects %s", (_label, url) => {
    expect(parsePairUrl(url)).toBeNull();
  });
});
