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

use serde::{Deserialize, Serialize};

pub mod cloud_relay;
pub mod server;

/// Sync protocol version negotiated between Capture and Bridge. Must stay in
/// step with `SYNC_PROTOCOL_VERSION` in `@motif/shared`.
pub const SYNC_PROTOCOL_VERSION: u32 = 1;

/// Returns the sync protocol version this Bridge build speaks.
pub fn sync_protocol_version() -> u32 {
    SYNC_PROTOCOL_VERSION
}

/// Whether a peer advertising `peer_version` speaks a protocol this build can
/// sync with. Mirror of `isSyncProtocolCompatible` in `@motif/shared`.
pub fn is_sync_protocol_compatible(peer_version: u32) -> bool {
    peer_version == SYNC_PROTOCOL_VERSION
}

/// Number of digits in the pairing code Bridge displays. Mirror of
/// `PAIRING_CODE_LENGTH` in `@motif/shared`.
pub const PAIRING_CODE_LENGTH: usize = 6;

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

/// Portable Idea metadata — the syncable record for one captured recording.
/// Mirror of `IdeaMetadata` in `@motif/shared`. The on-device audio file path
/// is deliberately *not* part of this schema (it's a device-local detail).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
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
        Self::sort(&mut deduped);
        Self { ideas: deduped }
    }

    fn sort(ideas: &mut [IdeaMetadata]) {
        // Stable, newest-first: Ideas captured at the same instant keep order.
        ideas.sort_by_key(|idea| std::cmp::Reverse(idea.captured_at));
    }

    pub fn has(&self, id: &str) -> bool {
        self.ideas.iter().any(|i| i.id == id)
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
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
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

/// Bridge telling Capture which Ideas it already holds. Mirror of `SyncManifest`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncManifest {
    pub kind: String,
    pub from: DeviceIdentity,
    pub have: Vec<String>,
}

impl SyncManifest {
    fn new(from: DeviceIdentity, have: Vec<String>) -> Self {
        Self {
            kind: "sync-manifest".to_string(),
            from,
            have,
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
    paired: Option<DeviceIdentity>,
}

impl PairingState {
    pub fn new(
        identity: DeviceIdentity,
        pairing_code: String,
        paired: Option<DeviceIdentity>,
    ) -> Self {
        Self {
            identity,
            pairing_code,
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

/// The receiver-side session: this Bridge's durable pairing and its received
/// Library. Owns every pairing/accept decision so the transport shell stays
/// thin.
#[derive(Debug, Clone)]
pub struct SyncState {
    pairing: PairingState,
    library: BridgeLibrary,
}

impl SyncState {
    pub fn new(pairing: PairingState, library: BridgeLibrary) -> Self {
        Self { pairing, library }
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

    /// Decides and applies a pairing request. Accepts when the protocol is
    /// compatible *and* the code matches the one Bridge is displaying; on
    /// acceptance it remembers the Capture as its single paired peer (Free
    /// tier), replacing any prior pairing.
    pub fn handle_pairing(&mut self, req: &PairingRequest) -> PairingResponse {
        let accepted = is_sync_protocol_compatible(req.protocol_version)
            && req.pairing_code == self.pairing.pairing_code;
        if accepted {
            self.pairing.paired = Some(req.from.clone());
        }
        PairingResponse::new(accepted, self.pairing.identity.clone())
    }

    /// Whether an offer would be accepted: it must come from the paired Capture
    /// and name an Idea not already held (dedup). Pure — deciding changes
    /// nothing (copy semantics).
    pub fn would_accept(&self, offer: &IdeaSyncOffer) -> bool {
        self.is_paired_with(&offer.from.device_id) && !self.library.has(&offer.idea.id)
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

    /// The manifest Bridge reports to Capture: the ids it already holds.
    pub fn manifest(&self) -> SyncManifest {
        SyncManifest::new(self.pairing.identity.clone(), self.library.have_ids())
    }
}
