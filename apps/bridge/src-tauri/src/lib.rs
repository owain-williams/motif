//! Tauri commands layer — a thin adapter over `bridge-core`. It owns no domain
//! logic itself: on launch it starts the core's local-network sync receiver
//! ([`bridge_core::server`]) on a background thread and persists received Ideas
//! to disk; commands just read the shared state for the frontend. All the
//! pairing/accept/dedup decisions live in `bridge-core`, tested without a window.

use std::fs;
use std::net::UdpSocket;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use bridge_core::cloud_relay::{sync_from_cloud, HttpCloudRelay};
use bridge_core::server::{SyncServer, SyncSink};
use bridge_core::{
    audio_extension, plan_handoff, sync_protocol_version, BridgeLibrary, DeviceIdentity,
    DeviceRole, HandoffPlan, IdeaMetadata, PairingState, SyncState, PAIRING_CODE_LENGTH,
};
use serde::Serialize;
use tauri::{Manager, State};

use transcode::transcode_to_wav;

mod transcode;

/// Default LAN port Bridge listens on for Free-tier sync. A fixed port keeps
/// the address Bridge shows for pairing stable across restarts; if it's taken,
/// the OS assigns one and the frontend shows whatever [`SyncServer`] bound.
const DEFAULT_SYNC_PORT: u16 = 47600;
const CLOUD_SYNC_INTERVAL: Duration = Duration::from_secs(15);
const CLOUD_API_URL: &str = "https://to8jymiybd.execute-api.eu-west-2.amazonaws.com";

/// Shared handle the commands read: the live sync state plus the details the
/// frontend needs to render (the pairing code and the bound port).
struct BridgeState {
    sync: Arc<Mutex<SyncState>>,
    data_dir: PathBuf,
    pairing_code: String,
    host: Option<String>,
    port: u16,
    cloud_token: Arc<Mutex<Option<String>>>,
}

/// Writes received Ideas to the app data directory: audio at `ideas/<id><ext>`
/// (mirroring Capture's layout) and the Library manifest as `library.json`.
struct FsSink {
    audio_dir: PathBuf,
    manifest_path: PathBuf,
    pairing_path: PathBuf,
}

impl SyncSink for FsSink {
    fn store_audio(&self, idea: &IdeaMetadata, bytes: &[u8]) -> std::io::Result<()> {
        fs::create_dir_all(&self.audio_dir)?;
        let file =
            self.audio_dir
                .join(format!("{}{}", idea.id, audio_extension(idea.audio_format)));
        fs::write(file, bytes)
    }

    fn persist_library(&self, library: &BridgeLibrary) {
        if let Ok(json) = serde_json::to_vec(library.ideas()) {
            let _ = fs::write(&self.manifest_path, json);
        }
    }

