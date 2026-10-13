// @vitest-environment node
// Window-wide terminal cap: every workspace's sessions stay alive behind
// display:none, so the per-scope cap (MAX_TERMINAL_SESSIONS) alone lets N
// workspaces hold 5×N live terminals. The total cap is a creation gate only:
// it refuses a new session and never closes an existing one.
import { beforeEach, describe, expect, it } from "vitest";
import {
  MAX_TERMINAL_SESSIONS,
  MAX_TOTAL_TERMINAL_SESSIONS,
  resetTerminalSessionStore,
  useTerminalStore,
} from "@/stores/terminalStore";
import { terminalCreationBlock } from "./sessionActions";

function create(ownerInstanceId?: string) {
  return useTerminalStore
    .getState()
    .terminalCreateSession(ownerInstanceId ? { ownerInstanceId } : undefined);
}

/** Fill the window to the total cap, spreading sessions across scopes so no
 *  single scope reaches the per-scope cap. */
function fillToTotalCap() {
  for (let i = 0; i < MAX_TOTAL_TERMINAL_SESSIONS; i++) {
    expect(create(`wsi-${Math.floor(i / (MAX_TERMINAL_SESSIONS - 1))}`)).not.toBeNull();
  }
}

beforeEach(() => {
  resetTerminalSessionStore();
});

describe("total terminal cap", () => {
  it("is larger than the per-scope cap", () => {
    expect(MAX_TOTAL_TERMINAL_SESSIONS).toBeGreaterThan(MAX_TERMINAL_SESSIONS);
  });

  it("refuses a session in a fresh scope once the window holds the total", () => {
    fillToTotalCap();
    expect(create("wsi-fresh")).toBeNull();
    expect(create()).toBeNull();
  });

  it("never removes an existing session when refusing", () => {
    fillToTotalCap();
    create("wsi-fresh");
    expect(useTerminalStore.getState().sessions).toHaveLength(MAX_TOTAL_TERMINAL_SESSIONS);
  });

  it("frees headroom when a session is closed", () => {
    fillToTotalCap();
    const first = useTerminalStore.getState().sessions[0];
    useTerminalStore.getState().terminalRemoveSession(first.id);
    expect(create("wsi-fresh")).not.toBeNull();
  });
});

describe("terminalCreationBlock", () => {
  it("is null with headroom everywhere", () => {
    expect(terminalCreationBlock([], "wsi-a")).toBeNull();
  });

  it("reports the scope cap when only the scope is full", () => {
    for (let i = 0; i < MAX_TERMINAL_SESSIONS; i++) create("wsi-a");
    const { sessions } = useTerminalStore.getState();
    expect(terminalCreationBlock(sessions, "wsi-a")).toBe("scope");
    expect(terminalCreationBlock(sessions, "wsi-b")).toBeNull();
  });

  it("reports the total cap even for a scope with headroom", () => {
    fillToTotalCap();
    const { sessions } = useTerminalStore.getState();
    expect(terminalCreationBlock(sessions, "wsi-fresh")).toBe("total");
  });
});
