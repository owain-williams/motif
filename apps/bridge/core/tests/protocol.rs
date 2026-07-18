//! Scaffold smoke test for the `bridge-core` seam: proves the crate builds
//! and is testable with `cargo test` without launching the Tauri shell.
//! Later tickets add behavioral tests for discovery/transfer, cloud relay,
//! transcode-on-handoff, and pairing here.

use bridge_core::{sync_protocol_version, DeviceIdentity, DeviceRole};

#[test]
fn reports_a_protocol_version() {
    assert_eq!(sync_protocol_version(), 1);
}

#[test]
fn device_identity_round_trips_through_json() {
    let device = DeviceIdentity {
        device_id: "abc-123".to_string(),
        display_name: "Studio Mac".to_string(),
        role: DeviceRole::Bridge,
    };

    let json = serde_json::to_string(&device).expect("serialize");
    let decoded: DeviceIdentity = serde_json::from_str(&json).expect("deserialize");

    assert_eq!(decoded, device);
    // Wire format must match @motif/shared's DeviceIdentity: camelCase fields
    // and a lowercase role.
    assert!(json.contains("\"deviceId\":\"abc-123\""));
    assert!(json.contains("\"displayName\":\"Studio Mac\""));
    assert!(json.contains("\"role\":\"bridge\""));
}
