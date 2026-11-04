// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { LOCALES, errorText, setLanguage, t } from "./i18n";

afterEach(() => setLanguage("zh"));

describe("i18n", () => {
  it("has the same keys in both languages, all non-empty", () => {
    expect(Object.keys(LOCALES.en).sort()).toEqual(Object.keys(LOCALES.zh).sort());
    for (const v of [...Object.values(LOCALES.en), ...Object.values(LOCALES.zh)]) expect(v.length).toBeGreaterThan(0);
  });

  it("interpolates variables", () => {
    setLanguage("en");
    expect(t("settings.added", { name: "m4" })).toBe("Added “m4”");
  });

  it("maps known and unknown error codes", () => {
    setLanguage("zh");
    expect(errorText("not_utf8")).toContain("UTF-8");
    expect(errorText("http_500")).toContain("http_500");
  });
});

describe("share and PDF strings", () => {
  const KEYS = [
    "settings.share",
    "settings.shareUnavailable",
    "share.sendFile",
    "share.copyLink",
    "share.sending",
    "share.creating",
    "share.copied",
    "share.copyFailed",
    "share.retryCopy",
    "share.linkLabel",
    "share.cancelled",
    "share.sent",
    "share.failed",
    "share.busy",
    "error.sharing_unavailable",
  ] as const;

  it("has every share string in both languages", () => {
    for (const key of KEYS) {
      expect(LOCALES.zh[key], key).toBeTruthy();
      expect(LOCALES.en[key], key).toBeTruthy();
    }
  });

  it("explains sharing_unavailable in words rather than a code", () => {
    setLanguage("en");
    expect(errorText("sharing_unavailable")).toContain("public link");
    setLanguage("zh");
    expect(errorText("sharing_unavailable")).not.toContain("sharing_unavailable");
  });

  it("labels the two share actions", () => {
    setLanguage("zh");
    expect(t("share.sendFile")).toBe("分享文件");
    expect(t("share.copyLink")).toContain("链接");
    setLanguage("en");
    expect(t("share.sendFile")).toBe("Share file");
    expect(t("share.copyLink")).toBe("Create share link");
  });
});
