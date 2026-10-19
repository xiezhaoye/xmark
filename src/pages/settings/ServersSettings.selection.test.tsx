/**
 * ServersSettings — choosing the server (the radio list).
 *
 * Behaviour under test: "This Mac" is the first row and is always there; every
 * row is a radio, exactly one is checked; clicking a row hands the choice to
 * the document window (an EVENT — Settings is another webview and the session
 * selection is per-window memory), marks the row at once and says "Switched";
 * clicking the current row does nothing at all; deleting the current server
 * falls back to "This Mac"; and a choice made in the main window's own menu
 * arrives here as the same radio state.
 *
 * FAKED: the Tauri event API (`listen` / `emit`) and the probe command.
 * REAL: the page, both stores, `useSettingsSelection`, the shared prober.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { ServersSettings } from "./ServersSettings";
import { useRemoteServersStore } from "@/stores/remoteServersStore";
import { useRemoteSessionStore } from "@/stores/remoteSessionStore";
import {
  BROADCAST,
  REMOTE_SERVER_SELECT_EVENT,
  REMOTE_SERVER_SELECTION_EVENT,
  resetSelectionOrder,
  type RemoteSelectionPayload,
} from "@/services/remoteServers/selection";

const TOKEN = "a".repeat(64);

const boundary = vi.hoisted(() => ({
  invoke: vi.fn(() => Promise.resolve({ ok: true, version: "1.0.0" })),
  emit: vi.fn((_event: string, _payload?: unknown) => Promise.resolve()),
  /** Every `listen` this page registered, by event name. */
  handlers: new Map<string, Array<(event: { payload: unknown }) => void>>(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => boundary.invoke(...(a as [])) }));
vi.mock("@tauri-apps/api/event", () => ({
  emit: (event: string, payload?: unknown) => boundary.emit(event, payload),
  listen: (event: string, handler: (e: { payload: unknown }) => void) => {
    const list = boundary.handlers.get(event) ?? [];
    list.push(handler);
    boundary.handlers.set(event, list);
    return Promise.resolve(() => {
      boundary.handlers.set(event, (boundary.handlers.get(event) ?? []).filter((h) => h !== handler));
    });
  },
}));

/** Deliver an event as Tauri would (every window hears it). */
function deliver(event: string, payload: unknown): void {
  for (const handler of boundary.handlers.get(event) ?? []) handler({ payload });
}

function seed() {
  useRemoteServersStore.setState({ servers: [], corrupt: false });
  const store = useRemoteServersStore.getState();
  store.addServer({ host: "m4.tailc8e51.ts.net", port: 8740, token: TOKEN, name: "Studio" });
  store.addServer({ host: "m5.tailc8e51.ts.net", port: 8740, token: TOKEN, name: "书房" });
  return useRemoteServersStore.getState().servers;
}

const radios = () => screen.getAllByRole("radio");

/**
 * Sonner only renders inside its own `<Toaster/>`, which the app mounts at the
 * root. "Was the user told?" is the question, so the API is spied: what is
 * asserted is the MESSAGE and its short duration, not sonner's DOM.
 */
const toastSuccess = vi.spyOn(toast, "success");
const checked = () => radios().filter((r) => r.getAttribute("aria-checked") === "true");

beforeEach(() => {
  vi.clearAllMocks();
  boundary.invoke.mockClear();
  boundary.emit.mockClear();
  boundary.handlers.clear();
  localStorage.clear();
  resetSelectionOrder();
  useRemoteSessionStore.setState({ active: {} });
  useRemoteServersStore.setState({ servers: [], corrupt: false });
});

