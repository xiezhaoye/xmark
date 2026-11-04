import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ApiError, type Client } from "../api/client";
import { setLanguage } from "../i18n";
import { useReaderStore } from "../state/readerStore";
import { useLocalLibrary } from "../state/localLibrary";
import { saveActiveServerId, saveServers } from "../state/storage";
import { scanQrCode } from "../platform";
import { App } from "../App";

/** The paired Macs: the local `本机` row always heads the list and is not one. */
const macs = () => useReaderStore.getState().servers.filter((p) => !p.local);

/** The Mac rows only: the local `本机` row heads every list now. */
const macRadios = () => screen.getAllByRole("radio").filter((r) => !r.closest("[data-local]"));

/** Walks the add-a-server sheet to the camera: choose, then scan. */
async function openAddScan() {
  fireEvent.click(screen.getByText("Add a server"));
  await flush();
  fireEvent.click(screen.getByText("Scan a code"));
  await flush();
}

vi.mock("../platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../platform")>()),
  scanQrCode: vi.fn(),
}));

const scans = (raw: string | null) => vi.mocked(scanQrCode).mockResolvedValueOnce(raw);
const pairLink = (host: string, extra = "") => `xmark-mobile://pair?host=${host}&port=8740&token=${"c".repeat(64)}${extra}`;

const TOKEN = "a".repeat(64);
const CONN = { host: "m4.ts.net", port: 8740, token: TOKEN };
const PROFILE = { id: "s1", name: "Study Mac", host: CONN.host, port: CONN.port, token: TOKEN };
const OTHER = { id: "s2", name: "客厅 Mac", host: "100.66.175.80", port: 8740, token: "b".repeat(64) };

/** One paired Mac, current. */
const pair = (profile = PROFILE) => {
  saveServers([profile]);
  saveActiveServerId(profile.id);
};

/** Saves the last document for the current server. */
const lastDoc = (doc: { rootId: string; relPath: string }, serverId = PROFILE.id) =>
  localStorage.setItem("xmark-mobile.lastDoc", JSON.stringify({ [serverId]: doc }));

function fakeClient(): Client {
  return {
    health: vi.fn(async () => ({ ok: true, version: "0.1.0" })),
    workspaces: vi.fn(async () => ({
      groups: [{ id: "g", name: "Wiki", folders: [{ rootId: "r1", name: "wiki", available: true }, { rootId: "r2", name: "gone", available: false }] }],
    })),
    tree: vi.fn(async () => ({ path: "", entries: [{ name: "a.md", kind: "markdown" as const, relPath: "a.md" }] })),
    file: vi.fn(async () => ({ text: "# Hello\n\nsee [b](b.md)", kind: "markdown" as const, size: 1, mtime: 1 })),
    asset: vi.fn(async () => new Blob()),
    search: vi.fn(async () => ({ results: [{ rootId: "r1", relPath: "a.md", matches: [{ lineNumber: 3, lineContent: "hello world" }] }], truncated: false })),
    download: vi.fn(async () => ({ bytes: new Uint8Array(), name: "a.md", mimeType: "text/markdown" })),
    createShare: vi.fn(async () => ({ url: "https://box.ts.net/s/abc" })),
  };
}

let client: Client;
beforeEach(() => {
  setLanguage("en");
  localStorage.clear();
  // The local library is a module singleton: clearing storage does not touch
  // the groups it already holds in memory, so one test's folders would leak
  // into the next test's list.
  useLocalLibrary.getState().setGroups([]);
  client = fakeClient();
  useReaderStore.getState().reset(() => client);
  // A queued `mockResolvedValueOnce` that a failing test never consumed is
  // handed to the NEXT test's scan — the classic way a scan test passes alone
  // and fails in a suite.
  vi.mocked(scanQrCode).mockReset();
});
afterEach(() => {
  cleanup();
  setLanguage("zh");
});

const flush = () => act(async () => {
  await new Promise((r) => setTimeout(r, 0));
});

