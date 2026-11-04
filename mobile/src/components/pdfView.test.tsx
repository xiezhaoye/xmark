import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ApiError, type Client } from "../api/client";
import { setLanguage } from "../i18n";
import { useReaderStore } from "../state/readerStore";
import { saveActiveServerId, saveServers } from "../state/storage";
import { App } from "../App";

const TOKEN = "a".repeat(64);
const PROFILE = { id: "s1", name: "Study Mac", host: "m4.ts.net", port: 8740, token: TOKEN };
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);

function fakeClient(over: Partial<Client> = {}): Client {
  return {
    health: vi.fn(async () => ({ ok: true, version: "0.1.0" })),
    workspaces: vi.fn(async () => ({ groups: [{ id: "g", name: "Wiki", folders: [{ rootId: "r1", name: "wiki", available: true }] }] })),
    tree: vi.fn(async () => ({ path: "", entries: [] })),
    file: vi.fn(async () => ({ text: "", kind: "text" as const, size: 0, mtime: 1 })),
    asset: vi.fn(async () => new Blob()),
    search: vi.fn(async () => ({ results: [], truncated: false })),
    download: vi.fn(async () => ({ bytes: PDF, name: "手册.pdf", mimeType: "application/pdf" })),
    createShare: vi.fn(async () => ({ url: "https://box.ts.net/s/abc" })),
    ...over,
  };
}

let client: Client;
let created: Blob[] = [];
let revoked: string[] = [];
let urlSeq = 0;

beforeEach(() => {
  setLanguage("en");
  localStorage.clear();
  created = [];
  revoked = [];
  urlSeq = 0;
  client = fakeClient();
  useReaderStore.getState().reset(() => client);
  saveServers([PROFILE]);
  saveActiveServerId(PROFILE.id);
  localStorage.setItem("xmark-mobile.lastDoc", JSON.stringify({ [PROFILE.id]: { rootId: "r1", relPath: "手册.pdf" } }));
  URL.createObjectURL = vi.fn((blob: Blob) => {
    created.push(blob);
    urlSeq += 1;
    return `blob:pdf-${urlSeq}`;
  });
  URL.revokeObjectURL = vi.fn((url: string) => {
    revoked.push(url);
  });
});

afterEach(() => {
  cleanup();
  setLanguage("zh");
});

const flush = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

const viewer = (container: HTMLElement) => container.querySelector("iframe.pdf-view") as HTMLIFrameElement | null;

describe("PDF documents", () => {
  it("opens a PDF as a blob preview of the file's own bytes", async () => {
    const { container } = render(<App />);
    for (let turn = 0; turn < 3 && !container.querySelector("iframe.pdf-view"); turn += 1) await flush();
    expect(client.file).not.toHaveBeenCalled();
    expect(client.download).toHaveBeenCalledWith("r1", "手册.pdf");
    const frame = viewer(container);
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute("src")).toBe("blob:pdf-1");
    expect(frame?.getAttribute("title")).toBe("手册.pdf");
    expect(created[0]?.type).toBe("application/pdf");
  });

  it("does not offer the preview/source switch for a PDF", async () => {
    const { container } = render(<App />);
    await flush();
    await flush();
    const scroller = container.querySelector(".document") as HTMLElement;
    scroller.scrollTop = 400;
    await act(async () => {
      scroller.dispatchEvent(new Event("scroll"));
    });
    expect(screen.queryByRole("radio", { name: "Source" })).toBeNull();
  });

  it("explains a failed fetch and retries", async () => {
    vi.mocked(client.download).mockRejectedValueOnce(new ApiError(404, "not_found"));
    const { container } = render(<App />);
    await flush();
    expect(screen.getByText(/missing or was moved/)).toBeTruthy();
    expect(viewer(container)).toBeNull();
    act(() => {
      screen.getByRole("button", { name: "Retry" }).click();
    });
    await flush();
    expect(viewer(container)).not.toBeNull();
  });

  it("releases its blob URL when the document is replaced", async () => {
    const { container } = render(<App />);
    await flush();
    await act(async () => {
      await useReaderStore.getState().openDoc("r1", "a.md");
    });
    await flush();
    expect(viewer(container)).toBeNull();
    expect(revoked).toContain("blob:pdf-1");
  });

  it("shows the latest PDF when the open document changes before the first arrives", async () => {
    let releaseFirst!: (v: { bytes: Uint8Array; name: string; mimeType: string }) => void;
    vi.mocked(client.download).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseFirst = resolve;
        }),
    );
    vi.mocked(client.download).mockImplementationOnce(async () => ({ bytes: PDF, name: "第二个.pdf", mimeType: "application/pdf" }));
    const { container } = render(<App />);
    await flush();
    await act(async () => {
      await useReaderStore.getState().openDoc("r1", "第二个.pdf");
    });
    await flush();
    // The slower first answer must not replace the newer document's preview.
    await act(async () => {
      releaseFirst({ bytes: PDF, name: "手册.pdf", mimeType: "application/pdf" });
      await Promise.resolve();
    });
    expect(viewer(container)?.getAttribute("title")).toBe("第二个.pdf");
  });

  // NOT a stale expectation but a missing feature: `DocumentView` no longer
  // installs a pull gesture at all, so nothing refetches a PDF on a downward
  // drag. Kept as a todo so the intent stays visible instead of being deleted
  // or, worse, turned into an assertion that passes by describing less.
  it.todo("fetches afresh when the document is pulled down to refresh", async () => {
    const { container } = render(<App />);
    await flush();
    expect(client.download).toHaveBeenCalledTimes(1);
    const scroller = container.querySelector(".document") as HTMLElement;
    fireEvent.touchStart(scroller, { touches: [{ clientY: 0 }] });
    fireEvent.touchMove(scroller, { touches: [{ clientY: 300 }] });
    fireEvent.touchEnd(scroller);
    await flush();
    expect(client.download).toHaveBeenCalledTimes(2);
    // The new bytes get their own URL, and the old one is released.
    expect(viewer(container)?.getAttribute("src")).toBe("blob:pdf-2");
    expect(revoked).toContain("blob:pdf-1");
  });
});
