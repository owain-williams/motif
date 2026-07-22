//! Cross-device delete on the Bridge side (ADR 0005, motif-kka.5): the
//! per-device delete/restore log, its exchange with the paired Capture, and the
//! 30-day Recently Deleted window — all without a socket or a Tauri window.

use bridge_core::{
    AudioFormat, BridgeLibrary, DeletionLog, DeviceIdentity, DeviceRole, IdeaDeletion,
    IdeaMetadata, IdeaStorageState::OnDevice, IdeaSyncOffer, PairingRequest, PairingState,
    SyncManifest, SyncState, RECENTLY_DELETED_RETENTION_MS,
};

const DAY: i64 = 24 * 60 * 60 * 1000;
const T0: i64 = 1_700_000_000_000;

fn bridge_identity() -> DeviceIdentity {
    DeviceIdentity {
        device_id: "br-1".into(),
        display_name: "Studio Mac".into(),
        role: DeviceRole::Bridge,
    }
}

fn capture_identity() -> DeviceIdentity {
    DeviceIdentity {
        device_id: "cap-1".into(),
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
        tags: Vec::new(),
        instrument: Vec::new(),
        style: Vec::new(),
        tempo: None,
        location: None,
        field_updated_at: Default::default(),
    }
}

/// A Bridge already paired with Capture and holding the given Ideas — the
/// state after a first successful sync.
fn paired_state(ideas: Vec<IdeaMetadata>) -> SyncState {
    let mut state = SyncState::new(
        PairingState::new(bridge_identity(), "123456".into(), 1_000, None),
        BridgeLibrary::from_ideas(ideas),
    );
    let accepted = state.handle_pairing_at(
        &PairingRequest {
            protocol_version: bridge_core::SYNC_PROTOCOL_VERSION,
            from: capture_identity(),
            pairing_code: "123456".into(),
        },
        1_100,
    );
    assert!(accepted.accepted, "test setup: pairing should succeed");
    state
}

fn capture_manifest(deleted: Vec<IdeaDeletion>) -> SyncManifest {
    SyncManifest::from_device(capture_identity(), Vec::new(), deleted)
}

fn tombstone(id: &str, deleted_at: i64) -> IdeaDeletion {
    let mut log = DeletionLog::new();
    log.mark_deleted(id, deleted_at);
    log.records()[0].clone()
}

#[test]
fn retention_window_matches_the_shared_package() {
    assert_eq!(RECENTLY_DELETED_RETENTION_MS, 30 * DAY);
}

#[test]
fn log_records_deletes_and_restores() {
    let mut log = DeletionLog::new();
    assert!(!log.is_deleted("a"));

    assert!(log.mark_deleted("a", T0));
    assert!(log.is_deleted("a"));
    assert!(!log.is_deleted("b"));

    assert!(log.mark_restored("a", T0 + DAY));
    assert!(!log.is_deleted("a"));
}

#[test]
fn deleting_twice_does_not_restart_the_grace_period() {
    let mut log = DeletionLog::new();
    log.mark_deleted("a", T0);
    assert!(
        !log.mark_deleted("a", T0 + DAY),
        "re-delete changes nothing"
    );
    assert_eq!(
        log.records()[0].purge_at(),
        T0 + RECENTLY_DELETED_RETENTION_MS
    );
}

#[test]
fn restoring_an_idea_that_was_never_deleted_is_a_no_op() {
    let mut log = DeletionLog::new();
    assert!(!log.mark_restored("a", T0));
    assert!(log.records().is_empty());
}

#[test]
fn merging_a_peer_log_applies_its_deletes_and_restores() {
    let mut local = DeletionLog::new();
    local.mark_deleted("a", T0);

    // The peer deleted one Idea we don't know about and restored one we do.
    let mut peer = DeletionLog::new();
    peer.mark_deleted("b", T0);
    peer.merge(local.records());
    peer.mark_restored("a", T0 + DAY);

    assert!(local.merge(peer.records()));
    assert!(local.is_deleted("b"));
    assert!(!local.is_deleted("a"));

    // Re-exchanging the same log is idempotent.
    assert!(!local.merge(peer.records()));
}

#[test]
fn a_delete_after_the_peers_restore_still_wins() {
    let mut peer = DeletionLog::new();
    peer.mark_deleted("a", T0);
    peer.mark_restored("a", T0 + DAY);

    let mut local = DeletionLog::new();
    local.merge(peer.records());
    local.mark_deleted("a", T0 + 2 * DAY);

    local.merge(peer.records());
    assert!(local.is_deleted("a"));
}

#[test]
fn expired_deletions_are_reported_only_after_the_full_window() {
    let mut log = DeletionLog::new();
    log.mark_deleted("a", T0);

    assert!(log
        .expired(T0 + RECENTLY_DELETED_RETENTION_MS - 1)
        .is_empty());
    let expired = log.expired(T0 + RECENTLY_DELETED_RETENTION_MS);
    assert_eq!(expired.len(), 1);
    assert_eq!(expired[0].id, "a");

    log.mark_restored("a", T0 + DAY);
    assert!(
        log.expired(T0 + 365 * DAY).is_empty(),
        "restored never expires"
    );
}

