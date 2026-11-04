//! Folders the user picked on the phone, read through the system document
//! picker's security scope.
//!
//! iOS never hands out a usable plain path: a picked folder arrives as a
//! security-scoped URL whose access must be started, and only its bookmark
//! survives a relaunch. The Swift half owns the picker and the bookmark store
//! (see `ios/Sources/LocalFSPlugin.swift`); reading the bytes stays here,
//! because a started scope belongs to the PROCESS — `std::fs` sees the folder
//! exactly as Swift does.

use base64::Engine as _;
use serde::{ser::Serializer, Deserialize, Serialize};
#[cfg(target_os = "ios")]
use tauri::plugin::PluginHandle;
use tauri::{
    plugin::{Builder, TauriPlugin},
    AppHandle, Manager, Runtime,
};

/// Errors surfaced to the webview. The frontend localises these at the
/// boundary, so the codes must stay stable.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// `cancelled` is a user decision, not a failure: the frontend shows nothing.
    #[error("cancelled")]
    Cancelled,
    /// The path is not absolute, or walks out of itself with `..`.
    #[error("invalid path")]
    InvalidPath,
    /// Not a directory this app may read.
    #[error("not a folder")]
    NotAFolder,
    /// The file exceeds the per-read ceiling.
    #[error("file too large")]
    TooLarge,
    /// Not UTF-8, or unreadable.
    #[error("cannot read file")]
    Unreadable,
    /// Reading folders is only implemented for iOS today.
    #[error("unsupported on this platform")]
    Unsupported,
    #[cfg(target_os = "ios")]
    #[error(transparent)]
    PluginInvoke(#[from] tauri::plugin::mobile::PluginInvokeError),
}

impl Serialize for Error {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.to_string().as_ref())
    }
}

pub type Result<T> = std::result::Result<T, Error>;

/// Ceiling for a text read: the reader caps display well below this.
pub const MAX_TEXT_BYTES: u64 = 5 * 1024 * 1024;
/// Ceiling for an image read (the phone's own camera roll size).
pub const MAX_BYTES_BYTES: u64 = 30 * 1024 * 1024;

fn check_path(path: &str) -> Result<std::path::PathBuf> {
    let p = std::path::PathBuf::from(path);
    if !p.is_absolute() || p.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
        return Err(Error::InvalidPath);
    }
    Ok(p)
}

/// One entry of a listing, as the reader's tree wants it.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub rel_path: String,
    pub is_dir: bool,
    pub size: u64,
    pub mtime: u64,
}

/// Lists a folder the user granted. Iterative and shallow: the tree asks for
/// one level at a time, so a deep folder costs one `read_dir` per expansion.
pub fn list_dir(dir: &str) -> Result<Vec<DirEntry>> {
    let root = check_path(dir)?;
    if !root.is_dir() {
        return Err(Error::NotAFolder);
    }
    let read = std::fs::read_dir(&root).map_err(|_| Error::NotAFolder)?;
    let mut out = Vec::new();
    for item in read.flatten() {
        let path = item.path();
        let name = item.file_name().to_string_lossy().to_string();
        // Hidden files are the app's own business, not the reader's.
        if name.starts_with('.') {
            continue;
        }
        let meta = match item.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let mtime = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        out.push(DirEntry {
            name,
            rel_path: path.to_string_lossy().to_string(),
            is_dir: meta.is_dir(),
            size: meta.len(),
            mtime,
        });
    }
    out.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(out)
}

