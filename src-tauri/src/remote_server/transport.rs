//! One HTTP exchange with a remote mobile server, and how failures read.
//!
//! Key decisions:
//!   - **No redirects.** `redirect::Policy::none()`: a 3xx is a refusal, and the
//!     `Location` it carries is never visited — following it would leave the
//!     `guard`'s allowed destination behind.
//!   - **15 s for the whole exchange**, which is the phone client's timeout, so
//!     the two surfaces give up at the same moment.
//!   - **Bodies are capped while reading** (`read_capped`), never after: a
//!     server that streams forever must not grow the desktop's heap.
//!   - **The URL is only ever built from the guarded host**, and the token is
//!     only ever a header, so no error text can contain either.
//!   - **No proxy, ever** (`no_proxy()`). The allowed destinations are Tailscale
//!     and loopback: a system/HTTP_PROXY/PAC proxy cannot reach those and would
//!     either fail (`502`) or be handed the token. This is the one place a
//!     client for the remote server is built.
//!
//! @coordinates-with guard.rs — the destination check that runs first
//! @module remote_server/transport

use std::time::Duration;

use crate::command_error::{CommandError, ErrorCode};

use super::guard::check_host;
use super::types::RemoteConnection;

/// Whole-exchange deadline (connect + response + body).
pub(crate) const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);

/// A validated destination plus a client that will not follow a redirect.
pub(crate) struct Target {
    host: String,
    port: u16,
    http: reqwest::Client,
}

/// Resolve `conn` into a `Target`, or refuse an off-Tailscale host.
pub(crate) fn target(conn: &RemoteConnection) -> Result<Target, CommandError> {
    if conn.port == 0 {
        return Err(CommandError::invalid_input("remote server port must be 1-65535")
            .with_i18n_key("errors.remoteServer.badAddress"));
    }
    let host = check_host(&conn.host)?;
    let http = reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .redirect(reqwest::redirect::Policy::none())
        // Never a proxy. The guard limits the destination to Tailscale and
        // loopback, which a proxy cannot route to — it answers 502 for them —
        // and handing it the bearer token is a leak with no upside. `no_proxy()`
        // disables the system settings, `HTTP(S)_PROXY`/`ALL_PROXY` and PAC for
        // this client, whatever the environment says.
        .no_proxy()
        .build()
        .map_err(|e| CommandError::internal(format!("could not build HTTP client: {e}")))?;
    Ok(Target { host, port: conn.port, http })
}

impl Target {
    fn base(&self) -> String {
        format!("http://{}:{}", self.host, self.port)
    }

    /// `base + route(?query)`, percent-encoded by `form_urlencoded` (through
    /// `serde_urlencoded`'s own serializer is overkill for two strings).
    fn url(&self, route: &str, query: &[(&str, String)]) -> String {
        let base = format!("{}{route}", self.base());
        if query.is_empty() {
            return base;
        }
        let encoded = query
            .iter()
            .map(|(k, v)| format!("{}={}", encode(k), encode(v)))
            .collect::<Vec<_>>()
            .join("&");
        format!("{base}?{encoded}")
    }

    /// `GET <route>?<query>` with the bearer token, 2xx required, body capped.
    pub(crate) async fn get(
        &self,
        route: &str,
        query: &[(&str, String)],
        token: &str,
        cap: usize,
    ) -> Result<Vec<u8>, CommandError> {
        let url = self.url(route, query);
        let resp = self
            .http
            .get(url)
            .bearer_auth(token)
            // Named per call so the message says WHAT failed without the URL.
            .header("Accept", "application/json, */*")
            .send()
            .await
            .map_err(|e| failure(route, e))?;
        let status = resp.status();
        if !status.is_success() {
            let body = read_capped(resp, 64 * 1024).await.unwrap_or_default();
            return Err(refusal(route, status.as_u16(), &String::from_utf8_lossy(&body)));
        }
        read_capped(resp, cap)
            .await
            .map_err(|_| CommandError::new(ErrorCode::InvalidInput, format!("{route} answer is larger than the allowed limit"))
                .with_i18n_key("errors.remoteServer.tooLarge")
                .with_detail(serde_json::json!({ "limit": cap })))
    }

