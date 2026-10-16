/**
 * Bearer-token gate in front of every route.
 *
 * Only the `Authorization` header is accepted — never a query parameter —
 * so the token cannot leak through logs, history or a shared link.
 *
 * @module auth
 */
import type { MiddlewareHandler } from "hono";
import { tokenMatches, type TokenSource } from "./token";

export function bearerAuth(source: TokenSource): MiddlewareHandler {
  return async (c, next) => {
    const header = c.req.header("authorization") ?? "";
    const match = /^bearer\s+(\S+)$/i.exec(header);
    if (!match || !tokenMatches(await source.current(), match[1])) {
      c.header("WWW-Authenticate", "Bearer");
      return c.json({ error: "unauthorized" }, 401);
    }
    await next();
  };
}
