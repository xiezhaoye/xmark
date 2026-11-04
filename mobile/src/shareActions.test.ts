import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, type Client } from "./api/client";
import type { ServerProfile } from "./api/types";
import { copyText } from "./share";
import { shareFile } from "./platformShare";
import { copyExistingLink, createLink, sendOriginal } from "./shareActions";

// The native boundary is mocked: no UIKit in tests, only its contract.
vi.mock("./platformShare", () => ({ shareFile: vi.fn() }));
vi.mock("./share", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./share")>()),
  copyText: vi.fn(),
}));

const profile = (over: Partial<ServerProfile> = {}): ServerProfile => ({
  id: "s1",
  name: "书房 Mac",
  host: "m4.ts.net",
  port: 8740,
  token: "a".repeat(64),
  ...over,
});

const OTHER = profile({ id: "s2", name: "客厅 Mac", host: "100.66.175.80", port: 8740, token: "b".repeat(64) });

const DOC = { rootId: "r1", relPath: "notes/报告.pdf" };
const BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

function fakeClient(over: Partial<Client> = {}): Client {
  return {
    health: vi.fn(async () => ({ ok: true, version: "t" })),
    workspaces: vi.fn(async () => ({ groups: [] })),
    tree: vi.fn(async () => ({ path: "", entries: [] })),
    file: vi.fn(async () => ({ text: "stale cached text", kind: "markdown" as const, size: 1, mtime: 1 })),
    asset: vi.fn(async () => new Blob()),
    search: vi.fn(async () => ({ results: [], truncated: false })),
    download: vi.fn(async () => ({ bytes: BYTES, name: "报告.pdf", mimeType: "application/pdf" })),
    createShare: vi.fn(async () => ({ url: "https://box.ts.net/s/abc" })),
    ...over,
  };
}

let client: Client;
const deps = () => ({ makeClient: () => client });
const shareMock = () => vi.mocked(shareFile);
const copyMock = () => vi.mocked(copyText);

beforeEach(() => {
  client = fakeClient();
  shareMock().mockReset();
  shareMock().mockResolvedValue(true);
  copyMock().mockReset();
  copyMock().mockResolvedValue(true);
});

describe("sendOriginal", () => {
  it("sends the bytes downloaded now, named and typed as the Mac says", async () => {
    const result = await sendOriginal(DOC, profile(), deps());
    expect(result).toEqual({ status: "sent" });
    expect(client.download).toHaveBeenCalledWith("r1", "notes/报告.pdf");
    expect(shareMock()).toHaveBeenCalledWith({ name: "报告.pdf", bytes: BYTES, mimeType: "application/pdf" });
  });

  it("never uses the reader's cached text", async () => {
    await sendOriginal(DOC, profile(), deps());
    expect(client.file).not.toHaveBeenCalled();
  });

  it("shares from the Mac the action started on, not the one selected later", async () => {
    const seen: string[] = [];
    const makeClient = vi.fn((c: { host: string }) => {
      seen.push(c.host);
      return client;
    });
    const pending = sendOriginal(DOC, profile(), { makeClient });
    // The user switches servers and documents while the download is in flight.
    await pending;
    expect(seen).toEqual(["m4.ts.net"]);
    expect(client.download).toHaveBeenCalledWith("r1", "notes/报告.pdf");
    expect(makeClient).toHaveBeenCalledTimes(1);
  });

  it("is quiet when the share sheet is cancelled", async () => {
    shareMock().mockResolvedValue(false);
    expect(await sendOriginal(DOC, profile(), deps())).toEqual({ status: "cancelled" });
  });

  it("reports a download failure by code and never opens the sheet", async () => {
    client = fakeClient({ download: vi.fn(async () => Promise.reject(new ApiError(404, "not_found"))) });
    expect(await sendOriginal(DOC, OTHER, deps())).toEqual({ status: "error", code: "not_found" });
    expect(shareMock()).not.toHaveBeenCalled();
  });

  it("reports an unexpected failure as a network error rather than throwing", async () => {
    client = fakeClient({
      download: vi.fn(async () => {
        throw new Error("boom");
      }),
    });
    expect(await sendOriginal(DOC, profile(), deps())).toEqual({ status: "error", code: "network" });
  });
});

describe("createLink", () => {
  it("creates the link for the doc on the current Mac and copies it", async () => {
    expect(await createLink(DOC, profile(), deps())).toEqual({ status: "copied", url: "https://box.ts.net/s/abc" });
    expect(client.createShare).toHaveBeenCalledWith("r1", "notes/报告.pdf");
    expect(copyMock()).toHaveBeenCalledWith("https://box.ts.net/s/abc");
  });

  it("keeps the created link when the clipboard refuses it, without creating a second one", async () => {
    copyMock().mockResolvedValue(false);
    expect(await createLink(DOC, profile(), deps())).toEqual({ status: "copy_failed", url: "https://box.ts.net/s/abc" });
    expect(client.createShare).toHaveBeenCalledTimes(1);
  });

  it("surfaces sharing_unavailable and copies nothing", async () => {
    client = fakeClient({ createShare: vi.fn(async () => Promise.reject(new ApiError(503, "sharing_unavailable"))) });
    expect(await createLink(DOC, profile(), deps())).toEqual({ status: "error", code: "sharing_unavailable" });
    expect(copyMock()).not.toHaveBeenCalled();
  });

  it("snapshots the connection at the moment of the click", async () => {
    const seen: string[] = [];
    const makeClient = (c: { host: string }) => {
      seen.push(c.host);
      return client;
    };
    await createLink(DOC, OTHER, { makeClient });
    expect(seen).toEqual(["100.66.175.80"]);
    expect((client.createShare as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.[0]).toBe("r1");
  });
});

describe("copyExistingLink", () => {
  it("retries the clipboard with the link that already exists", async () => {
    expect(await copyExistingLink("https://box.ts.net/s/abc")).toBe(true);
    expect(copyMock()).toHaveBeenCalledWith("https://box.ts.net/s/abc");
    expect(client.createShare).not.toHaveBeenCalled();
  });

  it("answers false when the retry fails too", async () => {
    copyMock().mockResolvedValue(false);
    expect(await copyExistingLink("https://box.ts.net/s/abc")).toBe(false);
  });
});
