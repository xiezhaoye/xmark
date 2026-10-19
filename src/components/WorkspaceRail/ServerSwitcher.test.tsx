/**
 * ServerSwitcher — the button and its menu.
 *
 * Behaviour under test: the label follows the selection, the menu lists "This
 * Mac" plus every server plus "Add Server…", choosing switches the window and
 * closes, choosing the current entry just closes, and the keyboard can do all
 * of it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ServerSwitcher } from "./ServerSwitcher";
import { useRemoteServersStore } from "@/stores/remoteServersStore";
import { useRemoteSessionStore } from "@/stores/remoteSessionStore";

const openSettings = vi.hoisted(() => vi.fn());
vi.mock("@/services/navigation/settingsWindow", () => ({
  openSettingsWindow: (section?: string) => openSettings(section),
}));

const TOKEN = "a".repeat(64);

function seedServers() {
  useRemoteServersStore.setState({ servers: [], corrupt: false });
  const store = useRemoteServersStore.getState();
  store.addServer({ host: "m4.tailc8e51.ts.net", port: 8740, token: TOKEN, name: "Studio" });
  store.addServer({ host: "m5.tailc8e51.ts.net", port: 8740, token: TOKEN, name: "书房" });
}

beforeEach(() => {
  openSettings.mockReset();
  useRemoteSessionStore.setState({ active: {} });
  useRemoteServersStore.setState({ servers: [], corrupt: false });
});

describe("ServerSwitcher", () => {
  it("says 'This Mac' with nothing selected", () => {
    render(<ServerSwitcher windowLabel="main" />);
    expect(screen.getByRole("button", { name: /This Mac/ })).toHaveTextContent("This Mac");
  });

  it("shows only This Mac and Add Server… when nothing is paired", async () => {
    const user = userEvent.setup();
    render(<ServerSwitcher windowLabel="main" />);
    await user.click(screen.getByRole("button", { name: /This Mac/ }));
    const items = screen.getAllByRole("menuitemradio");
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent("This Mac");
    expect(screen.getAllByRole("menuitem")).toHaveLength(1);
    expect(screen.getByRole("menuitem", { name: "Add Server…" })).toBeInTheDocument();
  });

  // There is no Refresh row: opening the menu already re-reads the stored list
  // and re-probes every server, so a second control for that read was a button
  // whose effect the user could not see.
  it("offers no Refresh row", async () => {
    seedServers();
    const user = userEvent.setup();
    render(<ServerSwitcher windowLabel="main" />);
    await user.click(screen.getByRole("button", { name: /This Mac/ }));
    expect(screen.queryByRole("menuitem", { name: /Refresh/ })).not.toBeInTheDocument();
    // This Mac → Studio → 书房 → Add Server…
    const rows = [
      ...screen.getAllByRole("menuitemradio"),
      ...screen.getAllByRole("menuitem"),
    ];
    expect(rows).toHaveLength(useRemoteServersStore.getState().servers.length + 2);
  });

  it("lists every paired server with the current one checked", async () => {
    seedServers();
    useRemoteSessionStore.getState().setActive("main", useRemoteServersStore.getState().servers[0].id);
    const user = userEvent.setup();
    render(<ServerSwitcher windowLabel="main" />);
    expect(screen.getByRole("button", { name: /Studio/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Studio/ }));
    const items = screen.getAllByRole("menuitemradio");
    // Each row's accessible name is the server's own name (the status word is
    // hidden from it), in "This Mac" → list order.
    const names = items.map((item) =>
      item.textContent?.replace(/(Online|Offline|Checking…|Token rejected)$/, ""),
    );
    expect(names).toEqual(["This Mac", "Studio", "书房"]);
    expect(items[1]).toHaveAttribute("aria-checked", "true");
    expect(items[0]).toHaveAttribute("aria-checked", "false");
  });

  it("switches the window and closes", async () => {
    seedServers();
    const user = userEvent.setup();
    render(<ServerSwitcher windowLabel="main" />);
    await user.click(screen.getByRole("button", { name: /This Mac/ }));
    await user.click(screen.getByRole("menuitemradio", { name: "书房" }));
    expect(useRemoteSessionStore.getState().getActive("main")).toBe(useRemoteServersStore.getState().servers[1].id);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("choosing the current entry only closes", async () => {
    seedServers();
    const user = userEvent.setup();
    render(<ServerSwitcher windowLabel="main" />);
    await user.click(screen.getByRole("button", { name: /This Mac/ }));
    await user.click(screen.getByRole("menuitemradio", { name: "This Mac" }));
    expect(useRemoteSessionStore.getState().getActive("main")).toBeNull();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("opens Settings → Servers from the last item", async () => {
    const user = userEvent.setup();
    render(<ServerSwitcher windowLabel="main" />);
    await user.click(screen.getByRole("button", { name: /This Mac/ }));
    await user.click(screen.getByRole("menuitem", { name: "Add Server…" }));
    expect(openSettings).toHaveBeenCalledWith("servers");
  });

  it("walks the menu with the arrow keys and chooses with Enter", async () => {
    seedServers();
    const user = userEvent.setup();
    render(<ServerSwitcher windowLabel="main" />);
    await user.click(screen.getByRole("button", { name: /This Mac/ }));
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    expect(useRemoteSessionStore.getState().getActive("main")).toBe(useRemoteServersStore.getState().servers[1].id);
  });

  it("closes on Escape and returns focus to the button", async () => {
    const user = userEvent.setup();
    render(<ServerSwitcher windowLabel="main" />);
    const button = screen.getByRole("button", { name: /This Mac/ });
    await user.click(button);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it("keeps each window's selection apart", async () => {
    seedServers();
    useRemoteSessionStore.getState().setActive("doc-2", useRemoteServersStore.getState().servers[0].id);
    render(<ServerSwitcher windowLabel="main" />);
    expect(screen.getByRole("button", { name: /This Mac/ })).toBeInTheDocument();
  });
});