describe("App", () => {
  it("smoke: stops downward dragging at the top and leaves an 88px preview strip", async () => {
    pair();
    lastDoc({ rootId: "r1", relPath: "a.md" });
    const { container } = render(<App />);
    await flush();
    const scroller = container.querySelector(".document") as HTMLElement;
    expect(scroller.querySelector(".pull")).toBeNull();
    fireEvent.touchStart(scroller, { touches: [{ clientX: 100, clientY: 100 }] });
    const downward = new Event("touchmove", { bubbles: true, cancelable: true });
    Object.defineProperty(downward, "touches", { value: [{ clientX: 100, clientY: 150 }] });
    fireEvent(scroller, downward);
    expect(downward.defaultPrevented).toBe(true);
    expect(scroller.scrollTop).toBe(0);
    fireEvent.touchEnd(scroller);
    fireEvent.touchStart(scroller, { touches: [{ clientX: 100, clientY: 150 }] });
    const upward = new Event("touchmove", { bubbles: true, cancelable: true });
    Object.defineProperty(upward, "touches", { value: [{ clientX: 100, clientY: 100 }] });
    fireEvent(scroller, upward);
    expect(upward.defaultPrevented).toBe(false);
    fireEvent.touchEnd(scroller);
    fireEvent.click(screen.getByLabelText("Open groups and files"));
    const strip = container.querySelector(".main-strip") as HTMLElement;
    expect(window.innerWidth - Number.parseFloat(strip.style.left)).toBe(88);
    expect(client.file).toHaveBeenCalledTimes(1);
  });

  it("shows an add-a-server button in the reader when nothing is paired", async () => {
    render(<App />);
    await flush();
    expect(useReaderStore.getState().view).toBe("reader");
    // The local source heads the list, so there is no "add a server" prompt in
    // the reader any more; settings still offers the control.
    const all = useReaderStore.getState().servers;
    expect(all).toHaveLength(1);
    expect(all[0].local).toBe(true);
    fireEvent.click(screen.getByLabelText("Settings"));
    expect(useReaderStore.getState().view).toBe("settings");
  });

  it("goes to the reader by itself after the first server is added by scanning", async () => {
    render(<App />);
    await flush();
    fireEvent.click(screen.getByText("Add a server"));
    await flush();
    fireEvent.click(screen.getByText("Scan a code"));
    await flush();
    scans(pairLink("m4.tailc8e51.ts.net"));
    await openAddScan();
    expect(macs().map((p) => p.name)).toEqual(["m4"]);
    expect(useReaderStore.getState().view).toBe("reader");
    expect(client.health).toHaveBeenCalled();
  });

  it("starts closed; the drawer button opens it, lists groups, and opening a file closes it", async () => {
    pair();
    render(<App />);
    await flush();
    expect(useReaderStore.getState().drawerOpen).toBe(false);
    fireEvent.click(screen.getByLabelText("Open groups and files"));
    expect(useReaderStore.getState().drawerOpen).toBe(true);
    expect(screen.getByText("Wiki")).toBeTruthy();
    fireEvent.click(screen.getByText("wiki"));
    await flush();
    fireEvent.click(screen.getByText("a.md"));
    await flush();
    expect(useReaderStore.getState().drawerOpen).toBe(false);
    expect(screen.getByRole("heading", { name: "Hello" })).toBeTruthy();
  });

  it("explains an unavailable folder instead of loading it", async () => {
    pair();
    render(<App />);
    await flush();
    fireEvent.click(screen.getByLabelText("Open groups and files"));
    fireEvent.click(screen.getByText("gone"));
    await flush();
    expect(screen.getAllByText(/missing or unreadable/).length).toBeGreaterThan(0);
    expect(client.tree).not.toHaveBeenCalledWith("r2", "");
  });

  it("follows a relative link to another note", async () => {
    pair();
    lastDoc({ rootId: "r1", relPath: "notes/a.md" });
    render(<App />);
    await flush();
    fireEvent.click(screen.getByText("b"));
    await flush();
    expect(useReaderStore.getState().doc).toEqual({ rootId: "r1", relPath: "notes/b.md" });
  });

  it("pushes the document right while open, and the strip or the corner button closes it", async () => {
    pair();
    lastDoc({ rootId: "r1", relPath: "a.md" });
    const { container } = render(<App />);
    await flush();
    const main = container.querySelector(".main") as HTMLElement;
    expect(main.style.transform).toBe("translateX(0px)");
    fireEvent.click(screen.getByLabelText("Open groups and files"));
    expect(main.style.transform).not.toBe("translateX(0px)");
    fireEvent.click(screen.getByLabelText("Close"));
    expect(useReaderStore.getState().drawerOpen).toBe(false);
    fireEvent.click(screen.getByLabelText("Open groups and files"));
    fireEvent.click(container.querySelector(".main-strip") as HTMLElement);
    expect(useReaderStore.getState().drawerOpen).toBe(false);
  });

  it("switches a markdown file between preview and source, from the settings popover", async () => {
    pair();
    lastDoc({ rootId: "r1", relPath: "a.md" });
    const { container } = render(<App />);
    await flush();
    expect(screen.getByRole("heading", { name: "Hello" })).toBeTruthy();
    // The switch lives in the popover now; the floating pill carries the size.
    expect(screen.queryByRole("radio", { name: "Source" })).toBeNull();
    fireEvent.click(screen.getByLabelText("Settings"));
    await flush();
    const settings = screen.getByRole("dialog", { name: "Settings" });
    fireEvent.click(within(settings).getByRole("radio", { name: "Source" }));
    await flush();
    expect(container.querySelector("pre.source")?.textContent).toContain("# Hello");
    expect(screen.queryByRole("heading", { name: "Hello" })).toBeNull();
    fireEvent.click(within(settings).getByRole("radio", { name: "Preview" }));
    await flush();
    expect(screen.getByRole("heading", { name: "Hello" })).toBeTruthy();
  });

  it("scrolls the top bar away with the document and floats the mode switch", async () => {
    pair();
    lastDoc({ rootId: "r1", relPath: "a.md" });
    const { container } = render(<App />);
    await flush();
    const scroller = container.querySelector(".document") as HTMLElement;
    expect(scroller.querySelector(".topbar")).not.toBeNull();
    expect(container.querySelector(".mode-float")).toBeNull();
    scroller.scrollTop = 400;
    fireEvent.scroll(scroller);
    expect(container.querySelector(".mode-float")).not.toBeNull();
    scroller.scrollTop = 0;
    fireEvent.scroll(scroller);
    expect(container.querySelector(".mode-float")).toBeNull();
  });

  it("offers a back-to-top button once the text has scrolled past the top bar", async () => {
    pair();
    lastDoc({ rootId: "r1", relPath: "a.md" });
    const { container } = render(<App />);
    await flush();
    expect(container.querySelector(".to-top")).toBeNull();
    const scroller = container.querySelector(".document") as HTMLElement;
    scroller.scrollTop = 600;
    fireEvent.scroll(scroller);
    const button = container.querySelector(".to-top") as HTMLButtonElement;
    expect(button).not.toBeNull();
    expect(button.getAttribute("aria-label")).toBe("Back to top");
    fireEvent.click(button);
    expect(scroller.scrollTop).toBe(0);
  });

  it("previews an HTML file in a script-less sandbox, with source one switch away", async () => {
    pair();
    vi.mocked(client.file).mockResolvedValue({ text: "<h1>Page</h1>", kind: "text", size: 13, mtime: 1 });
    lastDoc({ rootId: "r1", relPath: "site/index.html" });
    const { container } = render(<App />);
    await flush();
    const frame = container.querySelector("iframe.html-preview") as HTMLIFrameElement;
    expect(frame).not.toBeNull();
    expect(frame.getAttribute("sandbox")).toBe("allow-same-origin");
    expect(frame.getAttribute("srcdoc")).toContain("<h1>Page</h1>");
    fireEvent.click(screen.getByLabelText("Settings"));
    await flush();
    const settings = screen.getByRole("dialog", { name: "Settings" });
    fireEvent.click(within(settings).getByRole("radio", { name: "Source" }));
    await flush();
    expect(container.querySelector("iframe.html-preview")).toBeNull();
    expect(container.querySelector("pre.source")?.textContent).toContain("<h1>Page</h1>");
  });

  it("offers no mode switch for a non-markdown file", async () => {
    pair();
    vi.mocked(client.file).mockResolvedValue({ text: "k: v", kind: "text", size: 4, mtime: 1 });
    lastDoc({ rootId: "r1", relPath: "a.yml" });
    render(<App />);
    await flush();
    expect(screen.queryByRole("radio", { name: "Source" })).toBeNull();
  });

  it("puts settings in the top bar instead of the drawer", async () => {
    pair();
    render(<App />);
    await flush();
    fireEvent.click(screen.getByLabelText("Settings"));
    expect(useReaderStore.getState().view).toBe("settings");
    expect(screen.queryByLabelText("Outline")).toBeNull();
  });

  it("draws each folder with its rail glyph and a group count", async () => {
    pair();
    const { container } = render(<App />);
    await flush();
    const glyphs = [...container.querySelectorAll(".folder .glyph")].map((g) => g.textContent);
    expect(glyphs).toEqual(["W", "G"]);
    expect(container.querySelector(".group-count")?.textContent).toBe("2");
  });

  it("search results open the file with the query to reveal", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    pair();
    render(<App />);
    await flush();
    act(() => useReaderStore.getState().setView("search"));
    fireEvent.change(screen.getByPlaceholderText("Search notes"), { target: { value: "hello" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    fireEvent.click(screen.getByText("hello world"));
    await flush();
    expect(useReaderStore.getState().doc).toEqual({ rootId: "r1", relPath: "a.md" });
    expect(useReaderStore.getState().view).toBe("reader");
    vi.useRealTimers();
  });
});

describe("server picker", () => {
  it("shows the current server's name even when it is the only one", async () => {
    pair();
    render(<App />);
    await flush();
    fireEvent.click(screen.getByLabelText("Open groups and files"));
    expect(screen.getByRole("button", { name: "Switch server" }).textContent).toContain("Study Mac");
  });

  it("reads as a row of the column, not a button: an icon, the name, a chevron", async () => {
    pair();
    render(<App />);
    await flush();
    fireEvent.click(screen.getByLabelText("Open groups and files"));
    const toggle = screen.getByRole("button", { name: "Switch server" });
    expect(toggle.querySelector(".glyph-server svg")).not.toBeNull();
    expect(toggle.querySelector(".label")?.textContent).toBe("Study Mac");
    expect(toggle.querySelector(".chevron svg")).not.toBeNull();
  });

  it("lists every server, marks the current one and switches on tap", async () => {
    saveServers([PROFILE, OTHER]);
    saveActiveServerId(OTHER.id);
    render(<App />);
    await flush();
    fireEvent.click(screen.getByLabelText("Open groups and files"));
    fireEvent.click(screen.getByRole("button", { name: "Switch server" }));
    const options = macRadios();
    expect(options.map((o) => o.querySelector(".sheet-option-name")?.textContent)).toEqual(["Study Mac", "客厅 Mac"]);
    expect(options[1].getAttribute("aria-checked")).toBe("true");
    fireEvent.click(options[0]);
    await flush();
    expect(useReaderStore.getState().activeServerId).toBe(PROFILE.id);
    expect(useReaderStore.getState().connection).toEqual(CONN);
    // The sheet closes after a pick.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Switch server" }).textContent).toContain("Study Mac");
  });

  it("keeps the current server's name reachable from the drawer title", async () => {
    pair();
    render(<App />);
    await flush();
    fireEvent.click(screen.getByLabelText("Open groups and files"));
    expect(screen.getByRole("button", { name: "Switch server" }).getAttribute("title")).toBe("m4.ts.net:8740");
  });

  it("offers a way to add a server from the sheet", async () => {
    pair();
    render(<App />);
    await flush();
    fireEvent.click(screen.getByLabelText("Open groups and files"));
    fireEvent.click(screen.getByRole("button", { name: "Switch server" }));
    fireEvent.click(screen.getByRole("button", { name: "＋ Add server" }));
    expect(useReaderStore.getState().view).toBe("settings");
  });

  const openSheet = async () => {
    const result = render(<App />);
    await flush();
    fireEvent.click(screen.getByLabelText("Open groups and files"));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Switch server" }));
    await flush();
    return result;
  };

  it("opens the sheet as a dialog, and Esc closes it", async () => {
    pair();
    await openSheet();
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    // A class of its own: the other sheets keep `.sheet-backdrop`.
    expect(dialog.parentElement?.className).toBe("server-sheet-backdrop");
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes when the backdrop behind the card is tapped, and stays open for a tap on the card", async () => {
    pair();
    const { container } = await openSheet();
    const dialog = screen.getByRole("dialog");
    const backdrop = () => container.ownerDocument.body;
    fireEvent.click(dialog);
    expect(screen.queryByRole("dialog")).not.toBeNull();
    fireEvent.click(backdrop().querySelector(".server-sheet-backdrop") as HTMLElement);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes without refetching when the current server is tapped", async () => {
    saveServers([PROFILE, OTHER]);
    saveActiveServerId(PROFILE.id);
    await openSheet();
    await flush();
    vi.mocked(client.workspaces).mockClear();
    fireEvent.click(macRadios()[0] as HTMLElement);
    await flush();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(useReaderStore.getState().activeServerId).toBe(PROFILE.id);
    expect(client.workspaces).not.toHaveBeenCalled();
  });

  it("switches to another server, closes the sheet and leaves the drawer open on the new server", async () => {
    saveServers([PROFILE, OTHER]);
    saveActiveServerId(PROFILE.id);
    lastDoc({ rootId: "r1", relPath: "a.md" }, OTHER.id);
    await openSheet();
    fireEvent.click(macRadios()[1] as HTMLElement);
    await flush();
    expect(screen.queryByRole("dialog")).toBeNull();
    const s = useReaderStore.getState();
    expect(s.activeServerId).toBe(OTHER.id);
    expect(s.view).toBe("reader");
    // The drawer the picker sits in stays open, so the groups stay in sight.
    expect(s.drawerOpen).toBe(true);
    // The last document of the new server is loaded behind the drawer.
    expect(s.doc).toEqual({ rootId: "r1", relPath: "a.md" });
    expect(s.docState.status).toBe("ready");
    expect(screen.getByRole("button", { name: "Switch server" }).textContent).toContain("客厅 Mac");
  });
});

describe("settings servers", () => {
  const openSettings = async () => {
    const result = render(<App />);
    await flush();
    fireEvent.click(screen.getByLabelText("Settings"));
    await flush();
    return result;
  };

  it("is titled Settings and lists each server with its address, the current one selected", async () => {
    saveServers([PROFILE, OTHER]);
    saveActiveServerId(OTHER.id);
    await openSettings();
    expect(screen.getByRole("heading", { name: "Settings" })).toBeTruthy();
    expect(screen.getByText("100.66.175.80:8740")).toBeTruthy();
    const radios = macRadios();
    expect(radios.map((r) => r.getAttribute("aria-checked"))).toEqual(["false", "true"]);
  });

  it("shows whether each server answers", async () => {
    saveServers([PROFILE, OTHER]);
    saveActiveServerId(PROFILE.id);
    vi.mocked(client.health).mockImplementation(async () => {
      throw new ApiError(0, "network");
    });
    await openSettings();
    expect(screen.getAllByRole("img", { name: "Unreachable" })).toHaveLength(2);
  });

  it("switches a server on tap, says so, and stays on the page", async () => {
    saveServers([PROFILE, OTHER]);
    saveActiveServerId(OTHER.id);
    await openSettings();
    fireEvent.click(macRadios()[0] as HTMLElement);
    await flush();
    expect(useReaderStore.getState().activeServerId).toBe(PROFILE.id);
    expect(useReaderStore.getState().view).toBe("settings");
    expect(screen.getByRole("status").textContent).toBe("Switched");
    expect(macRadios().map((r) => r.getAttribute("aria-checked"))).toEqual(["true", "false"]);
  });

  it("says switched for half the usual time, and other messages keep theirs", async () => {
    saveServers([PROFILE, OTHER]);
    saveActiveServerId(OTHER.id);
    await openSettings();
    // Real timers until the page is up; only the message clock is faked.
    vi.useFakeTimers();
    try {
      fireEvent.click(macRadios()[0] as HTMLElement);
      expect(screen.getByRole("status").textContent).toBe("Switched");
      act(() => vi.advanceTimersByTime(900));
      expect(screen.queryByRole("status")).toBeNull();
      // An ordinary success keeps 1800ms; adding a scanned server says so at once.
      scans(pairLink("100.66.175.80", `&name=${encodeURIComponent("客厅 Mac")}`));
      fireEvent.click(screen.getByText("Add a server"));
      await flush();
      fireEvent.click(screen.getByText("Scan a code"));
      await flush();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.getByRole("status").textContent).toContain('Updated “客厅 Mac”');
      act(() => vi.advanceTimersByTime(900));
      expect(screen.queryByRole("status")).not.toBeNull();
      act(() => vi.advanceTimersByTime(901));
      expect(screen.queryByRole("status")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("says nothing and reloads nothing when the row tapped is already the current one", async () => {
    saveServers([PROFILE, OTHER]);
    saveActiveServerId(OTHER.id);
    await openSettings();
    await flush();
    vi.mocked(client.workspaces).mockClear();
    vi.mocked(client.health).mockClear();
    fireEvent.click(macRadios()[1] as HTMLElement);
    await flush();
    expect(useReaderStore.getState().activeServerId).toBe(OTHER.id);
    expect(screen.queryByRole("status")).toBeNull();
    expect(client.workspaces).not.toHaveBeenCalled();
    // Only the status probes count as health calls here; tapping adds none.
    expect(vi.mocked(client.health).mock.calls.length).toBeLessThanOrEqual(2);
  });

  it("leads each row with the status dot, in the slot the radio used to hold", async () => {
    saveServers([PROFILE, OTHER]);
    saveActiveServerId(PROFILE.id);
    const { container } = await openSettings();
    const rows = [...container.querySelectorAll(".server")];
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      // The leading mark of the select button IS the dot.
      const select = row.querySelector(".server-select") as HTMLElement;
      expect(select.firstElementChild?.classList.contains("status-dot")).toBe(true);
      // The radio is gone, and the name no longer carries a dot of its own.
      expect(row.querySelector(".radio")).toBeNull();
      expect(row.querySelector(".server-title .status-dot")).toBeNull();
      // The row still ends with "more", not with a dot.
      const more = row.querySelector(".icon-button");
      expect(more?.getAttribute("aria-label")).toBe("More");
      expect(row.querySelector(".server-row")?.lastElementChild).toBe(more);
    }
  });

  it("shows the whole address under the name, and no drag handle", async () => {
    saveServers([PROFILE, OTHER]);
    saveActiveServerId(PROFILE.id);
    const { container } = await openSettings();
    // Rows carry the name and the status dot; the full address lives in the
    // sheet the row opens, so the popover row itself has none.
    expect(container.querySelector(".server-address")).toBeNull();
    expect(screen.queryByLabelText("Drag to reorder")).toBeNull();
    expect(container.querySelector(".grip")).toBeNull();
  });

  it("adds a scanned server straight away, named by the link, without switching to it", async () => {
    pair();
    await openSettings();
    scans(pairLink("100.66.175.80", `&name=${encodeURIComponent("客厅 Mac")}`));
    await openAddScan();
    const s = useReaderStore.getState();
    expect(macs(s.servers).map((p) => p.name)).toEqual(["Study Mac", "客厅 Mac"]);
    expect(s.activeServerId).toBe(PROFILE.id);
    expect(s.view).toBe("settings");
    expect(screen.getByText("客厅 Mac")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Added “客厅 Mac”");
  });

  it("names a scanned server after its machine when the link has no name", async () => {
    pair();
    await openSettings();
    scans(pairLink("m1.tailc8e51.ts.net"));
    await openAddScan();
    expect(macs().map((p) => p.name)).toEqual(["Study Mac", "m1"]);
  });

  it("saves nothing when the scanned server does not answer, and says why", async () => {
    pair();
    await openSettings();
    vi.mocked(client.health).mockRejectedValueOnce(new ApiError(401, "unauthorized"));
    // The probes on opening already ran; the next call is the check of the scan.
    scans(pairLink("m1.tailc8e51.ts.net"));
    await openAddScan();
    expect(macs()).toHaveLength(1);
    expect(screen.getByRole("status").textContent).toContain("The token is not valid");
  });

  it("rejects a code that is not a pairing code, and a cancelled scan does nothing", async () => {
    pair();
    await openSettings();
    scans("https://example.com");
    await openAddScan();
    expect(screen.getByRole("status").textContent).toContain("not an XMark pairing QR code");
    scans(null);
    await openAddScan();
    expect(macs()).toHaveLength(1);
  });

  it("updates the server already paired at the same host and port instead of adding it twice", async () => {
    pair();
    await openSettings();
    scans(`xmark-mobile://pair?host=m4.ts.net&port=8740&token=${"d".repeat(64)}&name=${encodeURIComponent("书房")}`);
    await openAddScan();
    const servers = macs();
    expect(servers).toHaveLength(1);
    expect(servers[0]).toMatchObject({ id: PROFILE.id, name: "书房", token: "d".repeat(64) });
    expect(screen.getByRole("status").textContent).toContain("Updated “书房”");
  });

  it("renames a server from its menu", async () => {
    pair();
    await openSettings();
    fireEvent.click(screen.getByLabelText("More"));
    fireEvent.click(screen.getByText("Rename"));
    const input = screen.getByLabelText("Rename") as HTMLInputElement;
    expect(input.value).toBe("Study Mac");
    fireEvent.change(input, { target: { value: "书房 Mac" } });
    fireEvent.click(screen.getByText("OK"));
    await flush();
    expect(macs()[0].name).toBe("书房 Mac");
    expect(screen.getByText("书房 Mac")).toBeTruthy();
  });

  it("falls back to the machine name when the name is cleared", async () => {
    pair();
    await openSettings();
    fireEvent.click(screen.getByLabelText("More"));
    fireEvent.click(screen.getByText("Rename"));
    fireEvent.change(screen.getByLabelText("Rename"), { target: { value: "   " } });
    fireEvent.click(screen.getByText("OK"));
    await flush();
    expect(macs()[0].name).toBe("m4");
  });

  it("asks before deleting, then selects the remaining server", async () => {
    saveServers([PROFILE, OTHER]);
    saveActiveServerId(OTHER.id);
    await openSettings();
    fireEvent.click(screen.getAllByLabelText("More")[1] as HTMLElement);
    fireEvent.click(screen.getByText("Delete"));
    expect(screen.getByText("Remove “客厅 Mac” from this phone?")).toBeTruthy();
    fireEvent.click(screen.getAllByText("Delete").at(-1) as HTMLElement);
    await flush();
    expect(macs().map((p) => p.id)).toEqual([PROFILE.id]);
    expect(useReaderStore.getState().activeServerId).toBe(PROFILE.id);
    expect(useReaderStore.getState().view).toBe("settings");
  });

  it("moves a server up or down with Alt+arrow keys on its radio button", async () => {
    saveServers([PROFILE, OTHER]);
    saveActiveServerId(PROFILE.id);
    await openSettings();
    fireEvent.keyDown(macRadios()[1] as HTMLElement, { key: "ArrowUp", altKey: true });
    expect(macs().map((p) => p.id)).toEqual([OTHER.id, PROFILE.id]);
    // The first row cannot go further up.
    fireEvent.keyDown(macRadios()[0] as HTMLElement, { key: "ArrowUp", altKey: true });
    expect(macs().map((p) => p.id)).toEqual([OTHER.id, PROFILE.id]);
    // Down again, from the top row.
    fireEvent.keyDown(macRadios()[0] as HTMLElement, { key: "ArrowDown", altKey: true });
    expect(macs().map((p) => p.id)).toEqual([PROFILE.id, OTHER.id]);
  });

  it("drags a row after a long press, and the click that follows does not select it", async () => {
    saveServers([PROFILE, OTHER]);
    saveActiveServerId(PROFILE.id);
    // Open the page on real timers (`flush` waits on one); only the press itself runs on fake ones.
    await openSettings();
    vi.useFakeTimers();
    try {
      const first = macRadios()[0] as HTMLElement;
      fireEvent.pointerDown(first, { pointerId: 1, pointerType: "touch", clientX: 10, clientY: 100 });
      act(() => vi.advanceTimersByTime(400));
      expect(first.closest(".server")?.className).toContain("dragging");
      fireEvent.pointerMove(first, { pointerId: 1, pointerType: "touch", clientX: 10, clientY: 160 });
      fireEvent.pointerUp(first, { pointerId: 1, pointerType: "touch", clientX: 10, clientY: 160 });
      fireEvent.click(first);
      expect(macs().map((p) => p.id)).toEqual([OTHER.id, PROFILE.id]);
      // The tap that ended the drag did not switch servers.
      expect(useReaderStore.getState().activeServerId).toBe(PROFILE.id);
      expect(screen.queryByRole("status")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("scrolls instead of dragging when the finger moves before the hold", async () => {
    saveServers([PROFILE, OTHER]);
    saveActiveServerId(PROFILE.id);
    // Open the page on real timers (`flush` waits on one); only the press itself runs on fake ones.
    await openSettings();
    vi.useFakeTimers();
    try {
      const first = macRadios()[0] as HTMLElement;
      fireEvent.pointerDown(first, { pointerId: 1, pointerType: "touch", clientX: 10, clientY: 100 });
      fireEvent.pointerMove(first, { pointerId: 1, pointerType: "touch", clientX: 10, clientY: 160 });
      act(() => vi.advanceTimersByTime(400));
      expect(first.closest(".server")?.className).not.toContain("dragging");
      fireEvent.pointerUp(first, { pointerId: 1, pointerType: "touch", clientX: 10, clientY: 160 });
      fireEvent.click(first);
      expect(macs().map((p) => p.id)).toEqual([PROFILE.id, OTHER.id]);
      // A press that never became a drag is still an ordinary tap.
      expect(useReaderStore.getState().activeServerId).toBe(PROFILE.id);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the page still while a row is being dragged", async () => {
    saveServers([PROFILE, OTHER]);
    saveActiveServerId(PROFILE.id);
    const { container } = await openSettings();
    vi.useFakeTimers();
    try {
      const list = container.querySelector(".servers") as HTMLElement;
      const first = macRadios()[0] as HTMLElement;
      const before = fireEvent.touchMove(list, { touches: [{ clientX: 0, clientY: 0 }] });
      expect(before).toBe(true);
      fireEvent.pointerDown(first, { pointerId: 1, pointerType: "touch", clientX: 10, clientY: 100 });
      act(() => vi.advanceTimersByTime(400));
      const during = fireEvent.touchMove(list, { touches: [{ clientX: 0, clientY: 20 }] });
      expect(during).toBe(false);
      fireEvent.pointerUp(first, { pointerId: 1, pointerType: "touch", clientX: 10, clientY: 100 });
      const after = fireEvent.touchMove(list, { touches: [{ clientX: 0, clientY: 30 }] });
      expect(after).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves plain arrow keys alone", async () => {
    saveServers([PROFILE, OTHER]);
    saveActiveServerId(PROFILE.id);
    await openSettings();
    fireEvent.keyDown(macRadios()[1] as HTMLElement, { key: "ArrowUp" });
    fireEvent.keyDown(macRadios()[1] as HTMLElement, { key: "ArrowDown" });
    expect(macs().map((p) => p.id)).toEqual([PROFILE.id, OTHER.id]);
  });

  it("shows the reading size on the document and moves it one px per tap", async () => {
    pair();
    lastDoc({ rootId: "r1", relPath: "a.md" });
    const { container } = render(<App />);
    await flush();
    // It floats once the top bar has scrolled away, where the mode switch used to be.
    const scroller = container.querySelector(".document") as HTMLElement;
    scroller.scrollTop = 400;
    fireEvent.scroll(scroller);
    const value = () => document.querySelector(".stepper-value")?.textContent;
    expect(value()).toBe("16");
    fireEvent.click(screen.getByLabelText("Larger text"));
    expect(value()).toBe("17");
    expect(useReaderStore.getState().readingSize).toBe(17);
    expect(localStorage.getItem("xmark-mobile.readingSize")).toBe("17");
    fireEvent.click(screen.getByLabelText("Smaller text"));
    fireEvent.click(screen.getByLabelText("Smaller text"));
    expect(value()).toBe("15");
    expect(useReaderStore.getState().readingSize).toBe(15);
  });

  it("disables the step that would leave the size's range", async () => {
    pair();
    lastDoc({ rootId: "r1", relPath: "a.md" });
    const { container } = render(<App />);
    await flush();
    const scroller = container.querySelector(".document") as HTMLElement;
    scroller.scrollTop = 400;
    fireEvent.scroll(scroller);
    const minus = () => screen.getByLabelText("Smaller text") as HTMLButtonElement;
    const plus = () => screen.getByLabelText("Larger text") as HTMLButtonElement;
    act(() => useReaderStore.getState().setReadingSize(12));
    expect((document.querySelector(".stepper-value") as HTMLElement).textContent).toBe("12");
    expect(minus().disabled).toBe(true);
    expect(plus().disabled).toBe(false);
    fireEvent.click(minus());
    expect(useReaderStore.getState().readingSize).toBe(12);
    act(() => useReaderStore.getState().setReadingSize(24));
    expect((document.querySelector(".stepper-value") as HTMLElement).textContent).toBe("24");
    expect(plus().disabled).toBe(true);
    expect(minus().disabled).toBe(false);
    fireEvent.click(plus());
    expect(useReaderStore.getState().readingSize).toBe(24);
  });

  it("goes back to the reader", async () => {
    pair();
    await openSettings();
    fireEvent.click(screen.getByLabelText("Back"));
    expect(useReaderStore.getState().view).toBe("reader");
  });
});
