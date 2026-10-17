//! The desktop → mobile share file.
//!
//! Purpose: publish the workspace groups to
//! `<app data dir>/mobile-share.json`, which the standalone mobile server
//! (`server/mobile`) reads to decide which folders the iPhone reader may
//! browse. Groups live in WebView localStorage, which no other process can
//! read reliably, so the frontend pushes them here whenever they change.
//!
//! The shape is versioned and owned here (`render_share`); the server's
//! parser is `server/mobile/src/shareFile.ts`. Relative or empty folder paths
//! are dropped, and a write that would not change the file is skipped so the
//! server's mtime-driven reload only fires on real edits.
//!
//! @coordinates-with server/mobile/src/shareFile.ts — the parser on the other side
//! @module mobile_share

use std::path::Path;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::atomic_replace::atomic_replace;
use crate::command_error::CommandError;

pub(crate) const SHARE_FILE_NAME: &str = "mobile-share.json";
const SHARE_FILE_VERSION: u32 = 1;

/// One workspace group as the frontend store holds it.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct MobileShareGroup {
    pub id: String,
    pub name: String,
    pub folders: Vec<String>,
}

#[derive(Serialize)]
struct ShareFile {
    version: u32,
    groups: Vec<MobileShareGroup>,
}

/// The exact bytes of the share file for `groups`.
pub(crate) fn render_share(groups: &[MobileShareGroup]) -> Vec<u8> {
    let groups = groups
        .iter()
        .map(|g| MobileShareGroup {
            id: g.id.clone(),
            name: g.name.clone(),
            folders: g
                .folders
                .iter()
                .filter(|f| !f.is_empty() && Path::new(f).is_absolute())
                .cloned()
                .collect(),
        })
        .collect();
    let file = ShareFile {
        version: SHARE_FILE_VERSION,
        groups,
    };
    let mut bytes = serde_json::to_vec_pretty(&file).unwrap_or_default();
    bytes.push(b'\n');
    bytes
}

/// Write the share file into `dir` (created if missing). Returns whether the
/// file changed.
pub(crate) fn write_share(dir: &Path, groups: &[MobileShareGroup]) -> Result<bool, CommandError> {
    std::fs::create_dir_all(dir)
        .map_err(|e| CommandError::from_io(&e, format!("{}: {e}", dir.display())))?;
    let target = dir.join(SHARE_FILE_NAME);
    let bytes = render_share(groups);
    if std::fs::read(&target).is_ok_and(|existing| existing == bytes) {
        return Ok(false);
    }
    atomic_replace(&target, dir, &bytes)?;
    Ok(true)
}

/// Frontend command: publish the current workspace groups for the mobile server.
#[tauri::command]
pub fn write_mobile_share(
    app: AppHandle,
    groups: Vec<MobileShareGroup>,
) -> Result<(), CommandError> {
    let dir = crate::app_paths::app_data_dir(&app)
        .map_err(CommandError::internal)?;
    write_share(&dir, &groups)?;
    Ok(())
}

#[cfg(test)]
#[path = "mobile_share.test.rs"]
mod tests;
