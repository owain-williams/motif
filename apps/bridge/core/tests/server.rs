//! End-to-end transport test for Free-tier sync (motif-6fu.6): drive the real
//! HTTP receiver over the loopback network with a plain `TcpStream` client, the
//! same way Capture's `fetch`-based client will. Proves pairing, the framed
//! offer+audio upload, and dedup all work across an actual socket — on one
//! machine, no external crates.

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

use bridge_core::server::{SyncServer, SyncSink};
use bridge_core::{
    BridgeLibrary, DeletionLog, DeviceIdentity, DeviceRole, IdeaDeletion, IdeaMetadata,
    PairingState, SyncState, SYNC_PROTOCOL_VERSION,
};

#[derive(Default)]
struct RecordingSink {
    stored: Mutex<Vec<(String, Vec<u8>)>>,
    persisted_len: Mutex<usize>,
    persisted_pairing: Mutex<Option<PairingState>>,
    persisted_deletions: Mutex<Vec<IdeaDeletion>>,
}

impl SyncSink for RecordingSink {
    fn store_audio(&self, idea: &IdeaMetadata, bytes: &[u8]) -> std::io::Result<()> {
        self.stored
            .lock()
            .unwrap()
            .push((idea.id.clone(), bytes.to_vec()));
        Ok(())
    }

    fn persist_library(&self, library: &BridgeLibrary) {
        *self.persisted_len.lock().unwrap() = library.len();
    }

    fn persist_pairing(&self, pairing: &PairingState) {
        *self.persisted_pairing.lock().unwrap() = Some(pairing.clone());
    }

    fn persist_deletions(&self, deletions: &DeletionLog) {
        *self.persisted_deletions.lock().unwrap() = deletions.records().to_vec();
    }
}

fn http(addr: SocketAddr, method: &str, path: &str, body: &[u8]) -> (u16, String) {
    let mut stream = TcpStream::connect(addr).unwrap();
    let head = format!(
        "{method} {path} HTTP/1.1\r\nHost: motif\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    stream.write_all(head.as_bytes()).unwrap();
    stream.write_all(body).unwrap();
    stream.flush().unwrap();

    let mut response = Vec::new();
    stream.read_to_end(&mut response).unwrap();
    let split = (0..response.len().saturating_sub(3))
        .find(|&i| &response[i..i + 4] == b"\r\n\r\n")
        .expect("response has a header terminator");
    let status: u16 = String::from_utf8_lossy(&response[..split])
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|code| code.parse().ok())
        .expect("status code");
    let body = String::from_utf8_lossy(&response[split + 4..]).to_string();
    (status, body)
}

fn pair_body(code: &str) -> String {
    format!(
        r#"{{"kind":"pairing-request","protocolVersion":{SYNC_PROTOCOL_VERSION},"from":{{"deviceId":"cap-1","displayName":"Pixel","role":"capture"}},"pairingCode":"{code}"}}"#
    )
}

fn offer_json(id: &str, audio_len: usize) -> String {
    format!(
        r#"{{"kind":"idea-sync-offer","from":{{"deviceId":"cap-1","displayName":"Pixel","role":"capture"}},"idea":{{"id":"{id}","name":"Idea","capturedAt":1700000000000,"durationMs":4200,"audioFormat":"aac","channels":1,"storageState":"on-device"}},"audioByteLength":{audio_len}}}"#
    )
}

/// Length-frames an offer + audio the way Capture's client will:
/// `[4-byte BE JSON length][offer JSON][audio bytes]`.
fn framed_offer(json: &str, audio: &[u8]) -> Vec<u8> {
    let json = json.as_bytes();
    let mut out = Vec::with_capacity(4 + json.len() + audio.len());
    out.extend_from_slice(&(json.len() as u32).to_be_bytes());
    out.extend_from_slice(json);
    out.extend_from_slice(audio);
    out
}

/// A Capture-to-Bridge manifest: what Capture holds and what it has deleted.
fn capture_manifest_body(have: &str, deleted: &str) -> String {
    format!(
        r#"{{"kind":"sync-manifest","from":{{"deviceId":"cap-1","displayName":"Pixel","role":"capture"}},"have":[{have}],"deleted":[{deleted}]}}"#
    )
}

/// Binds the receiver on a free loopback port and serves it on a thread.
fn start(state: Arc<Mutex<SyncState>>, sink: Arc<RecordingSink>) -> SocketAddr {
    let server = SyncServer::bind("127.0.0.1:0", state, sink).unwrap();
    let addr = server.local_addr().unwrap();
    thread::spawn(move || server.serve_forever());
    addr
}

fn fresh_bridge() -> Arc<Mutex<SyncState>> {
    let identity = DeviceIdentity {
        device_id: "br-1".into(),
        display_name: "Studio Mac".into(),
        role: DeviceRole::Bridge,
    };
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();
    Arc::new(Mutex::new(SyncState::new(
        PairingState::new(identity, "424242".into(), now, None),
        BridgeLibrary::new(),
    )))
}

