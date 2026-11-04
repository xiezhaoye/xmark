import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** What the app sees inside Tauri; set before each import of the module. */
const tauriWindow = () => Object.assign(window, { __TAURI_INTERNALS__: {} });

const clipboardWriteText = vi.fn(async (_text: string) => {});

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  writeText: (text: string) => clipboardWriteText(text),
  readText: async () => "",
}));

/** Loads `share.ts` fresh, so its module-level platform detection re-runs. */
async function loadShare() {
  vi.resetModules();
  return (await import("./share")) as typeof import("./share");
}

beforeEach(() => {
  clipboardWriteText.mockReset();
  clipboardWriteText.mockResolvedValue(undefined);
  localStorage.clear();
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
});
afterEach(() => {
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  vi.unstubAllGlobals();
});

const doc = { rootId: "r1", relPath: "notes/报告.pdf" };

describe("shareTargetOf", () => {
  it("names a file by its last path segment and carries the document with it", async () => {
    const { shareTargetOf } = await loadShare();
    expect(shareTargetOf(doc, "s1")).toEqual({ rootId: "r1", relPath: "notes/报告.pdf", name: "报告.pdf", serverId: "s1" });
  });

  it("handles a root-level name and an empty name", async () => {
    const { shareTargetOf } = await loadShare();
    expect(shareTargetOf({ rootId: "r", relPath: "a.md" }, "s").name).toBe("a.md");
    expect(shareTargetOf({ rootId: "r", relPath: "" }, "s").name).toBe("r");
  });
});

describe("copyText", () => {
  it("writes through Tauri's clipboard inside the app", async () => {
    tauriWindow();
    const { copyText } = await loadShare();
    await copyText("https://box.ts.net/s/abc");
    expect(clipboardWriteText).toHaveBeenCalledWith("https://box.ts.net/s/abc");
  });

  it("uses the browser clipboard outside the app", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    const { copyText } = await loadShare();
    await copyText("https://x");
    expect(writeText).toHaveBeenCalledWith("https://x");
    expect(clipboardWriteText).not.toHaveBeenCalled();
  });

  it("answers false instead of throwing when the clipboard refuses", async () => {
    tauriWindow();
    clipboardWriteText.mockRejectedValueOnce(new Error("denied"));
    const { copyText } = await loadShare();
    await expect(copyText("x")).resolves.toBe(false);
  });

  it("answers false when there is no clipboard at all", async () => {
    vi.stubGlobal("navigator", { ...navigator, clipboard: undefined });
    const { copyText } = await loadShare();
    expect(await copyText("x")).toBe(false);
  });

  it("remembers the last link copied, so a later failure can still show it", async () => {
    tauriWindow();
    const { copyText, lastCopiedLink } = await loadShare();
    expect(lastCopiedLink()).toBeNull();
    await copyText("https://box.ts.net/s/abc");
    expect(lastCopiedLink()).toBe("https://box.ts.net/s/abc");
    clipboardWriteText.mockRejectedValueOnce(new Error("denied"));
    await copyText("https://box.ts.net/s/def");
    expect(lastCopiedLink()).toBe("https://box.ts.net/s/abc");
  });
});
