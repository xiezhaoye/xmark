/**
 * ServersSettings — pairing behaviour: verify before saving, update an
 * existing Mac, and the status dot.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ServersSettings } from "./ServersSettings";
import { useRemoteServersStore } from "@/stores/remoteServersStore";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));

const TOKEN = "a".repeat(64);
const link = (host: string, port = 8740, name?: string) =>
  `xmark-mobile://pair?host=${host}&port=${port}&token=${TOKEN}${name ? `&name=${encodeURIComponent(name)}` : ""}`;

const stored = () => useRemoteServersStore.getState().servers;

beforeEach(() => {
  invoke.mockReset();
  localStorage.clear();
  useRemoteServersStore.setState({ servers: [], corrupt: false });
});

describe("ServersSettings", () => {
  it("saves a server once the health probe passes", async () => {
    invoke.mockResolvedValue({ ok: true, version: "1.0.0" });
    const user = userEvent.setup();
    render(<ServersSettings />);
    await user.type(screen.getByLabelText("Paste pairing link"), link("m4.tailc8e51.ts.net"));
    await user.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(stored()).toHaveLength(1));
    expect(stored()[0]).toMatchObject({ host: "m4.tailc8e51.ts.net", port: 8740, name: "m4" });
    expect(invoke).toHaveBeenCalledWith("remote_health", {
      conn: { host: "m4.tailc8e51.ts.net", port: 8740, token: TOKEN },
    });
    expect(await screen.findByRole("status")).toHaveTextContent("m4");
  });

  it("saves NOTHING when the probe fails, and says why", async () => {
    invoke.mockRejectedValue({ code: "unauthorized", message: "401" });
    const user = userEvent.setup();
    render(<ServersSettings />);
    await user.type(screen.getByLabelText("Paste pairing link"), link("m4.tailc8e51.ts.net"));
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/pairing token/i);
    expect(stored()).toEqual([]);
  });

  it("refuses a link that is not a pairing link WITHOUT probing", async () => {
    const user = userEvent.setup();
    render(<ServersSettings />);
    await user.type(screen.getByLabelText("Paste pairing link"), "https://example.com/x");
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/pairing link/i);
    expect(invoke).not.toHaveBeenCalled();
    expect(stored()).toEqual([]);
  });

  it("updates a server already paired at the same address", async () => {
    useRemoteServersStore.getState().addServer({ host: "m4.tailc8e51.ts.net", port: 8740, token: TOKEN, name: "Studio" });
    invoke.mockResolvedValue({ ok: true, version: "1.0.0" });
    const user = userEvent.setup();
    render(<ServersSettings />);
    await user.type(screen.getByLabelText("Paste pairing link"), link("M4.tailc8e51.ts.net"));
    await user.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Studio"));
    expect(stored()).toHaveLength(1);
    expect(stored()[0].name).toBe("Studio");
  });

  it("does not add twice on a rapid double submit", async () => {
    invoke.mockResolvedValue({ ok: true, version: "1.0.0" });
    const user = userEvent.setup();
    render(<ServersSettings />);
    await user.type(screen.getByLabelText("Paste pairing link"), link("m4.tailc8e51.ts.net"));
    const add = screen.getByRole("button", { name: "Add" });
    await user.click(add);
    await user.click(add);
    await waitFor(() => expect(stored()).toHaveLength(1));
  });

  it("renames in place, and commits on Enter", async () => {
    useRemoteServersStore.getState().addServer({ host: "m4.tailc8e51.ts.net", port: 8740, token: TOKEN });
    invoke.mockResolvedValue({ ok: true, version: "1.0.0" });
    const user = userEvent.setup();
    render(<ServersSettings />);
    await user.click(await screen.findByRole("button", { name: "Rename “m4”" }));
    const field = screen.getByLabelText("Rename");
    await user.clear(field);
    await user.type(field, "书房{Enter}");
    expect(stored()[0].name).toBe("书房");
  });

  it("removes a server only after the inline confirmation", async () => {
    useRemoteServersStore.getState().addServer({ host: "m4.tailc8e51.ts.net", port: 8740, token: TOKEN });
    invoke.mockResolvedValue({ ok: true, version: "1.0.0" });
    const user = userEvent.setup();
    render(<ServersSettings />);
    await user.click(await screen.findByRole("button", { name: "Remove “m4”" }));
    expect(stored()).toHaveLength(1);
    const group = screen.getByRole("group", { name: "Remove “m4”?" });
    await user.click(within(group).getByRole("button", { name: "Remove" }));
    expect(stored()).toEqual([]);
  });

  it("moves a server up with its own button", async () => {
    const store = useRemoteServersStore.getState();
    store.addServer({ host: "a.tailc8e51.ts.net", port: 8740, token: TOKEN });
    store.addServer({ host: "b.tailc8e51.ts.net", port: 8740, token: TOKEN });
    invoke.mockResolvedValue({ ok: true, version: "1.0.0" });
    const user = userEvent.setup();
    render(<ServersSettings />);
    await user.click(await screen.findByRole("button", { name: "Move “b” up" }));
    expect(stored().map((s) => s.name)).toEqual(["b", "a"]);
  });

  it("states each server's reachability on the dot, not in a word beside the row", async () => {
    useRemoteServersStore.getState().addServer({ host: "m4.tailc8e51.ts.net", port: 8740, token: TOKEN });
    invoke.mockRejectedValue({ code: "network", message: "nope" });
    render(<ServersSettings />);
    // The meaning lives on the dot's aria-label/title: colour alone is not a
    // label, but the row no longer repeats it as running text.
    const dot = await screen.findByRole("img", { name: "Offline" });
    expect(dot).toBeInTheDocument();
    expect(dot).toHaveClass("server-row__status");
    expect(screen.queryByText("Offline", { selector: "span:not([role])" })).not.toBeInTheDocument();
  });

  it("warns that an unreadable saved list was left untouched", () => {
    useRemoteServersStore.setState({ servers: [], corrupt: true });
    invoke.mockResolvedValue({ ok: true, version: "1" });
    render(<ServersSettings />);
    expect(screen.getByText(/left untouched/i)).toBeInTheDocument();
  });
});
