//! Fambot desktop shell. The Rust side stays deliberately thin: it wraps the
//! Vite-built SPA in a native window. Notifications, tray, and secure token
//! storage are later additions.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running fambot desktop");
}
