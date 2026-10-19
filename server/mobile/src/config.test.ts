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
      corsOrigins: [],
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
    ).toEqual({ shareFile: "/s.json", tokenFile: "/t", port: 9000, host: "127.0.0.1", corsOrigins: [] });
  });

  it.each([["65536"], ["abc"], ["80.5"], [""]])("rejects port %j", (port) => {
    expect(() => resolveConfig({ XMARK_MOBILE_PORT: port }, HOME)).toThrow(/port/i);
  });

  it("rejects an identifier that would escape the support directory", () => {
    expect(() => resolveConfig({ XMARK_APP_IDENTIFIER: "../x" }, HOME)).toThrow(/identifier/i);
  });
});

describe("resolveConfig CORS origins", () => {
  it("is empty by default, so no browser may call the server", () => {
    expect(resolveConfig({}, HOME).corsOrigins).toEqual([]);
  });

  it("is empty for an empty or comma-only value", () => {
    for (const raw of ["", " ", ",", " , , "]) {
      expect(resolveConfig({ XMARK_MOBILE_CORS_ORIGINS: raw }, HOME).corsOrigins).toEqual([]);
    }
  });

  it("parses a comma-separated list, trimming and de-duplicating", () => {
    const cfg = resolveConfig(
      { XMARK_MOBILE_CORS_ORIGINS: " https://web.xmark.app , http://localhost:5173,https://web.xmark.app" },
      HOME,
    );
    expect(cfg.corsOrigins).toEqual(["https://web.xmark.app", "http://localhost:5173"]);
  });

  it("keeps the origin exactly as a browser spells it", () => {
    expect(resolveConfig({ XMARK_MOBILE_CORS_ORIGINS: "http://localhost:5173" }, HOME).corsOrigins).toEqual([
      "http://localhost:5173",
    ]);
    expect(resolveConfig({ XMARK_MOBILE_CORS_ORIGINS: "https://web.xmark.app" }, HOME).corsOrigins).toEqual([
      "https://web.xmark.app",
    ]);
  });

  it("rejects an origin a browser would never send verbatim (trailing slash, path, upper-case host)", () => {
    for (const raw of ["https://web.xmark.app/", "https://web.xmark.app/app", "https://WEB.xmark.app"]) {
      expect(() => resolveConfig({ XMARK_MOBILE_CORS_ORIGINS: raw }, HOME)).toThrow(/cors/i);
    }
  });

  it.each([["tauri://localhost"], ["file://"], ["web.xmark.app"], ["https://web.xmark.app/path"], ["*"], ["ftp://x"], ["https://web.xmark.app:"]])(
    "rejects %j",
    (raw) => {
      expect(() => resolveConfig({ XMARK_MOBILE_CORS_ORIGINS: raw }, HOME)).toThrow(/cors/i);
    },
  );

  it("names the offending entry", () => {
    expect(() => resolveConfig({ XMARK_MOBILE_CORS_ORIGINS: "https://ok.app, nope" }, HOME)).toThrow(/"nope"/);
  });
});

describe("resolveConfig port 0", () => {
  it("accepts 0 for an OS-assigned test port", () => {
    expect(resolveConfig({ XMARK_MOBILE_PORT: "0" }, HOME).port).toBe(0);
  });
});
