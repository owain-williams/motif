use std::io;
use std::sync::{Arc, Mutex};

use bridge_core::cloud_relay::{sync_from_cloud, sync_metadata_with_cloud, CloudRelaySource};
use bridge_core::server::SyncSink;
use bridge_core::{
    AudioFormat, BridgeLibrary, DeviceIdentity, DeviceRole, FieldTimestamps, IdeaMetadata,
    IdeaStorageState, PairingState, SyncState,
};

#[derive(Default)]
struct FakeRelay {
    have: Vec<String>,
    offers: Vec<(String, Vec<u8>)>,
    /// The account's Idea metadata, as the relay currently holds it.
    library: Vec<IdeaMetadata>,
    /// Edits Bridge pushed back, in order.
    pushed: Mutex<Vec<IdeaMetadata>>,
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

    fn library(&self) -> Result<Vec<IdeaMetadata>, String> {
        Ok(self.library.clone())
    }

    fn push_update(&self, _from: &DeviceIdentity, idea: &IdeaMetadata) -> Result<bool, String> {
        self.pushed.lock().unwrap().push(idea.clone());
        Ok(true)
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

fn idea(id: &str) -> IdeaMetadata {
    IdeaMetadata {
        id: id.into(),
        name: "Cloud Idea".into(),
        captured_at: 1_000,
        duration_ms: 4_200,
        audio_format: AudioFormat::Aac,
        channels: 1,
        storage_state: IdeaStorageState::OnDevice,
        tags: Vec::new(),
        instrument: Vec::new(),
        style: Vec::new(),
        tempo: None,
        location: None,
        field_updated_at: FieldTimestamps::default(),
    }
}

#[test]
fn imports_missing_cloud_ideas_without_local_pairing() {
    let audio = b"cloud-audio";
    let relay = FakeRelay {
        have: vec!["idea-1".into()],
        offers: vec![("idea-1".into(), framed_offer("idea-1", audio))],
        ..Default::default()
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
        ..Default::default()
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
        ..Default::default()
    };
    let sink = RecordingSink::default();

    assert_eq!(sync_from_cloud(&relay, &state, &sink).unwrap(), 0);
    assert!(sink.stored.lock().unwrap().is_empty());
}

// --- Metadata over the relay (motif-kka.9) -------------------------------
// The relay carries edits as well as audio, so a rename or a tag made while
// Capture and Bridge are on different networks still lands (ADR 0006).

/// A Bridge holding `ideas`, as one built from a persisted Library would be.
fn state_holding(ideas: Vec<IdeaMetadata>) -> Arc<Mutex<SyncState>> {
    let state = state();
    for idea in ideas {
        state.lock().unwrap().import_relay_idea(idea);
    }
    state
}

#[test]
fn pulls_an_edit_made_on_another_device_into_bridges_library() {
    let state = state_holding(vec![idea("idea-1")]);
    let mut edited = idea("idea-1");
    edited.tags = vec!["from-phone".into()];
    edited.field_updated_at.tags = 5_000;
    let relay = FakeRelay {
        library: vec![edited],
        ..Default::default()
    };
    let sink = RecordingSink::default();

    sync_metadata_with_cloud(&relay, &state, &sink).unwrap();

    assert_eq!(state.lock().unwrap().library().ideas()[0].tags, vec!["from-phone"]);
    // The merged Library is persisted, so the edit survives a Bridge restart.
    assert_eq!(*sink.persisted.lock().unwrap(), 1);
    // Nothing to send back: the relay already has the newest of every field.
    assert!(relay.pushed.lock().unwrap().is_empty());
}

#[test]
fn pushes_an_edit_made_on_bridge_up_to_the_relay() {
    let mut edited = idea("idea-1");
    edited.name = "Chorus hook".into();
    edited.field_updated_at.name = 9_000;
    let state = state_holding(vec![edited]);
    let relay = FakeRelay {
        library: vec![idea("idea-1")],
        ..Default::default()
    };

    let pushed = sync_metadata_with_cloud(&relay, &state, &RecordingSink::default()).unwrap();

    assert_eq!(pushed, 1);
    assert_eq!(relay.pushed.lock().unwrap()[0].name, "Chorus hook");
}

#[test]
fn resolves_each_field_by_last_write_wins_in_both_directions() {
    // Bridge renamed; the relay carries a tag another device added later. Both
    // edits must survive, and the copy pushed back must carry both so the relay
    // converges on the same Idea.
    let mut on_bridge = idea("idea-1");
    on_bridge.name = "Chorus hook".into();
    on_bridge.field_updated_at.name = 9_000;
    let state = state_holding(vec![on_bridge]);

    let mut on_relay = idea("idea-1");
    on_relay.tags = vec!["dreamy".into()];
    on_relay.field_updated_at.tags = 5_000;
    let relay = FakeRelay {
        library: vec![on_relay],
        ..Default::default()
    };

    sync_metadata_with_cloud(&relay, &state, &RecordingSink::default()).unwrap();

    let held = state.lock().unwrap().library().ideas()[0].clone();
    assert_eq!(held.name, "Chorus hook");
    assert_eq!(held.tags, vec!["dreamy"]);
    let pushed = relay.pushed.lock().unwrap();
    assert_eq!(pushed[0].name, "Chorus hook");
    assert_eq!(pushed[0].tags, vec!["dreamy"]);
}

#[test]
fn a_second_pass_with_nothing_new_changes_and_sends_nothing() {
    let state = state_holding(vec![idea("idea-1")]);
    let relay = FakeRelay {
        library: vec![idea("idea-1")],
        ..Default::default()
    };
    let sink = RecordingSink::default();

    assert_eq!(sync_metadata_with_cloud(&relay, &state, &sink).unwrap(), 0);
    assert!(relay.pushed.lock().unwrap().is_empty());
    // Nothing merged, so nothing is rewritten to disk.
    assert_eq!(*sink.persisted.lock().unwrap(), 0);
}

#[test]
fn ignores_relay_metadata_for_an_idea_bridge_has_not_received() {
    // The audio-carrying import path owns Ideas Bridge doesn't hold; a metadata
    // pass must not invent one from an edit alone.
    let state = state_holding(Vec::new());
    let mut edited = idea("idea-1");
    edited.tags = vec!["orphan".into()];
    edited.field_updated_at.tags = 5_000;
    let relay = FakeRelay {
        library: vec![edited],
        ..Default::default()
    };

    sync_metadata_with_cloud(&relay, &state, &RecordingSink::default()).unwrap();

    assert!(state.lock().unwrap().library().is_empty());
    assert!(relay.pushed.lock().unwrap().is_empty());
}

#[test]
fn never_pushes_an_idea_the_relay_does_not_hold() {
    // A LAN-only Idea has no audio in the cloud, so pushing its metadata would
    // describe something the relay can never serve.
    let mut lan_only = idea("lan-idea");
    lan_only.tags = vec!["local".into()];
    lan_only.field_updated_at.tags = 9_000;
    let state = state_holding(vec![lan_only]);
    let relay = FakeRelay::default();

    assert_eq!(
        sync_metadata_with_cloud(&relay, &state, &RecordingSink::default()).unwrap(),
        0
    );
    assert!(relay.pushed.lock().unwrap().is_empty());
}
