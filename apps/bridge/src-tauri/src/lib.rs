//! Tauri commands layer — a thin adapter over `bridge-core`. It owns no
//! domain logic itself; commands delegate straight into the core crate so the
//! logic stays testable without a window (see `bridge-core`).

use bridge_core::sync_protocol_version;

/// Returns the sync protocol version the Rust core speaks. Lets the frontend
/// confirm the core is reachable across the Tauri boundary (scaffold).
#[tauri::command]
fn protocol_version() -> u32 {
    sync_protocol_version()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![protocol_version])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