describe("ServersSettings — choosing a server", () => {
  it("lists This Mac first, always, with exactly one row checked", async () => {
    seed();
    render(<ServersSettings />);
    const group = screen.getByRole("radiogroup", { name: "Remote Servers" });
    const rows = within(group).getAllByRole("radio");
    expect(rows.map((r) => r.getAttribute("aria-label"))).toEqual(["This Mac", "Studio", "书房"]);
    expect(checked()).toHaveLength(1);
    expect(rows[0]).toHaveAttribute("aria-checked", "true");
    // "Current" is no longer printed beside the row — the row's fill and the
    // filled radio say it — but it is still there for a screen reader.
    const currentRow = within(group).getAllByRole("radio")[0];
    expect(within(currentRow).getByText("Current")).toHaveClass("sr-only");
  });

  it("keeps This Mac in the list with no servers paired at all", () => {
    render(<ServersSettings />);
    expect(radios()).toHaveLength(1);
    expect(radios()[0]).toHaveAttribute("aria-checked", "true");
  });

  it("hands the choice to the document window, marks the row and says so", async () => {
    seed();
    const user = userEvent.setup();
    render(<ServersSettings />);
    const studio = screen.getByRole("radio", { name: "Studio" });
    await user.click(studio);
    // The event IS the switch: Settings holds no shell of its own.
    await waitFor(() => expect(boundary.emit).toHaveBeenCalled());
    const [event, payload] = boundary.emit.mock.calls[0] as [string, RemoteSelectionPayload];
    expect(event).toBe(REMOTE_SERVER_SELECT_EVENT);
    expect(payload.serverId).toBe(useRemoteServersStore.getState().servers[0].id);
    expect(payload.windowLabel).not.toBe("settings");
    expect(studio).toHaveAttribute("aria-checked", "true");
    // "Switched", briefly: the row itself already shows the result.
    expect(toastSuccess).toHaveBeenCalledTimes(1);
    expect(toastSuccess).toHaveBeenCalledWith("Switched", { duration: 900 });
  });

  it("does nothing at all when the current row is clicked again", async () => {
    seed();
    const user = userEvent.setup();
    render(<ServersSettings />);
    await user.click(screen.getByRole("radio", { name: "Studio" }));
    boundary.emit.mockClear();
    await user.click(screen.getByRole("radio", { name: "Studio" }));
    expect(boundary.emit).not.toHaveBeenCalled();
    // One switch, one notice: the second click said nothing at all.
    expect(toastSuccess).toHaveBeenCalledTimes(1);
  });

  it("going back to This Mac is a choice like any other", async () => {
    seed();
    const user = userEvent.setup();
    render(<ServersSettings />);
    await user.click(screen.getByRole("radio", { name: "Studio" }));
    await user.click(screen.getByRole("radio", { name: "This Mac" }));
    await waitFor(() => expect(boundary.emit).toHaveBeenCalledTimes(2));
    const [event, payload] = boundary.emit.mock.calls[1] as [string, RemoteSelectionPayload];
    expect(event).toBe(REMOTE_SERVER_SELECT_EVENT);
    expect(payload.serverId).toBeNull();
    expect(screen.getByRole("radio", { name: "This Mac" })).toHaveAttribute("aria-checked", "true");
  });

  it("follows a choice made in the main window's own menu", async () => {
    const servers = seed();
    render(<ServersSettings />);
    deliver(REMOTE_SERVER_SELECTION_EVENT, { windowLabel: "main", serverId: servers[1].id });
    await waitFor(() =>
      expect(screen.getByRole("radio", { name: "书房" })).toHaveAttribute("aria-checked", "true"),
    );
    expect(screen.getByRole("radio", { name: "This Mac" })).toHaveAttribute("aria-checked", "false");
    // Another window's announcement is not this page's business.
    deliver(REMOTE_SERVER_SELECTION_EVENT, { windowLabel: "settings", serverId: null });
    expect(screen.getByRole("radio", { name: "书房" })).toHaveAttribute("aria-checked", "true");
  });

  it("removing the current server falls back to This Mac in every window", async () => {
    const servers = seed();
    useRemoteSessionStore.setState({ active: { main: servers[0].id, "doc-2": servers[0].id } });
    const user = userEvent.setup();
    render(<ServersSettings />);
    await user.click(screen.getByRole("radio", { name: "Studio" }));
    await user.click(screen.getByRole("button", { name: "Remove “Studio”" }));
    const before = boundary.emit.mock.calls.length;
    await user.click(screen.getByRole("button", { name: "Remove" }));

    expect(screen.getByRole("radio", { name: "This Mac" })).toHaveAttribute("aria-checked", "true");
    // A selection of a server that no longer exists would render an empty
    // remote shell, so every window holding it is told to go back to this Mac:
    // the reset is an EVENT, because those windows are other webviews.
    const resetTargets = boundary.emit.mock.calls
      .slice(before)
      .filter(([name, payload]) => name === REMOTE_SERVER_SELECT_EVENT && (payload as RemoteSelectionPayload).serverId === null)
      .map(([, payload]) => (payload as RemoteSelectionPayload).windowLabel);
    expect(resetTargets).toEqual(["main", "doc-2"]);
    await waitFor(() => expect(boundary.emit.mock.calls.length).toBeGreaterThan(before));
    // The document window that held it hears "go back to this Mac" — otherwise
    // it would render a shell for a server that no longer exists.
    const selectCall = boundary.emit.mock.calls
      .slice(before)
      .find(([name]) => name === REMOTE_SERVER_SELECT_EVENT);
    expect(selectCall).toBeDefined();
    const payload = selectCall?.[1] as RemoteSelectionPayload;
    expect(payload.serverId).toBeNull();
    expect(["main", "doc-2"]).toContain(payload.windowLabel);
  });

  it("every radio is keyboard-reachable as one group (roving tabindex)", () => {
    seed();
    render(<ServersSettings />);
    // Only the current row is in the tab order; the whole group is walkable
    // with the arrow keys by the native radiogroup contract.
    const tabbable = radios().filter((r) => r.getAttribute("tabindex") === "0");
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0]).toHaveAttribute("aria-checked", "true");
  });

  it("addresses every document window when the target cannot be resolved", async () => {
    seed();
    const user = userEvent.setup();
    render(<ServersSettings />);
    await user.click(screen.getByRole("radio", { name: "Studio" }));
    await waitFor(() => expect(boundary.emit).toHaveBeenCalled());
    const payload = boundary.emit.mock.calls[0]?.[1] as RemoteSelectionPayload;
    expect([BROADCAST, "main", "doc-2"]).toContain(payload.windowLabel);
  });

  it("probes one server again from its own refresh button", async () => {
    seed();
    boundary.invoke.mockClear();
    const user = userEvent.setup();
    render(<ServersSettings />);
    // The open-page probe already ran (twice, once per paired server).
    await waitFor(() => expect(boundary.invoke).toHaveBeenCalledTimes(2));
    await user.click(screen.getByRole("button", { name: "Refresh “Studio”" }));
    // Exactly one more health check, and it is the one that was asked for.
    await waitFor(() => expect(boundary.invoke).toHaveBeenCalledTimes(3));
    const [command, args] = boundary.invoke.mock.calls[2] as [string, { conn: { host: string } }];
    expect(command).toBe("remote_health");
    expect(args.conn.host).toBe("m4.tailc8e51.ts.net");
  });

  it("offers no refresh on This Mac, which has no address to probe", () => {
    seed();
    render(<ServersSettings />);
    // A paired row carries a refresh button; This Mac carries none — there is
    // no address to probe, and a permanently disabled control is not a control.
    expect(screen.getByRole("button", { name: "Refresh “Studio”" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Refresh “This Mac”" })).not.toBeInTheDocument();
    const localRow = screen.getByRole("radio", { name: "This Mac" }).closest("li");
    expect(localRow?.querySelectorAll("button")).toHaveLength(0);
  });

  it("shows This Mac's own Tailscale name where a paired row shows its address", () => {
    seed();
    render(<ServersSettings />);
    const local = screen.getByRole("radio", { name: "This Mac" });
    expect(within(local).getByText("m1.tailc8e51.ts.net")).toBeInTheDocument();
    // Always up, by definition: the dot is green and says so.
    expect(within(local).getByRole("img", { name: "Online" })).toBeInTheDocument();
  });

  it("puts the status on a dot after the name, not in a word beside the row", () => {
    seed();
    render(<ServersSettings />);
    const studio = screen.getByRole("radio", { name: "Studio" });
    const dot = within(studio).getByRole("img", { name: /Online|Offline|Checking/ });
    expect(dot).toHaveClass("server-row__status");
    // The dot is the LAST thing in its line: nothing follows it inside the
    // name block, which is what puts it "after the name".
    expect(dot.nextSibling).toBeNull();
  });
});
