import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Mark the window as being inside Tauri before the module import runs. */
const tauriWindow = () => Object.assign(window, { __TAURI_INTERNALS__: {} });

const invoke = vi.fn(async (_cmd: string, _args?: unknown) => true);

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

async function loadPlatformShare() {
  vi.resetModules();
  return (await import("./platformShare")) as typeof import("./platformShare");
}

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue(true);
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
});
afterEach(() => {
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  vi.unstubAllGlobals();
});

const payload = (overrides: Partial<{ name: string; bytes: Uint8Array; mimeType: string }> = {}) => ({
  name: "报告.pdf",
  bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
  mimeType: "application/pdf",
  ...overrides,
});

describe("shareFile native path", () => {
  it("invokes the xmark-share plugin command with base64 bytes", async () => {
    tauriWindow();
    const { shareFile } = await loadPlatformShare();
    const ok = await shareFile(payload());
    expect(ok).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(1);
    const [cmd, args] = invoke.mock.calls[0];
    expect(cmd).toBe("plugin:xmark-share|share_file");
    expect(args).toMatchObject({ name: "报告.pdf", mimeType: "application/pdf" });
    // base64 of 0x25 0x50 0x44 0x46 ("%PDF") is "JVBERg==".
    expect((args as { base64: string }).base64).toBe("JVBERg==");
  });

  it("returns false for a user cancellation (resolve false)", async () => {
    tauriWindow();
    invoke.mockResolvedValue(false);
    const { shareFile } = await loadPlatformShare();
    expect(await shareFile(payload())).toBe(false);
  });

  it("propagates native errors (unsupported / share_failed) to the caller", async () => {
    tauriWindow();
    invoke.mockRejectedValue(new Error("unsupported on this platform"));
    const { shareFile } = await loadPlatformShare();
    await expect(shareFile(payload())).rejects.toThrow("unsupported on this platform");
  });

  it("accepts empty files and rejects oversized payloads before IPC", async () => {
    tauriWindow();
    const { shareFile } = await loadPlatformShare();
    await expect(shareFile(payload({ bytes: new Uint8Array(0) }))).resolves.toBe(true);
    invoke.mockClear();
    await expect(
      shareFile(payload({ bytes: new Uint8Array(30 * 1024 * 1024 + 1) })),
    ).rejects.toThrow("invalid file size");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("rejects a name with path separators before IPC", async () => {
    tauriWindow();
    const { shareFile } = await loadPlatformShare();
    await expect(shareFile(payload({ name: "a/../b.md" }))).rejects.toThrow("invalid filename");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("encodes multi-byte Unicode content without a huge spread", async () => {
    tauriWindow();
    const { shareFile } = await loadPlatformShare();
    const bytes = new TextEncoder().encode("你好，世界");
    await shareFile(payload({ bytes, name: "你好.txt", mimeType: "text/plain" }));
    const args = invoke.mock.calls[0][1] as { base64: string };
    // base64 of the UTF-8 bytes of "你好，世界".
    expect(args.base64).toBe("5L2g5aW977yM5LiW55WM");
  });
});

describe("shareFile browser fallback", () => {
  it("uses navigator.share with a File and resolves true on completion", async () => {
    const share = vi.fn(async (_data: { files: File[] }) => {});
    vi.stubGlobal("navigator", {
      canShare: vi.fn(() => true),
      share,
    });
    const { shareFile } = await loadPlatformShare();
    expect(await shareFile(payload())).toBe(true);
    expect(share).toHaveBeenCalledTimes(1);
    const called = share.mock.calls[0][0] as { files: File[] };
    expect(called.files).toHaveLength(1);
    expect(called.files[0].name).toBe("报告.pdf");
    expect(called.files[0].type).toBe("application/pdf");
  });

  it("treats AbortError as a quiet cancel (false)", async () => {
    vi.stubGlobal("navigator", {
      canShare: vi.fn(() => true),
      share: vi.fn(async () => {
        throw new DOMException("cancel", "AbortError");
      }),
    });
    const { shareFile } = await loadPlatformShare();
    expect(await shareFile(payload())).toBe(false);
  });

  it("throws unsupported when canShare is missing or false", async () => {
    vi.stubGlobal("navigator", { canShare: vi.fn(() => false), share: vi.fn() });
    const { shareFile } = await loadPlatformShare();
    await expect(shareFile(payload())).rejects.toThrow("unsupported on this platform");
  });
});
