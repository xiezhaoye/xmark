/**
 * Temporary-directory helpers shared by the mobile-server tests.
 *
 * @module testFixtures.testUtils
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";

/** Create a fresh temp dir; the returned cleanup removes it recursively. */
export async function makeTempDir(prefix = "xmark-mobile-"): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

/** A workspace with one group holding `wiki/`, plus a ready app and its token. */
export async function makeTestApp() {
  const { mkdir, realpath, writeFile } = await import("node:fs/promises");
  const { createApp } = await import("./createApp");
  const { createRegistrySource } = await import("./registry");
  const { createTokenSource } = await import("./token");
  const { dir, cleanup } = await makeTempDir();
  const base = await realpath(dir);
  const wiki = path.join(base, "wiki");
  await mkdir(wiki);
  const shareFile = path.join(base, "mobile-share.json");
  await writeFile(shareFile, JSON.stringify({ version: 1, groups: [{ id: "g1", name: "Wiki", folders: [wiki] }] }));
  const tokens = await createTokenSource(path.join(base, "state", "token"));
  const token = await tokens.current();
  const registry = await createRegistrySource(shareFile, undefined, 0);
  const rootId = (await registry.current()).groups[0].folders[0].rootId;
  const app = createApp({ tokens, registry, version: "test" });
  const get = (url: string, headers: Record<string, string> = {}) =>
    app.request(url, { headers: { Authorization: `Bearer ${token}`, ...headers } });
  return { base, wiki, rootId, token, app, get, cleanup };
}

/** Read a JSON response body loosely typed, for assertions. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test assertions inspect arbitrary response shapes
export const readJson = (res: Response): Promise<any> => res.json();
