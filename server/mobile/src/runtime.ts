/**
 * Binding the app to a socket.
 *
 * @module runtime
 */
import { serve } from "@hono/node-server";
import type { Hono } from "hono";

export interface RunningServer {
  url: string;
  close(): Promise<void>;
}

export function startServer({ app, hostname, port }: { app: Hono; hostname: string; port: number }): Promise<RunningServer> {
  return new Promise((resolve, reject) => {
    const server = serve({ fetch: app.fetch, hostname, port }, (info) => {
      server.off("error", reject);
      resolve({
        url: `http://${hostname}:${info.port}`,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
    server.once("error", reject);
  });
}
