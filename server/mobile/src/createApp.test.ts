import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./createApp";
import { makeTestApp, readJson } from "./testFixtures.testUtils";
import type { Hono } from "hono";

let t: Awaited<ReturnType<typeof makeTestApp>>;
beforeEach(async () => (t = await makeTestApp()));
afterEach(() => t.cleanup());

describe("createApp", () => {
  it("answers health with the version", async () => {
    const res = await t.get("/api/health");
    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual({ ok: true, version: "test" });
  });

  it("requires the token on every route, health included", async () => {
    for (const url of ["/api/health", "/api/workspaces", `/api/tree?root=${t.rootId}`, "/nope"]) {
      expect((await t.app.request(url)).status).toBe(401);
    }
  });

  it("lists groups without absolute paths", async () => {
    const res = await t.get("/api/workspaces");
    const body = await readJson(res);
    expect(body).toEqual({ groups: [{ id: "g1", name: "Wiki", folders: [{ rootId: t.rootId, name: "wiki", available: true }] }] });
    expect(JSON.stringify(body)).not.toContain(t.base);
  });

  it("returns JSON 404 for unknown routes", async () => {
    const res = await t.get("/api/nope");
    expect(res.status).toBe(404);
    expect(await readJson(res)).toEqual({ error: "not_found" });
  });

  it("marks every response uncacheable and unsniffable", async () => {
    const res = await t.get("/api/workspaces");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("does not send CORS headers", async () => {
    const res = await t.get("/api/health", { Origin: "tauri://localhost" });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("treats an empty origin list as no CORS at all, preflight included", async () => {
    const app = makeCorsApp([]);
    const pre = await app.request("/api/health", {
      method: "OPTIONS",
      headers: { Origin: "https://web.xmark.app", "Access-Control-Request-Method": "GET" },
    });
    expect(pre.status).toBe(401);
    expect(pre.headers.get("access-control-allow-origin")).toBeNull();
    const res = await app.request("/api/health", { headers: { Origin: "https://web.xmark.app" } });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});

const WEB = "https://web.xmark.app";

/** An app whose registry never changes; only the CORS behaviour matters here. */
function makeCorsApp(corsOrigins: string[]) {
  const tokens = { current: async () => "test-token" };
  const registry = { current: async () => ({ version: 1, groups: [] }) } as unknown as Parameters<
    typeof createApp
  >[0]["registry"];
  return createApp({ tokens, registry, version: "test", corsOrigins });
}

const preflight = (origin: string) => ({ method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "GET" } });

describe("createApp with CORS origins", () => {
  let app: Hono;
  beforeEach(() => {
    app = makeCorsApp([WEB]);
  });

  it("answers a preflight from an allowed origin with 204 and no token", async () => {
    const res = await app.request("/api/workspaces", preflight(WEB));
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(WEB);
    expect(res.headers.get("access-control-allow-methods")).toBe("GET, OPTIONS");
    expect(res.headers.get("access-control-allow-headers")).toBe("Authorization");
    expect(res.headers.get("vary")).toBe("Origin");
    expect(res.headers.get("www-authenticate")).toBeNull();
  });

  it("echoes the origin on a real request that carries the token", async () => {
    const res = await app.request("/api/workspaces", { headers: { Origin: WEB, Authorization: "Bearer test-token" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(WEB);
  });

  it("still requires the token for the actual request", async () => {
    const res = await app.request("/api/workspaces", { headers: { Origin: WEB } });
    expect(res.status).toBe(401);
    expect(res.headers.get("access-control-allow-origin")).toBe(WEB);
    expect(await readJson(res)).toEqual({ error: "unauthorized" });
  });

  it("does not grant an origin outside the list but answers its preflight", async () => {
    const pre = await app.request("/api/health", preflight("https://evil.example"));
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBeNull();
    const res = await app.request("/api/health", {
      headers: { Origin: "https://evil.example", Authorization: "Bearer test-token" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("sends no CORS headers when the request carries no Origin", async () => {
    const res = await app.request("/api/health", { headers: { Authorization: "Bearer test-token" } });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.get("vary")).toBeNull();
  });

  it("keeps the security headers on cross-origin responses", async () => {
    const res = await app.request("/api/health", { headers: { Origin: WEB, Authorization: "Bearer test-token" } });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("honours every listed origin", async () => {
    const multi = makeCorsApp([WEB, "http://localhost:5173"]);
    for (const origin of [WEB, "http://localhost:5173"]) {
      const res = await multi.request("/api/health", { headers: { Origin: origin, Authorization: "Bearer test-token" } });
      expect(res.headers.get("access-control-allow-origin")).toBe(origin);
    }
  });
});
