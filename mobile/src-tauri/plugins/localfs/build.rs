const COMMANDS: &[&str] = &["pick_folder", "restore_folders", "forget_folder", "list_folder", "read_text", "read_bytes"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).ios_path("ios").build();
}
