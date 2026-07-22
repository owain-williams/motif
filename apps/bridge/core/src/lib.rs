//! Bridge core — the testable domain logic behind Free-tier local-network sync
//! (motif-6fu.6). Bridge is the *receiver*: a Capture on the same LAN pairs
//! with it (no account) and offers its Ideas; Bridge accepts the ones it
//! doesn't already have and stores them in its own Library. This crate owns the
//! pairing rules, the dedup Library, and the copy-semantics accept decision,
//! plus a small dependency-free HTTP transport ([`server`]) that wires them to
//! real sockets — all exercised with `cargo test`, no Tauri window required.
//!
//! These types mirror `@motif/shared` on the TypeScript side (ADR 0003); the
//! `camelCase`/`kebab-case` serde attributes keep the JSON wire format
//! byte-identical to what Capture sends.

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

pub mod cloud_relay;
pub mod discovery;
pub mod server;

/// Sync protocol version negotiated between Capture and Bridge. Must stay in
/// step with `SYNC_PROTOCOL_VERSION` in `@motif/shared`.
pub const SYNC_PROTOCOL_VERSION: u32 = 1;

/// Returns the sync protocol version this Bridge build speaks.
pub fn sync_protocol_version() -> u32 {
    SYNC_PROTOCOL_VERSION
}

fn unix_timestamp_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

/// Whether a peer advertising `peer_version` speaks a protocol this build can
/// sync with. Mirror of `isSyncProtocolCompatible` in `@motif/shared`.
pub fn is_sync_protocol_compatible(peer_version: u32) -> bool {
    peer_version == SYNC_PROTOCOL_VERSION
}

/// Number of digits in the pairing code Bridge displays. Mirror of
/// `PAIRING_CODE_LENGTH` in `@motif/shared`.
pub const PAIRING_CODE_LENGTH: usize = 6;

/// How long a displayed pairing code remains usable.
pub const PAIRING_CODE_TTL_SECS: u64 = 10 * 60;

/// Wrong codes allowed before pairing is temporarily locked.
pub const PAIRING_MAX_FAILED_ATTEMPTS: u32 = 5;

/// Cooldown after too many wrong pairing codes.
pub const PAIRING_LOCKOUT_SECS: u64 = 60;

/// Whether `code` is a well-formed pairing code (exactly [`PAIRING_CODE_LENGTH`]
/// ASCII digits). Mirror of `isValidPairingCode` in `@motif/shared`.
pub fn is_valid_pairing_code(code: &str) -> bool {
    code.len() == PAIRING_CODE_LENGTH && code.bytes().all(|b| b.is_ascii_digit())
}

/// The role a paired device plays in a sync session.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DeviceRole {
    Capture,
    Bridge,
}

/// A device announcing itself for pairing / discovery. Mirror of
/// `DeviceIdentity` in `@motif/shared`; `camelCase` keeps the JSON wire format
/// identical to the TypeScript side (`deviceId`, `displayName`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceIdentity {
    pub device_id: String,
    pub display_name: String,
    pub role: DeviceRole,
}

/// Stored audio format for an Idea's recording. Mirror of `AudioFormat`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AudioFormat {
    Aac,
    Wav,
}

/// Where an Idea's audio currently lives. Mirror of `IdeaStorageState`;
/// `kebab-case` renders `OnDevice` as the wire value `"on-device"`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum IdeaStorageState {
    OnDevice,
    Offloaded,
}

/// Where an Idea was recorded (motif-kka.3). Mirror of `IdeaLocation` in
/// `@motif/shared`. Captured opt-in on Capture; Bridge can edit the `label` or
/// remove the whole location tag, syncing per-field like the other metadata (ADR
/// 0006). (`Eq` is not derived — the coordinates are floats.)
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdeaLocation {
    pub lat: f64,
    pub lon: f64,
    /// Reverse-geocoded place label, or `""` when none could be resolved.
    pub label: String,
}

/// Per-field last-edit timestamps (epoch ms) driving last-write-wins metadata
/// merges (ADR 0006). Mirror of `IdeaFieldTimestamps` in `@motif/shared`. Every
/// field `#[serde(default)]`s to 0 so a Library persisted before this schema
/// still deserializes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FieldTimestamps {
    #[serde(default)]
    pub name: i64,
    #[serde(default)]
    pub tags: i64,
    #[serde(default)]
    pub instrument: i64,
    #[serde(default)]
    pub style: i64,
    #[serde(default)]
    pub tempo: i64,
    #[serde(default)]
    pub location: i64,
}

