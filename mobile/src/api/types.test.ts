// @vitest-environment node
import { describe, expect, it } from "vitest";
import { defaultServerName } from "./types";

describe("defaultServerName", () => {
  it("takes the first label of a Tailscale domain, however long the domain", () => {
    expect(defaultServerName("m4.tailc8e51.ts.net")).toBe("m4");
    expect(defaultServerName("m1.some-very-long-tailnet-name-1234.ts.net")).toBe("m1");
    expect(defaultServerName("m4.ts.net")).toBe("m4");
  });

  it("uses the address itself when it is an IP", () => {
    expect(defaultServerName("100.66.175.80")).toBe("100.66.175.80");
    expect(defaultServerName("192.168.1.9")).toBe("192.168.1.9");
  });

  it("leaves a bare name alone", () => {
    expect(defaultServerName("m4")).toBe("m4");
    expect(defaultServerName("mac-mini")).toBe("mac-mini");
  });
});
