import { describe, expect, it, vi } from "vitest";
import { findTailscaleIPv4, findTailscaleDnsName, waitForTailscaleIPv4, type RunCommand } from "./tailscale";

const runner = (outputs: Record<string, string | Error>): RunCommand =>
  vi.fn(async (cmd: string, args: string[]) => {
    const key = `${cmd} ${args.join(" ")}`;
    const out = outputs[key];
    if (out === undefined || out instanceof Error) throw out ?? new Error(`ENOENT ${key}`);
    return out;
  });

describe("findTailscaleIPv4", () => {
  it("returns the CGNAT address from the first working binary", async () => {
    const run = runner({ "/Applications/Tailscale.app/Contents/MacOS/Tailscale ip -4": "100.66.175.80\n" });
    expect(await findTailscaleIPv4(run)).toBe("100.66.175.80");
  });

  it("ignores addresses outside 100.64.0.0/10", async () => {
    const run = runner({ "tailscale ip -4": "192.168.1.5\n100.128.0.1\n" });
    expect(await findTailscaleIPv4(run)).toBeNull();
  });

  it.each([["100.64.0.1"], ["100.127.255.254"]])("accepts the range edge %s", async (ip) => {
    expect(await findTailscaleIPv4(runner({ "tailscale ip -4": `${ip}\n` }))).toBe(ip);
  });

  it("returns null when Tailscale is not running or not installed", async () => {
    expect(await findTailscaleIPv4(runner({}))).toBeNull();
  });
});

describe("findTailscaleDnsName", () => {
  it("reads the MagicDNS name without the trailing dot", async () => {
    const run = runner({ "tailscale status --json": JSON.stringify({ Self: { DNSName: "m4.tailc8e51.ts.net." } }) });
    expect(await findTailscaleDnsName(run)).toBe("m4.tailc8e51.ts.net");
  });

  it("returns null on garbage or a missing name", async () => {
    expect(await findTailscaleDnsName(runner({ "tailscale status --json": "nope" }))).toBeNull();
    expect(await findTailscaleDnsName(runner({ "tailscale status --json": "{}" }))).toBeNull();
  });
});

describe("waitForTailscaleIPv4", () => {
  it("retries until an address appears, logging once", async () => {
    let calls = 0;
    const run: RunCommand = async () => (++calls < 3 ? "" : "100.64.0.9\n");
    const sleep = vi.fn(async () => {});
    const log = vi.fn();
    expect(await waitForTailscaleIPv4(run, { sleep, log, retryMs: 10 })).toBe("100.64.0.9");
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledTimes(1);
  });
});
