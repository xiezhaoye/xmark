import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTestApp, readJson } from "./testFixtures.testUtils";

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
});
