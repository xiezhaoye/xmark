//! Shapes crossing the remote-server IPC boundary, and the size caps.
//!
//! These mirror `mobile/src/api/types.ts` and `server/mobile/src/routes/*`:
//! `serde(rename_all = "camelCase")` on every struct, because the frontend reads
//! the same field names the phone app reads from the server's JSON.

use serde::{Deserialize, Serialize};

/// Text documents above this are refused — the server's own `/api/file` bound.
pub(crate) const MAX_TEXT_BYTES: usize = 5 * 1024 * 1024;
/// Images above this are refused — the server's own `/api/asset` bound.
pub(crate) const MAX_ASSET_BYTES: usize = 30 * 1024 * 1024;

/// The connection every command takes: the token is the pairing token.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteConnection {
    pub host: String,
    pub port: u16,
    pub token: String,
}

/// `/api/health`.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthReply {
    pub ok: bool,
    #[serde(default)]
    pub version: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFolder {
    pub root_id: String,
    pub name: String,
    #[serde(default)]
    pub available: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceGroup {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub folders: Vec<WorkspaceFolder>,
}

/// `/api/workspaces`.
#[derive(Debug, Serialize, Deserialize)]
pub struct WorkspacesReply {
    pub groups: Vec<WorkspaceGroup>,
}

/// One directory level (`/api/tree`). `kind` stays a string: the server may
/// add a kind this build does not know, and the tree should still list it.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeEntry {
    pub name: String,
    pub kind: String,
    pub rel_path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mtime: Option<i64>,
}

/// `/api/tree`.
#[derive(Debug, Serialize, Deserialize)]
pub struct TreeReply {
    pub path: String,
    pub entries: Vec<TreeEntry>,
}

/// `/api/file`.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileReply {
    pub text: String,
    pub kind: String,
    pub size: u64,
    pub mtime: i64,
}

/// `/api/asset`: the image bytes, its media type and the two cache facts the
/// frontend needs to build a blob URL.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetReply {
    pub content_type: String,
    pub bytes: Vec<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub etag: Option<String>,
}
