//! Fambot desktop shell. The Rust side stays deliberately thin: it wraps the
//! Vite-built SPA in a native window. Notification plugins are registered
//! here; everything else (permission prompts, APNs registration, presentation)
//! is driven from the JS adapter in `src/lib/notifications.ts`.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_push_notifications::init())
        .run(tauri::generate_context!())
        .expect("error while running fambot desktop");
}
