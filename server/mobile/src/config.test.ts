import { describe, expect, it } from "vitest";
import { DEFAULT_PORT, resolveConfig } from "./config";

const HOME = "/Users/me";

describe("resolveConfig", () => {
  it("defaults to the release app's support directory and port", () => {
    expect(resolveConfig({}, HOME)).toEqual({
      shareFile: "/Users/me/Library/Application Support/app.xmark/mobile-share.json",
      tokenFile: "/Users/me/Library/Application Support/app.xmark/mobile-server/token",
      port: DEFAULT_PORT,
      host: null,
    });
  });

  it("follows the app identifier override (the dev build is app.vmark.dev)", () => {
    const cfg = resolveConfig({ XMARK_APP_IDENTIFIER: "app.vmark.dev" }, HOME);
    expect(cfg.shareFile).toBe("/Users/me/Library/Application Support/app.vmark.dev/mobile-share.json");
  });

  it("honours explicit overrides", () => {
    expect(
      resolveConfig(
        { XMARK_MOBILE_SHARE_FILE: "/s.json", XMARK_MOBILE_TOKEN_FILE: "/t", XMARK_MOBILE_PORT: "9000", XMARK_MOBILE_HOST: "127.0.0.1" },
        HOME,
      ),
    ).toEqual({ shareFile: "/s.json", tokenFile: "/t", port: 9000, host: "127.0.0.1" });
  });

  it.each([["65536"], ["abc"], ["80.5"], [""]])("rejects port %j", (port) => {
    expect(() => resolveConfig({ XMARK_MOBILE_PORT: port }, HOME)).toThrow(/port/i);
  });

  it("rejects an identifier that would escape the support directory", () => {
    expect(() => resolveConfig({ XMARK_APP_IDENTIFIER: "../x" }, HOME)).toThrow(/identifier/i);
  });
});

describe("resolveConfig port 0", () => {
  it("accepts 0 for an OS-assigned test port", () => {
    expect(resolveConfig({ XMARK_MOBILE_PORT: "0" }, HOME).port).toBe(0);
  });
});