/// Portable Idea metadata — the syncable record for one captured recording.
/// Mirror of `IdeaMetadata` in `@motif/shared`. The on-device audio file path
/// is deliberately *not* part of this schema (it's a device-local detail). The
/// editable fields (tags/instrument/style/tempo) each carry a timestamp in
/// [`FieldTimestamps`] so bidirectional edits merge per-field (ADR 0006). `Eq`
/// is intentionally not derived — `tempo` is a float.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdeaMetadata {
    pub id: String,
    pub name: String,
    /// Epoch milliseconds when the recording was captured.
    pub captured_at: i64,
    /// Recording length in milliseconds.
    pub duration_ms: i64,
    pub audio_format: AudioFormat,
    pub channels: u8,
    pub storage_state: IdeaStorageState,
    /// Free-text tags; zero or many (CONTEXT.md).
    #[serde(default)]
    pub tags: Vec<String>,
    /// Instruments on the recording; same shape as `tags`.
    #[serde(default)]
    pub instrument: Vec<String>,
    /// Musical styles; same shape as `tags`.
    #[serde(default)]
    pub style: Vec<String>,
    /// Tempo in BPM, or `None` when unset.
    #[serde(default)]
    pub tempo: Option<f64>,
    /// Where the recording was made, or `None` when untagged (motif-kka.3).
    #[serde(default)]
    pub location: Option<IdeaLocation>,
    /// Per-field last-edit timestamps (ADR 0006).
    #[serde(default)]
    pub field_updated_at: FieldTimestamps,
}

/// A metadata-only edit applied on this device — the full desired editable
/// state. Only the fields that actually change are re-stamped, so re-saving an
/// unchanged field never makes it spuriously win a merge. Mirror of the edit
/// payload the Bridge frontend sends via the `edit_idea` command.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdeaMetadataEdit {
    pub name: String,
    pub tags: Vec<String>,
    pub instrument: Vec<String>,
    pub style: Vec<String>,
    pub tempo: Option<f64>,
    /// The desired location tag: `Some` to set/relabel, `None` to remove or leave
    /// untagged. Only re-stamped when it differs from the held value.
    #[serde(default)]
    pub location: Option<IdeaLocation>,
}

/// Applies `edit` to `idea` in place, stamping each field that changes at
/// `edited_at` — the same stamp-only-what-changed rule as `applyIdeaEdit` in
/// `@motif/shared` (which takes a partial edit rather than this full state).
pub fn apply_idea_edit(idea: &mut IdeaMetadata, edit: &IdeaMetadataEdit, edited_at: i64) {
    if idea.name != edit.name {
        idea.name = edit.name.clone();
        idea.field_updated_at.name = edited_at;
    }
    if idea.tags != edit.tags {
        idea.tags = edit.tags.clone();
        idea.field_updated_at.tags = edited_at;
    }
    if idea.instrument != edit.instrument {
        idea.instrument = edit.instrument.clone();
        idea.field_updated_at.instrument = edited_at;
    }
    if idea.style != edit.style {
        idea.style = edit.style.clone();
        idea.field_updated_at.style = edited_at;
    }
    if idea.tempo != edit.tempo {
        idea.tempo = edit.tempo;
        idea.field_updated_at.tempo = edited_at;
    }
    if idea.location != edit.location {
        idea.location = edit.location.clone();
        idea.field_updated_at.location = edited_at;
    }
}

/// Merges two versions of the same Idea by per-field last-write-wins (ADR 0006):
/// each editable field takes the value from whichever side edited it most
/// recently, ties keeping `local`. Device-local facts — id, capture details,
/// audio format/channels, and `storage_state` — always stay `local`. Mirror of
/// `mergeIdea` in `@motif/shared`.
pub fn merge_idea(local: &IdeaMetadata, incoming: &IdeaMetadata) -> IdeaMetadata {
    let mut merged = local.clone();
    if incoming.field_updated_at.name > local.field_updated_at.name {
        merged.name = incoming.name.clone();
        merged.field_updated_at.name = incoming.field_updated_at.name;
    }
    if incoming.field_updated_at.tags > local.field_updated_at.tags {
        merged.tags = incoming.tags.clone();
        merged.field_updated_at.tags = incoming.field_updated_at.tags;
    }
    if incoming.field_updated_at.instrument > local.field_updated_at.instrument {
        merged.instrument = incoming.instrument.clone();
        merged.field_updated_at.instrument = incoming.field_updated_at.instrument;
    }
    if incoming.field_updated_at.style > local.field_updated_at.style {
        merged.style = incoming.style.clone();
        merged.field_updated_at.style = incoming.field_updated_at.style;
    }
    if incoming.field_updated_at.tempo > local.field_updated_at.tempo {
        merged.tempo = incoming.tempo;
        merged.field_updated_at.tempo = incoming.field_updated_at.tempo;
    }
    if incoming.field_updated_at.location > local.field_updated_at.location {
        merged.location = incoming.location.clone();
        merged.field_updated_at.location = incoming.field_updated_at.location;
    }
    merged
}

