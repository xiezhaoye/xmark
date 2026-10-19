// @vitest-environment node
import { describe, expect, it } from "vitest";
import { addressParts, defaultServerName, sameServer } from "../serverIdentity";

describe("defaultServerName", () => {
  it.each([
    ["m4.tailc8e51.ts.net", "m4"],
    ["macbook.tailc8e51.ts.net", "macbook"],
    ["100.101.7.42", "100.101.7.42"],
    ["localhost", "localhost"],
    ["m4", "m4"],
  ])("%s → %s", (host, expected) => {
    expect(defaultServerName(host)).toBe(expected);
  });

  it("returns an empty string for an empty host rather than throwing", () => {
    expect(defaultServerName("")).toBe("");
    expect(defaultServerName("   ")).toBe("");
  });

  it("keeps a CJK label intact", () => {
    expect(defaultServerName("书房.tailc8e51.ts.net")).toBe("书房");
  });
});

describe("sameServer", () => {
  it("ignores host case and surrounding space", () => {
    expect(sameServer({ host: " M4.tailc8e51.ts.net ", port: 8740 }, { host: "m4.TAILC8E51.ts.net", port: 8740 })).toBe(true);
  });

  it("separates different ports on one host", () => {
    expect(sameServer({ host: "m4.tailc8e51.ts.net", port: 8740 }, { host: "m4.tailc8e51.ts.net", port: 8741 })).toBe(false);
  });

  it("separates different hosts on one port", () => {
    expect(sameServer({ host: "m4.tailc8e51.ts.net", port: 8740 }, { host: "m5.tailc8e51.ts.net", port: 8740 })).toBe(false);
  });
});

describe("addressParts", () => {
  it("splits the host into labels and keeps the port whole", () => {
    expect(addressParts("m4.tailc8e51.ts.net", 8740)).toEqual({
      segments: ["m4", "tailc8e51", "ts", "net"],
      port: ":8740",
    });
  });
});
