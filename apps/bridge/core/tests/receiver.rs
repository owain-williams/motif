//! Behavioral tests for the Bridge receiver core (motif-6fu.6): the dedup
//! Library, the pairing rules, and the copy-semantics accept decision — all
//! without opening a socket or a Tauri window.

use bridge_core::{
    audio_extension, is_sync_protocol_compatible, is_valid_pairing_code, AudioFormat,
    BridgeLibrary, DeviceIdentity, DeviceRole, IdeaMetadata, IdeaStorageState, IdeaSyncOffer,
    IdeaStorageState::OnDevice, PairingRequest, SyncState, PAIRING_CODE_LENGTH,
    SYNC_PROTOCOL_VERSION,
};

fn bridge_identity() -> DeviceIdentity {
    DeviceIdentity {
        device_id: "br-1".into(),
        display_name: "Studio Mac".into(),
        role: DeviceRole::Bridge,
    }
}

fn capture_identity(id: &str) -> DeviceIdentity {
    DeviceIdentity {
        device_id: id.into(),
        display_name: "Pixel".into(),
        role: DeviceRole::Capture,
    }
}

fn idea(id: &str, captured_at: i64) -> IdeaMetadata {
    IdeaMetadata {
        id: id.into(),
        name: format!("Idea {id}"),
        captured_at,
        duration_ms: 3000,
        audio_format: AudioFormat::Aac,
        channels: 1,
        storage_state: OnDevice,
    }
}

fn offer_from(capture: &DeviceIdentity, idea: IdeaMetadata) -> IdeaSyncOffer {
    IdeaSyncOffer {
        from: capture.clone(),
        idea,
        audio_byte_length: 0,
    }
}

fn state_with_code(code: &str) -> SyncState {
    SyncState::new(bridge_identity(), code.into(), BridgeLibrary::new())
}

#[test]
fn protocol_and_pairing_code_guards_mirror_the_shared_package() {
    assert!(is_sync_protocol_compatible(SYNC_PROTOCOL_VERSION));
    assert!(!is_sync_protocol_compatible(SYNC_PROTOCOL_VERSION + 1));
    assert_eq!(PAIRING_CODE_LENGTH, 6);
    assert!(is_valid_pairing_code("012345"));
    assert!(!is_valid_pairing_code("12345"));
    assert!(!is_valid_pairing_code("12345x"));
}

#[test]
fn audio_extension_matches_the_capture_convention() {
    assert_eq!(audio_extension(AudioFormat::Aac), ".m4a");
    assert_eq!(audio_extension(AudioFormat::Wav), ".wav");
}

#[test]
fn library_orders_newest_first_and_dedups_by_id() {
    let mut library = BridgeLibrary::new();
    assert!(library.is_empty());
    assert!(library.insert(idea("a", 10)));
    assert!(library.insert(idea("c", 30)));
    assert!(library.insert(idea("b", 20)));

    let ids: Vec<&str> = library.ideas().iter().map(|i| i.id.as_str()).collect();
    assert_eq!(ids, ["c", "b", "a"]);

    // Re-inserting a known id is a no-op that reports it wasn't added.
    assert!(!library.insert(idea("b", 999)));
    assert_eq!(library.len(), 3);
    assert_eq!(library.have_ids(), vec!["c", "b", "a"]);
}

#[test]
fn from_ideas_restores_the_invariants_of_a_persisted_library() {
    let library = BridgeLibrary::from_ideas(vec![
        idea("a", 10),
        idea("b", 30),
        idea("a", 10), // duplicate on disk — first wins
        idea("c", 20),
    ]);
    let ids: Vec<&str> = library.ideas().iter().map(|i| i.id.as_str()).collect();
    assert_eq!(ids, ["b", "c", "a"]);
}

