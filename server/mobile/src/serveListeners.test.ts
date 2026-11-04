import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { listenerSpecs, openListeners, type ListenerSpec } from "./serveListeners";
import type { RunningServer } from "./runtime";

const app = new Hono();

/** A start function that records what it bound and hands back closable servers. */
function recordingStart(options: { failOn?: number } = {}) {
  const bound: Array<{ hostname: string; port: number }> = [];
  const closed: string[] = [];
  let call = 0;
  const start = async (o: { app: unknown; hostname: string; port: number }): Promise<RunningServer> => {
    call += 1;
    if (options.failOn === call) throw new Error("EADDRINUSE");
    bound.push({ hostname: o.hostname, port: o.port });
    const url = `http://${o.hostname}:${o.port}`;
    return { url, close: async () => void closed.push(url) };
  };
  return { start, bound, closed };
}

const specs = (ports: number[]): ListenerSpec[] =>
  ports.map((port, i) => ({ role: i === 0 ? "private" : "public", app, hostname: "127.0.0.1", port }));

describe("openListeners", () => {
  it("starts every listener in order and reports each URL", async () => {
    const { start, bound } = recordingStart();
    const opened = await openListeners(specs([1, 2]), start);
    expect(bound).toEqual([
      { hostname: "127.0.0.1", port: 1 },
      { hostname: "127.0.0.1", port: 2 },
    ]);
    expect(opened.urls).toEqual(["http://127.0.0.1:1", "http://127.0.0.1:2"]);
    await opened.close();
  });

  it("closes what it already opened when a later listener fails", async () => {
    const { start, closed } = recordingStart({ failOn: 2 });
    await expect(openListeners(specs([1, 2]), start)).rejects.toThrow("EADDRINUSE");
    expect(closed).toEqual(["http://127.0.0.1:1"]);
  });

  it("closes public before private when both are open", async () => {
    const { start, closed } = recordingStart();
    const opened = await openListeners(specs([1, 2]), start);
    await opened.close();
    // Reverse order: the public listener is the one an outside client uses.
    expect(closed).toEqual(["http://127.0.0.1:2", "http://127.0.0.1:1"]);
  });

  it("closes once, even when close is called twice", async () => {
    const { start, closed } = recordingStart();
    const opened = await openListeners(specs([1, 2]), start);
    await opened.close();
    await opened.close();
    expect(closed).toHaveLength(2);
  });

  it("swallows a close error, so the other listener still closes", async () => {
    const closed: string[] = [];
    const start = vi.fn(async (o: { hostname: string; port: number }): Promise<RunningServer> => ({
      url: `http://${o.hostname}:${o.port}`,
      close: async () => {
        if (o.port === 2) throw new Error("already closed");
        closed.push(String(o.port));
      },
    }));
    const opened = await openListeners(specs([1, 2]), start as never);
    await expect(opened.close()).resolves.toBeUndefined();
    expect(closed).toEqual(["1"]);
  });

  it("starts nothing for an empty list", async () => {
    const { start, bound } = recordingStart();
    const opened = await openListeners([], start);
    expect(bound).toEqual([]);
    await opened.close();
  });
});

describe("listenerSpecs", () => {
  const cfg = { port: 8740, publicPort: 8741, host: null } as never;

  it("binds the private app on the given hostname", () => {
    expect(listenerSpecs({ cfg, privateApp: app, publicApp: null, hostname: "100.64.1.2" })).toEqual([
      { role: "private", app, hostname: "100.64.1.2", port: 8740 },
    ]);
  });

  it("adds the public app on loopback when sharing is configured", () => {
    const publicApp = new Hono();
    expect(listenerSpecs({ cfg, privateApp: app, publicApp, hostname: "100.64.1.2" })).toEqual([
      { role: "private", app, hostname: "100.64.1.2", port: 8740 },
      { role: "public", app: publicApp, hostname: "127.0.0.1", port: 8741 },
    ]);
  });
});
