import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Client } from "../api/client";
import { setLanguage } from "../i18n";
import { useReaderStore } from "../state/readerStore";
import { saveActiveServerId, saveServers } from "../state/storage";
import { App } from "../App";

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
  };
}

let client: Client;
beforeEach(() => {
  setLanguage("en");
  localStorage.clear();
  client = fakeClient();
  useReaderStore.getState().reset(() => client);
});
afterEach(() => {
  cleanup();
  setLanguage("zh");
});

const flush = () => act(async () => {
  await new Promise((r) => setTimeout(r, 0));
});

describe("App", () => {
  it("asks for pairing on first launch and rejects a malformed token", async () => {
    render(<App />);
    await flush();
    expect(screen.getByText("Connect to your Mac")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Host"), { target: { value: "m4.ts.net" } });
    fireEvent.change(screen.getByLabelText("Token"), { target: { value: "short" } });
    fireEvent.click(screen.getByText("Test connection"));
    await flush();
    expect(screen.getByRole("status").textContent).toContain("64-character");
  });

  it("pairs from a pasted link", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { readText: async () => `xmark-mobile://pair?host=m4.ts.net&port=8740&token=${"a".repeat(64)}` },
    });
    render(<App />);
    await flush();
    fireEvent.click(screen.getByText("Paste pairing link"));
    await flush();
    expect((screen.getByLabelText("Host") as HTMLInputElement).value).toBe("m4.ts.net");
    expect(screen.getByRole("status").textContent).toContain("Connected, server 0.1.0");
  });

  it("fills every field when a pairing link is pasted into one", async () => {
    render(<App />);
    await flush();
    fireEvent.change(screen.getByLabelText("Token"), { target: { value: `xmark-mobile://pair?host=h.ts.net&port=9000&token=${"c".repeat(64)}` } });
    await flush();
    expect((screen.getByLabelText("Host") as HTMLInputElement).value).toBe("h.ts.net");
    expect((screen.getByLabelText("Port") as HTMLInputElement).value).toBe("9000");
    expect((screen.getByLabelText("Token") as HTMLInputElement).value).toBe("c".repeat(64));
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

  it("switches a markdown file between preview and source, from the switch that floats once the top bar is gone", async () => {
    pair();
    lastDoc({ rootId: "r1", relPath: "a.md" });
    const { container } = render(<App />);
    await flush();
    expect(screen.getByRole("heading", { name: "Hello" })).toBeTruthy();
    expect(screen.queryByRole("radio", { name: "Source" })).toBeNull();
    const scroller = container.querySelector(".document") as HTMLElement;
    scroller.scrollTop = 400;
    fireEvent.scroll(scroller);
    fireEvent.click(screen.getByRole("radio", { name: "Source" }));
    await flush();
    expect(container.querySelector("pre.source")?.textContent).toContain("# Hello");
    expect(screen.queryByRole("heading", { name: "Hello" })).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Preview" }));
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
    const scroller = container.querySelector(".document") as HTMLElement;
    scroller.scrollTop = 400;
    fireEvent.scroll(scroller);
    fireEvent.click(screen.getByRole("radio", { name: "Source" }));
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

  it("lists every server, marks the current one and switches on tap", async () => {
    saveServers([PROFILE, OTHER]);
    saveActiveServerId(OTHER.id);
    render(<App />);
    await flush();
    fireEvent.click(screen.getByLabelText("Open groups and files"));
    fireEvent.click(screen.getByRole("button", { name: "Switch server" }));
    const options = screen.getAllByRole("menuitemradio");
    expect(options.map((o) => o.textContent)).toEqual(["Study Mac", "客厅 Mac"]);
    expect(options[1].getAttribute("aria-checked")).toBe("true");
    fireEvent.click(options[0]);
    await flush();
    expect(useReaderStore.getState().activeServerId).toBe(PROFILE.id);
    expect(useReaderStore.getState().connection).toEqual(CONN);
    // The list closes after a pick.
    expect(screen.queryByRole("menuitemradio")).toBeNull();
    expect(screen.getByRole("button", { name: "Switch server" }).textContent).toContain("Study Mac");
  });

  it("keeps the current server's name reachable from the drawer title", async () => {
    pair();
    render(<App />);
    await flush();
    fireEvent.click(screen.getByLabelText("Open groups and files"));
    expect(screen.getByRole("button", { name: "Switch server" }).getAttribute("title")).toBe("m4.ts.net:8740");
  });

  it("offers a way to manage servers from the list", async () => {
    pair();
    render(<App />);
    await flush();
    fireEvent.click(screen.getByLabelText("Open groups and files"));
    fireEvent.click(screen.getByRole("button", { name: "Switch server" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Manage servers" }));
    expect(useReaderStore.getState().view).toBe("settings");
  });
});

describe("settings servers", () => {
  const clip = (text: string) =>
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { readText: async () => text } });

  it("lists each server with its address and marks the current one", async () => {
    saveServers([PROFILE, OTHER]);
    saveActiveServerId(OTHER.id);
    render(<App />);
    await flush();
    // Reached from the top bar; the drawer already names the current server.
    fireEvent.click(screen.getByLabelText("Settings"));
    expect(screen.getByText("客厅 Mac")).toBeTruthy();
    expect(screen.getByText("100.66.175.80:8740")).toBeTruthy();
    expect(screen.getByText("Study Mac")).toBeTruthy();
    expect(screen.getByText("Current")).toBeTruthy();
    expect(screen.queryAllByText("Current")).toHaveLength(1);
  });

  it("switches to another server from the list", async () => {
    saveServers([PROFILE, OTHER]);
    saveActiveServerId(OTHER.id);
    render(<App />);
    await flush();
    fireEvent.click(screen.getByLabelText("Settings"));
    fireEvent.click(screen.getByText("Switch"));
    await flush();
    expect(useReaderStore.getState().activeServerId).toBe(PROFILE.id);
  });

  it("asks before deleting and then switches to the remaining server", async () => {
    saveServers([PROFILE, OTHER]);
    saveActiveServerId(OTHER.id);
    render(<App />);
    await flush();
    fireEvent.click(screen.getByLabelText("Settings"));
    const deletes = screen.getAllByText("Delete");
    fireEvent.click(deletes[deletes.length - 1]);
    expect(screen.getByText("Remove “客厅 Mac” from this phone?")).toBeTruthy();
    fireEvent.click(screen.getAllByText("Delete").at(-1) as HTMLElement);
    await flush();
    expect(useReaderStore.getState().servers.map((p) => p.id)).toEqual([PROFILE.id]);
    expect(useReaderStore.getState().activeServerId).toBe(PROFILE.id);
  });

  it("adds a second server from a pasted link that names it", async () => {
    pair();
    render(<App />);
    await flush();
    act(() => useReaderStore.getState().setView("settings"));
    clip(`xmark-mobile://pair?host=100.66.175.80&port=9000&token=${"c".repeat(64)}&name=${encodeURIComponent("客厅 Mac")}`);
    fireEvent.click(screen.getByText("Paste pairing link"));
    await flush();
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("客厅 Mac");
    fireEvent.click(screen.getByText("Save and connect"));
    await flush();
    const servers = useReaderStore.getState().servers;
    expect(servers.map((p) => p.name)).toEqual(["Study Mac", "客厅 Mac"]);
    expect(useReaderStore.getState().activeServerId).toBe(servers[1].id);
  });

  it("updates the server already paired at the same host and port instead of adding it twice", async () => {
    pair();
    render(<App />);
    await flush();
    act(() => useReaderStore.getState().setView("settings"));
    clip(`xmark-mobile://pair?host=m4.ts.net&port=8740&token=${"d".repeat(64)}&name=${encodeURIComponent("书房")}`);
    fireEvent.click(screen.getByText("Paste pairing link"));
    await flush();
    fireEvent.click(screen.getByText("Save and connect"));
    await flush();
    const servers = useReaderStore.getState().servers;
    expect(servers).toHaveLength(1);
    expect(servers[0]).toMatchObject({ id: PROFILE.id, name: "书房", token: "d".repeat(64) });
  });

  it("edits a server's name from the list", async () => {
    pair();
    render(<App />);
    await flush();
    fireEvent.click(screen.getByLabelText("Settings"));
    fireEvent.click(screen.getByText("Edit"));
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Study Mac");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "书房 Mac" } });
    fireEvent.click(screen.getByText("Save and connect"));
    await flush();
    expect(useReaderStore.getState().servers[0].name).toBe("书房 Mac");
    expect(screen.getByText("书房 Mac")).toBeTruthy();
  });

  it("falls back to the host when the name is cleared", async () => {
    pair();
    render(<App />);
    await flush();
    fireEvent.click(screen.getByLabelText("Settings"));
    fireEvent.click(screen.getByText("Edit"));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "   " } });
    fireEvent.click(screen.getByText("Save and connect"));
    await flush();
    expect(useReaderStore.getState().servers[0].name).toBe("m4.ts.net");
  });

  it("offers a way back only once a server is paired", async () => {
    render(<App />);
    await flush();
    expect(useReaderStore.getState().view).toBe("settings");
    expect(screen.queryByLabelText("Back")).toBeNull();
  });

  it("goes back to the reader from settings when a server is paired", async () => {
    pair();
    render(<App />);
    await flush();
    fireEvent.click(screen.getByLabelText("Settings"));
    fireEvent.click(screen.getByLabelText("Back"));
    expect(useReaderStore.getState().view).toBe("reader");
  });
});
