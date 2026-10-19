/**
 * ServerSwitcher — what OPENING the menu does.
 *
 * Behaviour under test: opening probes every listed server once (never on a
 * timer), shows the three states in their own dot, and re-reads the STORED list
 * so a server paired in the Settings window appears without a second action.
 * That read is why there is no Refresh row: the menu never shows a list it has
 * not just re-read.
 *
 * FAKED: the Tauri commands (`invoke`) — the probe.
 * REAL: the switcher, its menu, both stores and the shared prober.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ServerSwitcher } from "./ServerSwitcher";
import { useRemoteServersStore } from "@/stores/remoteServersStore";
import { useRemoteSessionStore } from "@/stores/remoteSessionStore";
import { useRemoteBrowserStore } from "@/stores/remoteBrowserStore";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("@/services/navigation/settingsWindow", () => ({ openSettingsWindow: () => Promise.resolve() }));

const TOKEN = "a".repeat(64);
const KEY = "xmark-remote-servers";
const server = (id: string, host: string) => ({ id, name: id, host, port: 8740, token: TOKEN });
const blob = (servers: unknown[]) => JSON.stringify({ state: { servers }, version: 1 });

/** Answer each command, by name. */
function answer(handlers: Record<string, (args: Record<string, unknown>) => unknown>) {
  invoke.mockImplementation((command: string, args: Record<string, unknown>) => {
    const handler = handlers[command];
    if (!handler) return Promise.resolve({ ok: true, version: "1.0.0" });
    try {
      return Promise.resolve(handler(args));
    } catch (error) {
      return Promise.reject(error);
    }
  });
}

const commandsCalled = () => invoke.mock.calls.map((call) => String(call[0]));

beforeEach(() => {
  invoke.mockReset();
  localStorage.clear();
  useRemoteServersStore.setState({ servers: [], corrupt: false });
  useRemoteSessionStore.setState({ active: {} });
  useRemoteBrowserStore.setState({
    serverId: null,
    connection: null,
    groups: [],
    groupsStatus: "idle",
    groupsMessage: null,
    activeRootId: null,
    doc: null,
    levels: {},
    expanded: {},
    seq: 0,
  });
});

describe("ServerSwitcher — opening the menu", () => {
  it("probes every server once when the menu opens", async () => {
    answer({ remote_health: () => ({ ok: true, version: "1.0.0" }) });
    useRemoteServersStore.setState({ servers: [server("s1", "a.tailc8e51.ts.net"), server("s2", "b.tailc8e51.ts.net")] });
    const user = userEvent.setup();
    render(<ServerSwitcher windowLabel="main" />);
    await user.click(screen.getByRole("button", { name: /This Mac/ }));
    await waitFor(() => expect(commandsCalled().filter((c) => c === "remote_health")).toHaveLength(2));
    expect(await screen.findByTestId("server-status-s1")).toHaveAttribute("data-state", "online");
    // Opening again is a new probe; nothing at all happens when the menu is shut.
    const before = commandsCalled().length;
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    expect(commandsCalled()).toHaveLength(before);
  });

  it("shows unreachable and token-rejected servers in their own state", async () => {
    answer({
      remote_health: (args) => {
        const conn = args.conn as { host: string };
        if (conn.host.startsWith("bad")) throw { code: "unauthorized", message: "401" };
        throw { code: "network", message: "unreachable" };
      },
    });
    useRemoteServersStore.setState({ servers: [server("s1", "bad.tailc8e51.ts.net"), server("s2", "gone.tailc8e51.ts.net")] });
    const user = userEvent.setup();
    render(<ServerSwitcher windowLabel="main" />);
    await user.click(screen.getByRole("button", { name: /This Mac/ }));
    expect(await screen.findByTestId("server-status-s1")).toHaveAttribute("data-state", "unauthorized");
    expect(screen.getByTestId("server-status-s2")).toHaveAttribute("data-state", "offline");
  });

  // The read that used to sit behind Refresh: a server paired in the Settings
  // window (a separate webview) is here on the next OPEN, with no event needed.
  it("re-reads the stored list, and probes what it found", async () => {
    answer({ remote_health: () => ({ ok: true, version: "1.0.0" }) });
    const user = userEvent.setup();
    render(<ServerSwitcher windowLabel="main" />);
    localStorage.setItem(KEY, blob([server("s9", "new.tailc8e51.ts.net")]));
    await user.click(screen.getByRole("button", { name: /This Mac/ }));

    const menu = screen.getByRole("menu");
    expect(within(menu).getByRole("menuitemradio", { name: "s9" })).toBeInTheDocument();
    expect(await screen.findByTestId("server-status-s9")).toHaveAttribute("data-state", "online");
  });

  it("picks up a list another window wrote, before the menu closes", async () => {
    answer({ remote_health: () => ({ ok: true, version: "1.0.0" }) });
    const user = userEvent.setup();
    render(<ServerSwitcher windowLabel="main" />);
    await user.click(screen.getByRole("button", { name: /This Mac/ }));
    await waitFor(() => expect(screen.getByRole("menu")).toBeInTheDocument());

    // The Settings window pairs a Mac and this window hears the event.
    localStorage.setItem(KEY, blob([server("s9", "new.tailc8e51.ts.net")]));
    window.dispatchEvent(new StorageEvent("storage", { key: KEY, newValue: blob([server("s9", "new.tailc8e51.ts.net")]) }));
    expect(await screen.findByRole("menuitemradio", { name: "s9" })).toBeInTheDocument();
  });

  // The other half of "no Refresh": the browsing calls are gone with it.
  it("never re-reads the remote groups", async () => {
    answer({ remote_health: () => ({ ok: true, version: "1.0.0" }) });
    useRemoteServersStore.setState({ servers: [server("s1", "a.tailc8e51.ts.net")] });
    useRemoteSessionStore.setState({ active: { main: "s1" } });
    const user = userEvent.setup();
    render(<ServerSwitcher windowLabel="main" />);
    const button = screen.getAllByRole("button").find((b) => b.getAttribute("aria-haspopup") === "menu");
    await user.click(button as HTMLElement);
    await waitFor(() => expect(commandsCalled()).toContain("remote_health"));
    expect(commandsCalled()).not.toContain("remote_workspaces");
    expect(commandsCalled()).not.toContain("remote_tree");
    expect(commandsCalled()).not.toContain("remote_file");
  });
});