#[test]
fn pairing_accepts_only_the_right_code_on_a_compatible_protocol() {
    let mut state = state_with_code("424242");
    let capture = capture_identity("cap-1");

    let wrong = PairingRequest {
        protocol_version: SYNC_PROTOCOL_VERSION,
        from: capture.clone(),
        pairing_code: "000000".into(),
    };
    assert!(!state.handle_pairing(&wrong).accepted);
    assert!(!state.is_paired());

    let bad_version = PairingRequest {
        protocol_version: SYNC_PROTOCOL_VERSION + 1,
        from: capture.clone(),
        pairing_code: "424242".into(),
    };
    assert!(!state.handle_pairing(&bad_version).accepted);
    assert!(!state.is_paired());

    let good = PairingRequest {
        protocol_version: SYNC_PROTOCOL_VERSION,
        from: capture.clone(),
        pairing_code: "424242".into(),
    };
    let response = state.handle_pairing(&good);
    assert!(response.accepted);
    assert_eq!(response.kind, "pairing-response");
    assert!(state.is_paired());
    assert_eq!(state.paired_peer(), Some(&capture));
}

#[test]
fn an_offer_is_accepted_only_from_the_paired_capture() {
    let mut state = state_with_code("424242");
    let stranger = capture_identity("stranger");

    // Not paired yet: reject.
    let ack = state.accept_offer(&offer_from(&stranger, idea("x", 1)));
    assert!(!ack.accepted);
    assert!(state.library().is_empty());

    // Pair with cap-1, then an offer from a different device is still rejected.
    let cap = capture_identity("cap-1");
    state.handle_pairing(&PairingRequest {
        protocol_version: SYNC_PROTOCOL_VERSION,
        from: cap.clone(),
        pairing_code: "424242".into(),
    });
    let ack = state.accept_offer(&offer_from(&stranger, idea("y", 2)));
    assert!(!ack.accepted);
    assert!(state.library().is_empty());
}

#[test]
fn accepting_an_offer_is_idempotent_and_uses_copy_semantics() {
    let mut state = state_with_code("424242");
    let cap = capture_identity("cap-1");
    state.handle_pairing(&PairingRequest {
        protocol_version: SYNC_PROTOCOL_VERSION,
        from: cap.clone(),
        pairing_code: "424242".into(),
    });

    let offer = offer_from(&cap, idea("song", 5));
    assert!(state.would_accept(&offer));

    let first = state.accept_offer(&offer);
    assert!(first.accepted);
    assert_eq!(first.idea_id, "song");
    assert_eq!(first.kind, "idea-sync-ack");
    assert!(state.library().has("song"));

    // Re-offering the same Idea is a no-op: accepted:false, no duplicate.
    assert!(!state.would_accept(&offer));
    let second = state.accept_offer(&offer);
    assert!(!second.accepted);
    assert_eq!(state.library().len(), 1);

    // The manifest reports exactly what Bridge now holds.
    let manifest = state.manifest();
    assert_eq!(manifest.kind, "sync-manifest");
    assert_eq!(manifest.have, vec!["song"]);
}

#[test]
fn idea_metadata_wire_format_matches_the_shared_schema() {
    // A JSON offer exactly as `@motif/shared` serializes it — including the
    // `kind` discriminant Bridge ignores — must deserialize cleanly.
    let json = r#"{
        "kind": "idea-sync-offer",
        "from": { "deviceId": "cap-1", "displayName": "Pixel", "role": "capture" },
        "idea": {
            "id": "song",
            "name": "19 Jul 2026, 15:04:03",
            "capturedAt": 1700000000000,
            "durationMs": 4200,
            "audioFormat": "aac",
            "channels": 1,
            "storageState": "on-device"
        },
        "audioByteLength": 12345
    }"#;
    let offer: IdeaSyncOffer = serde_json::from_str(json).expect("deserialize offer");
    assert_eq!(offer.idea.id, "song");
    assert_eq!(offer.idea.audio_format, AudioFormat::Aac);
    assert_eq!(offer.idea.storage_state, IdeaStorageState::OnDevice);
    assert_eq!(offer.audio_byte_length, 12345);

    // ...and re-serializing the Idea round-trips with the same wire spelling.
    let reserialized = serde_json::to_string(&offer.idea).expect("serialize idea");
    assert!(reserialized.contains("\"capturedAt\":1700000000000"));
    assert!(reserialized.contains("\"audioFormat\":\"aac\""));
    assert!(reserialized.contains("\"storageState\":\"on-device\""));
}