/// Whether two copies of an Idea carry identical editable metadata *and*
/// per-field stamps — i.e. neither side has an edit the other is missing.
/// Mirror of `sameEditableMetadata` in `@motif/shared`.
pub fn same_editable_metadata(a: &IdeaMetadata, b: &IdeaMetadata) -> bool {
    a.name == b.name
        && a.tags == b.tags
        && a.instrument == b.instrument
        && a.style == b.style
        && a.tempo == b.tempo
        && a.location == b.location
        && a.field_updated_at == b.field_updated_at
}

/// The outcome of reconciling this device's metadata against a peer's snapshot.
/// The counterpart of `MetadataReconciliation` in Capture's sync engine, which
/// hands back a merged Library because it reconciles a value; here the merge
/// lands in the held Library as it goes, so `changed` is all the caller needs.
#[derive(Debug, Clone, PartialEq)]
pub struct MetadataReconciliation {
    /// Whether merging the peer's copies changed this Library, so the caller
    /// knows whether to persist.
    pub changed: bool,
    /// Merged Ideas whose local copy is ahead of the peer's, to push back.
    pub to_push: Vec<IdeaMetadata>,
}

/// How long a deleted Idea stays restorable on this device before it may be
/// purged (CONTEXT.md, ADR 0005). Mirror of `RECENTLY_DELETED_RETENTION_MS`.
pub const RECENTLY_DELETED_RETENTION_MS: i64 = 30 * 24 * 60 * 60 * 1000;

/// This device's view of whether an Idea is deleted. Mirror of `IdeaDeletion`
/// in `@motif/shared`. Both stamps are epoch ms and only move forward, so
/// merging two devices' records is a per-field max — order-independent and
/// repeatable. A record whose restore is the later stamp is kept rather than
/// dropped: it's what stops a peer's older tombstone from re-deleting the Idea
/// on the next exchange.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdeaDeletion {
    pub id: String,
    /// When this Idea was last deleted, on whichever device deleted it.
    pub deleted_at: i64,
    /// When it was last restored; `0` when it never has been. `#[serde(default)]`
    /// so a log written before restore existed still loads.
    #[serde(default)]
    pub restored_at: i64,
}

impl IdeaDeletion {
    /// Whether the deletion is the more recent of this record's two stamps.
    pub fn is_deleted(&self) -> bool {
        self.deleted_at > self.restored_at
    }

    /// When this device may purge the Idea for good (motif-kka.8).
    pub fn purge_at(&self) -> i64 {
        self.deleted_at
            .saturating_add(RECENTLY_DELETED_RETENTION_MS)
    }
}

/// This device's set of delete/restore records — the tombstones exchanged with
/// a paired peer so a delete lands everywhere, however long a device was
/// offline (ADR 0005). Mirror of the `deletion` module in `@motif/shared`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DeletionLog {
    records: Vec<IdeaDeletion>,
}

impl DeletionLog {
    pub fn new() -> Self {
        Self::default()
    }

    /// Rebuilds a log from persisted records.
    pub fn from_records(records: Vec<IdeaDeletion>) -> Self {
        Self { records }
    }

    pub fn records(&self) -> &[IdeaDeletion] {
        &self.records
    }

    fn find_mut(&mut self, id: &str) -> Option<&mut IdeaDeletion> {
        self.records.iter_mut().find(|record| record.id == id)
    }

    /// Whether this device currently considers `id` deleted.
    pub fn is_deleted(&self, id: &str) -> bool {
        self.records
            .iter()
            .any(|record| record.id == id && record.is_deleted())
    }

    /// Records a local delete, returning whether the log changed. Deleting an
    /// already-deleted Idea is a no-op, so a re-delete never restarts the 30-day
    /// window. The stamp is nudged past any restore this device knows about, so
    /// a local action holds even if a peer's clock ran ahead.
    pub fn mark_deleted(&mut self, id: &str, deleted_at: i64) -> bool {
        match self.find_mut(id) {
            Some(record) if record.is_deleted() => false,
            Some(record) => {
                record.deleted_at = deleted_at.max(record.restored_at.saturating_add(1));
                true
            }
            None => {
                self.records.push(IdeaDeletion {
                    id: id.to_string(),
                    deleted_at,
                    restored_at: 0,
                });
                true
            }
        }
    }

    /// Records a local restore, returning whether the log changed. Restoring an
    /// Idea that isn't deleted is a no-op; as with a delete, the stamp is nudged
    /// past the deletion it undoes so it holds regardless of clock skew.
    pub fn mark_restored(&mut self, id: &str, restored_at: i64) -> bool {
        match self.find_mut(id) {
            Some(record) if record.is_deleted() => {
                record.restored_at = restored_at.max(record.deleted_at.saturating_add(1));
                true
            }
            _ => false,
        }
    }

