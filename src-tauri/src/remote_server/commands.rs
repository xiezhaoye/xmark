//! The `#[tauri::command]` surface for a read-only remote mobile server.
//!
//! Every command takes the connection (`host`, `port`, `token`) because the
//! desktop holds no server session: the window's current-server state is the
//! frontend's, and one window may be on "this Mac" while another browses the
//! tailnet. Commands are thin — destination check, request, decode — so the
//! protocol lives in one place per route (`transport`, `types`).
//!
//! Nothing here writes: every route is a `GET`, and the server behind it is
//! read-only too.

use crate::command_error::{CommandError, ErrorCode};

use super::transport::{target, Target, REQUEST_TIMEOUT};
use super::types::{
    AssetReply, FileReply, HealthReply, RemoteConnection, TreeReply, WorkspacesReply,
    MAX_ASSET_BYTES, MAX_TEXT_BYTES,
};

/// A JSON answer is capped well under the text bound: the tree and the group
/// list are listings, and a listing larger than this is a server bug.
const MAX_JSON_BYTES: usize = 8 * 1024 * 1024;

fn require_token(conn: &RemoteConnection) -> Result<&str, CommandError> {
    if conn.token.trim().is_empty() {
        return Err(CommandError::invalid_input("remote server token is missing")
            .with_i18n_key("errors.remoteServer.badAddress"));
    }
    Ok(conn.token.as_str())
}

/// The path query, percent-encoded by `reqwest`'s `query`.
fn path_query(root: &str, path: &str) -> Vec<(&'static str, String)> {
    vec![("root", root.to_string()), ("path", path.to_string())]
}

/// `GET /api/health` — the pairing check. Success means the token was accepted.
#[tauri::command]
pub async fn remote_health(conn: RemoteConnection) -> Result<HealthReply, CommandError> {
    let token = require_token(&conn)?;
    let t = target(&conn)?;
    let reply: HealthReply = t.get_json("/api/health", &[], token, 64 * 1024).await?;
    if !reply.ok {
        return Err(CommandError::network("/api/health answered ok=false")
            .with_i18n_key("errors.remoteServer.network"));
    }
    Ok(reply)
}

/// `GET /api/workspaces` — the groups and their folders (`rootId`, no paths).
#[tauri::command]
pub async fn remote_workspaces(conn: RemoteConnection) -> Result<WorkspacesReply, CommandError> {
    let token = require_token(&conn)?;
    let t = target(&conn)?;
    t.get_json("/api/workspaces", &[], token, MAX_JSON_BYTES).await
}

/// `GET /api/tree` — ONE level, so the explorer loads a folder when it opens.
#[tauri::command]
pub async fn remote_tree(
    conn: RemoteConnection,
    root_id: String,
    path: String,
) -> Result<TreeReply, CommandError> {
    let token = require_token(&conn)?;
    let t = target(&conn)?;
    t.get_json("/api/tree", &path_query(&root_id, &path), token, MAX_JSON_BYTES)
        .await
}

/// `GET /api/file` — UTF-8 text up to the server's 5 MB bound.
#[tauri::command]
pub async fn remote_file(
    conn: RemoteConnection,
    root_id: String,
    path: String,
) -> Result<FileReply, CommandError> {
    let token = require_token(&conn)?;
    let t = target(&conn)?;
    let reply: FileReply = t
        .get_json("/api/file", &path_query(&root_id, &path), token, MAX_TEXT_BYTES)
        .await?;
    if reply.text.len() > MAX_TEXT_BYTES {
        return Err(too_large(MAX_TEXT_BYTES));
    }
    Ok(reply)
}

/// `GET /api/asset` — image bytes up to the server's 30 MB bound.
#[tauri::command]
pub async fn remote_asset(
    conn: RemoteConnection,
    root_id: String,
    path: String,
) -> Result<AssetReply, CommandError> {
    let token = require_token(&conn)?;
    let t = target(&conn)?;
    let (content_type, bytes, etag) = t
        .get_bytes("/api/asset", &path_query(&root_id, &path), token, MAX_ASSET_BYTES)
        .await?;
    Ok(AssetReply { content_type, bytes, etag })
}

fn too_large(limit: usize) -> CommandError {
    CommandError::new(ErrorCode::InvalidInput, "remote file is larger than the allowed limit")
        .with_i18n_key("errors.remoteServer.tooLarge")
        .with_detail(serde_json::json!({ "limit": limit }))
}

/// The whole-exchange budget, re-exported for the tests that assert it.
#[allow(dead_code)]
pub(crate) const TIMEOUT_FOR_TESTS: std::time::Duration = REQUEST_TIMEOUT;

#[allow(dead_code)]
fn _assert_target_type(_t: &Target) {}
