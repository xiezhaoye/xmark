//! Read-only client for a `xmark-mobile-server` on the user's tailnet.
//!
//! Purpose: the desktop half of the mobile reader's protocol. A desktop window
//! can point at another Mac's mobile server and browse its workspace groups,
//! tree and documents — READ-ONLY, over `GET`, with a bearer token. The
//! protocol (routes, payload shapes, sizes) is the one `server/mobile/src`
//! already serves to the iPhone app; this module is the Rust twin of
//! `mobile/src/api/client.ts`, not a second protocol.
//!
//! Key decisions:
//!   - **Requests go through Rust, not `fetch`.** The webview's CSP forbids
//!     reaching an external origin, so every call is a `#[tauri::command]`.
//!   - **One guard for every destination** (`guard`): only Tailscale addresses
//!     (`100.64.0.0/10`) and `.ts.net` names, plus loopback for local
//!     development and the tests. The host comes from a user-pasted pairing
//!     link, so an unchecked client here would be an SSRF gadget pointed at
//!     whatever the machine can reach.
//!   - **The token never leaves the request.** It is a header and nothing else:
//!     no URL, no log line, no error message (see `error::failure`).
//!   - **Redirections are refused, not followed.** A 3xx is a refusal whose
//!     `Location` is never visited — the destination would bypass the guard.
//!   - **Bodies are capped as they are read** (`transport::read_capped`), so a
//!     hostile or broken server cannot make the desktop allocate without a
//!     bound: text is the server's own 5 MB, images its 30 MB.
//!
//! @coordinates-with server/mobile/src/routes — the protocol these commands mirror
//! @coordinates-with services/remoteServers — the frontend client and pairing
//! @module remote_server

pub mod commands;
mod error;
mod guard;
mod transport;
mod types;

#[cfg(test)]
#[path = "tests.rs"]
mod tests;
