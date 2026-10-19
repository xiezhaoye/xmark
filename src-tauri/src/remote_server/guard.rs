//! Which hosts a remote-server command may talk to.
//!
//! Purpose: the host arrives from a pasted pairing link, so the connection
//! target is user-supplied. Left unchecked, the desktop would proxy a request
//! to whatever this machine can reach — the classic SSRF gadget, pointed by a
//! link someone else printed.
//!
//! Allowed, and nothing else:
//!   - an IPv4 address inside Tailscale's CGNAT range `100.64.0.0/10`;
//!   - a host name ending in `.ts.net` (Tailscale's MagicDNS domain);
//!   - `localhost` / `127.0.0.1` — local development and the tests. Loopback
//!     cannot reach another machine, so it adds no SSRF surface.
//!
//! An IPv6 address is refused outright rather than guessed at: the server binds
//! the Tailscale IPv4 only, and `100.64.0.0/10` has no IPv6 spelling.
//!
//! @coordinates-with server/mobile/src/runtime.ts — the server binds the same range
//! @module remote_server/guard

use crate::command_error::{CommandError, ErrorCode};

/// `100.64.0.0/10`: 100.64.0.0 – 100.127.255.255.
const TAILSCALE_FIRST: u32 = 0x6440_0000;
const TAILSCALE_LAST: u32 = 0x647f_ffff;

const LOOPBACK_HOSTS: [&str; 2] = ["localhost", "127.0.0.1"];

/// True for a host name the client may dial. Case-insensitive; a single
/// trailing dot (`m4.tailc8e51.ts.net.`) is ignored, as DNS does.
pub(crate) fn is_allowed_host(host: &str) -> bool {
    let name = host.trim().to_ascii_lowercase();
    let name = name.strip_suffix('.').unwrap_or(&name);
    if name.is_empty() {
        return false;
    }
    if LOOPBACK_HOSTS.contains(&name) {
        return true;
    }
    if let Ok(addr) = name.parse::<std::net::Ipv4Addr>() {
        let n = u32::from(addr);
        return (TAILSCALE_FIRST..=TAILSCALE_LAST).contains(&n);
    }
    name.ends_with(".ts.net")
}

/// Accept `host`, or refuse with the one message the frontend renders.
///
/// The message names the RULE ("Tailscale"), never the address the caller sent:
/// echoing input back is how a pasted token ends up in a dialog.
pub(crate) fn check_host(host: &str) -> Result<String, CommandError> {
    if is_allowed_host(host) {
        return Ok(host.trim().to_ascii_lowercase().trim_end_matches('.').to_string());
    }
    Err(CommandError::new(
        ErrorCode::PermissionDenied,
        "remote server host is not on Tailscale (allowed: a 100.64.0.0/10 address, a *.ts.net name, or localhost)",
    )
    .with_i18n_key("errors.remoteServer.hostRejected"))
}

#[cfg(test)]
mod tests {
    use super::is_allowed_host;

    #[test]
    fn tailscale_ipv4_range_is_allowed() {
        assert!(is_allowed_host("100.64.0.1"));
        assert!(is_allowed_host("100.101.7.42"));
        assert!(is_allowed_host("100.127.255.255"));
    }

    #[test]
    fn addresses_outside_the_range_are_refused() {
        assert!(!is_allowed_host("100.63.255.255"));
        assert!(!is_allowed_host("100.128.0.1"));
        assert!(!is_allowed_host("192.168.1.10"));
        assert!(!is_allowed_host("10.0.0.1"));
        assert!(!is_allowed_host("8.8.8.8"));
        assert!(!is_allowed_host("0.0.0.0"));
    }

    #[test]
    fn ts_net_names_are_allowed_case_insensitively() {
        assert!(is_allowed_host("m4.tailc8e51.ts.net"));
        assert!(is_allowed_host("M4.TailC8e51.TS.NET"));
        assert!(is_allowed_host("m4.tailc8e51.ts.net."));
    }

    #[test]
    fn near_misses_on_the_domain_are_refused() {
        assert!(!is_allowed_host("ts.net"));
        assert!(!is_allowed_host("evil-ts.net"));
        assert!(!is_allowed_host("m4.ts.net.evil.com"));
        assert!(!is_allowed_host("m4.tailc8e51.ts.net@evil.com"));
    }

    #[test]
    fn loopback_is_allowed_and_empty_is_not() {
        assert!(is_allowed_host("localhost"));
        assert!(is_allowed_host("127.0.0.1"));
        assert!(!is_allowed_host(""));
        assert!(!is_allowed_host("   "));
    }

    #[test]
    fn ipv6_is_refused() {
        assert!(!is_allowed_host("::1"));
        assert!(!is_allowed_host("[fd7a:115c:a1e0::1]"));
    }
}
