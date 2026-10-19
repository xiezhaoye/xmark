/**
 * ServersSettings — a refusal says WHICH refusal.
 *
 * The pairing probe runs through a chain the user cannot see (Tailscale, a
 * local proxy, the phone's own server), so "the server refused the request"
 * without the status leaves nothing to act on. The server's status rides in
 * `detail.status`; the panel must show it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ServersSettings } from "./ServersSettings";
import { useRemoteServersStore } from "@/stores/remoteServersStore";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));

const TOKEN = "a".repeat(64);
const link = `xmark-mobile://pair?host=5095.tailc8e51.ts.net&port=8740&token=${TOKEN}`;

beforeEach(() => {
  invoke.mockReset();
  localStorage.clear();
  useRemoteServersStore.setState({ servers: [], corrupt: false });
});

describe("ServersSettings refusal text", () => {
  it("names the status of a refusal", async () => {
    invoke.mockRejectedValue({
      code: "network",
      message: "/api/health failed (502)",
      i18nKey: "errors.remoteServer.http",
      detail: { status: 502, remoteError: null },
    });
    const user = userEvent.setup();
    render(<ServersSettings />);
    await user.type(screen.getByLabelText("Paste pairing link"), link);
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The server refused the request (502)");
    expect(useRemoteServersStore.getState().servers).toEqual([]);
  });

  it("leaves the other failures without a status", async () => {
    invoke.mockRejectedValue({ code: "timeout", message: "/api/health request failed" });
    const user = userEvent.setup();
    render(<ServersSettings />);
    await user.type(screen.getByLabelText("Paste pairing link"), link);
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The server did not answer in time");
  });
});
