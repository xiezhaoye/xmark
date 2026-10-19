import { describe, expect, it } from "vitest";
import { buildSystemdUnit, quoteSystemdWord, SYSTEMD_UNIT_NAME } from "./systemdUnit";

describe("SYSTEMD_UNIT_NAME", () => {
  it("is the service file name systemctl is given", () => {
    expect(SYSTEMD_UNIT_NAME).toBe("xmark-mobile-server.service");
  });
});

describe("buildSystemdUnit", () => {
  const unit = buildSystemdUnit({
    nodePath: "/home/me/.local/node24/bin/node",
    cliPath: "/home/me/xmark/server/mobile/dist/cli.js",
    pathEnv: "/usr/local/bin:/usr/bin:/bin",
  });

  it("runs `node cli.js serve`", () => {
    expect(unit).toContain("ExecStart=/home/me/.local/node24/bin/node /home/me/xmark/server/mobile/dist/cli.js serve");
  });

  it("starts after the network and tailscaled, and is wanted by default.target", () => {
    expect(unit).toMatch(/^\[Unit\]$/m);
    expect(unit).toContain("After=network-online.target tailscaled.service");
    expect(unit).toMatch(/^\[Install\]$/m);
    expect(unit).toContain("WantedBy=default.target");
  });

  it("restarts on failure after 10 seconds", () => {
    expect(unit).toContain("Restart=always");
    expect(unit).toContain("RestartSec=10");
  });

  it("passes PATH, so the service can find tailscale", () => {
    expect(unit).toContain('Environment="PATH=/usr/local/bin:/usr/bin:/bin"');
  });

  it("ends with a newline and has one section per header", () => {
    expect(unit.endsWith("\n")).toBe(true);
    expect(unit.match(/^\[Unit\]$/gm)).toHaveLength(1);
    expect(unit.match(/^\[Service\]$/gm)).toHaveLength(1);
    expect(unit.match(/^\[Install\]$/gm)).toHaveLength(1);
  });
});

describe("buildSystemdUnit quoting", () => {
  it("quotes and escapes a path with spaces and quotes", () => {
    const unit = buildSystemdUnit({
      nodePath: "/opt/my node/bin/node",
      cliPath: '/home/me/a "quoted" dir/cli.js',
      pathEnv: "/opt/my bin:/usr/bin",
    });
    expect(unit).toContain('ExecStart="/opt/my node/bin/node" "/home/me/a \\"quoted\\" dir/cli.js" serve');
    // The `serve` argument itself needs no quoting, and neither does a plain word.
    expect(unit).toContain('cli.js" serve\n');
    expect(unit).toContain('Environment="PATH=/opt/my bin:/usr/bin"');
  });

  it("escapes a backslash inside the quotes", () => {
    const unit = buildSystemdUnit({ nodePath: "/opt/a\\b/node", cliPath: "/opt/cli.js", pathEnv: "/usr/bin" });
    expect(unit).toContain('ExecStart="/opt/a\\\\b/node" /opt/cli.js serve');
  });

  it("quotes a specifier or variable sigil so systemd does not expand it", () => {
    const unit = buildSystemdUnit({ nodePath: "/opt/%h/node", cliPath: "/opt/$HOME/cli.js", pathEnv: "/usr/bin" });
    expect(unit).toContain('ExecStart="/opt/%h/node" "/opt/$HOME/cli.js" serve');
  });

  it("quotes an empty word", () => {
    expect(quoteSystemdWord("")).toBe('""');
  });

  it("leaves a plain path alone", () => {
    expect(quoteSystemdWord("/usr/bin/node")).toBe("/usr/bin/node");
    expect(quoteSystemdWord("serve")).toBe("serve");
  });

  it("keeps Chinese characters unquoted — they are not whitespace", () => {
    expect(quoteSystemdWord("/home/me/文档/cli.js")).toBe("/home/me/文档/cli.js");
  });
});
