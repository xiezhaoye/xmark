import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { makeTempDir, readJson } from "./testFixtures.testUtils";
import { defaultServerName, parsePairArgs, runCli, type CliDeps } from "./cliMain";
import { LAUNCH_AGENT_LABEL } from "./launchAgent";

let dir: string;
let cleanup: () => Promise<void>;
let out: string[];
let err: string[];
let deps: CliDeps;
let stops: Array<() => Promise<void>>;

beforeEach(async () => {
  ({ dir, cleanup } = await makeTempDir());
  out = [];
  err = [];
  stops = [];
  deps = {
    env: {
      XMARK_MOBILE_SHARE_FILE: path.join(dir, "share.json"),
      XMARK_MOBILE_TOKEN_FILE: path.join(dir, "state", "token"),
    },
    home: dir,
    hostname: () => "m4.local",
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    run: vi.fn(async (cmd: string, args: string[]) => {
      if (args[0] === "ip") return "100.64.1.2\n";
      if (args[0] === "status") return JSON.stringify({ Self: { DNSName: "m4.tail.ts.net." } });
      if (cmd === "launchctl") return "";
      throw new Error("unexpected");
    }),
    sleep: async () => {},
    version: "9.9.9",
    nodePath: "/opt/node",
    cliPath: "/opt/xmark/dist/cli.js",
    uid: 501,
    platform: "darwin",
    userName: () => "me",
    exit: vi.fn(),
    onStop: (stop) => stops.push(stop),
  };
});
afterEach(async () => {
  for (const s of stops) await s();
  await cleanup();
});