    /// Merges a peer's records in, taking the later of each stamp per Idea.
    /// Returns whether anything changed, so the caller knows to persist.
    /// Idempotent: re-exchanging the same log reports no change.
    pub fn merge(&mut self, incoming: &[IdeaDeletion]) -> bool {
        let mut changed = false;
        for record in incoming {
            match self.find_mut(&record.id) {
                Some(existing) => {
                    let deleted_at = existing.deleted_at.max(record.deleted_at);
                    let restored_at = existing.restored_at.max(record.restored_at);
                    if deleted_at != existing.deleted_at || restored_at != existing.restored_at {
                        existing.deleted_at = deleted_at;
                        existing.restored_at = restored_at;
                        changed = true;
                    }
                }
                None => {
                    self.records.push(record.clone());
                    changed = true;
                }
            }
        }
        changed
    }

    /// The deletions whose grace period has elapsed by `now` — the Ideas this
    /// device may purge for good (motif-kka.8). Restored Ideas never expire.
    pub fn expired(&self, now: i64) -> Vec<&IdeaDeletion> {
        self.records
            .iter()
            .filter(|record| record.is_deleted() && record.purge_at() <= now)
            .collect()
    }
}

/// A deleted Idea as shown in Recently Deleted, with when it stops being
/// restorable on this device.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentlyDeletedIdea {
    pub idea: IdeaMetadata,
    pub deleted_at: i64,
    pub purge_at: i64,
}

/// The on-device file extension for an Idea's audio, derived from its format —
/// AAC lives in an `.m4a` container, WAV in `.wav`. Mirror of `audioExtension`
/// in Capture's `recording-config`.
pub fn audio_extension(format: AudioFormat) -> &'static str {
    match format {
        AudioFormat::Wav => ".wav",
        AudioFormat::Aac => ".m4a",
    }
}

/// Work required to expose an Idea as a DAW-ready WAV file. The shell executes
/// the transcode because codecs and filesystem access are runtime concerns;
/// this core decision keeps format gating independently testable.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HandoffPlan {
    /// Pro Ideas are already WAV, so hand off the received file unchanged.
    UseOriginal(PathBuf),
    /// Free/Basic Ideas are AAC and need a temporary WAV export.
    TranscodeToWav {
        source: PathBuf,
        destination: PathBuf,
    },
}

/// Plans the file Bridge gives to a DAW when an Idea is dragged out.
pub fn plan_handoff(idea: &IdeaMetadata, source: &Path, handoff_dir: &Path) -> HandoffPlan {
    match idea.audio_format {
        AudioFormat::Wav => HandoffPlan::UseOriginal(source.to_path_buf()),
        AudioFormat::Aac => HandoffPlan::TranscodeToWav {
            source: source.to_path_buf(),
            destination: handoff_dir.join(format!("{}.wav", idea.id)),
        },
    }
}

/// Bridge's Library: the flat, reverse-chronological list of received Ideas
/// (CONTEXT.md). Deduplicated by id — a synced Idea is inserted at most once,
/// so re-offers are idempotent.
#[derive(Debug, Clone, Default)]
pub struct BridgeLibrary {
    ideas: Vec<IdeaMetadata>,
}

impl BridgeLibrary {
    pub fn new() -> Self {
        Self::default()
    }

    /// Builds a Library from persisted Ideas, dropping duplicate ids (first
    /// wins) and ordering newest-first — so a manifest loaded from disk has the
    /// same invariants as one built by [`insert`](Self::insert).
    pub fn from_ideas(ideas: Vec<IdeaMetadata>) -> Self {
        let mut seen = std::collections::HashSet::new();
        let mut deduped: Vec<IdeaMetadata> = ideas
            .into_iter()
            .filter(|i| seen.insert(i.id.clone()))
            .collect();
        for idea in &mut deduped {
            // Mirror `withMetadataDefaults` in `@motif/shared`: a Library
            // persisted before per-field timestamps existed loads with a name
            // stamp of 0; treat the name as set at capture so both devices agree.
            if idea.field_updated_at.name == 0 {
                idea.field_updated_at.name = idea.captured_at;
            }
        }
        Self::sort(&mut deduped);
        Self { ideas: deduped }
    }

    fn sort(ideas: &mut [IdeaMetadata]) {
        // Stable, newest-first: Ideas captured at the same instant keep order.
        ideas.sort_by_key(|idea| std::cmp::Reverse(idea.captured_at));
    }

    pub fn has(&self, id: &str) -> bool {
        self.get(id).is_some()
    }

