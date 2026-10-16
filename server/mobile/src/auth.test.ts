import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { bearerAuth } from "./auth";
import { readJson } from "./testFixtures.testUtils";

const TOKEN = "f".repeat(64);
const app = new Hono();
app.use("*", bearerAuth({ current: async () => TOKEN }));
app.get("/api/health", (c) => c.json({ ok: true }));

const call = (headers: Record<string, string> = {}) => app.request("/api/health", { headers });

describe("bearerAuth", () => {
  it("passes a request carrying the token", async () => {
    const res = await call({ Authorization: `Bearer ${TOKEN}` });
    expect(res.status).toBe(200);
  });

  it("accepts the scheme case-insensitively", async () => {
    expect((await call({ Authorization: `bearer ${TOKEN}` })).status).toBe(200);
  });

  it.each([
    ["no header", {}],
    ["wrong token", { Authorization: `Bearer ${"0".repeat(64)}` }],
    ["wrong scheme", { Authorization: `Basic ${TOKEN}` }],
    ["bare token", { Authorization: TOKEN }],
    ["token in query only", {}],
  ])("rejects %s with 401 and a challenge", async (_label, headers) => {
    const res = await call(headers as Record<string, string>);
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe("Bearer");
    expect(await readJson(res)).toEqual({ error: "unauthorized" });
  });

  it("does not accept the token as a query parameter", async () => {
    const res = await app.request(`/api/health?token=${TOKEN}`);
    expect(res.status).toBe(401);
  });
});
