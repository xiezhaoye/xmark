//! Error wording for the remote-server commands.
//!
//! Every user-facing failure carries an `errors.remoteServer.*` key (all ten
//! `src-tauri/locales/*.yml`) so the message renders in the app's language
//! rather than as English prose. This file only documents the vocabulary; the
//! constructors live beside the code that knows the fact (`guard.rs` for the
//! destination, `transport.rs` for the exchange).
//!
//! Keys, and when each is returned:
//!   - `errors.remoteServer.hostRejected` — the host is not on Tailscale.
//!   - `errors.remoteServer.badAddress`  — port out of range, token empty.
//!   - `errors.remoteServer.network`     — no answer (refused, DNS, TLS).
//!   - `errors.remoteServer.timeout`     — the 15 s budget elapsed.
//!   - `errors.remoteServer.unauthorized` — the server refused the token.
//!   - `errors.remoteServer.http`        — any other non-2xx answer.
//!   - `errors.remoteServer.tooLarge`    — the answer exceeded the route's cap.
//!
//! The token is never interpolated into any of them, and no key takes it as a
//! placeholder.