#[test]
fn syncs_an_idea_over_the_loopback_network() {
    let state = fresh_bridge();
    let sink = Arc::new(RecordingSink::default());
    let addr = start(state.clone(), sink.clone());

    // Wrong pairing code is rejected.
    let (status, body) = http(addr, "POST", "/motif/pair", pair_body("000000").as_bytes());
    assert_eq!(status, 200);
    assert!(body.contains("\"accepted\":false"), "body: {body}");

    // Correct code pairs the two devices.
    let (_, body) = http(addr, "POST", "/motif/pair", pair_body("424242").as_bytes());
    assert!(body.contains("\"accepted\":true"), "body: {body}");
    let persisted_pairing = sink.persisted_pairing.lock().unwrap().clone().unwrap();
    assert_eq!(persisted_pairing.paired().unwrap().device_id, "cap-1");

    // A fresh Bridge has an empty manifest.
    let (_, body) = http(addr, "GET", "/motif/manifest", b"");
    assert!(body.contains("\"have\":[]"), "body: {body}");

    // Offer an Idea and its audio in one framed request.
    let audio: &[u8] = b"FAKE-AAC-AUDIO-BYTES";
    let json = offer_json("song", audio.len());
    let (status, body) = http(addr, "POST", "/motif/ideas", &framed_offer(&json, audio));
    assert_eq!(status, 200);
    assert!(body.contains("\"accepted\":true"), "body: {body}");

    // The audio landed via the sink and the Idea is in Bridge's Library.
    {
        let stored = sink.stored.lock().unwrap();
        assert_eq!(stored.len(), 1);
        assert_eq!(stored[0].0, "song");
        assert_eq!(stored[0].1, audio);
    }
    assert_eq!(state.lock().unwrap().library().len(), 1);
    assert_eq!(*sink.persisted_len.lock().unwrap(), 1);

    // The manifest now advertises the received Idea.
    let (_, body) = http(addr, "GET", "/motif/manifest", b"");
    assert!(body.contains("\"song\""), "body: {body}");

    // Re-offering the same Idea is deduped: accepted:false, no second store.
    let (_, body) = http(addr, "POST", "/motif/ideas", &framed_offer(&json, audio));
    assert!(body.contains("\"accepted\":false"), "body: {body}");
    assert_eq!(sink.stored.lock().unwrap().len(), 1);
}

#[test]
fn exchanges_delete_records_with_capture_over_the_loopback_network() {
    let state = fresh_bridge();
    let sink = Arc::new(RecordingSink::default());
    let addr = start(state.clone(), sink.clone());

    http(addr, "POST", "/motif/pair", pair_body("424242").as_bytes());
    let audio: &[u8] = b"FAKE-AAC-AUDIO-BYTES";
    let json = offer_json("song", audio.len());
    http(addr, "POST", "/motif/ideas", &framed_offer(&json, audio));

    // Capture deletes the Idea and posts its records on the next connection.
    let deleted = r#"{"id":"song","deletedAt":1700000001000,"restoredAt":0}"#;
    let (status, body) = http(
        addr,
        "POST",
        "/motif/manifest",
        capture_manifest_body(r#""song""#, deleted).as_bytes(),
    );
    assert_eq!(status, 200);
    // Bridge answers with its own manifest, now carrying the merged record —
    // one round trip and both devices agree.
    assert!(
        body.contains(r#""deletedAt":1700000001000"#),
        "body: {body}"
    );
    assert_eq!(sink.persisted_deletions.lock().unwrap().len(), 1);
    assert!(state.lock().unwrap().deletions().is_deleted("song"));
    assert!(state.lock().unwrap().active_ideas().is_empty());
    // Soft delete: Bridge still holds the audio, so a restore needs no re-sync.
    assert!(state.lock().unwrap().library().has("song"));

    // A Capture that hasn't caught up cannot resurrect it by re-offering.
    let (_, body) = http(addr, "POST", "/motif/ideas", &framed_offer(&json, audio));
    assert!(body.contains("\"accepted\":false"), "body: {body}");

    // Restoring on Capture rides the same exchange — no extra message.
    let restored = r#"{"id":"song","deletedAt":1700000001000,"restoredAt":1700000002000}"#;
    let (_, body) = http(
        addr,
        "POST",
        "/motif/manifest",
        capture_manifest_body(r#""song""#, restored).as_bytes(),
    );
    assert!(
        body.contains(r#""restoredAt":1700000002000"#),
        "body: {body}"
    );
    assert!(!state.lock().unwrap().deletions().is_deleted("song"));
    assert_eq!(state.lock().unwrap().active_ideas().len(), 1);
}

#[test]
fn a_manifest_from_an_unpaired_peer_changes_nothing() {
    let state = fresh_bridge();
    let sink = Arc::new(RecordingSink::default());
    let addr = start(state.clone(), sink.clone());

    let deleted = r#"{"id":"song","deletedAt":1700000001000,"restoredAt":0}"#;
    let (status, body) = http(
        addr,
        "POST",
        "/motif/manifest",
        capture_manifest_body("", deleted).as_bytes(),
    );
    assert_eq!(status, 200);
    assert!(body.contains(r#""deleted":[]"#), "body: {body}");
    assert!(!state.lock().unwrap().deletions().is_deleted("song"));
    assert!(sink.persisted_deletions.lock().unwrap().is_empty());
}
