import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ApiError, type Client } from "../../api/client";
import { setLanguage } from "../../i18n";
import { useReaderStore } from "../../state/readerStore";
import { saveActiveServerId, saveServers } from "../../state/storage";
import { scanQrCode } from "../../platform";
import { shareFile } from "../../platformShare";
import { App } from "../../App";

vi.mock("../../platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../platform")>()),
  scanQrCode: vi.fn(),
}));
vi.mock("../../platformShare", () => ({ shareFile: vi.fn() }));

const TOKEN = "a".repeat(64);
const CONN = { host: "m4.ts.net", port: 8740, token: TOKEN };
const PROFILE = { id: "s1", name: "Study Mac", host: CONN.host, port: CONN.port, token: TOKEN };
const OTHER = { id: "s2", name: "客厅 Mac", host: "100.66.175.80", port: 8740, token: "b".repeat(64) };

const pair = (profile = PROFILE) => {
  saveServers([profile]);
  saveActiveServerId(profile.id);
};
const lastDoc = (relPath: string, rootId = "r1", serverId = PROFILE.id) =>
  localStorage.setItem("xmark-mobile.lastDoc", JSON.stringify({ [serverId]: { rootId, relPath } }));

function fakeClient(): Client {
  return {
    health: vi.fn(async () => ({ ok: true, version: "0.1.0" })),
    workspaces: vi.fn(async () => ({
      groups: [{ id: "g", name: "Wiki", folders: [{ rootId: "r1", name: "wiki", available: true }] }],
    })),
    tree: vi.fn(async () => ({
      path: "",
      entries: [
        { name: "a.md", kind: "markdown" as const, relPath: "a.md" },
        { name: "手册.pdf", kind: "pdf" as const, relPath: "手册.pdf" },
      ],
    })),
    file: vi.fn(async () => ({ text: "# Hello", kind: "markdown" as const, size: 7, mtime: 1 })),
    asset: vi.fn(async () => new Blob()),
    search: vi.fn(async () => ({ results: [], truncated: false })),
    download: vi.fn(async () => ({ bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]), name: "marker.pdf", mimeType: "application/pdf" })),
    createShare: vi.fn(async () => ({ url: "https://box.ts.net/s/abc" })),
  };
}

let client: Client;
beforeEach(() => {
  setLanguage("en");
  localStorage.clear();
  client = fakeClient();
  useReaderStore.getState().reset(() => client);
  vi.mocked(shareFile).mockReset();
  vi.mocked(shareFile).mockResolvedValue(true);
  vi.mocked(scanQrCode).mockReset();
});
afterEach(() => {
  cleanup();
  setLanguage("zh");
});

const flush = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

/** Renders the app with one paired server and the last document it had open. Next to `describe`: a hoisted helper is fine. */
async function openReader(profile = PROFILE, relPath = "a.md") {
  pair(profile);
  lastDoc(relPath);
  const result = render(<App />);
  await flush();
  // Let whatever this app started finish: a PDF's bytes, a status probe.
  await act(settle);
  return result;
}

/**
 * The top bar's icon. The document's top bar reports it with aria-expanded;
 * the empty document's own add-a-server row says "Settings" as a button too.
 */
const settingsButton = () => screen.getAllByLabelText("Settings")[0]!;

