//! Tauri commands layer — a thin adapter over `bridge-core`. It owns no domain
//! logic itself: on launch it starts the core's local-network sync receiver
//! ([`bridge_core::server`]) on a background thread and persists received Ideas
//! to disk; commands just read the shared state for the frontend. All the
//! pairing/accept/dedup decisions live in `bridge-core`, tested without a window.

use std::fs;
use std::net::UdpSocket;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use bridge_core::server::{SyncServer, SyncSink};
use bridge_core::{
    audio_extension, sync_protocol_version, BridgeLibrary, DeviceIdentity, DeviceRole, IdeaMetadata,
    SyncState, PAIRING_CODE_LENGTH,
};
use serde::Serialize;
use tauri::{Manager, State};

/// Default LAN port Bridge listens on for Free-tier sync. A fixed port keeps
/// the address Bridge shows for pairing stable across restarts; if it's taken,
/// the OS assigns one and the frontend shows whatever [`SyncServer`] bound.
const DEFAULT_SYNC_PORT: u16 = 47600;

/// Shared handle the commands read: the live sync state plus the details the
/// frontend needs to render (the pairing code and the bound port).
struct BridgeState {
    sync: Arc<Mutex<SyncState>>,
    pairing_code: String,
    host: Option<String>,
    port: u16,
}

/// Writes received Ideas to the app data directory: audio at `ideas/<id><ext>`
/// (mirroring Capture's layout) and the Library manifest as `library.json`.
struct FsSink {
    audio_dir: PathBuf,
    manifest_path: PathBuf,
}

impl SyncSink for FsSink {
    fn store_audio(&self, idea: &IdeaMetadata, bytes: &[u8]) -> std::io::Result<()> {
        fs::create_dir_all(&self.audio_dir)?;
        let file = self
            .audio_dir
            .join(format!("{}{}", idea.id, audio_extension(idea.audio_format)));
        fs::write(file, bytes)
    }

    fn persist_library(&self, library: &BridgeLibrary) {
        if let Ok(json) = serde_json::to_vec(library.ideas()) {
            let _ = fs::write(&self.manifest_path, json);
        }
    }
}

/// Loads the persisted Library, or an empty one if none exists yet / is corrupt.
fn load_library(manifest_path: &Path) -> BridgeLibrary {
    match fs::read(manifest_path) {
        Ok(bytes) => match serde_json::from_slice::<Vec<IdeaMetadata>>(&bytes) {
            Ok(ideas) => BridgeLibrary::from_ideas(ideas),
            Err(_) => BridgeLibrary::new(),
        },
        Err(_) => BridgeLibrary::new(),
    }
}

/// A short-lived pseudo-random pairing code for this session, sized to
/// [`PAIRING_CODE_LENGTH`] so it always passes `is_valid_pairing_code`. Free
/// tier has no account, so this is the shared secret the user types into
/// Capture to prove the two devices are theirs. Regenerated each launch — good
/// enough for a LAN pairing; a persisted device secret is a later refinement.
fn generate_pairing_code() -> String {
    let modulus = 10u64.pow(PAIRING_CODE_LENGTH as u32);
    let seed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.subsec_nanos() as u64)
        .unwrap_or(0);
    format!("{:0width$}", seed % modulus, width = PAIRING_CODE_LENGTH)
}

/// This machine's primary LAN IP, for the user to type into Capture when
/// pairing. No packets are sent — connecting a UDP socket to a public address
/// just selects the outbound interface, whose local address is the LAN IP.
/// Returns `None` if it can't be determined (e.g. offline).
fn local_ip() -> Option<String> {
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    Some(socket.local_addr().ok()?.ip().to_string())
}

fn bridge_identity() -> DeviceIdentity {
    let seed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    DeviceIdentity {
        device_id: format!("bridge-{seed:x}"),
        display_name: "Motif Bridge".to_string(),
        role: DeviceRole::Bridge,
    }
}

/// The pairing details the frontend shows so a phone can pair over the LAN:
/// this Bridge's address (`host:port`) and the code to type into Capture.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PairingInfo {
    code: String,
    host: Option<String>,
    port: u16,
}

/// Returns the sync protocol version the Rust core speaks. Lets the frontend
/// confirm the core is reachable across the Tauri boundary.
#[tauri::command]
fn protocol_version() -> u32 {
    sync_protocol_version()
}

/// The Ideas Bridge has received, newest first — the desktop Library view.
#[tauri::command]
fn library(state: State<'_, BridgeState>) -> Vec<IdeaMetadata> {
    state.sync.lock().unwrap().library().ideas().to_vec()
}

/// The pairing code + port to display for a phone to pair against.
#[tauri::command]
fn pairing_info(state: State<'_, BridgeState>) -> PairingInfo {
    PairingInfo {
        code: state.pairing_code.clone(),
        host: state.host.clone(),
        port: state.port,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            fs::create_dir_all(&data_dir)?;
            let manifest_path = data_dir.join("library.json");
            let sink = Arc::new(FsSink {
                audio_dir: data_dir.join("ideas"),
                manifest_path: manifest_path.clone(),
            });

            let pairing_code = generate_pairing_code();
            let sync = Arc::new(Mutex::new(SyncState::new(
                bridge_identity(),
                pairing_code.clone(),
                load_library(&manifest_path),
            )));

            // Bind the receiver on the LAN — fixed port for a stable pairing
            // address, falling back to an OS-assigned one if it's taken.
            let server = SyncServer::bind(("0.0.0.0", DEFAULT_SYNC_PORT), sync.clone(), sink.clone())
                .or_else(|_| SyncServer::bind(("0.0.0.0", 0), sync.clone(), sink.clone()))?;
            let port = server.local_addr()?.port();
            std::thread::spawn(move || server.serve_forever());

            app.manage(BridgeState {
                sync,
                pairing_code,
                host: local_ip(),
                port,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            protocol_version,
            library,
            pairing_info
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