    /// The held Idea with this id, or `None` when the Library has no such Idea.
    pub fn get(&self, id: &str) -> Option<&IdeaMetadata> {
        self.ideas.iter().find(|i| i.id == id)
    }

    /// Adds an Idea, keeping the list newest-first. Returns `false` (leaving the
    /// Library unchanged) if an Idea with the same id is already present.
    pub fn insert(&mut self, idea: IdeaMetadata) -> bool {
        if self.has(&idea.id) {
            return false;
        }
        self.ideas.push(idea);
        Self::sort(&mut self.ideas);
        true
    }

    /// Merges an incoming Idea's metadata into the held copy by per-field
    /// last-write-wins (ADR 0006). Returns `true` if the merge changed anything;
    /// an update for an Idea not held is dropped (`false`) since its audio never
    /// arrived. Never reorders — an edit is not a capture.
    pub fn merge(&mut self, incoming: &IdeaMetadata) -> bool {
        let Some(existing) = self.ideas.iter_mut().find(|i| i.id == incoming.id) else {
            return false;
        };
        let merged = merge_idea(existing, incoming);
        if merged != *existing {
            *existing = merged;
            return true;
        }
        false
    }

    /// Applies a local metadata edit to the held Idea, returning its new state,
    /// or `None` if no Idea has that id. Only changed fields are re-stamped.
    pub fn edit(
        &mut self,
        id: &str,
        edit: &IdeaMetadataEdit,
        edited_at: i64,
    ) -> Option<IdeaMetadata> {
        let existing = self.ideas.iter_mut().find(|i| i.id == id)?;
        apply_idea_edit(existing, edit, edited_at);
        Some(existing.clone())
    }

    /// Removes an Idea for good, returning it so the caller can delete its
    /// audio. `None` when no Idea has that id. Only the purge sweep calls this
    /// — an ordinary delete is soft and leaves the Idea in place (ADR 0005).
    pub fn remove(&mut self, id: &str) -> Option<IdeaMetadata> {
        let index = self.ideas.iter().position(|idea| idea.id == id)?;
        Some(self.ideas.remove(index))
    }

    /// The ids Bridge already holds — the `have` set it reports to Capture.
    pub fn have_ids(&self) -> Vec<String> {
        self.ideas.iter().map(|i| i.id.clone()).collect()
    }

    pub fn ideas(&self) -> &[IdeaMetadata] {
        &self.ideas
    }

    pub fn len(&self) -> usize {
        self.ideas.len()
    }

    pub fn is_empty(&self) -> bool {
        self.ideas.is_empty()
    }
}

/// Capture asking to pair. Mirror of `PairingRequest`. Deserialize-only: Bridge
/// receives these. A `kind` field on the wire is ignored (serde skips unknown
/// fields), so this parses the full `@motif/shared` message.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingRequest {
    pub protocol_version: u32,
    pub from: DeviceIdentity,
    pub pairing_code: String,
}

/// Bridge's answer to a [`PairingRequest`]. Mirror of `PairingResponse`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingResponse {
    pub kind: String,
    pub protocol_version: u32,
    pub accepted: bool,
    pub bridge: DeviceIdentity,
}

impl PairingResponse {
    fn new(accepted: bool, bridge: DeviceIdentity) -> Self {
        Self {
            kind: "pairing-response".to_string(),
            protocol_version: SYNC_PROTOCOL_VERSION,
            accepted,
            bridge,
        }
    }
}

/// An Idea offered by Capture. Mirror of `IdeaSyncOffer`. Deserialize-only.
/// (`Eq` is not derived — `IdeaMetadata` carries a float `tempo`.)
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdeaSyncOffer {
    pub from: DeviceIdentity,
    pub idea: IdeaMetadata,
    pub audio_byte_length: i64,
}

/// Bridge's response to an offer. Mirror of `IdeaSyncAck`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdeaSyncAck {
    pub kind: String,
    pub idea_id: String,
    pub accepted: bool,
}

impl IdeaSyncAck {
    fn new(idea_id: String, accepted: bool) -> Self {
        Self {
            kind: "idea-sync-ack".to_string(),
            idea_id,
            accepted,
        }
    }
}

/// A metadata-only edit propagated from a paired peer. Mirror of
/// `IdeaMetadataUpdate` in `@motif/shared`. Deserialize-only: Bridge receives
/// these over `POST /motif/updates` and merges them into an Idea it already
/// holds (an update for an unknown Idea is ignored — its audio never arrived).
/// The message's `kind` discriminant is ignored (serde skips unknown fields),
/// so this parses the full `@motif/shared` message.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdeaMetadataUpdate {
    pub from: DeviceIdentity,
    pub idea: IdeaMetadata,
}

/// Bridge's response to an [`IdeaMetadataUpdate`]. Mirror of `IdeaUpdateAck`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdeaUpdateAck {
    pub kind: String,
    pub idea_id: String,
    pub accepted: bool,
}

