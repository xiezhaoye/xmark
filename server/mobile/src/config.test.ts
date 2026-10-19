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

describe("resolveConfig platform-aware data directory", () => {
  const LINUX_HOME = "/home/me";

  it("keeps macOS on the desktop app's Application Support directory", () => {
    const cfg = resolveConfig({}, HOME, "darwin");
    expect(cfg.shareFile).toBe("/Users/me/Library/Application Support/app.xmark/mobile-share.json");
    expect(cfg.tokenFile).toBe("/Users/me/Library/Application Support/app.xmark/mobile-server/token");
  });

  it("uses ~/.local/share on Linux when XDG_DATA_HOME is unset", () => {
    const cfg = resolveConfig({}, LINUX_HOME, "linux");
    expect(cfg.shareFile).toBe("/home/me/.local/share/app.xmark/mobile-share.json");
    expect(cfg.tokenFile).toBe("/home/me/.local/share/app.xmark/mobile-server/token");
  });

  it("prefers an absolute XDG_DATA_HOME on Linux", () => {
    const cfg = resolveConfig({ XDG_DATA_HOME: "/srv/data" }, LINUX_HOME, "linux");
    expect(cfg.shareFile).toBe("/srv/data/app.xmark/mobile-share.json");
    expect(cfg.tokenFile).toBe("/srv/data/app.xmark/mobile-server/token");
  });

  it("ignores a relative XDG_DATA_HOME, which the XDG spec says is invalid", () => {
    for (const raw of ["rel/data", "", " "]) {
      expect(resolveConfig({ XDG_DATA_HOME: raw }, LINUX_HOME, "linux").shareFile).toBe(
        "/home/me/.local/share/app.xmark/mobile-share.json",
      );
    }
  });

  it("honours the app identifier on Linux too", () => {
    expect(resolveConfig({ XMARK_APP_IDENTIFIER: "app.vmark.dev" }, LINUX_HOME, "linux").shareFile).toBe(
      "/home/me/.local/share/app.vmark.dev/mobile-share.json",
    );
  });

  it("treats every non-macOS platform as Linux", () => {
    for (const platform of ["win32", "freebsd", "openbsd", "aix"] as NodeJS.Platform[]) {
      expect(resolveConfig({}, "/home/me", platform).shareFile).toBe("/home/me/.local/share/app.xmark/mobile-share.json");
    }
  });

  it("still lets explicit paths win on any platform", () => {
    const env = { XMARK_MOBILE_SHARE_FILE: "/s.json", XMARK_MOBILE_TOKEN_FILE: "/t", XDG_DATA_HOME: "/srv/data" };
    expect(resolveConfig(env, LINUX_HOME, "linux")).toMatchObject({ shareFile: "/s.json", tokenFile: "/t" });
    expect(resolveConfig(env, HOME, "darwin")).toMatchObject({ shareFile: "/s.json", tokenFile: "/t" });
  });

  it("rejects an identifier that would escape the data directory on Linux", () => {
    expect(() => resolveConfig({ XMARK_APP_IDENTIFIER: "../x" }, LINUX_HOME, "linux")).toThrow(/identifier/i);
  });

  it("defaults the platform to the running one", () => {
    const cfg = resolveConfig({}, LINUX_HOME);
    const expected = process.platform === "darwin"
      ? "/home/me/Library/Application Support/app.xmark/mobile-share.json"
      : "/home/me/.local/share/app.xmark/mobile-share.json";
    expect(cfg.shareFile).toBe(expected);
  });
});