#[test]
fn a_deleted_idea_leaves_the_active_library_but_keeps_its_audio() {
    let mut state = paired_state(vec![idea("a", 10), idea("b", 20)]);

    assert!(state.delete_idea("a", T0));

    let active: Vec<String> = state.active_ideas().into_iter().map(|i| i.id).collect();
    assert_eq!(active, ["b"]);
    // Soft delete: the Idea itself is still held, so it can be restored.
    assert!(state.library().has("a"));

    let deleted = state.recently_deleted();
    assert_eq!(deleted.len(), 1);
    assert_eq!(deleted[0].idea.id, "a");
    assert_eq!(deleted[0].deleted_at, T0);
    assert_eq!(deleted[0].purge_at, T0 + RECENTLY_DELETED_RETENTION_MS);
}

#[test]
fn restoring_puts_an_idea_back_in_the_active_library() {
    let mut state = paired_state(vec![idea("a", 10)]);
    state.delete_idea("a", T0);

    assert!(state.restore_idea("a", T0 + DAY));
    assert_eq!(state.active_ideas().len(), 1);
    assert!(state.recently_deleted().is_empty());
}

#[test]
fn deleting_an_idea_bridge_does_not_hold_is_a_no_op() {
    let mut state = paired_state(vec![idea("a", 10)]);
    assert!(!state.delete_idea("missing", T0));
    assert!(state.deletions().records().is_empty());
}

#[test]
fn bridges_manifest_carries_its_deletions_to_capture() {
    let mut state = paired_state(vec![idea("a", 10), idea("b", 20)]);
    state.delete_idea("a", T0);

    let manifest = state.manifest();
    // Soft-deleted Ideas stay in `have` — Bridge still holds them, so Capture
    // must not re-offer their audio.
    assert_eq!(manifest.have, vec!["b", "a"]);
    assert_eq!(manifest.deleted.len(), 1);
    assert_eq!(manifest.deleted[0].id, "a");
    assert_eq!(manifest.deleted[0].deleted_at, T0);
}

#[test]
fn a_delete_from_the_paired_capture_is_applied_on_exchange() {
    let mut state = paired_state(vec![idea("a", 10)]);

    assert!(state.apply_peer_manifest(&capture_manifest(vec![tombstone("a", T0)])));

    assert!(state.deletions().is_deleted("a"));
    assert!(state.active_ideas().is_empty());
    assert_eq!(state.recently_deleted().len(), 1);
}

#[test]
fn a_delete_lands_however_long_the_peer_was_offline() {
    let mut state = paired_state(vec![idea("a", 10)]);
    // Capture deleted a year before it next reached this Bridge.
    let stale = tombstone("a", T0 - 365 * DAY);

    assert!(state.apply_peer_manifest(&capture_manifest(vec![stale])));
    assert!(state.deletions().is_deleted("a"));
}

#[test]
fn a_restore_from_capture_undoes_a_delete_bridge_already_applied() {
    let mut state = paired_state(vec![idea("a", 10)]);
    state.apply_peer_manifest(&capture_manifest(vec![tombstone("a", T0)]));

    let mut restored = DeletionLog::new();
    restored.mark_deleted("a", T0);
    restored.mark_restored("a", T0 + DAY);

    assert!(state.apply_peer_manifest(&capture_manifest(restored.records().to_vec())));
    assert!(!state.deletions().is_deleted("a"));
    assert_eq!(state.active_ideas().len(), 1);
}

#[test]
fn an_unchanged_exchange_reports_nothing_to_persist() {
    let mut state = paired_state(vec![idea("a", 10)]);
    let manifest = capture_manifest(vec![tombstone("a", T0)]);

    assert!(state.apply_peer_manifest(&manifest));
    assert!(!state.apply_peer_manifest(&manifest));
}

#[test]
fn deletions_from_an_unpaired_peer_are_ignored() {
    let mut state = paired_state(vec![idea("a", 10)]);
    let stranger = DeviceIdentity {
        device_id: "cap-evil".into(),
        display_name: "Someone else".into(),
        role: DeviceRole::Capture,
    };

    let manifest = SyncManifest::from_device(stranger, Vec::new(), vec![tombstone("a", T0)]);
    assert!(!state.apply_peer_manifest(&manifest));
    assert!(!state.deletions().is_deleted("a"));
}

#[test]
fn a_tombstoned_idea_is_not_re_accepted_once_its_audio_is_gone() {
    // Bridge knows the Idea was deleted but no longer holds it — it purged its
    // copy, or the delete arrived before the audio ever did. Dedup alone would
    // let a Capture that hasn't caught up resurrect it.
    let mut state = paired_state(Vec::new());
    state.apply_peer_manifest(&capture_manifest(vec![tombstone("a", T0)]));
    assert!(!state.library().has("a"));

    let offer = IdeaSyncOffer {
        from: capture_identity(),
        idea: idea("a", 10),
        audio_byte_length: 0,
    };
    assert!(!state.would_accept(&offer));
    assert!(!state.accept_offer(&offer).accepted);
    assert!(state.library().is_empty());
}

