import { describe, expect, it } from "vitest";
import { buildLaunchAgentPlist, LAUNCH_AGENT_LABEL } from "./launchAgent";

describe("buildLaunchAgentPlist", () => {
  const plist = buildLaunchAgentPlist({
    nodePath: "/Users/me/.local/node24/bin/node",
    cliPath: "/Users/me/x & y/dist/cli.js",
    logPath: "/Users/me/Library/Logs/xmark-mobile-server.log",
    pathEnv: "/usr/local/bin:/usr/bin:/bin",
  });

  it("runs `node cli.js serve` at load and keeps it alive", () => {
    expect(plist).toContain(`<string>${LAUNCH_AGENT_LABEL}</string>`);
    expect(plist).toMatch(/<key>RunAtLoad<\/key>\s*<true\/>/);
    expect(plist).toMatch(/<key>KeepAlive<\/key>\s*<true\/>/);
    expect(plist).toContain("<string>/Users/me/.local/node24/bin/node</string>");
    expect(plist).toContain("<string>serve</string>");
  });

  it("XML-escapes paths", () => {
    expect(plist).toContain("/Users/me/x &amp; y/dist/cli.js");
    expect(plist).not.toContain("x & y");
  });

  it("logs both streams to the log file and sets PATH", () => {
    expect(plist.match(/xmark-mobile-server\.log/g)).toHaveLength(2);
    expect(plist).toContain("<string>/usr/local/bin:/usr/bin:/bin</string>");
  });
});