/** Lets every pending microtask chain run, so the next turn starts clean. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const popover = () => screen.queryByRole("dialog", { name: "Settings" });

async function openSettings() {
  fireEvent.click(settingsButton());
  await flush();
  const dialog = screen.getByRole("dialog", { name: "Settings" });
  return dialog;
}


describe("share block", () => {
  const block = (settings: HTMLElement) => within(settings);

  it("shares a PDF's original bytes from the PDF viewer", async () => {
    await openReader(PROFILE, "手册.pdf");
    const settings = await openSettings();
    expect(block(settings).getByRole("button", { name: "Share file" })).toBeTruthy();
    fireEvent.click(block(settings).getByRole("button", { name: "Share file" }));
    await flush();
    expect(shareFile).toHaveBeenCalledTimes(1);
    // What was sent is the PDF on the Mac right now, read fresh for the share.
    expect(client.download).toHaveBeenLastCalledWith("r1", "手册.pdf");
    expect(shareFile).toHaveBeenCalledWith({ name: "marker.pdf", bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]), mimeType: "application/pdf" });
    // A PDF is never read as text.
    expect(client.file).not.toHaveBeenCalled();
  });
});

describe("settings popover", () => {
  it("opens under the icon rather than replacing the document", async () => {
    const { container } = await openReader();
    expect(screen.getByRole("heading", { name: "Hello" })).toBeTruthy();
    const settings = await openSettings();
    // The document is still there, behind the popover.
    expect(screen.getByRole("heading", { name: "Hello" })).toBeTruthy();
    expect(container.querySelector(".document .topbar")).not.toBeNull();
    // Anchored to the icon: it starts below the top bar, on the right.
    expect(settings.className).toContain("settings-popover");
    expect(settings.getAttribute("aria-modal")).toBe("false");
  });

  it("is about half the screen wide and bounded to the viewport", async () => {
    await openReader();
    const settings = await openSettings();
    const style = settings.style;
    expect(parseFloat(style.width)).toBeCloseTo(window.innerWidth / 2, 0);
    expect(style.getPropertyValue("--popover-max-height")).toBeTruthy();
    expect(parseFloat(style.maxHeight || style.getPropertyValue("--popover-max-height"))).toBeGreaterThan(100);
  });

  it("is titled Settings, then share, preview/source, servers", async () => {
    await openReader();
    const settings = await openSettings();
    // Header: the title and a close button in the corner.
    expect(within(settings).getByRole("heading", { name: "Settings" })).toBeTruthy();
    expect(within(settings).getByLabelText("Close settings")).toBeTruthy();
    // Three sections, in this order.
    expect(within(settings).getByRole("heading", { name: "Share" })).toBeTruthy();
    expect(within(settings).getByRole("button", { name: "Share file" })).toBeTruthy();
    expect(within(settings).getByRole("heading", { name: "Preview" })).toBeTruthy();
    expect(within(settings).getByRole("radiogroup", { name: "View as" })).toBeTruthy();
    expect(within(settings).getByRole("heading", { name: "Servers" })).toBeTruthy();
    // The type size is not here: it floats over the document.
    expect(within(settings).queryByLabelText("Larger text")).toBeNull();
  });

  it("closes by tapping the icon again, and returns focus to it", async () => {
    await openReader();
    await openSettings();
    fireEvent.click(settingsButton());
    await flush();
    expect(popover()).toBeNull();
    expect(document.activeElement).toBe(settingsButton());
    // And it opens again.
    expect(await openSettings()).toBeTruthy();
  });

  it("closes on Escape and gives focus back to the icon", async () => {
    await openReader();
    const settings = await openSettings();
    fireEvent.keyDown(settings, { key: "Escape" });
    await flush();
    expect(popover()).toBeNull();
    expect(document.activeElement).toBe(settingsButton());
  });

  it("closes on a tap outside it, but not on a tap inside", async () => {
    const { container } = await openReader();
    const settings = await openSettings();
    fireEvent.pointerDown(settings);
    fireEvent.pointerDown(within(settings).getByRole("heading", { name: "Servers" }));
    await flush();
    expect(popover()).not.toBeNull();
    fireEvent.pointerDown(container.querySelector(".document") as HTMLElement);
    await flush();
    expect(popover()).toBeNull();
  });

  it("does not close for a tap on the icon itself, which toggles it instead", async () => {
    await openReader();
    await openSettings();
    fireEvent.pointerDown(settingsButton());
    await flush();
    expect(popover()).not.toBeNull();
  });

  it("moves focus into the popover when it opens", async () => {
    await openReader();
    const settings = await openSettings();
    expect(settings.contains(document.activeElement)).toBe(true);
  });

  it("the close button in the corner returns to the document", async () => {
    await openReader();
    await openSettings();
    fireEvent.click(screen.getByLabelText("Close settings"));
    await flush();
    expect(popover()).toBeNull();
    expect(screen.getByRole("heading", { name: "Hello" })).toBeTruthy();
  });

  it("opens for a programmatic settings request: the reader's add-a-server button", async () => {
    render(<App />);
    await flush();
    fireEvent.click(screen.getByText("Add a server"));
    await flush();
    expect(popover()).toBeTruthy();
    expect(within(popover() as HTMLElement).getByText("Add a server")).toBeTruthy();
  });

  it("opens for the drawer's add-a-server entry, closing the drawer first", async () => {
    await openReader();
    fireEvent.click(screen.getByLabelText("Open groups and files"));
    fireEvent.click(screen.getByRole("button", { name: "Switch server" }));
    fireEvent.click(screen.getByRole("button", { name: "＋ Add server" }));
    await flush();
    expect(popover()).toBeTruthy();
    expect(useReaderStore.getState().drawerOpen).toBe(false);
  });

  it("stays usable with the drawer open: it sits above it and taps outside reach the drawer", async () => {
    await openReader();
    fireEvent.click(screen.getByLabelText("Open groups and files"));
    const settings = await openSettings();
    expect(useReaderStore.getState().drawerOpen).toBe(true);
    // The popover is above the drawer, not behind it.
    expect(settings.closest(".overlay-page")).toBeNull();
    expect(within(settings).getByRole("heading", { name: "Servers" })).toBeTruthy();
  });

  it("no longer carries the reading size: it floats over the document", async () => {
    await openReader();
    const settings = await openSettings();
    expect(within(settings).queryByLabelText("Larger text")).toBeNull();
    expect(within(settings).queryByLabelText("Smaller text")).toBeNull();
  });

  it("closes when a document is opened from the drawer", async () => {
    await openReader();
    fireEvent.click(screen.getByLabelText("Open groups and files"));
    await openSettings();
    fireEvent.click(screen.getByText("a.md", { selector: ".label" }));
    await flush();
    expect(popover()).toBeNull();
    expect(useReaderStore.getState().view).toBe("reader");
  });

  it("a server whose token fails still lists in the popover and switches", async () => {
    saveServers([PROFILE, OTHER]);
    saveActiveServerId(PROFILE.id);
    vi.mocked(client.health).mockImplementation(async () => {
      throw new ApiError(0, "network");
    });
    render(<App />);
    await flush();
    const settings = await openSettings();
    expect(within(settings).getAllByRole("img", { name: "Unreachable" })).toHaveLength(2);
    fireEvent.click(within(settings).getAllByRole("radio")[1] as HTMLElement);
    await flush();
    expect(useReaderStore.getState().activeServerId).toBe(OTHER.id);
    expect(popover()).not.toBeNull();
  });

  it("a row's own inline editor keeps the popover open: its states are inside it", async () => {
    await openReader();
    const settings = await openSettings();
    fireEvent.click(within(settings).getByLabelText("More"));
    fireEvent.click(within(settings).getByText("Rename"));
    const input = within(settings).getByLabelText("Rename") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "书房 Mac" } });
    fireEvent.click(within(settings).getByText("OK"));
    await flush();
    expect(popover()).not.toBeNull();
    expect(useReaderStore.getState().servers[0].name).toBe("书房 Mac");
  });
});


describe("share block", () => {
  const block = (settings: HTMLElement) => within(settings);

  it("smoke: keeps one file sharing action and no link entry", async () => {
    await openReader();
    const settings = await openSettings();
    expect(block(settings).getByRole("button", { name: "Share file" })).toBeTruthy();
    expect(block(settings).queryByRole("button", { name: "Create share link" })).toBeNull();
    expect(client.createShare).not.toHaveBeenCalled();
    fireEvent.click(block(settings).getByRole("button", { name: "Share file" }));
    await flush();
    expect(client.download).toHaveBeenCalledWith("r1", "a.md");
    expect(shareFile).toHaveBeenCalledTimes(1);
    fireEvent.click(block(settings).getByRole("button", { name: "Close settings" }));
    await flush();
    expect(popover()).toBeNull();
  });
  it("is disabled with no document open, and says why", async () => {
    pair();
    render(<App />);
    await flush();
    const settings = await openSettings();
    const send = block(settings).getByRole("button", { name: "Share file" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    expect(block(settings).getByText("Open a file to share it")).toBeTruthy();
  });
  it("is disabled with no server at all", async () => {
    render(<App />);
    await flush();
    const settings = await openSettings();
    expect((block(settings).getByRole("button", { name: "Share file" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("sends the original bytes just downloaded, not the reader's text", async () => {
    await openReader();
    const settings = await openSettings();
    fireEvent.click(block(settings).getByRole("button", { name: "Share file" }));
    await flush();
    expect(client.download).toHaveBeenCalledWith("r1", "a.md");
    expect(client.file).toHaveBeenCalledTimes(1); // the document itself, only
    expect(shareFile).toHaveBeenCalledWith({
      name: "marker.pdf",
      bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      mimeType: "application/pdf",
    });
    expect(block(settings).getByRole("status").textContent).toBe("Handed to the share sheet");
  });
  it("shows progress while the download runs and refuses a second tap", async () => {
    let release!: (v: { bytes: Uint8Array; name: string; mimeType: string }) => void;
    vi.mocked(client.download).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    await openReader();
    const settings = await openSettings();
    const send = () => block(settings).getByRole("button", { name: /Share file|Preparing/ }) as HTMLButtonElement;
    fireEvent.click(send());
    fireEvent.click(send());
    expect(client.download).toHaveBeenCalledTimes(1);
    expect(block(settings).getByRole("status").textContent).toBe("Preparing the original file…");
    expect(send().disabled).toBe(true);
    await act(async () => {
      release({ bytes: new Uint8Array([1]), name: "a.md", mimeType: "text/markdown" });
      await Promise.resolve();
    });
    expect(shareFile).toHaveBeenCalledTimes(1);
  });
  it("says nothing troubling when the share sheet is cancelled", async () => {
    vi.mocked(shareFile).mockResolvedValue(false);
    await openReader();
    const settings = await openSettings();
    fireEvent.click(block(settings).getByRole("button", { name: "Share file" }));
    await flush();
    expect(block(settings).queryByRole("alert")).toBeNull();
    expect(block(settings).queryByRole("status")).toBeNull();
    expect((block(settings).getByRole("button", { name: "Share file" }) as HTMLButtonElement).disabled).toBe(false);
  });
  it("explains a download failure and offers another try", async () => {
    vi.mocked(client.download).mockRejectedValueOnce(new ApiError(404, "not_found"));
    await openReader();
    const settings = await openSettings();
    fireEvent.click(block(settings).getByRole("button", { name: "Share file" }));
    await flush();
    expect(block(settings).getByRole("alert").textContent).toContain("missing or was moved");
    expect(shareFile).not.toHaveBeenCalled();
    fireEvent.click(block(settings).getByRole("button", { name: "Share file" }));
    await flush();
    expect(shareFile).toHaveBeenCalledTimes(1);
  });
  it("shares the Mac the document belonged to, even after switching servers mid-flight", async () => {
    saveServers([PROFILE, OTHER]);
    saveActiveServerId(PROFILE.id);
    lastDoc("a.md");
    // The download for the first Mac is still in flight when the user moves on.
    let release!: (v: { bytes: Uint8Array; name: string; mimeType: string }) => void;
    vi.mocked(client.download).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    render(<App />);
    await flush();
    expect(useReaderStore.getState().doc).toEqual({ rootId: "r1", relPath: "a.md" });
    const settings = await openSettings();
    fireEvent.click(block(settings).getByRole("button", { name: "Share file" }));
    await act(() => useReaderStore.getState().switchServer(OTHER.id));
    await flush();
    expect(useReaderStore.getState().activeServerId).toBe(OTHER.id);
    await act(async () => {
      release({ bytes: new Uint8Array([2]), name: "a.md", mimeType: "text/markdown" });
      await Promise.resolve();
    });
    // The share still read the Mac it started on, and nothing else was shared.
    expect(client.download).toHaveBeenCalledWith("r1", "a.md");
    expect(shareFile).toHaveBeenCalledTimes(1);
    expect(shareFile).toHaveBeenCalledWith({ name: "a.md", bytes: new Uint8Array([2]), mimeType: "text/markdown" });
  });
  it("shares a PDF's original bytes from the PDF viewer", async () => {
    await openReader(PROFILE, "手册.pdf");
    const settings = await openSettings();
    expect(block(settings).getByRole("button", { name: "Share file" })).toBeTruthy();
    fireEvent.click(block(settings).getByRole("button", { name: "Share file" }));
    await flush();
    expect(shareFile).toHaveBeenCalledTimes(1);
    // What was sent is the PDF on the Mac right now, read fresh for the share.
    expect(client.download).toHaveBeenLastCalledWith("r1", "手册.pdf");
    expect(shareFile).toHaveBeenCalledWith({ name: "marker.pdf", bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]), mimeType: "application/pdf" });
    // A PDF is never read as text.
    expect(client.file).not.toHaveBeenCalled();
  });
});
