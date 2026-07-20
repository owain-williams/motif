//! Behavioral tests for bidirectional metadata editing and per-field
//! last-write-wins merge (motif-kka.4 / motif-kka.2, ADR 0006) — the schema and
//! sync logic Bridge uses to edit tags/instrument/style/tempo and reconcile
//! edits with Capture, all without a socket or a window.

use bridge_core::{
    apply_idea_edit, merge_idea, AudioFormat, BridgeLibrary, DeviceIdentity, DeviceRole,
    FieldTimestamps, IdeaLocation, IdeaMetadata, IdeaMetadataEdit, IdeaMetadataUpdate,
    IdeaStorageState, PairingRequest, PairingState, SyncState, SYNC_PROTOCOL_VERSION,
};

fn london() -> IdeaLocation {
    IdeaLocation {
        lat: 51.5074,
        lon: -0.1278,
        label: "London".into(),
    }
}

fn capture_identity(id: &str) -> DeviceIdentity {
    DeviceIdentity {
        device_id: id.into(),
        display_name: "Pixel".into(),
        role: DeviceRole::Capture,
    }
}

fn idea(id: &str) -> IdeaMetadata {
    IdeaMetadata {
        id: id.into(),
        name: "Idea".into(),
        captured_at: 1_000,
        duration_ms: 3_000,
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

fn edit_of(idea: &IdeaMetadata) -> IdeaMetadataEdit {
    IdeaMetadataEdit {
        name: idea.name.clone(),
        tags: idea.tags.clone(),
        instrument: idea.instrument.clone(),
        style: idea.style.clone(),
        tempo: idea.tempo,
        location: idea.location.clone(),
    }
}

/// A Bridge state paired with `capture`, holding `ideas`.
fn paired_state(capture: &DeviceIdentity, ideas: Vec<IdeaMetadata>) -> SyncState {
    let bridge = DeviceIdentity {
        device_id: "br-1".into(),
        display_name: "Studio Mac".into(),
        role: DeviceRole::Bridge,
    };
    let mut state = SyncState::new(
        PairingState::new(bridge, "012345".into(), 1_000, None),
        BridgeLibrary::from_ideas(ideas),
    );
    let request = PairingRequest {
        protocol_version: SYNC_PROTOCOL_VERSION,
        from: capture.clone(),
        pairing_code: "012345".into(),
    };
    assert!(state.handle_pairing_at(&request, 1_001).accepted);
    state
}

#[test]
fn apply_idea_edit_stamps_only_changed_fields() {
    let mut idea = idea("a");
    idea.tags = vec!["verse".into()];
    idea.field_updated_at.tags = 100;
    let edit = IdeaMetadataEdit {
        name: "Idea".into(),
        tags: vec!["verse".into(), "chorus".into()],
        instrument: Vec::new(),
        style: Vec::new(),
        tempo: Some(128.0),
        location: None,
    };
    apply_idea_edit(&mut idea, &edit, 9_000);

    assert_eq!(idea.tags, vec!["verse", "chorus"]);
    assert_eq!(idea.tempo, Some(128.0));
    assert_eq!(idea.field_updated_at.tags, 9_000);
    assert_eq!(idea.field_updated_at.tempo, 9_000);
    // Name was re-submitted unchanged, so its timestamp does not move.
    assert_eq!(idea.field_updated_at.name, 0);
}

#[test]
fn merge_takes_each_field_from_the_most_recent_editor() {
    let mut local = idea("a");
    local.tags = vec!["mine".into()];
    local.field_updated_at.tags = 100;
    local.instrument = vec!["guitar".into()];
    local.field_updated_at.instrument = 300;

    let mut incoming = idea("a");
    incoming.tags = vec!["theirs".into()];
    incoming.field_updated_at.tags = 200;
    incoming.instrument = vec!["piano".into()];
    incoming.field_updated_at.instrument = 150;

    let merged = merge_idea(&local, &incoming);
    assert_eq!(merged.tags, vec!["theirs"]); // remote's tag edit newer
    assert_eq!(merged.instrument, vec!["guitar"]); // local's instrument edit newer
}

#[test]
fn an_older_edit_never_clobbers_a_newer_edit_to_a_different_field() {
    // ADR 0006 concurrent-edit scenario: device A renamed at t=500, device B
    // (clock slightly behind) added a tag at t=400. Merging in either direction
    // must keep both edits.
    let mut renamed_by_a = idea("a");
    renamed_by_a.name = "Chorus hook".into();
    renamed_by_a.field_updated_at.name = 500;

    let mut tagged_by_b = idea("a");
    tagged_by_b.tags = vec!["dreamy".into()];
    tagged_by_b.field_updated_at.tags = 400;

    for merged in [
        merge_idea(&renamed_by_a, &tagged_by_b),
        merge_idea(&tagged_by_b, &renamed_by_a),
    ] {
        assert_eq!(merged.name, "Chorus hook");
        assert_eq!(merged.tags, vec!["dreamy"]);
    }
}

#[test]
fn merge_resolves_each_field_independently_when_both_sides_edited_both() {
    // Both devices edited name and tags at different non-zero times: A's name
    // edit is newer, B's tag edit is newer. The per-field winner differs and is
    // stable regardless of which copy the merge starts from.
    let mut device_a = idea("a");
    device_a.name = "A name".into();
    device_a.field_updated_at.name = 600;
    device_a.tags = vec!["a-tag".into()];
    device_a.field_updated_at.tags = 500;

    let mut device_b = idea("a");
    device_b.name = "B name".into();
    device_b.field_updated_at.name = 400;
    device_b.tags = vec!["b-tag".into()];
    device_b.field_updated_at.tags = 700;

    for merged in [
        merge_idea(&device_a, &device_b),
        merge_idea(&device_b, &device_a),
    ] {
        assert_eq!(merged.name, "A name"); // A's name edit (600) beats B's (400)
        assert_eq!(merged.tags, vec!["b-tag"]); // B's tag edit (700) beats A's (500)
    }
}

#[test]
fn merge_keeps_local_value_and_storage_state_on_a_tie() {
    let mut local = idea("a");
    local.tags = vec!["mine".into()];
    local.field_updated_at.tags = 500;
    local.storage_state = IdeaStorageState::Offloaded;

    let mut incoming = idea("a");
    incoming.tags = vec!["theirs".into()];
    incoming.field_updated_at.tags = 500;
    incoming.storage_state = IdeaStorageState::OnDevice;

    let merged = merge_idea(&local, &incoming);
    assert_eq!(merged.tags, vec!["mine"]);
    // storage_state is per-device and never merged.
    assert_eq!(merged.storage_state, IdeaStorageState::Offloaded);
}

#[test]
fn editing_an_idea_on_bridge_stamps_it_and_persists_in_the_library() {
    let capture = capture_identity("cap-1");
    let mut state = paired_state(&capture, vec![idea("a")]);

    let mut edit = edit_of(&idea("a"));
    edit.tags = vec!["dreamy".into()];
    edit.tempo = Some(120.0);
    let updated = state.edit_idea("a", &edit, 9_000).expect("idea exists");

    assert_eq!(updated.tags, vec!["dreamy"]);
    assert_eq!(updated.tempo, Some(120.0));
    assert_eq!(updated.field_updated_at.tags, 9_000);
    // The change is reflected in the served Library, so Capture can pull it.
    let held = &state.library().ideas()[0];
    assert_eq!(held.tags, vec!["dreamy"]);
}

#[test]
fn editing_an_unknown_idea_returns_none() {
    let capture = capture_identity("cap-1");
    let mut state = paired_state(&capture, vec![idea("a")]);
    assert!(state.edit_idea("missing", &edit_of(&idea("a")), 9_000).is_none());
}

#[test]
fn a_metadata_update_from_the_paired_capture_is_merged() {
    let capture = capture_identity("cap-1");
    let mut state = paired_state(&capture, vec![idea("a")]);

    let mut edited = idea("a");
    edited.tags = vec!["from-phone".into()];
    edited.field_updated_at.tags = 5_000;
    let update = IdeaMetadataUpdate {
        from: capture.clone(),
        idea: edited,
    };
    assert!(state.apply_metadata_update(&update));
    assert_eq!(state.library().ideas()[0].tags, vec!["from-phone"]);

    // Re-applying the same update is a no-op (nothing newer to merge).
    let mut same = idea("a");
    same.tags = vec!["from-phone".into()];
    same.field_updated_at.tags = 5_000;
    assert!(!state.apply_metadata_update(&IdeaMetadataUpdate {
        from: capture,
        idea: same,
    }));
}

#[test]
fn a_metadata_update_from_an_unpaired_peer_is_ignored() {
    let capture = capture_identity("cap-1");
    let mut state = paired_state(&capture, vec![idea("a")]);

    let stranger = capture_identity("cap-2");
    let mut edited = idea("a");
    edited.tags = vec!["intruder".into()];
    edited.field_updated_at.tags = 9_000;
    assert!(!state.apply_metadata_update(&IdeaMetadataUpdate {
        from: stranger,
        idea: edited,
    }));
    assert!(state.library().ideas()[0].tags.is_empty());
}

#[test]
fn a_metadata_update_for_an_unknown_idea_is_ignored() {
    let capture = capture_identity("cap-1");
    let mut state = paired_state(&capture, vec![idea("a")]);

    let mut unknown = idea("b");
    unknown.tags = vec!["ghost".into()];
    unknown.field_updated_at.tags = 9_000;
    assert!(!state.apply_metadata_update(&IdeaMetadataUpdate {
        from: capture,
        idea: unknown,
    }));
    assert_eq!(state.library().len(), 1);
}

#[test]
fn editing_a_location_label_on_bridge_stamps_and_persists_it() {
    let capture = capture_identity("cap-1");
    let mut located = idea("a");
    located.location = Some(london());
    located.field_updated_at.location = 100;
    let mut state = paired_state(&capture, vec![located]);

    let mut edit = edit_of(&{
        let mut i = idea("a");
        i.location = Some(london());
        i
    });
    edit.location = Some(IdeaLocation {
        label: "London studio".into(),
        ..london()
    });
    let updated = state.edit_idea("a", &edit, 9_000).expect("idea exists");

    assert_eq!(updated.location.as_ref().map(|l| l.label.as_str()), Some("London studio"));
    assert_eq!(updated.field_updated_at.location, 9_000);
    assert_eq!(
        state.library().ideas()[0].location.as_ref().unwrap().label,
        "London studio"
    );
}

#[test]
fn removing_a_location_on_bridge_stamps_and_clears_it() {
    let capture = capture_identity("cap-1");
    let mut located = idea("a");
    located.location = Some(london());
    located.field_updated_at.location = 100;
    let mut state = paired_state(&capture, vec![located]);

    // A remove is an edit whose desired location is None.
    let edit = edit_of(&idea("a"));
    let updated = state.edit_idea("a", &edit, 9_000).expect("idea exists");

    assert!(updated.location.is_none());
    assert_eq!(updated.field_updated_at.location, 9_000);
}

#[test]
fn merge_takes_location_from_the_most_recent_editor() {
    let mut local = idea("a");
    local.location = Some(london());
    local.field_updated_at.location = 100;

    let mut incoming = idea("a");
    incoming.location = Some(IdeaLocation {
        label: "London studio".into(),
        ..london()
    });
    incoming.field_updated_at.location = 200;

    for merged in [merge_idea(&local, &incoming), merge_idea(&incoming, &local)] {
        assert_eq!(merged.location.unwrap().label, "London studio");
    }
}