    /// `GET <route>` and decode the JSON body.
    pub(crate) async fn get_json<T: serde::de::DeserializeOwned>(
        &self,
        route: &str,
        query: &[(&str, String)],
        token: &str,
        cap: usize,
    ) -> Result<T, CommandError> {
        let bytes = self.get(route, query, token, cap).await?;
        serde_json::from_slice::<T>(&bytes).map_err(|e| {
            CommandError::internal(format!("{route} answer was not the expected JSON: {e}"))
        })
    }

    /// `GET <route>` returning bytes and the response's content type.
    pub(crate) async fn get_bytes(
        &self,
        route: &str,
        query: &[(&str, String)],
        token: &str,
        cap: usize,
    ) -> Result<(String, Vec<u8>, Option<String>), CommandError> {
        let resp = self
            .http
            .get(self.url(route, query))
            .bearer_auth(token)
            .send()
            .await
            .map_err(|e| failure(route, e))?;
        let status = resp.status();
        if !status.is_success() {
            let body = read_capped(resp, 64 * 1024).await.unwrap_or_default();
            return Err(refusal(route, status.as_u16(), &String::from_utf8_lossy(&body)));
        }
        let content_type = resp
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("application/octet-stream")
            .to_string();
        let etag = resp
            .headers()
            .get(reqwest::header::ETAG)
            .and_then(|v| v.to_str().ok())
            .map(str::to_string);
        let bytes = read_capped(resp, cap)
            .await
            .map_err(|_| CommandError::new(ErrorCode::InvalidInput, format!("{route} answer is larger than the allowed limit"))
                .with_i18n_key("errors.remoteServer.tooLarge")
                .with_detail(serde_json::json!({ "limit": cap })))?;
        Ok((content_type, bytes, etag))
    }
}

/// The subset of `application/x-www-form-urlencoded` a QUERY needs:
/// everything outside the unreserved set is percent-encoded, and a space is
/// `+` (which every server decodes as a space). Percent-encoding is what keeps
/// a CJK path — or a `&` in a folder name — inside its own parameter.
fn encode(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                out.push(*byte as char)
            }
            b' ' => out.push('+'),
            other => out.push_str(&format!("%{other:02X}")),
        }
    }
    out
}

/// Drain `resp` into a buffer, refusing once it yields more than `cap` bytes.
///
/// Reads chunk by chunk rather than through `Content-Length`: a lying or
/// chunked answer must be stopped by the bytes actually received.
async fn read_capped(mut resp: reqwest::Response, cap: usize) -> Result<Vec<u8>, ()> {
    let mut body: Vec<u8> = Vec::new();
    loop {
        match resp.chunk().await {
            Ok(Some(chunk)) => {
                if body.len() + chunk.len() > cap {
                    return Err(());
                }
                body.extend_from_slice(&chunk);
            }
            Ok(None) => return Ok(body),
            Err(_) => return Err(()),
        }
    }
}

/// A request that got no answer. `timeout` when the deadline elapsed, `network`
/// otherwise. `without_url` keeps the address (and anything a future caller
/// puts in a query) out of the message.
fn failure(route: &str, e: reqwest::Error) -> CommandError {
    let timed_out = e.is_timeout();
    let code = if timed_out { ErrorCode::Timeout } else { ErrorCode::Network };
    CommandError::new(code, format!("{route} request failed: {}", e.without_url())).with_i18n_key(
        if timed_out {
            "errors.remoteServer.timeout"
        } else {
            "errors.remoteServer.network"
        },
    )
}

/// A non-2xx answer. 401 keeps its own code so the UI can say "token rejected"
/// rather than "cannot connect"; the server's own `{"error": …}` code rides in
/// `detail.remoteError` for the same reason the phone branches on it.
///
/// The body is echoed only when it is a SHORT JSON error document — never a
/// page of HTML — and the message never repeats the request.
pub(crate) fn refusal(route: &str, status: u16, body: &str) -> CommandError {
    let remote = serde_json::from_str::<serde_json::Value>(body.trim())
        .ok()
        .and_then(|v| v.get("error").and_then(|e| e.as_str()).map(str::to_string));
    let code = if status == 401 { ErrorCode::Unauthorized } else { ErrorCode::Network };
    let key = if status == 401 {
        "errors.remoteServer.unauthorized"
    } else {
        "errors.remoteServer.http"
    };
    CommandError::new(
        code,
        match &remote {
            Some(name) => format!("{route} failed ({status}): {name}"),
            None => format!("{route} failed ({status})"),
        },
    )
    .with_i18n_key(key)
    .with_detail(serde_json::json!({ "status": status, "remoteError": remote }))
}
