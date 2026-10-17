import { beforeEach, describe, expect, it } from "vitest";
import { loadConnection, loadLastDoc, saveConnection, saveLastDoc } from "./storage";

beforeEach(() => localStorage.clear());

describe("storage", () => {
  it("round-trips the connection and the last document", () => {
    saveConnection({ host: "h.ts.net", port: 1, token: "t" });
    saveLastDoc({ rootId: "r", relPath: "中文.md" });
    expect(loadConnection()).toEqual({ host: "h.ts.net", port: 1, token: "t" });
    expect(loadLastDoc()).toEqual({ rootId: "r", relPath: "中文.md" });
  });

  it("treats corrupt or wrongly shaped values as absent", () => {
    localStorage.setItem("xmark-mobile.connection", "{oops");
    localStorage.setItem("xmark-mobile.lastDoc", JSON.stringify({ rootId: 1 }));
    expect(loadConnection()).toBeNull();
    expect(loadLastDoc()).toBeNull();
  });

  it("clears on null", () => {
    saveLastDoc({ rootId: "r", relPath: "a.md" });
    saveLastDoc(null);
    expect(loadLastDoc()).toBeNull();
  });
});