    fn persist_pairing(&self, pairing: &PairingState) {
        let _ = persist_pairing(&self.pairing_path, pairing);
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

/// Loads Bridge's durable LAN pairing, or returns `None` if none exists yet or
/// the file is corrupt. The caller creates and immediately persists a fresh
/// identity and code in that case.
fn load_pairing(path: &Path) -> Option<PairingState> {
    fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
}

fn persist_pairing(path: &Path, pairing: &PairingState) -> std::io::Result<()> {
    let json = serde_json::to_vec(pairing).map_err(std::io::Error::other)?;
    fs::write(path, json)
}

/// Generates the initial pseudo-random pairing code, sized to
/// [`PAIRING_CODE_LENGTH`] so it always passes `is_valid_pairing_code`. Free
/// tier has no account, so this is the shared secret the user types into
/// Capture to prove the two devices are theirs. It is persisted and reused on
/// future launches.
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

/// Enables account-scoped relay polling. The token remains in memory only and
/// the backend verifies both account identity and Basic/Pro tier each poll.
#[tauri::command]
fn enable_cloud_sync(id_token: String, state: State<'_, BridgeState>) -> Result<(), String> {
    if id_token.trim().is_empty() {
        return Err("Login did not return a usable session".to_string());
    }
    *state
        .cloud_token
        .lock()
        .map_err(|_| "Cloud sync unavailable")? = Some(id_token);
    Ok(())
}

#[tauri::command]
fn disable_cloud_sync(state: State<'_, BridgeState>) -> Result<(), String> {
    *state
        .cloud_token
        .lock()
        .map_err(|_| "Cloud sync unavailable")? = None;
    Ok(())
}

fn idea_for_id(state: &BridgeState, id: &str) -> Result<IdeaMetadata, String> {
    state
        .sync
        .lock()
        .map_err(|_| "Library unavailable".to_string())?
        .library()
        .ideas()
        .iter()
        .find(|idea| idea.id == id)
        .cloned()
        .ok_or_else(|| "Idea not found".to_string())
}

fn idea_audio_path(state: &BridgeState, idea: &IdeaMetadata) -> PathBuf {
    state
        .data_dir
        .join("ideas")
        .join(format!("{}{}", idea.id, audio_extension(idea.audio_format)))
}

/// Absolute path consumed by Tauri's scoped asset protocol for in-window audio
/// preview. Looking the id up first prevents callers from selecting arbitrary
/// files through this command.
#[tauri::command]
fn preview_audio_path(id: String, state: State<'_, BridgeState>) -> Result<String, String> {
    let idea = idea_for_id(&state, &id)?;
    let path = idea_audio_path(&state, &idea);
    if !path.is_file() {
        return Err("Idea audio is missing".to_string());
    }
    Ok(path.to_string_lossy().into_owned())
}

/// Produces the DAW-ready file for a native drag. AAC is decoded into a
/// temporary WAV; an already-WAV Idea returns its received file unchanged.
#[tauri::command]
fn prepare_handoff(id: String, state: State<'_, BridgeState>) -> Result<String, String> {
    let idea = idea_for_id(&state, &id)?;
    let source = idea_audio_path(&state, &idea);
    if !source.is_file() {
        return Err("Idea audio is missing".to_string());
    }

    let handoff_dir = state.data_dir.join("handoffs");
    let path = match plan_handoff(&idea, &source, &handoff_dir) {
        HandoffPlan::UseOriginal(path) => path,
        HandoffPlan::TranscodeToWav {
            source,
            destination,
        } => {
            fs::create_dir_all(&handoff_dir).map_err(|error| error.to_string())?;
            transcode_to_wav(&source, &destination)?;
            destination
        }
    };
    Ok(path.to_string_lossy().into_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_drag::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            fs::create_dir_all(&data_dir)?;
            let manifest_path = data_dir.join("library.json");
            let pairing_path = data_dir.join("pairing.json");
            let sink = Arc::new(FsSink {
                audio_dir: data_dir.join("ideas"),
                manifest_path: manifest_path.clone(),
                pairing_path: pairing_path.clone(),
            });

            let pairing = load_pairing(&pairing_path).unwrap_or_else(|| {
                PairingState::new(bridge_identity(), generate_pairing_code(), None)
            });
            persist_pairing(&pairing_path, &pairing)?;
            let pairing_code = pairing.pairing_code().to_string();
            let sync = Arc::new(Mutex::new(SyncState::new(
                pairing,
                load_library(&manifest_path),
            )));

            // Bind the receiver on the LAN — fixed port for a stable pairing
            // address, falling back to an OS-assigned one if it's taken.
            let server =
                SyncServer::bind(("0.0.0.0", DEFAULT_SYNC_PORT), sync.clone(), sink.clone())
                    .or_else(|_| SyncServer::bind(("0.0.0.0", 0), sync.clone(), sink.clone()))?;
            let port = server.local_addr()?.port();
            std::thread::spawn(move || server.serve_forever());

            // The cloud path is additive to the LAN receiver. It sleeps when no
            // paid account is logged in and never interferes with local sync.
            let cloud_token: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
            let relay_token = cloud_token.clone();
            let relay_sync = sync.clone();
            let relay_sink = sink.clone();
            std::thread::spawn(move || loop {
                let token = relay_token.lock().ok().and_then(|token| token.clone());
                if let Some(token) = token {
                    let relay = HttpCloudRelay::new(CLOUD_API_URL, token);
                    let _ = sync_from_cloud(&relay, &relay_sync, relay_sink.as_ref());
                }
                std::thread::sleep(CLOUD_SYNC_INTERVAL);
            });

            app.manage(BridgeState {
                sync,
                data_dir,
                pairing_code,
                host: local_ip(),
                port,
                cloud_token,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            protocol_version,
            library,
            pairing_info,
            enable_cloud_sync,
            disable_cloud_sync,
            preview_audio_path,
            prepare_handoff
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
