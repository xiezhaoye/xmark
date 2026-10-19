// @vitest-environment node
import { describe, expect, it } from "vitest";
import { PAIR_LINK_NAME_MAX, parsePairLink } from "../parsePairLink";

const TOKEN = "a".repeat(64);

const link = (params: Record<string, string>) =>
  `xmark-mobile://pair?${new URLSearchParams(params).toString()}`;

const good = { host: "m4.tailc8e51.ts.net", port: "8740", token: TOKEN };

describe("parsePairLink", () => {
  it("parses a minimal pairing link", () => {
    const parsed = parsePairLink(link(good));
    expect(parsed).not.toBeNull();
    expect(parsed?.connection).toEqual({ host: "m4.tailc8e51.ts.net", port: 8740, token: TOKEN });
    expect(parsed?.name).toBe("");
    expect(parsed?.nameTooLong).toBe(false);
  });

  it("keeps an optional name, trimmed", () => {
    const parsed = parsePairLink(link({ ...good, name: "  Mac 助理  " }));
    // The query encoding round-trips CJK names unchanged.
    expect(parsed?.name).toBe("Mac 助理");
  });

  it("cuts a name longer than the limit and reports it", () => {
    const long = "名".repeat(PAIR_LINK_NAME_MAX + 5);
    const parsed = parsePairLink(link({ ...good, name: long }));
    expect(parsed?.name).toHaveLength(PAIR_LINK_NAME_MAX);
    expect(parsed?.nameTooLong).toBe(true);
  });

  it("trims surrounding whitespace from the whole link", () => {
    expect(parsePairLink(`   ${link(good)}\n`)).not.toBeNull();
  });

  it.each([
    ["empty", ""],
    ["not a pair link", "https://example.com/pair?host=a&port=1&token=x"],
    ["wrong scheme", "vmark://pair?host=a.tailc8e51.ts.net&port=1&token=" + TOKEN],
    ["no query", "xmark-mobile://pair"],
    ["no host", link({ port: "8740", token: TOKEN })],
    ["host with a slash", link({ ...good, host: "m4/../etc" })],
    ["host with a space", link({ ...good, host: "m4 ts" })],
    ["host with a colon", link({ ...good, host: "m4:8740" })],
    ["port zero", link({ ...good, port: "0" })],
    ["port too large", link({ ...good, port: "65536" })],
    ["port not a number", link({ ...good, port: "eighty" })],
    ["port fractional", link({ ...good, port: "80.5" })],
    ["port with a sign", link({ ...good, port: "+80" })],
    ["port negative", link({ ...good, port: "-1" })],
    ["port empty", link({ ...good, port: "" })],
    ["token too short", link({ ...good, token: "a".repeat(63) })],
    ["token too long", link({ ...good, token: "a".repeat(65) })],
    ["token uppercase", link({ ...good, token: "A".repeat(64) })],
    ["token not hex", link({ ...good, token: "z".repeat(64) })],
    ["no token", link({ host: good.host, port: good.port })],
  ])("rejects %s", (_label, raw) => {
    expect(parsePairLink(raw)).toBeNull();
  });

  it("accepts the boundary ports", () => {
    expect(parsePairLink(link({ ...good, port: "1" }))?.connection.port).toBe(1);
    expect(parsePairLink(link({ ...good, port: "65535" }))?.connection.port).toBe(65535);
  });

  it("accepts a loopback host and an IP", () => {
    expect(parsePairLink(link({ ...good, host: "127.0.0.1" }))?.connection.host).toBe("127.0.0.1");
    expect(parsePairLink(link({ ...good, host: "100.101.7.42" }))?.connection.host).toBe("100.101.7.42");
  });
});