/// Reads a text file the user granted.
///
/// Plain `.txt` files on a phone are frequently NOT UTF-8 — Chinese ones are
/// often GBK. Refusing them would read as "the app cannot open my notes", so
/// the fallback chain is: UTF-8 exactly, then GB18030 (a superset of GBK), then
/// a lossy UTF-8 decode so something always renders.
pub fn read_text_impl(path: &str) -> Result<String> {
    let p = check_path(path)?;
    let size = std::fs::metadata(&p).map_err(|_| Error::Unreadable)?.len();
    if size > MAX_TEXT_BYTES {
        return Err(Error::TooLarge);
    }
    let bytes = std::fs::read(&p).map_err(|_| Error::Unreadable)?;
    if let Ok(text) = std::str::from_utf8(&bytes) {
        return Ok(text.to_string());
    }
    let (decoded, _, had_errors) = encoding_rs::GB18030.decode(&bytes);
    if !had_errors {
        return Ok(decoded.into_owned());
    }
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// Reads a file the user granted, base64-encoded for the webview.
pub fn read_bytes_impl(path: &str) -> Result<String> {
    let p = check_path(path)?;
    let size = std::fs::metadata(&p).map_err(|_| Error::Unreadable)?.len();
    if size > MAX_BYTES_BYTES {
        return Err(Error::TooLarge);
    }
    let bytes = std::fs::read(&p).map_err(|_| Error::Unreadable)?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

/// What the picker returns.
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PickedFolder {
    pub path: String,
    pub name: String,
}

#[derive(Debug, Deserialize)]
struct RestoreReply {
    folders: Vec<RestoredFolder>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoredFolder {
    pub path: String,
    pub name: String,
    pub ok: bool,
}

/// Access to the picker, through the Swift plugin.
pub struct LocalFs<R: Runtime> {
    #[cfg(target_os = "ios")]
    handle: PluginHandle<R>,
    #[cfg(not(target_os = "ios"))]
    _marker: std::marker::PhantomData<AppHandle<R>>,
}

impl<R: Runtime> LocalFs<R> {
    fn pick_folder(&self) -> Result<PickedFolder> {
        #[cfg(target_os = "ios")]
        {
            self.handle
                .run_mobile_plugin("pickFolder", serde_json::json!({}))
                .map_err(Error::from)
        }
        #[cfg(not(target_os = "ios"))]
        {
            Err(Error::Unsupported)
        }
    }

    fn restore_folders(&self) -> Result<Vec<RestoredFolder>> {
        #[cfg(target_os = "ios")]
        {
            let reply: RestoreReply = self
                .handle
                .run_mobile_plugin("restoreFolders", serde_json::json!({}))
                .map_err(Error::from)?;
            Ok(reply.folders)
        }
        #[cfg(not(target_os = "ios"))]
        {
            Ok(Vec::new())
        }
    }

    fn forget_folder(&self, path: &str) -> Result<()> {
        #[cfg(target_os = "ios")]
        {
            let _: serde_json::Value = self
                .handle
                .run_mobile_plugin("forgetFolder", serde_json::json!({ "path": path }))
                .map_err(Error::from)?;
            Ok(())
        }
        #[cfg(not(target_os = "ios"))]
        {
            let _ = path;
            Err(Error::Unsupported)
        }
    }
}

#[tauri::command]
async fn pick_folder<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, LocalFs<R>>,
) -> Result<PickedFolder> {
    state.pick_folder()
}

#[tauri::command]
async fn restore_folders<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, LocalFs<R>>,
) -> Result<Vec<RestoredFolder>> {
    state.restore_folders()
}

#[tauri::command]
async fn forget_folder<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, LocalFs<R>>,
    path: String,
) -> Result<()> {
    state.forget_folder(&path)
}

#[tauri::command]
async fn list_folder(dir: String) -> Result<Vec<DirEntry>> {
    list_dir(&dir)
}

#[tauri::command]
async fn read_text(path: String) -> Result<String> {
    read_text_impl(&path)
}

#[tauri::command]
async fn read_bytes(path: String) -> Result<String> {
    read_bytes_impl(&path)
}

/// Initializes the plugin.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("xmark-localfs")
        .invoke_handler(tauri::generate_handler![
            pick_folder,
            restore_folders,
            forget_folder,
            list_folder,
            read_text,
            read_bytes
        ])
        .setup(|app, api| {
            #[cfg(target_os = "ios")]
            let fs = {
                tauri::ios_plugin_binding!(init_plugin_xmark_localfs);
                let handle = api.register_ios_plugin(init_plugin_xmark_localfs)?;
                LocalFs { handle }
            };
            #[cfg(not(target_os = "ios"))]
            let fs: LocalFs<R> = {
                let _ = api;
                LocalFs {
                    _marker: std::marker::PhantomData,
                }
            };
            app.manage(fs);
            Ok(())
        })
        .build()
}
