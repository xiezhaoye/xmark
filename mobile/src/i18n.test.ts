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
