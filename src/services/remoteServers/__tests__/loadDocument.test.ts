/**
 * `loadDocument` — the read that paints a document in the remote browser.
 *
 * Behaviour under test: the read must NOT write `kind: "loading"` into the
 * store. `MainRegion` renders the viewer whenever `doc` exists, and the viewer
 * is keyed by `rootId:relPath`, so flipping the kind was what unmounted the
 * reader that had just asked for the read — its remount asked again, and a
 * remote document could never paint (an endless read loop). The staleness token
 * still moves, which is what the store's `seq` is for.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRemoteBrowserStore } from "@/stores/remoteBrowserStore";

const client = vi.hoisted(() => ({
  remoteFile: vi.fn(),
  remoteTree: vi.fn(),
  remoteWorkspaces: vi.fn(),
  remoteAsset: vi.fn(),
  classifyRemoteFailure: vi.fn(() => "network"),
  remoteFailureKey: vi.fn(() => "errors.remoteServer.network"),
  remoteFailureParams: vi.fn(() => undefined),
}));
vi.mock("@/services/remoteServers/client", () => client);

// Imported after the mock so `browse` binds the mock, not the real transport.
const { loadDocument } = await import("@/services/remoteServers/browse");

const CONNECTION = { host: "m1.tailc8e51.ts.net", port: 8740, token: "a".repeat(64) };

function openOnDocument(kind: "markdown" | "loading" = "markdown") {
  useRemoteBrowserStore.setState({
    serverId: "s1",
    connection: CONNECTION,
    groups: [],
    groupsStatus: "ready",
    groupsMessage: null,
    activeRootId: "r1",
    doc: { rootId: "r1", relPath: "notes.md", kind },
    levels: {},
    expanded: {},
    seq: 5,
  });
}

describe("loadDocument", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useRemoteBrowserStore.setState({ serverId: null, connection: null, doc: null, seq: 0 });
  });

  it("leaves doc.kind alone while the read is in flight", async () => {
    let settle: (value: unknown) => void = () => {};
    client.remoteFile.mockReturnValue(new Promise((resolve) => (settle = resolve)));
    openOnDocument();

    const read = loadDocument("r1", "notes.md");
    await Promise.resolve();

    // The viewer is keyed on `rootId:relPath` and mounted while `doc` exists;
    // "loading" here is what used to unmount it and restart the read.
    expect(useRemoteBrowserStore.getState().doc?.kind).toBe("markdown");
    // The staleness token still moves, so a superseded answer can be dropped.
    expect(useRemoteBrowserStore.getState().seq).toBe(6);

    settle({ rootId: "r1", relPath: "notes.md", kind: "markdown", text: "# hi" });
    await expect(read).resolves.toMatchObject({ text: "# hi" });
    expect(useRemoteBrowserStore.getState().doc).toEqual({
      rootId: "r1",
      relPath: "notes.md",
      kind: "markdown",
    });
  });

  it("drops an answer that arrives after the window moved to another server", async () => {
    let settle: (value: unknown) => void = () => {};
    client.remoteFile.mockReturnValue(new Promise((resolve) => (settle = resolve)));
    openOnDocument();

    const read = loadDocument("r1", "notes.md");
    await Promise.resolve();
    useRemoteBrowserStore.setState({ serverId: "s2" });

    settle({ rootId: "r1", relPath: "notes.md", kind: "markdown", text: "# stale" });
    await expect(read).resolves.toBeNull();
    expect(useRemoteBrowserStore.getState().doc?.kind).toBe("markdown");
  });

  it("marks the failure only while the same server is still current", async () => {
    client.remoteFile.mockRejectedValue(new Error("boom"));
    // A reader still on the previous document: `openDoc` wrote `"loading"` on
    // the way in, which is a legitimate starting point for a fresh click.
    openOnDocument("loading");

    await expect(loadDocument("r1", "notes.md")).rejects.toThrow("boom");
    expect(useRemoteBrowserStore.getState().doc?.kind).toBe("error");
  });
});
