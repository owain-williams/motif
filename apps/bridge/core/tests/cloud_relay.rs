use std::io;
use std::sync::{Arc, Mutex};

use bridge_core::cloud_relay::{sync_from_cloud, CloudRelaySource};
use bridge_core::server::SyncSink;
use bridge_core::{
    BridgeLibrary, DeviceIdentity, DeviceRole, IdeaMetadata, PairingState, SyncState,
};

#[derive(Default)]
struct FakeRelay {
    have: Vec<String>,
    offers: Vec<(String, Vec<u8>)>,
}

impl CloudRelaySource for FakeRelay {
    fn manifest(&self) -> Result<Vec<String>, String> {
        Ok(self.have.clone())
    }

    fn download(&self, id: &str) -> Result<Vec<u8>, String> {
        self.offers
            .iter()
            .find(|(candidate, _)| candidate == id)
            .map(|(_, bytes)| bytes.clone())
            .ok_or_else(|| "missing relay object".to_string())
    }
}

#[derive(Default)]
struct RecordingSink {
    stored: Mutex<Vec<(String, Vec<u8>)>>,
    persisted: Mutex<usize>,
}

impl SyncSink for RecordingSink {
    fn store_audio(&self, idea: &IdeaMetadata, bytes: &[u8]) -> io::Result<()> {
        self.stored
            .lock()
            .unwrap()
            .push((idea.id.clone(), bytes.to_vec()));
        Ok(())
    }

    fn persist_library(&self, library: &BridgeLibrary) {
        *self.persisted.lock().unwrap() = library.len();
    }
}

fn state() -> Arc<Mutex<SyncState>> {
    Arc::new(Mutex::new(SyncState::new(
        PairingState::new(
            DeviceIdentity {
                device_id: "bridge-1".into(),
                display_name: "Studio Mac".into(),
                role: DeviceRole::Bridge,
            },
            "424242".into(),
            0,
            None,
        ),
        BridgeLibrary::new(),
    )))
}

fn framed_offer(id: &str, audio: &[u8]) -> Vec<u8> {
    framed_offer_from("capture-1", id, audio)
}

fn framed_offer_from(device_id: &str, id: &str, audio: &[u8]) -> Vec<u8> {
    let json = format!(
        r#"{{"kind":"idea-sync-offer","from":{{"deviceId":"{device_id}","displayName":"Capture","role":"capture"}},"idea":{{"id":"{id}","name":"Cloud Idea","capturedAt":1700000000000,"durationMs":4200,"audioFormat":"aac","channels":1,"storageState":"on-device"}},"audioByteLength":{}}}"#,
        audio.len()
    );
    let mut frame = Vec::new();
    frame.extend_from_slice(&(json.len() as u32).to_be_bytes());
    frame.extend_from_slice(json.as_bytes());
    frame.extend_from_slice(audio);
    frame
}

#[test]
fn imports_missing_cloud_ideas_without_local_pairing() {
    let audio = b"cloud-audio";
    let relay = FakeRelay {
        have: vec!["idea-1".into()],
        offers: vec![("idea-1".into(), framed_offer("idea-1", audio))],
    };
    let state = state();
    let sink = RecordingSink::default();

    let imported = sync_from_cloud(&relay, &state, &sink).unwrap();

    assert_eq!(imported, 1);
    assert_eq!(state.lock().unwrap().library().have_ids(), vec!["idea-1"]);
    assert_eq!(sink.stored.lock().unwrap()[0].1, audio);
    assert_eq!(*sink.persisted.lock().unwrap(), 1);
}

#[test]
fn combines_ideas_from_multiple_capture_devices_into_one_bridge_library() {
    let relay = FakeRelay {
        have: vec!["phone-idea".into(), "tablet-idea".into()],
        offers: vec![
            (
                "phone-idea".into(),
                framed_offer_from("phone", "phone-idea", b"phone audio"),
            ),
            (
                "tablet-idea".into(),
                framed_offer_from("tablet", "tablet-idea", b"tablet audio"),
            ),
        ],
    };
    let state = state();
    let sink = RecordingSink::default();

    let imported = sync_from_cloud(&relay, &state, &sink).unwrap();

    assert_eq!(imported, 2);
    let mut ids = state.lock().unwrap().library().have_ids();
    ids.sort();
    assert_eq!(ids, vec!["phone-idea", "tablet-idea"]);
    assert_eq!(sink.stored.lock().unwrap().len(), 2);
    assert_eq!(*sink.persisted.lock().unwrap(), 2);
}

#[test]
fn skips_ideas_bridge_already_received_over_the_local_network() {
    let state = state();
    state.lock().unwrap().import_relay_idea(IdeaMetadata {
        id: "idea-1".into(),
        name: "Existing".into(),
        captured_at: 1,
        duration_ms: 1,
        audio_format: bridge_core::AudioFormat::Aac,
        channels: 1,
        storage_state: bridge_core::IdeaStorageState::OnDevice,
        tags: Vec::new(),
        instrument: Vec::new(),
        style: Vec::new(),
        tempo: None,
        location: None,
        field_updated_at: Default::default(),
    });
    let relay = FakeRelay {
        have: vec!["idea-1".into()],
        offers: vec![("idea-1".into(), framed_offer("idea-1", b"duplicate"))],
    };
    let sink = RecordingSink::default();

    assert_eq!(sync_from_cloud(&relay, &state, &sink).unwrap(), 0);
    assert!(sink.stored.lock().unwrap().is_empty());
}
