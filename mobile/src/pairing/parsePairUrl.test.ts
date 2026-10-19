// @vitest-environment node
import { describe, expect, it } from "vitest";
import { PAIR_URL_NAME_MAX } from "../api/types";
import { parsePairLink, parsePairUrl } from "./parsePairUrl";

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

  it("leaves the name empty for a link printed before names existed", () => {
    expect(parsePairLink(`xmark-mobile://pair?host=a.ts.net&port=8740&token=${TOKEN}`)).toEqual({
      connection: { host: "a.ts.net", port: 8740, token: TOKEN },
      name: "",
      nameTooLong: false,
    });
  });

  it("carries an optional display name, URL-decoded", () => {
    const link = parsePairLink(`xmark-mobile://pair?host=a.ts.net&port=8740&token=${TOKEN}&name=${encodeURIComponent("书房 Mac")}`);
    expect(link?.name).toBe("书房 Mac");
    expect(link?.nameTooLong).toBe(false);
    expect(link?.connection).toEqual({ host: "a.ts.net", port: 8740, token: TOKEN });
  });

  it("trims a name and drops a blank one", () => {
    expect(parsePairLink(`xmark-mobile://pair?host=a.ts.net&port=8740&token=${TOKEN}&name=${encodeURIComponent("  客厅  ")}`)?.name).toBe("客厅");
    expect(parsePairLink(`xmark-mobile://pair?host=a.ts.net&port=8740&token=${TOKEN}&name=${encodeURIComponent("   ")}`)?.name).toBe("");
  });

  it("cuts a name at the length limit and says so", () => {
    const long = "机".repeat(PAIR_URL_NAME_MAX + 5);
    const link = parsePairLink(`xmark-mobile://pair?host=a.ts.net&port=8740&token=${TOKEN}&name=${encodeURIComponent(long)}`);
    expect(link?.name).toBe("机".repeat(PAIR_URL_NAME_MAX));
    expect(link?.name).toBe(link?.name.trim());
    expect(link?.nameTooLong).toBe(true);
    expect(parsePairLink(`xmark-mobile://pair?host=a.ts.net&port=8740&token=${TOKEN}&name=${encodeURIComponent("机".repeat(PAIR_URL_NAME_MAX))}`)?.nameTooLong).toBe(false);
  });

  it("still returns just the connection from the old entry point", () => {
    const link = parsePairLink(`xmark-mobile://pair?host=a.ts.net&port=8740&token=${TOKEN}&name=Mac`);
    expect(parsePairUrl(`xmark-mobile://pair?host=a.ts.net&port=8740&token=${TOKEN}&name=Mac`)).toEqual(link?.connection);
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