impl IdeaUpdateAck {
    fn new(idea_id: String, accepted: bool) -> Self {
        Self {
            kind: "idea-update-ack".to_string(),
            idea_id,
            accepted,
        }
    }
}

/// What a device holds and what it has deleted. Mirror of `SyncManifest`.
/// Bridge serves one so Capture offers only the Ideas it's missing, and Capture
/// posts one back so the two devices' delete records meet (ADR 0005). A peer on
/// an older build sends no `deleted`, which `#[serde(default)]` reads as none.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncManifest {
    pub kind: String,
    pub from: DeviceIdentity,
    pub have: Vec<String>,
    #[serde(default)]
    pub deleted: Vec<IdeaDeletion>,
}

impl SyncManifest {
    /// Builds a manifest announcing what `from` holds and has deleted — either
    /// direction of the exchange, since Capture posts one too.
    pub fn from_device(
        from: DeviceIdentity,
        have: Vec<String>,
        deleted: Vec<IdeaDeletion>,
    ) -> Self {
        Self {
            kind: "sync-manifest".to_string(),
            from,
            have,
            deleted,
        }
    }
}

/// The durable part of Bridge's local-network pairing. The shell serializes
/// this alongside the Library so Bridge keeps the same identity, pairing code,
/// and paired Capture across restarts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingState {
    identity: DeviceIdentity,
    pairing_code: String,
    /// Unix timestamp in seconds. Missing on legacy files, which makes their
    /// long-lived code immediately eligible for rotation by the shell.
    #[serde(default)]
    pairing_code_expires_at: u64,
    paired: Option<DeviceIdentity>,
}

impl PairingState {
    pub fn new(
        identity: DeviceIdentity,
        pairing_code: String,
        issued_at: u64,
        paired: Option<DeviceIdentity>,
    ) -> Self {
        Self {
            identity,
            pairing_code,
            pairing_code_expires_at: issued_at.saturating_add(PAIRING_CODE_TTL_SECS),
            paired,
        }
    }

    pub fn identity(&self) -> &DeviceIdentity {
        &self.identity
    }

    pub fn pairing_code(&self) -> &str {
        &self.pairing_code
    }

    pub fn paired(&self) -> Option<&DeviceIdentity> {
        self.paired.as_ref()
    }
}

/// Security state surfaced by the Tauri shell alongside the current code.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingStatus {
    pub code: String,
    pub expires_at: u64,
    pub locked_until: Option<u64>,
}

/// The receiver-side session: this Bridge's durable pairing and its received
/// Library. Owns every pairing/accept decision so the transport shell stays
/// thin.
#[derive(Debug, Clone)]
pub struct SyncState {
    pairing: PairingState,
    library: BridgeLibrary,
    deletions: DeletionLog,
    failed_pairing_attempts: u32,
    locked_until: Option<u64>,
}

impl SyncState {
    pub fn new(pairing: PairingState, library: BridgeLibrary) -> Self {
        Self {
            pairing,
            library,
            deletions: DeletionLog::new(),
            failed_pairing_attempts: 0,
            locked_until: None,
        }
    }

    /// Restores the delete/restore records persisted by the shell, so a delete
    /// survives a restart and is still exchanged with Capture afterwards.
    pub fn with_deletions(mut self, deletions: DeletionLog) -> Self {
        self.deletions = deletions;
        self
    }

    pub fn identity(&self) -> &DeviceIdentity {
        self.pairing.identity()
    }

    pub fn pairing_code(&self) -> &str {
        self.pairing.pairing_code()
    }

    pub fn pairing(&self) -> &PairingState {
        &self.pairing
    }

    pub fn library(&self) -> &BridgeLibrary {
        &self.library
    }

    pub fn deletions(&self) -> &DeletionLog {
        &self.deletions
    }

    /// The Library the user sees: everything held minus everything deleted.
    pub fn active_ideas(&self) -> Vec<IdeaMetadata> {
        self.library
            .ideas()
            .iter()
            .filter(|idea| !self.deletions.is_deleted(&idea.id))
            .cloned()
            .collect()
    }

    /// The Recently Deleted list, most recently deleted first. A record whose
    /// Idea has already been purged is skipped — the record outlives the Idea so
    /// peers still learn about the delete.
    pub fn recently_deleted(&self) -> Vec<RecentlyDeletedIdea> {
        let mut deleted: Vec<RecentlyDeletedIdea> = self
            .deletions
            .records()
            .iter()
            .filter(|record| record.is_deleted())
            .filter_map(|record| {
                self.library
                    .ideas()
                    .iter()
                    .find(|idea| idea.id == record.id)
                    .map(|idea| RecentlyDeletedIdea {
                        idea: idea.clone(),
                        deleted_at: record.deleted_at,
                        purge_at: record.purge_at(),
                    })
            })
            .collect();
        deleted.sort_by_key(|entry| std::cmp::Reverse(entry.deleted_at));
        deleted
    }

