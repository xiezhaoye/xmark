//! XMark Mobile's native shell: the plugins the reader uses, nothing else.
//!
//! All behaviour lives in the web frontend (`mobile/src`). HTTP goes through
//! `tauri-plugin-http` (Rust networking: no browser CORS, no ATS for the
//! plain-HTTP Tailscale address), scoped in `capabilities/default.json`.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init());
    #[cfg(mobile)]
    let builder = builder.plugin(tauri_plugin_barcode_scanner::init());
    builder
        .run(tauri::generate_context!())
        .expect("error while running XMark Mobile");
}
