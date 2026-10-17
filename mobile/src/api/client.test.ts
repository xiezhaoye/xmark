// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { ApiError, baseUrlFor, createClient } from "./client";

const conn = { host: "m4.tail.ts.net", port: 8740, token: "t".repeat(64) };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("baseUrlFor", () => {
  it("builds an http URL", () => {
    expect(baseUrlFor(conn)).toBe("http://m4.tail.ts.net:8740");
  });
});

describe("createClient", () => {
  it("sends the bearer token and encodes query parameters", async () => {
    const fetch = vi.fn(async () => json({ path: "", entries: [] }));
    const client = createClient(conn, fetch);
    await client.tree("r1", "笔记/a b&c");
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`http://m4.tail.ts.net:8740/api/tree?root=r1&path=${encodeURIComponent("笔记/a b&c")}`);
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${conn.token}`);
  });

  it("maps a server error body to ApiError with its code", async () => {
    const client = createClient(conn, async () => json({ error: "not_utf8" }, 415));
    await expect(client.file("r", "a.md")).rejects.toMatchObject({ status: 415, code: "not_utf8" });
  });

  it("maps 401 to the unauthorized code even without a body", async () => {
    const client = createClient(conn, async () => new Response("", { status: 401 }));
    await expect(client.workspaces()).rejects.toMatchObject({ status: 401, code: "unauthorized" });
  });

  it("maps a network failure to status 0 / network", async () => {
    const client = createClient(conn, async () => {
      throw new TypeError("Load failed");
    });
    const err = await client.health().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 0, code: "network" });
  });

  it("omits the root for an all-workspace search", async () => {
    const fetch = vi.fn(async () => json({ results: [], truncated: false }));
    await createClient(conn, fetch).search("中文");
    expect((fetch.mock.calls[0] as unknown as [string])[0]).toBe(
      `http://m4.tail.ts.net:8740/api/search?q=${encodeURIComponent("中文")}`,
    );
  });

  it("returns asset bytes as a Blob", async () => {
    const client = createClient(conn, async () => new Response(new Uint8Array([1, 2]), { headers: { "content-type": "image/png" } }));
    const blob = await client.asset("r", "a.png");
    expect(blob.size).toBe(2);
  });

  it("aborts a request that takes too long", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    const pending = createClient(conn, fetch, 1000).health().catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toMatchObject({ status: 0, code: "timeout" });
    vi.useRealTimers();
  });
});