    /// Deletes an Idea on this device: soft, so its metadata and audio stay put
    /// for the 30-day grace period and the tombstone can reach Capture on the
    /// next exchange. Returns whether anything changed — an unknown or
    /// already-deleted id changes nothing.
    pub fn delete_idea(&mut self, id: &str, deleted_at: i64) -> bool {
        self.library.has(id) && self.deletions.mark_deleted(id, deleted_at)
    }

    /// Restores a deleted Idea. Bridge still holds the audio inside the grace
    /// period, so nothing needs re-fetching; the restore reaches Capture through
    /// the same record exchange that carried the delete.
    pub fn restore_idea(&mut self, id: &str, restored_at: i64) -> bool {
        self.deletions.mark_restored(id, restored_at)
    }

    /// Purges every Idea whose 30-day window has elapsed by `now`, returning
    /// the ones removed so the caller can delete their audio (motif-kka.8).
    /// There is no server to schedule this (ADR 0005), so Bridge sweeps at
    /// launch.
    ///
    /// The delete records stay: a record is the only thing that can still carry
    /// the delete to a Capture offline since before the window, and that has to
    /// hold "however long that takes" (CONTEXT.md). Keeping them is also what
    /// makes this idempotent — the next sweep finds the Ideas already gone.
    pub fn purge_expired(&mut self, now: i64) -> Vec<IdeaMetadata> {
        let expired: Vec<String> = self
            .deletions
            .expired(now)
            .into_iter()
            .map(|record| record.id.clone())
            .collect();
        expired
            .iter()
            .filter_map(|id| self.library.remove(id))
            .collect()
    }

    /// Merges the paired Capture's manifest into this device's records — the
    /// receiving half of the delete exchange (ADR 0005). Gated on pairing like
    /// every other inbound change; returns whether anything changed, so the
    /// caller knows to persist.
    pub fn apply_peer_manifest(&mut self, manifest: &SyncManifest) -> bool {
        if !self.is_paired_with(&manifest.from.device_id) {
            return false;
        }
        self.deletions.merge(&manifest.deleted)
    }

    pub fn is_paired(&self) -> bool {
        self.pairing.paired.is_some()
    }

    pub fn paired_peer(&self) -> Option<&DeviceIdentity> {
        self.pairing.paired()
    }

    fn is_paired_with(&self, device_id: &str) -> bool {
        self.pairing
            .paired
            .as_ref()
            .is_some_and(|p| p.device_id == device_id)
    }

    /// Current code lifetime and lockout state for display by the shell.
    pub fn pairing_status_at(&self, now: u64) -> PairingStatus {
        PairingStatus {
            code: self.pairing.pairing_code.clone(),
            expires_at: self.pairing.pairing_code_expires_at,
            locked_until: self.locked_until.filter(|until| *until > now),
        }
    }

    /// Replaces an expired code and begins a fresh attempt window. Invalid
    /// codes are refused so the shell cannot accidentally make pairing
    /// impossible.
    pub fn rotate_pairing_code(&mut self, code: String, now: u64) -> bool {
        if !is_valid_pairing_code(&code) {
            return false;
        }
        self.pairing.pairing_code = code;
        self.pairing.pairing_code_expires_at = now.saturating_add(PAIRING_CODE_TTL_SECS);
        self.failed_pairing_attempts = 0;
        self.locked_until = None;
        true
    }

    /// Decides and applies a pairing request using the system clock.
    pub fn handle_pairing(&mut self, req: &PairingRequest) -> PairingResponse {
        self.handle_pairing_at(req, unix_timestamp_secs())
    }

    /// Deterministic pairing seam. A code must be compatible, unexpired, and
    /// correct. Repeated wrong codes trigger a global cooldown, preventing a
    /// LAN peer from brute-forcing the six-digit trust boundary.
    pub fn handle_pairing_at(&mut self, req: &PairingRequest, now: u64) -> PairingResponse {
        if self.locked_until.is_some_and(|until| until <= now) {
            self.locked_until = None;
            self.failed_pairing_attempts = 0;
        }

        let compatible = is_sync_protocol_compatible(req.protocol_version);
        let code_active = now < self.pairing.pairing_code_expires_at;
        let locked = self.locked_until.is_some_and(|until| until > now);
        let code_matches = req.pairing_code == self.pairing.pairing_code;
        let accepted = compatible && code_active && !locked && code_matches;

        if accepted {
            self.failed_pairing_attempts = 0;
            self.locked_until = None;
            self.pairing.paired = Some(req.from.clone());
        } else if compatible && code_active && !locked && !code_matches {
            self.failed_pairing_attempts = self.failed_pairing_attempts.saturating_add(1);
            if self.failed_pairing_attempts >= PAIRING_MAX_FAILED_ATTEMPTS {
                self.locked_until = Some(now.saturating_add(PAIRING_LOCKOUT_SECS));
            }
        }
        PairingResponse::new(accepted, self.pairing.identity.clone())
    }

