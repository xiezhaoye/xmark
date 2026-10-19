/**
 * useRemoteSelectionBridge — the document window's half of the cross-window
 * switch.
 *
 * A row clicked in Settings is a DIFFERENT webview: it cannot write this
 * window's session store, so it sends an event. This asserts the receiving
 * end: an event aimed at this window switches it (through the one writer, so
 * "back to this Mac" also closes the remote slice); an event aimed at another
 * window is ignored; a choice made here is announced; and announcing is
 * edge-triggered — a re-render or an unrelated state change is not an event.
 *
 * FAKED: the Tauri event API and the window enumeration.
 * REAL: the hook, the session store, the remote browser store, the window-label
 * predicates.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useRemoteSelectionBridge } from "@/hooks/useRemoteSelectionBridge";
import { useRemoteSessionStore } from "@/stores/remoteSessionStore";
import { useRemoteBrowserStore } from "@/stores/remoteBrowserStore";
import {
  REMOTE_SERVER_SELECT_EVENT,
  REMOTE_SERVER_SELECTION_EVENT,
  resetSelectionOrder,
} from "@/services/remoteServers/selection";

const boundary = vi.hoisted(() => ({
  emit: vi.fn((_event: string, _payload?: unknown) => Promise.resolve()),
  handlers: new Map<string, Array<(event: { payload: unknown }) => void>>(),
  windows: [] as string[],
}));

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
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getAllWebviewWindows: () =>
    Promise.resolve(boundary.windows.map((label) => ({ label, isFocused: () => false }))),
  getCurrentWebviewWindow: () => ({ label: "main", emit: boundary.emit }),
}));

function deliver(event: string, payload: unknown): void {
  for (const handler of boundary.handlers.get(event) ?? []) handler({ payload });
}

beforeEach(() => {
  boundary.emit.mockClear();
  boundary.handlers.clear();
  boundary.windows = ["main", "doc-2", "settings"];
  resetSelectionOrder();
  useRemoteSessionStore.setState({ active: {} });
  useRemoteBrowserStore.getState().close();
});

describe("useRemoteSelectionBridge", () => {
  it("switches this window when the event names it", async () => {
    renderHook(() => useRemoteSelectionBridge("main"));
    act(() => deliver(REMOTE_SERVER_SELECT_EVENT, { windowLabel: "main", serverId: "s1" }));
    await waitFor(() => expect(useRemoteSessionStore.getState().getActive("main")).toBe("s1"));
  });

  it("ignores an event aimed at another window", async () => {
    renderHook(() => useRemoteSelectionBridge("main"));
    act(() => deliver(REMOTE_SERVER_SELECT_EVENT, { windowLabel: "doc-2", serverId: "s1" }));
    expect(useRemoteSessionStore.getState().getActive("main")).toBeNull();
    // ...until the broadcast form arrives.
    act(() => deliver(REMOTE_SERVER_SELECT_EVENT, { windowLabel: "*", serverId: "s1" }));
    await waitFor(() => expect(useRemoteSessionStore.getState().getActive("main")).toBe("s1"));
  });

  it("drops a malformed payload instead of switching to nonsense", async () => {
    renderHook(() => useRemoteSelectionBridge("main"));
    act(() => deliver(REMOTE_SERVER_SELECT_EVENT, { windowLabel: "main", serverId: 42 }));
    act(() => deliver(REMOTE_SERVER_SELECT_EVENT, null));
    expect(useRemoteSessionStore.getState().getActive("main")).toBeNull();
  });

  it("closes the remote slice when told to show this Mac", async () => {
    renderHook(() => useRemoteSelectionBridge("main"));
    act(() => deliver(REMOTE_SERVER_SELECT_EVENT, { windowLabel: "main", serverId: "s1" }));
    await waitFor(() => expect(useRemoteSessionStore.getState().getActive("main")).toBe("s1"));
    useRemoteBrowserStore.setState({ serverId: "s1", activeRootId: "r1" });
    act(() => deliver(REMOTE_SERVER_SELECT_EVENT, { windowLabel: "main", serverId: null }));
    await waitFor(() => expect(useRemoteBrowserStore.getState().serverId).toBeNull());
    expect(useRemoteBrowserStore.getState().activeRootId).toBeNull();
  });

  it("announces a choice made here, and only when it changes", async () => {
    renderHook(() => useRemoteSelectionBridge("main"));
    act(() => useRemoteSessionStore.getState().setActive("main", "s1"));
    await waitFor(() =>
      expect(boundary.emit).toHaveBeenCalledWith(REMOTE_SERVER_SELECTION_EVENT, {
        windowLabel: "main",
        serverId: "s1",
      }),
    );
    // Another window's selection is not this window's announcement.
    boundary.emit.mockClear();
    act(() => useRemoteSessionStore.getState().setActive("doc-2", "s2"));
    expect(boundary.emit).not.toHaveBeenCalled();
    // Re-stating the same value is not a change.
    act(() => useRemoteSessionStore.getState().setActive("main", "s1"));
    expect(boundary.emit).not.toHaveBeenCalled();
  });

  it("uses the caller's handler instead of switching when one is given", async () => {
    const onSelect = vi.fn();
    renderHook(() => useRemoteSelectionBridge("settings", onSelect));
    act(() => deliver(REMOTE_SERVER_SELECT_EVENT, { windowLabel: "settings", serverId: "s1" }));
    expect(onSelect).toHaveBeenCalledWith({ windowLabel: "settings", serverId: "s1" });
    // A non-document window never switches itself, and never announces.
    expect(useRemoteSessionStore.getState().getActive("settings")).toBeNull();
    expect(boundary.emit).not.toHaveBeenCalled();
  });

  it("unsubscribes both listeners on unmount", async () => {
    const view = renderHook(() => useRemoteSelectionBridge("main"));
    await waitFor(() => expect(boundary.handlers.get(REMOTE_SERVER_SELECT_EVENT)).toHaveLength(1));
    view.unmount();
    await waitFor(() => expect(boundary.handlers.get(REMOTE_SERVER_SELECT_EVENT)).toHaveLength(0));
    act(() => useRemoteSessionStore.getState().setActive("main", "s1"));
    expect(boundary.emit).not.toHaveBeenCalled();
  });
});
