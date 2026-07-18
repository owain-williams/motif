//! Bridge core (scaffold).
//!
//! This crate owns Bridge's testable domain logic and maintains its own
//! equivalent of the sync protocol types (mirroring `@motif/shared` on the
//! TypeScript side, per ADR 0003). For the scaffold it exposes only the
//! protocol version and the shared device/role vocabulary; the real
//! discovery/transfer, cloud relay, transcode, and pairing logic lands in
//! later tickets and is tested here with `cargo test` — no Tauri window
//! required.

use serde::{Deserialize, Serialize};

/// Sync protocol version negotiated between Capture and Bridge. Must stay in
/// step with `SYNC_PROTOCOL_VERSION` in `@motif/shared`.
pub const SYNC_PROTOCOL_VERSION: u32 = 1;

/// Returns the sync protocol version this Bridge build speaks.
pub fn sync_protocol_version() -> u32 {
    SYNC_PROTOCOL_VERSION
}

/// The role a paired device plays in a sync session.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DeviceRole {
    Capture,
    Bridge,
}

/// A device announcing itself for pairing / discovery. Placeholder mirror of
/// `DeviceIdentity` in `@motif/shared`; `camelCase` keeps the JSON wire format
/// identical to the TypeScript side (`deviceId`, `displayName`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceIdentity {
    pub device_id: String,
    pub display_name: String,
    pub role: DeviceRole,
}
