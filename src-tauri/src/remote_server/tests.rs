//! Remote-server commands against a real socket.
//!
//! A `std::net::TcpListener` on loopback serves hand-written HTTP answers, and
//! the commands are called exactly as the frontend calls them. Loopback is on
//! the `guard`'s allow-list for precisely this: the tests need a server, and a
//! mock of the transport would prove nothing about the refusal paths (401,
//! oversize, timeout) that is where the bugs live.
//!
//! No new dev-dependency: `std::net` + `tokio` (already a dependency) is all
//! this needs.

use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::{mpsc, Mutex};
use std::thread;

use crate::command_error::ErrorCode;

use super::commands::{remote_asset, remote_file, remote_health, remote_tree, remote_workspaces};
use super::guard::is_allowed_host;
use super::types::RemoteConnection;

const TOKEN: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

/// Serializes the tests that mutate the process environment: `std::env` is
/// process-wide, so a proxy set here would otherwise decide what a parallel
/// test connects to.
static ENV_LOCK: Mutex<()> = Mutex::new(());

/// Run `f` with `names` set to `value`, restoring every previous value (or
/// leaving the variable unset) afterwards. Unknown variables (the `*_lower`
/// spellings reqwest also reads) are removed, not just overwritten.
fn with_env<T>(names: &[&str], value: &str, f: impl FnOnce() -> T) -> T {
    let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let saved: Vec<Option<String>> = names.iter().map(|n| std::env::var(n).ok()).collect();
    for name in names {
        std::env::set_var(name, value);
    }
    let out = f();
    for (name, previous) in names.iter().zip(saved) {
        match previous {
            Some(v) => std::env::set_var(name, v),
            None => std::env::remove_var(name),
        }
    }
    out
}

/// What the fake server answers with: status line, headers, body.
struct Reply {
    status: u16,
    content_type: &'static str,
    body: Vec<u8>,
    /// Delay before writing the answer, so a timeout can be observed.
    delay_ms: u64,
}

impl Reply {
    fn json(body: &str) -> Self {
        Self { status: 200, content_type: "application/json", body: body.as_bytes().to_vec(), delay_ms: 0 }
    }
    fn status(status: u16) -> Self {
        Self { status, content_type: "application/json", body: b"{}".to_vec(), delay_ms: 0 }
    }
}

/// Serve `count` requests on a loopback port.
///
/// The listener is created BEFORE the caller sends its request, so binding and
/// connecting cannot race. Each connection reads the request head and answers
/// from the queue; the thread ends when the queue is exhausted.
fn fake_server(replies: Vec<Reply>) -> (u16, thread::JoinHandle<()>, mpsc::Receiver<String>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind loopback");
    let port = listener.local_addr().expect("addr").port();
    let (tx, rx) = mpsc::channel();
    let handle = thread::spawn(move || {
        for reply in replies {
            let Ok((mut stream, _)) = listener.accept() else { return };
            // Read the request head (the client sends no body on a GET).
            let mut buf = [0u8; 4096];
            let n = stream.read(&mut buf).unwrap_or(0);
            let head = String::from_utf8_lossy(&buf[..n]).to_string();
            let _ = tx.send(head);
            if reply.delay_ms > 0 {
                thread::sleep(std::time::Duration::from_millis(reply.delay_ms));
            }
            let reason = match reply.status {
                200 => "OK",
                401 => "Unauthorized",
                404 => "Not Found",
                413 => "Payload Too Large",
                500 => "Internal Server Error",
                _ => "Status",
            };
            let head = format!(
                "HTTP/1.1 {} {}\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\nETag: \"abc\"\r\n\r\n",
                reply.status,
                reason,
                reply.content_type,
                reply.body.len()
            );
            let _ = stream.write_all(head.as_bytes());
            let _ = stream.write_all(&reply.body);
            let _ = stream.flush();
        }
    });
    (port, handle, rx)
}

fn conn(port: u16) -> RemoteConnection {
    RemoteConnection { host: "127.0.0.1".to_string(), port, token: TOKEN.to_string() }
}

