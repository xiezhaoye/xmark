// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { ApiError, baseUrlFor, createClient, fallbackName, filenameFrom } from "./client";

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

  it("has no download or share on a client built from an unpaired server", async () => {
    const fetch = vi.fn(async () => json({}));
    const client = createClient(conn, fetch);
    expect(typeof client.download).toBe("function");
    expect(typeof client.createShare).toBe("function");
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

const bytesResponse = (bytes: number[], headers: Record<string, string>) =>
  new Response(new Uint8Array(bytes), { status: 200, headers });

/** The UTF-8 `filename*` of a Content-Disposition, as the server sends it. */
const utf8Disposition = (name: string) =>
  `attachment; filename="fallback.bin"; filename*=UTF-8''${encodeURIComponent(name)}`;

describe("fallbackName", () => {
  it("takes the last path segment", () => {
    expect(fallbackName("notes/2024/报告.pdf")).toBe("报告.pdf");
  });

  it("drops query-ish and traversal text", () => {
    expect(fallbackName("../../etc/passwd")).toBe("passwd");
    expect(fallbackName("a/b.md?x=1#y")).toBe("b.md?x=1#y");
    expect(fallbackName("back\\slash\\n.md")).toBe("n.md");
  });

  it("falls back to a neutral name when the path has none", () => {
    expect(fallbackName("")).toBe("download");
    expect(fallbackName("dir/")).toBe("download");
    expect(fallbackName(".")).toBe("download");
    expect(fallbackName("..")).toBe("download");
  });
});

describe("filenameFrom", () => {
  it("prefers the RFC 5987 UTF-8 parameter, decoded", () => {
    expect(filenameFrom(`attachment; filename="a.bin"; filename*=UTF-8''${encodeURIComponent("中文 笔记.md")}`)).toBe("中文 笔记.md");
  });

  it("accepts an uppercase UTF-8 marker and a quoted filename*", () => {
    expect(filenameFrom(`attachment; filename*=UTF-8''${encodeURIComponent("图.png")}`)).toBe("图.png");
    expect(filenameFrom(`attachment; filename*=utf-8''${encodeURIComponent("图.png")}`)).toBe("图.png");
  });

  it("uses the plain quoted name when there is no filename*", () => {
    expect(filenameFrom('attachment; filename="note.md"')).toBe("note.md");
  });

  it("strips any directory part a server might send", () => {
    expect(filenameFrom('attachment; filename="/tmp/evil.md"')).toBe("evil.md");
    expect(filenameFrom('attachment; filename="..\\..\\evil.md"')).toBe("evil.md");
  });

  it("has nothing for a missing or unusable header", () => {
    expect(filenameFrom(null)).toBeNull();
    expect(filenameFrom("attachment")).toBeNull();
    expect(filenameFrom('attachment; filename=""')).toBeNull();
  });
});

describe("Client.download", () => {
  it("returns the bytes, name and content type of the original file", async () => {
    const fetch = vi.fn(async () =>
      bytesResponse([1, 2, 3], { "content-type": "application/pdf", "content-disposition": utf8Disposition("报告.pdf") }),
    );
    const { bytes, name, mimeType } = await createClient(conn, fetch).download("r1", "notes/报告.pdf");
    expect(Array.from(bytes)).toEqual([1, 2, 3]);
    expect(name).toBe("报告.pdf");
    expect(mimeType).toBe("application/pdf");
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`http://m4.tail.ts.net:8740/api/download?root=r1&path=${encodeURIComponent("notes/报告.pdf")}`);
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${conn.token}`);
  });

  it("fetches afresh every time: no cached bytes between calls", async () => {
    let version = 1;
    const fetch = vi.fn(async () =>
      bytesResponse([version], { "content-type": "text/plain", "content-disposition": utf8Disposition("a.txt") }),
    );
    const client = createClient(conn, fetch);
    expect(Array.from((await client.download("r", "a.txt")).bytes)).toEqual([1]);
    version = 2;
    expect(Array.from((await client.download("r", "a.txt")).bytes)).toEqual([2]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("derives a safe name from the path when the header is missing", async () => {
    const client = createClient(conn, async () => bytesResponse([0x25], { "content-type": "application/pdf" }));
    expect(await client.download("r", "docs/扫描 件.pdf")).toEqual({
      bytes: new Uint8Array([0x25]),
      name: "扫描 件.pdf",
      mimeType: "application/pdf",
    });
  });

  it("falls back to octet-stream when there is no content type", async () => {
    const client = createClient(conn, async () => new Response(new Uint8Array([7]), { status: 200 }));
    expect((await client.download("r", "a.bin")).mimeType).toBe("application/octet-stream");
  });

  it("maps a server error body to its code", async () => {
    const client = createClient(conn, async () => json({ error: "not_found" }, 404));
    await expect(client.download("r", "gone.pdf")).rejects.toMatchObject({ status: 404, code: "not_found" });
  });

  it("maps an expired token to unauthorized", async () => {
    const client = createClient(conn, async () => new Response("", { status: 401 }));
    await expect(client.download("r", "a.md")).rejects.toMatchObject({ code: "unauthorized" });
  });

  it("respects the timeout", async () => {
    vi.useFakeTimers();
    try {
      const fetch = vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
          }),
      );
      const pending = createClient(conn, fetch, 1000).download("r", "a.md").catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(1000);
      expect(await pending).toMatchObject({ status: 0, code: "timeout" });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Client.createShare", () => {
  it("posts the root and path as JSON and returns the link", async () => {
    const fetch = vi.fn(async () => json({ url: "https://box.ts.net/s/abc" }, 201));
    const { url } = await createClient(conn, fetch).createShare("r1", "notes/报告.pdf");
    expect(url).toBe("https://box.ts.net/s/abc");
    const [calledUrl, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(calledUrl).toBe("http://m4.tail.ts.net:8740/api/shares");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ root: "r1", path: "notes/报告.pdf" }));
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${conn.token}`);
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("surfaces sharing_unavailable as its own code", async () => {
    const client = createClient(conn, async () => json({ error: "sharing_unavailable" }, 503));
    await expect(client.createShare("r", "a.md")).rejects.toMatchObject({ status: 503, code: "sharing_unavailable" });
  });

  it("maps a 401 to unauthorized and a timeout to its own code", async () => {
    await expect(createClient(conn, async () => new Response("", { status: 401 })).createShare("r", "a.md")).rejects.toMatchObject({
      code: "unauthorized",
    });
    vi.useFakeTimers();
    try {
      const fetch = vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
          }),
      );
      const pending = createClient(conn, fetch, 1000).createShare("r", "a.md").catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(1000);
      expect(await pending).toMatchObject({ status: 0, code: "timeout" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects a body without a string url", async () => {
    const client = createClient(conn, async () => json({ nope: true }, 200));
    await expect(client.createShare("r", "a.md")).rejects.toMatchObject({ code: "bad_response" });
  });
});
