//! XMark Mobile's native share sheet: present the system share UI for an exact
//! original file (raw bytes + name + extension), so the user can hand it to
//! any destination app. The MIME type is advisory; the file extension and
//! bytes are what the destination sees.

use serde::ser::Serializer;
use serde::{Deserialize, Serialize};
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
    /// The filename failed validation (empty, path traversal, control chars).
    #[error("invalid filename")]
    InvalidFilename,
    /// The transfer exceeds the 30 MiB ceiling.
    #[error("invalid file size")]
    InvalidSize,
    /// The base64 payload could not be decoded into the exact original bytes.
    #[error("invalid base64 payload")]
    InvalidBase64,
    /// Sharing is not available on this platform (only iOS presents a sheet).
    #[error("unsupported on this platform")]
    Unsupported,
    /// Forwarding to, or receiving a result from, the Swift plugin failed.
    #[cfg(mobile)]
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

/// Maximum transferable payload in bytes, zero bytes included.
const MAX_BYTES: usize = 30 * 1024 * 1024;

/// A share request as sent over IPC from the webview.
///
/// `base64` is the raw file bytes base64-encoded (the frontend encodes in
/// bounded chunks, never a huge spread). `mime_type` is advisory only.
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareRequest {
    // `name` and `base64` are only read on iOS; on other targets they are
    // validated by the command but never consumed by a native call.
    #[allow(dead_code)]
    name: String,
    #[allow(dead_code)]
    base64: String,
    #[allow(dead_code)]
    mime_type: Option<String>,
}

/// The Swift plugin's reply: whether the user completed (true) or cancelled (false).
#[derive(Debug, Deserialize)]
#[allow(dead_code)] // constructed only on iOS inside `share_file`.
struct ShareReply {
    completed: bool,
}

/// Validates the requested filename, preserving its extension while stripping
/// path separators, traversal and control characters.
///
/// The resulting name is guaranteed non-empty and safe to join onto a
/// per-share private temp directory.
pub fn sanitize_filename(name: &str) -> Result<String> {
    // Reject anything with separators (which would escape the temp dir) or
    // control/line-break characters outright rather than silently rewriting.
    if name.contains('/') || name.contains('\\') || name.chars().any(|c| c.is_control()) {
        return Err(Error::InvalidFilename);
    }

    let cleaned = name.trim();

    // Reject empty or the degenerate "." / ".." (a lone name can't be "..")
    if cleaned.is_empty() || cleaned == "." || cleaned == ".." {
        return Err(Error::InvalidFilename);
    }

    Ok(name.to_string())
}

/// Validates the decoded byte length against the transfer ceiling.
pub fn validate_size(len: usize) -> Result<()> {
    if len > MAX_BYTES {
        return Err(Error::InvalidSize);
    }
    Ok(())
}

/// Decodes the base64 payload into the exact original bytes.
pub fn decode_base64(base64: &str) -> Result<Vec<u8>> {
    use base64::Engine as _;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64)
        .map_err(|_| Error::InvalidBase64)?;
    validate_size(bytes.len())?;
    Ok(bytes)
}

/// Access to the share sheet.
pub struct Share<R: Runtime> {
    #[cfg(target_os = "ios")]
    handle: PluginHandle<R>,
    #[cfg(not(target_os = "ios"))]
    _marker: std::marker::PhantomData<AppHandle<R>>,
}

impl<R: Runtime> Share<R> {
    /// Presents the system share sheet on iOS for the given validated request.
    pub fn share_file(&self, request: ShareRequest) -> Result<bool> {
        #[cfg(target_os = "ios")]
        {
            let reply: ShareReply = self
                .handle
                .run_mobile_plugin("shareFile", request)
                .map_err(Error::from)?;
            Ok(reply.completed)
        }
        #[cfg(not(target_os = "ios"))]
        {
            let _ = request;
            Err(Error::Unsupported)
        }
    }
}

/// The plugin command the webview invokes as `plugin:xmark-share|share_file`.
#[tauri::command]
async fn share_file<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, Share<R>>,
    name: String,
    base64: String,
    mime_type: Option<String>,
) -> Result<bool> {
    // Validate before any native call so malformed input never reaches Swift.
    let name = sanitize_filename(&name)?;
    // Decode only to validate; the base64 string is passed through untouched
    // so Swift writes the exact original bytes with no re-encoding skew.
    let _ = decode_base64(&base64)?;
    state.share_file(ShareRequest {
        name,
        base64,
        mime_type,
    })
}

/// Initializes the plugin.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("xmark-share")
        .invoke_handler(tauri::generate_handler![share_file])
        .setup(|app, api| {
            #[cfg(target_os = "ios")]
            let share = {
                tauri::ios_plugin_binding!(init_plugin_xmark_share);
                let handle = api.register_ios_plugin(init_plugin_xmark_share)?;
                Share { handle }
            };
            #[cfg(not(target_os = "ios"))]
            let share: Share<R> = {
                let _ = api;
                Share {
                    _marker: std::marker::PhantomData,
                }
            };
            app.manage(share);
            Ok(())
        })
        .build()
}
