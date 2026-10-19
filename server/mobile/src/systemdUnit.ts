/**
 * The systemd user service that keeps the server running on Linux.
 *
 * Installed to `~/.config/systemd/user/<SYSTEMD_UNIT_NAME>` by
 * `install-agent`. A user unit (not a system one) runs as the logged-in
 * user, which is what reading the user's folders requires; it survives
 * crashes and, with lingering enabled, logout.
 *
 * @module systemdUnit
 */

export const SYSTEMD_UNIT_NAME = "xmark-mobile-server.service";

export interface SystemdUnitOptions {
  nodePath: string;
  cliPath: string;
  pathEnv: string;
}

/**
 * Quote one word for systemd's ExecStart parsing.
 *
 * systemd splits a command line on whitespace, honours single and double
 * quotes, and reads `%` as a specifier and `$` as a variable reference. A
 * plain word therefore only needs quotes when it is empty or holds
 * whitespace, a quote, a backslash or a specifier/variable sigil. Inside
 * double quotes `\` and `"` are escapes, while `$` and `%` are passed through
 * literally — so the quoting is valid whether or not the word matches a
 * known specifier, unlike the backslash escape, which systemd rejects when
 * the sequence is not special.
 */
export function quoteSystemdWord(word: string): string {
  if (word !== "" && !/[\s"'\\$%]/.test(word)) return word;
  const body = word.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${body}"`;
}

/** Quote an `Environment=` value; systemd unquotes whitespace and escapes here too. */
function quoteEnvironmentValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function buildSystemdUnit({ nodePath, cliPath, pathEnv }: SystemdUnitOptions): string {
  const execStart = [nodePath, cliPath, "serve"].map(quoteSystemdWord).join(" ");
  return `[Unit]
Description=XMark mobile server
After=network-online.target tailscaled.service

[Service]
ExecStart=${execStart}
Restart=always
RestartSec=10
Environment=${quoteEnvironmentValue(`PATH=${pathEnv}`)}

[Install]
WantedBy=default.target
`;
}