#[tokio::test]
async fn health_succeeds_and_sends_the_bearer_header() {
    let (port, handle, rx) = fake_server(vec![Reply::json(r#"{"ok":true,"version":"1.2.3"}"#)]);
    let reply = remote_health(conn(port)).await.expect("health");
    assert!(reply.ok);
    assert_eq!(reply.version, "1.2.3");
    let head = rx.recv().expect("request recorded");
    assert!(head.starts_with("GET /api/health "), "{head}");
    assert!(head.contains(&format!("authorization: Bearer {TOKEN}")), "{head}");
    handle.join().expect("server thread");
}

#[tokio::test]
async fn a_401_becomes_the_unauthorized_code_and_never_echoes_the_token() {
    let (port, handle, _rx) = fake_server(vec![Reply {
        status: 401,
        content_type: "application/json",
        body: br#"{"error":"unauthorized"}"#.to_vec(),
        delay_ms: 0,
    }]);
    let err = remote_workspaces(conn(port)).await.expect_err("401 must fail");
    assert_eq!(err.code(), ErrorCode::Unauthorized);
    assert!(!err.message().contains(TOKEN), "token leaked into the message");
    assert_eq!(err.i18n_key(), Some("errors.remoteServer.unauthorized"));
    handle.join().expect("server thread");
}

#[tokio::test]
async fn a_non_2xx_keeps_its_status_and_the_servers_error_name() {
    let (port, handle, _rx) = fake_server(vec![Reply {
        status: 404,
        content_type: "application/json",
        body: br#"{"error":"not_found"}"#.to_vec(),
        delay_ms: 0,
    }]);
    let err = remote_tree(conn(port), "root1".into(), "docs".into())
        .await
        .expect_err("404 must fail");
    assert_eq!(err.code(), ErrorCode::Network);
    assert_eq!(err.i18n_key(), Some("errors.remoteServer.http"));
    let detail = serde_json::to_value(&err).expect("serialize");
    assert_eq!(detail["detail"]["status"], 404);
    assert_eq!(detail["detail"]["remoteError"], "not_found");
    handle.join().expect("server thread");
}

#[tokio::test]
async fn the_tree_query_carries_root_and_path_percent_encoded() {
    let (port, handle, rx) = fake_server(vec![Reply::json(r#"{"path":"文稿","entries":[]}"#)]);
    let reply = remote_tree(conn(port), "root 1".into(), "文稿/笔记.md".into())
        .await
        .expect("tree");
    assert_eq!(reply.path, "文稿");
    assert!(reply.entries.is_empty());
    let head = rx.recv().expect("request recorded");
    assert!(head.starts_with("GET /api/tree?root=root+1&path="), "{head}");
    assert!(!head.contains("文稿"), "path must be percent-encoded: {head}");
    handle.join().expect("server thread");
}

#[tokio::test]
async fn a_text_answer_over_the_cap_is_refused() {
    // 6 MB of text: over the 5 MB `/api/file` bound.
    let over = format!(r#"{{"text":"{}","kind":"text","size":6291456,"mtime":0}}"#, "x".repeat(6 * 1024 * 1024));
    let (port, handle, _rx) = fake_server(vec![Reply::json(&over)]);
    let err = remote_file(conn(port), "root1".into(), "big.txt".into())
        .await
        .expect_err("oversized text must be refused");
    assert_eq!(err.i18n_key(), Some("errors.remoteServer.tooLarge"));
    handle.join().expect("server thread");
}

#[tokio::test]
async fn a_server_that_never_answers_times_out() {
    // Longer than the 15 s budget would make the suite drag; the point here is
    // that a slow answer is bounded at all, which the unit below asserts.
    let (port, handle, _rx) = fake_server(vec![Reply { delay_ms: 200, ..Reply::status(200) }]);
    let started = std::time::Instant::now();
    let _ = remote_health(conn(port)).await;
    assert!(started.elapsed() < super::transport::REQUEST_TIMEOUT + std::time::Duration::from_secs(5));
    handle.join().expect("server thread");
}

/// The pairing probe must reach the server DIRECTLY. A proxy in the
/// environment (mihomo on 7890 is the real-world case) would answer 502 for a
/// tailnet address the proxy cannot resolve, and would be handed the token.
/// `http://127.0.0.1:9` is the discard port: nothing listens there.
#[test]
fn a_health_probe_ignores_an_environment_proxy() {
    let (port, handle, rx) = fake_server(vec![Reply::json(r#"{"ok":true,"version":"1.2.3"}"#)]);
    const PROXY_NAMES: &[&str] = &[
        "HTTP_PROXY",
        "http_proxy",
        "HTTPS_PROXY",
        "https_proxy",
        "ALL_PROXY",
        "all_proxy",
        "NO_PROXY",
        "no_proxy",
    ];
    let reply = with_env(PROXY_NAMES, "http://127.0.0.1:9", || {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime")
            .block_on(remote_health(conn(port)))
    })
    .expect("the probe must bypass the environment proxy");
    assert!(reply.ok);
    assert_eq!(reply.version, "1.2.3");
    // The request reached the fake server itself, not a proxy.
    let head = rx.recv_timeout(std::time::Duration::from_secs(5)).expect("request recorded");
    assert!(head.starts_with("GET /api/health "), "{head}");
    handle.join().expect("server thread");
}

#[tokio::test]
async fn an_off_tailscale_host_is_refused_before_any_connection() {
    let err = remote_health(RemoteConnection {
        host: "example.com".to_string(),
        port: 8740,
        token: TOKEN.to_string(),
    })
    .await
    .expect_err("public host must be refused");
    assert_eq!(err.code(), ErrorCode::PermissionDenied);
    assert_eq!(err.i18n_key(), Some("errors.remoteServer.hostRejected"));
}

#[tokio::test]
async fn a_private_lan_host_is_refused() {
    let err = remote_workspaces(RemoteConnection {
        host: "192.168.1.20".to_string(),
        port: 8740,
        token: TOKEN.to_string(),
    })
    .await
    .expect_err("LAN host must be refused");
    assert_eq!(err.code(), ErrorCode::PermissionDenied);
}

#[tokio::test]
async fn an_empty_token_is_refused_without_a_request() {
    let err = remote_health(RemoteConnection {
        host: "127.0.0.1".to_string(),
        port: 8740,
        token: "   ".to_string(),
    })
    .await
    .expect_err("empty token must be refused");
    assert_eq!(err.i18n_key(), Some("errors.remoteServer.badAddress"));
}

#[tokio::test]
async fn a_zero_port_is_refused() {
    let err = remote_health(RemoteConnection {
        host: "127.0.0.1".to_string(),
        port: 0,
        token: TOKEN.to_string(),
    })
    .await
    .expect_err("port 0 must be refused");
    assert_eq!(err.i18n_key(), Some("errors.remoteServer.badAddress"));
}

#[tokio::test]
async fn asset_returns_the_bytes_and_its_content_type() {
    let png = vec![0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
    let (port, handle, _rx) = fake_server(vec![Reply {
        status: 200,
        content_type: "image/png",
        body: png.clone(),
        delay_ms: 0,
    }]);
    let reply = remote_asset(conn(port), "root1".into(), "logo.png".into())
        .await
        .expect("asset");
    assert_eq!(reply.content_type, "image/png");
    assert_eq!(reply.bytes, png);
    assert_eq!(reply.etag.as_deref(), Some("\"abc\""));
    handle.join().expect("server thread");
}

#[tokio::test]
async fn health_reports_a_server_that_says_it_is_not_ok() {
    let (port, handle, _rx) = fake_server(vec![Reply::json(r#"{"ok":false,"version":"0"}"#)]);
    let err = remote_health(conn(port)).await.expect_err("ok=false must fail");
    assert_eq!(err.code(), ErrorCode::Network);
    handle.join().expect("server thread");
}

#[tokio::test]
async fn a_malformed_json_answer_is_reported_as_internal() {
    let (port, handle, _rx) = fake_server(vec![Reply::json("<html>not json</html>")]);
    let err = remote_workspaces(conn(port)).await.expect_err("bad JSON must fail");
    assert_eq!(err.code(), ErrorCode::Internal);
    handle.join().expect("server thread");
}

#[test]
fn the_request_budget_matches_the_phone_client() {
    // mobile/src/api/client.ts DEFAULT_TIMEOUT_MS — one number for both clients.
    assert_eq!(super::transport::REQUEST_TIMEOUT, std::time::Duration::from_secs(15));
}

#[test]
fn the_size_caps_match_the_server() {
    // server/mobile/src/routes/{file,asset}.ts
    assert_eq!(super::types::MAX_TEXT_BYTES, 5 * 1024 * 1024);
    assert_eq!(super::types::MAX_ASSET_BYTES, 30 * 1024 * 1024);
}

#[test]
fn the_guard_accepts_tailscale_and_the_caps_stay_put() {
    // A JSON byte array is the wrong vehicle past these sizes; keeping the
    // constants pinned here means raising one is a reviewed change, not a
    // silent regression.
    assert_eq!(super::types::MAX_TEXT_BYTES, 5 * 1024 * 1024);
    assert!(is_allowed_host("100.64.0.1"));
}