    /// Whether an offer would be accepted: it must come from the paired Capture
    /// and name an Idea neither already held (dedup) nor deleted here. The
    /// deleted check keeps a Capture that hasn't yet learned of the delete from
    /// resurrecting the Idea by re-offering it. Pure — deciding changes nothing
    /// (copy semantics).
    pub fn would_accept(&self, offer: &IdeaSyncOffer) -> bool {
        self.is_paired_with(&offer.from.device_id)
            && !self.library.has(&offer.idea.id)
            && !self.deletions.is_deleted(&offer.idea.id)
    }

    /// Accepts an offered Idea into the Library, returning the ack. Idempotent:
    /// an Idea already held (or an offer from an unpaired peer) acks
    /// `accepted: false` and leaves the Library untouched. The caller stores the
    /// audio payload before calling this so the manifest only ever lists Ideas
    /// whose audio has landed.
    pub fn accept_offer(&mut self, offer: &IdeaSyncOffer) -> IdeaSyncAck {
        let accepted = self.would_accept(offer) && self.library.insert(offer.idea.clone());
        IdeaSyncAck::new(offer.idea.id.clone(), accepted)
    }

    /// Imports an account-authenticated cloud relay Idea. Unlike a LAN offer,
    /// this does not require local pairing: the backend's account boundary is
    /// the trust relationship. It shares the same Library deduplication.
    pub fn import_relay_idea(&mut self, idea: IdeaMetadata) -> bool {
        self.library.insert(idea)
    }

    /// Merges a metadata edit from the paired Capture into the Library by
    /// per-field last-write-wins (ADR 0006). Like an offer, it must come from
    /// the paired peer (the LAN trust boundary); an update for an Idea Bridge
    /// doesn't hold, or from an unpaired peer, is ignored. Returns whether the
    /// Library changed, so the caller knows whether to persist.
    pub fn apply_metadata_update(&mut self, update: &IdeaMetadataUpdate) -> bool {
        if !self.is_paired_with(&update.from.device_id) {
            return false;
        }
        self.library.merge(&update.idea)
    }

    /// Reconciles this Bridge's metadata with the account relay's snapshot,
    /// making cloud metadata sync bidirectional (motif-kka.9). Unlike a LAN
    /// update this needs no local pairing — the backend's account boundary is
    /// the trust relationship, as it already is for a relay import.
    ///
    /// Every Idea both sides hold is merged per-field last-write-wins (ADR
    /// 0006); any whose merged copy leaves the relay behind is returned to push
    /// back. Ideas only one side holds are left alone: the relay can't serve an
    /// Idea whose audio was never uploaded, and an Idea Bridge hasn't received
    /// yet belongs to the audio-carrying import path.
    pub fn reconcile_relay_metadata(&mut self, remote: &[IdeaMetadata]) -> MetadataReconciliation {
        let mut reconciliation = MetadataReconciliation {
            changed: false,
            to_push: Vec::new(),
        };
        for incoming in remote {
            if self.library.merge(incoming) {
                reconciliation.changed = true;
            }
            // Absent means the peer holds an Idea this device doesn't, which the
            // merge above already declined; there is nothing to send back.
            let Some(merged) = self.library.get(&incoming.id) else {
                continue;
            };
            if !same_editable_metadata(merged, incoming) {
                reconciliation.to_push.push(merged.clone());
            }
        }
        reconciliation
    }

    /// Applies a local metadata edit made on Bridge, returning the updated Idea
    /// (or `None` if the id is unknown). The updated Idea, stamped for merge, is
    /// what Bridge later serves to Capture so the edit propagates back.
    pub fn edit_idea(
        &mut self,
        id: &str,
        edit: &IdeaMetadataEdit,
        edited_at: i64,
    ) -> Option<IdeaMetadata> {
        self.library.edit(id, edit, edited_at)
    }

    /// The manifest Bridge reports to Capture: the ids it already holds (soft-
    /// deleted ones included — it still has their audio, so Capture must not
    /// re-offer them) plus its delete/restore records.
    pub fn manifest(&self) -> SyncManifest {
        SyncManifest::from_device(
            self.pairing.identity.clone(),
            self.library.have_ids(),
            self.deletions.records().to_vec(),
        )
    }
}
