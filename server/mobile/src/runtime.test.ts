import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTestApp } from "./testFixtures.testUtils";
import { startServer, type RunningServer } from "./runtime";

let t: Awaited<ReturnType<typeof makeTestApp>>;
let server: RunningServer | undefined;
beforeEach(async () => (t = await makeTestApp()));
afterEach(async () => {
  await server?.close();
  server = undefined;
  await t.cleanup();
});

describe("startServer", () => {
  it("binds exactly the requested host and serves over a real socket", async () => {
    server = await startServer({ app: t.app, hostname: "127.0.0.1", port: 0 });
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const ok = await fetch(`${server.url}/api/health`, { headers: { Authorization: `Bearer ${t.token}` } });
    expect(ok.status).toBe(200);
    expect((await fetch(`${server.url}/api/health`)).status).toBe(401);
  });

  it("rejects when the port is taken", async () => {
    server = await startServer({ app: t.app, hostname: "127.0.0.1", port: 0 });
    const port = Number(new URL(server.url).port);
    await expect(startServer({ app: t.app, hostname: "127.0.0.1", port })).rejects.toThrow(/EADDRINUSE/);
  });
});
