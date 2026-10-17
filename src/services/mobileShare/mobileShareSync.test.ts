// @vitest-environment node
// The workspace groups reach the mobile server only through this push: every
// change is debounced into one `write_mobile_share` call, repeats are skipped,
// and a failed push is retried by the next change.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), warn: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@/utils/debug", () => ({ workspaceWarn: mocks.warn }));

import { useWorkspaceGroupsStore } from "@/stores/workspaceGroupsStore";
import { MOBILE_SHARE_DEBOUNCE_MS, startMobileShareSync } from "./mobileShareSync";

const setGroups = (groups: { id: string; name: string; folders: string[] }[]) =>
  useWorkspaceGroupsStore.setState({ groups });

let stop: () => void;
beforeEach(() => {
  vi.useFakeTimers();
  mocks.invoke.mockReset().mockResolvedValue(undefined);
  mocks.warn.mockReset();
  setGroups([{ id: "g1", name: "Wiki", folders: ["/Users/me/wiki"] }]);
});
afterEach(() => {
  stop?.();
  vi.useRealTimers();
});

describe("startMobileShareSync", () => {
  it("publishes the current groups once at start", async () => {
    stop = startMobileShareSync();
    await vi.advanceTimersByTimeAsync(MOBILE_SHARE_DEBOUNCE_MS);
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).toHaveBeenCalledWith("write_mobile_share", {
      groups: [{ id: "g1", name: "Wiki", folders: ["/Users/me/wiki"] }],
    });
  });

  it("coalesces rapid edits into one push of the latest state", async () => {
    stop = startMobileShareSync();
    await vi.advanceTimersByTimeAsync(MOBILE_SHARE_DEBOUNCE_MS);
    mocks.invoke.mockClear();
    setGroups([{ id: "g1", name: "A", folders: [] }]);
    setGroups([{ id: "g1", name: "AB", folders: [] }]);
    setGroups([{ id: "g1", name: "ABC", folders: [] }]);
    await vi.advanceTimersByTimeAsync(MOBILE_SHARE_DEBOUNCE_MS);
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).toHaveBeenCalledWith("write_mobile_share", { groups: [{ id: "g1", name: "ABC", folders: [] }] });
  });

  it("skips a change that leaves the groups as they were", async () => {
    stop = startMobileShareSync();
    await vi.advanceTimersByTimeAsync(MOBILE_SHARE_DEBOUNCE_MS);
    mocks.invoke.mockClear();
    useWorkspaceGroupsStore.getState().toggleCollapsed("g1");
    setGroups([{ id: "g1", name: "Wiki", folders: ["/Users/me/wiki"] }]);
    await vi.advanceTimersByTimeAsync(MOBILE_SHARE_DEBOUNCE_MS);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("logs a failed push and retries it on the next change", async () => {
    mocks.invoke.mockRejectedValueOnce(new Error("disk full"));
    stop = startMobileShareSync();
    await vi.advanceTimersByTimeAsync(MOBILE_SHARE_DEBOUNCE_MS);
    expect(mocks.warn).toHaveBeenCalledTimes(1);
    setGroups([{ id: "g1", name: "Wiki", folders: ["/Users/me/wiki"] }]);
    useWorkspaceGroupsStore.getState().toggleCollapsed("g1");
    await vi.advanceTimersByTimeAsync(MOBILE_SHARE_DEBOUNCE_MS);
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
  });

  it("stops pushing after dispose, including a pending push", async () => {
    stop = startMobileShareSync();
    stop();
    setGroups([]);
    await vi.advanceTimersByTimeAsync(MOBILE_SHARE_DEBOUNCE_MS * 2);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("publishes an empty list when every group is deleted", async () => {
    stop = startMobileShareSync();
    await vi.advanceTimersByTimeAsync(MOBILE_SHARE_DEBOUNCE_MS);
    setGroups([]);
    await vi.advanceTimersByTimeAsync(MOBILE_SHARE_DEBOUNCE_MS);
    expect(mocks.invoke).toHaveBeenLastCalledWith("write_mobile_share", { groups: [] });
  });
});