#[test]
fn a_restored_idea_may_be_offered_again_so_its_audio_can_come_back() {
    let mut state = paired_state(Vec::new());
    state.apply_peer_manifest(&capture_manifest(vec![tombstone("a", T0)]));

    assert!(state.restore_idea("a", T0 + DAY));

    let offer = IdeaSyncOffer {
        from: capture_identity(),
        idea: idea("a", 10),
        audio_byte_length: 0,
    };
    assert!(state.would_accept(&offer));
    assert!(state.accept_offer(&offer).accepted);
    assert_eq!(state.active_ideas().len(), 1);
}

#[test]
fn nothing_is_purged_before_the_window_elapses() {
    let mut state = paired_state(vec![idea("a", 10)]);
    state.delete_idea("a", T0);

    let purged = state.purge_expired(T0 + RECENTLY_DELETED_RETENTION_MS - 1);

    assert!(purged.is_empty());
    assert!(state.library().has("a"));
    assert!(state.deletions().is_deleted("a"));
}

#[test]
fn an_expired_idea_is_purged_from_the_library() {
    let mut state = paired_state(vec![idea("a", 10), idea("b", 20)]);
    state.delete_idea("a", T0);

    let purged = state.purge_expired(T0 + RECENTLY_DELETED_RETENTION_MS);

    // The Idea comes back so the shell knows which audio file to delete.
    assert_eq!(purged.len(), 1);
    assert_eq!(purged[0].id, "a");
    assert!(!state.library().has("a"));
    assert!(state.library().has("b"));
    // Nothing is left to list under Recently Deleted, but the record stays: it
    // is still the only thing that can carry the delete to an absent Capture.
    assert!(state.recently_deleted().is_empty());
    assert!(state.deletions().is_deleted("a"));
    assert_eq!(state.manifest().deleted.len(), 1);
}

#[test]
fn a_purged_ideas_record_still_reaches_a_capture_absent_for_years() {
    let mut state = paired_state(vec![idea("a", 10)]);
    state.delete_idea("a", T0);
    state.purge_expired(T0 + RECENTLY_DELETED_RETENTION_MS);

    // Whenever that Capture finally connects, the manifest still tells it.
    let manifest = state.manifest();
    assert_eq!(manifest.deleted[0].id, "a");
    // And it cannot undo the delete by offering the Idea back.
    let offer = IdeaSyncOffer {
        from: capture_identity(),
        idea: idea("a", 10),
        audio_byte_length: 0,
    };
    assert!(!state.would_accept(&offer));
}

#[test]
fn a_restored_idea_is_never_purged() {
    let mut state = paired_state(vec![idea("a", 10)]);
    state.delete_idea("a", T0);
    state.restore_idea("a", T0 + DAY);

    assert!(state.purge_expired(T0 + 365 * DAY).is_empty());
    assert!(state.library().has("a"));
}

#[test]
fn an_expired_record_for_an_idea_bridge_never_held_purges_nothing() {
    let mut state = paired_state(Vec::new());
    state.apply_peer_manifest(&capture_manifest(vec![tombstone("a", T0)]));

    let purged = state.purge_expired(T0 + RECENTLY_DELETED_RETENTION_MS);

    assert!(purged.is_empty());
    assert!(state.deletions().is_deleted("a"));
}

#[test]
fn sweeping_again_after_a_purge_changes_nothing() {
    let mut state = paired_state(vec![idea("a", 10)]);
    state.delete_idea("a", T0);
    state.purge_expired(T0 + RECENTLY_DELETED_RETENTION_MS);

    assert!(state
        .purge_expired(T0 + RECENTLY_DELETED_RETENTION_MS + DAY)
        .is_empty());
    assert!(state.library().is_empty());
}

#[test]
fn a_persisted_log_reloads_with_the_same_answers() {
    let mut log = DeletionLog::new();
    log.mark_deleted("a", T0);
    log.mark_restored("a", T0 + DAY);
    log.mark_deleted("b", T0);

    let json = serde_json::to_string(log.records()).unwrap();
    let reloaded = DeletionLog::from_records(serde_json::from_str(&json).unwrap());
    assert!(!reloaded.is_deleted("a"));
    assert!(reloaded.is_deleted("b"));

    // A record written by an older build has no restore stamp.
    let legacy: Vec<IdeaDeletion> = serde_json::from_str(r#"[{"id":"c","deletedAt":1}]"#).unwrap();
    assert!(DeletionLog::from_records(legacy).is_deleted("c"));
}

#[test]
fn a_manifest_from_an_older_peer_carries_no_deletions() {
    let manifest: SyncManifest = serde_json::from_str(
        r#"{"kind":"sync-manifest","from":{"deviceId":"cap-1","displayName":"Pixel","role":"capture"},"have":["a"]}"#,
    )
    .unwrap();
    assert!(manifest.deleted.is_empty());
}