describe("runCli", () => {
  it("prints usage for help and returns 0", async () => {
    expect(await runCli(["help"], deps)).toBe(0);
    expect(out.join("")).toMatch(/serve.*pair.*rotate-token/s);
  });

  it("returns 2 for an unknown command", async () => {
    expect(await runCli(["bogus"], deps)).toBe(2);
    expect(err.join("")).toContain("bogus");
  });

  it("pair prints the MagicDNS host, port and token", async () => {
    expect(await runCli(["pair"], deps)).toBe(0);
    const token = (await readFile(path.join(dir, "state", "token"), "utf8")).trim();
    const text = out.join("");
    expect(text).toContain("m4.tail.ts.net");
    expect(text).toContain("8740");
    expect(text).toContain(token);
  });

  it("pair names the server after this Mac's hostname when --name is absent", async () => {
    expect(await runCli(["pair"], deps)).toBe(0);
    expect(out.join("")).toContain("name=m4");
    expect(out.join("")).toContain("  Name:  m4\n");
  });

  it("pair uses --name and percent-encodes a non-ASCII name", async () => {
    expect(await runCli(["pair", "--name", "书房 Mac"], deps)).toBe(0);
    const text = out.join("");
    const token = (await readFile(path.join(dir, "state", "token"), "utf8")).trim();
    expect(text).toContain(`xmark-mobile://pair?host=m4.tail.ts.net&port=8740&token=${token}&name=%E4%B9%A6%E6%88%BF+Mac`);
    expect(text).toContain("  Name:  书房 Mac");
    expect(text).not.toContain("  Name:  m4\n");
  });

  it("pair accepts --name=<value> too", async () => {
    expect(await runCli(["pair", "--name=Office"], deps)).toBe(0);
    expect(out.join("")).toContain("name=Office");
  });

  it("pair falls back to the hostname when --name has no value", async () => {
    expect(await runCli(["pair", "--name"], deps)).toBe(0);
    expect(out.join("")).toContain("name=m4");
  });

  it("pair keeps the link identical to older releases apart from the extra name parameter", async () => {
    expect(await runCli(["pair"], deps)).toBe(0);
    const token = (await readFile(path.join(dir, "state", "token"), "utf8")).trim();
    expect(out.join("")).toContain(`xmark-mobile://pair?host=m4.tail.ts.net&port=8740&token=${token}&name=m4`);
    expect(out.join("")).toContain("  Host:  m4.tail.ts.net");
    expect(out.join("")).toContain("  Port:  8740");
  });

  it("help documents --name", async () => {
    await runCli(["help"], deps);
    expect(out.join("")).toMatch(/pair \[--name/);
  });

  it("pair fails clearly when Tailscale is not available", async () => {
    deps.run = async () => {
      throw new Error("ENOENT");
    };
    expect(await runCli(["pair"], deps)).toBe(1);
    expect(err.join("")).toMatch(/tailscale/i);
  });

  it("rotate-token replaces the token and says the phone must re-pair", async () => {
    await runCli(["pair"], deps);
    const before = await readFile(path.join(dir, "state", "token"), "utf8");
    expect(await runCli(["rotate-token"], deps)).toBe(0);
    expect(await readFile(path.join(dir, "state", "token"), "utf8")).not.toBe(before);
    expect(out.join("")).toMatch(/pair again/i);
  });

  it("serve passes the configured CORS origins to the app", async () => {
    deps.env.XMARK_MOBILE_PORT = "0";
    deps.env.XMARK_MOBILE_HOST = "127.0.0.1";
    deps.env.XMARK_MOBILE_CORS_ORIGINS = "https://web.xmark.app";
    await writeFile(deps.env.XMARK_MOBILE_SHARE_FILE!, JSON.stringify({ version: 1, groups: [] }));
    let served: Parameters<NonNullable<CliDeps["startServer"]>>[0] | undefined;
    deps.startServer = async (o) => {
      served = o;
      return { url: "http://127.0.0.1:1", close: async () => {} };
    };
    expect(await runCli(["serve"], deps)).toBe(0);
    const pre = await Promise.resolve(served!.app.request("/api/health", {
      method: "OPTIONS",
      headers: { Origin: "https://web.xmark.app" },
    }));
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe("https://web.xmark.app");
  });

  it("serve reports bad CORS config", async () => {
    deps.env.XMARK_MOBILE_CORS_ORIGINS = "not-an-origin";
    expect(await runCli(["serve"], deps)).toBe(1);
    expect(err.join("")).toMatch(/cors/i);
  });

  it("serve binds the Tailscale address by default (here overridden to loopback) and answers", async () => {
    deps.env.XMARK_MOBILE_HOST = "127.0.0.1";
    deps.env.XMARK_MOBILE_PORT = "0";
    await writeFile(deps.env.XMARK_MOBILE_SHARE_FILE!, JSON.stringify({ version: 1, groups: [] }));
    expect(await runCli(["serve"], deps)).toBe(0);
    const url = /listening (http:\/\/\S+)/.exec(out.join(""))![1];
    const token = (await readFile(path.join(dir, "state", "token"), "utf8")).trim();
    const res = await fetch(`${url}/api/health`, { headers: { Authorization: `Bearer ${token}` } });
    expect(await readJson(res)).toEqual({ ok: true, version: "9.9.9" });
  });

  it("serve waits for Tailscale and binds its IPv4", async () => {
    deps.env.XMARK_MOBILE_PORT = "0";
    const listen = vi.fn(async () => ({ url: "http://100.64.1.2:1", close: async () => {} }));
    deps.startServer = listen;
    expect(await runCli(["serve"], deps)).toBe(0);
    expect(listen).toHaveBeenCalledWith(expect.objectContaining({ hostname: "100.64.1.2", port: 0 }));
  });

  it("serve exits so launchd restarts it when the Tailscale address changes", async () => {
    deps.env.XMARK_MOBILE_PORT = "0";
    deps.startServer = async () => ({ url: "http://100.64.1.2:1", close: async () => {} });
    let tick: (() => Promise<void>) | undefined;
    deps.watch = (fn) => {
      tick = fn;
      return () => {};
    };
    await runCli(["serve"], deps);
    deps.run = async () => "100.64.9.9\n";
    await tick!();
    expect(deps.exit).toHaveBeenCalledWith(1);
  });

  it("serve reports a bad port configuration", async () => {
    deps.env.XMARK_MOBILE_PORT = "nope";
    expect(await runCli(["serve"], deps)).toBe(1);
    expect(err.join("")).toMatch(/port/i);
  });

  it("install-agent writes the plist and bootstraps it", async () => {
    expect(await runCli(["install-agent"], deps)).toBe(0);
    const plistPath = path.join(dir, "Library", "LaunchAgents", `${LAUNCH_AGENT_LABEL}.plist`);
    const plist = await readFile(plistPath, "utf8");
    expect(plist).toContain("/opt/xmark/dist/cli.js");
    expect(deps.run).toHaveBeenCalledWith("launchctl", ["bootstrap", "gui/501", plistPath]);
  });

  it("uninstall-agent boots it out and removes the plist", async () => {
    await runCli(["install-agent"], deps);
    expect(await runCli(["uninstall-agent"], deps)).toBe(0);
    expect(deps.run).toHaveBeenCalledWith("launchctl", ["bootout", `gui/501/${LAUNCH_AGENT_LABEL}`]);
    await expect(readFile(path.join(dir, "Library", "LaunchAgents", `${LAUNCH_AGENT_LABEL}.plist`))).rejects.toThrow();
  });
});

/** A fake `run` that records every call, for the platform-dispatch tests. */
function recordingRun(): { run: CliDeps["run"]; calls: string[][] } {
  const calls: string[][] = [];
  const run = async (cmd: string, args: string[]) => {
    calls.push([cmd, ...args]);
    return "";
  };
  return { run, calls };
}

describe("runCli install-agent on Linux", () => {
  let calls: string[][];

  beforeEach(() => {
    deps.platform = "linux";
    const recording = recordingRun();
    calls = recording.calls;
    deps.run = recording.run;
  });

  it("writes the systemd user unit and enables it, in order", async () => {
    expect(await runCli(["install-agent"], deps)).toBe(0);
    const unitPath = path.join(dir, ".config", "systemd", "user", "xmark-mobile-server.service");
    const unit = await readFile(unitPath, "utf8");
    expect(unit).toContain("ExecStart=/opt/node /opt/xmark/dist/cli.js serve");
    expect(unit).toContain("WantedBy=default.target");
    expect(calls).toEqual([
      ["systemctl", "--user", "daemon-reload"],
      ["systemctl", "--user", "enable", "--now", "xmark-mobile-server.service"],
    ]);
  });

  it("never touches launchd or the real user directory", async () => {
    await runCli(["install-agent"], deps);
    expect(calls.some((c) => c[0] === "launchctl")).toBe(false);
    await expect(readFile(path.join(dir, "Library", "LaunchAgents", `${LAUNCH_AGENT_LABEL}.plist`))).rejects.toThrow();
  });

  it("prints the unit path, the journalctl command and the linger hint", async () => {
    await runCli(["install-agent"], deps);
    const text = out.join("");
    expect(text).toContain(path.join(dir, ".config", "systemd", "user", "xmark-mobile-server.service"));
    expect(text).toContain("journalctl --user -u xmark-mobile-server -f");
    expect(text).toContain("sudo loginctl enable-linger me");
    // Advice only: the installer must not run loginctl itself.
    expect(calls.some((c) => c[0] === "loginctl")).toBe(false);
  });

  it("fails when systemctl fails, surfacing the error", async () => {
    deps.run = async () => {
      throw new Error("systemctl: not found");
    };
    expect(await runCli(["install-agent"], deps)).toBe(1);
    expect(err.join("")).toContain("systemctl");
  });

  it("disables, removes the unit and reloads on uninstall", async () => {
    await runCli(["install-agent"], deps);
    calls.length = 0;
    expect(await runCli(["uninstall-agent"], deps)).toBe(0);
    expect(calls).toEqual([
      ["systemctl", "--user", "disable", "--now", "xmark-mobile-server.service"],
      ["systemctl", "--user", "daemon-reload"],
    ]);
    await expect(
      readFile(path.join(dir, ".config", "systemd", "user", "xmark-mobile-server.service")),
    ).rejects.toThrow();
    expect(out.join("")).toContain("Removed ");
  });

  it("still removes the unit and reloads when systemctl fails", async () => {
    await runCli(["install-agent"], deps);
    calls.length = 0;
    deps.run = async (cmd: string, args: string[]) => {
      calls.push([cmd, ...args]);
      throw new Error("no systemd");
    };
    expect(await runCli(["uninstall-agent"], deps)).toBe(0);
    expect(calls).toHaveLength(2);
    await expect(
      readFile(path.join(dir, ".config", "systemd", "user", "xmark-mobile-server.service")),
    ).rejects.toThrow();
  });
});

describe("runCli install-agent on an unsupported platform", () => {
  it("refuses and names the platform, for both commands", async () => {
    deps.platform = "win32";
    const { run, calls } = recordingRun();
    deps.run = run;
    expect(await runCli(["install-agent"], deps)).toBe(1);
    expect(await runCli(["uninstall-agent"], deps)).toBe(1);
    expect(err.join("")).toContain("win32");
    expect(calls).toHaveLength(0);
  });
});

describe("runCli install-agent on macOS", () => {
  it("keeps using launchd and never calls systemctl", async () => {
    deps.run = async (cmd: string) => {
      if (cmd !== "launchctl") throw new Error(`unexpected ${cmd}`);
      return "";
    };
    expect(await runCli(["install-agent"], deps)).toBe(0);
    expect(out.join("")).toContain(path.join(dir, "Library", "LaunchAgents", `${LAUNCH_AGENT_LABEL}.plist`));
  });
});

describe("runCli share", () => {
  it("adds, lists and removes through the configured share file", async () => {
    const folder = path.join(dir, "wiki");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(folder, { recursive: true });

    expect(await runCli(["share", "add", "测试", folder], deps)).toBe(0);
    const saved = JSON.parse(await readFile(deps.env.XMARK_MOBILE_SHARE_FILE!, "utf8")) as {
      version: number;
      groups: Array<{ name: string; folders: string[] }>;
    };
    expect(saved.version).toBe(1);
    expect(saved.groups[0]).toMatchObject({ name: "测试", folders: [folder] });

    out.length = 0;
    expect(await runCli(["share", "list"], deps)).toBe(0);
    expect(out.join("")).toContain(folder);

    expect(await runCli(["share", "remove", "测试"], deps)).toBe(0);
    const after = JSON.parse(await readFile(deps.env.XMARK_MOBILE_SHARE_FILE!, "utf8")) as { groups: unknown[] };
    expect(after.groups).toEqual([]);
  });

  it("resolves the share file from the data directory when no override is set", async () => {
    deps.platform = "linux";
    delete deps.env.XMARK_MOBILE_SHARE_FILE;
    const folder = path.join(dir, "kb");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(folder, { recursive: true });
    expect(await runCli(["share", "add", "KB", folder], deps)).toBe(0);
    const file = path.join(dir, ".local", "share", "app.xmark", "mobile-share.json");
    expect(JSON.parse(await readFile(file, "utf8"))).toHaveProperty("groups.0.name", "KB");
  });

  it("documents the subcommand in help", async () => {
    await runCli(["help"], deps);
    const text = out.join("");
    expect(text).toMatch(/share list \| add/);
    expect(text).toMatch(/Linux/);
  });

  it("reports a share error with code 1", async () => {
    expect(await runCli(["share", "add", "G", "relative"], deps)).toBe(1);
    expect(err.join("")).toMatch(/absolute/i);
  });

  it("reports usage for a bare `share` with code 0", async () => {
    expect(await runCli(["share"], deps)).toBe(0);
    expect(out.join("")).toMatch(/share add <group> <path>/);
  });
});

describe("parsePairArgs", () => {
  it("reads a separated value", () => {
    expect(parsePairArgs(["--name", "M4"])).toEqual({ name: "M4" });
  });

  it("reads an inline value", () => {
    expect(parsePairArgs(["--name=M4"])).toEqual({ name: "M4" });
  });

  it("ignores a missing or flag-shaped value", () => {
    expect(parsePairArgs(["--name"])).toEqual({});
    expect(parsePairArgs(["--name", "--verbose"])).toEqual({});
  });

  it("ignores unrelated arguments", () => {
    expect(parsePairArgs([])).toEqual({});
    expect(parsePairArgs(["extra"])).toEqual({});
  });
});

describe("defaultServerName", () => {
  it("drops the .local suffix", () => {
    expect(defaultServerName("m4.local")).toBe("m4");
    expect(defaultServerName("m4.local.")).toBe("m4");
    expect(defaultServerName("m4.LOCAL")).toBe("m4");
  });

  it("keeps a name without the suffix", () => {
    expect(defaultServerName("xiezhaoye-MacBook-Pro")).toBe("xiezhaoye-MacBook-Pro");
    expect(defaultServerName(" m4.local ")).toBe("m4");
  });

  it("does not strip .local from the middle of a name", () => {
    expect(defaultServerName("local.box")).toBe("local.box");
  });

  it("falls back to the raw text when stripping would empty it", () => {
    expect(defaultServerName(".local")).toBe(".local");
  });
});
