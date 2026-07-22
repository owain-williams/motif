//! Account-scoped cloud relay import for Basic/Pro Bridge sessions.
//!
//! The import decision is transport-independent and tested with an in-memory
//! [`CloudRelaySource`]. [`HttpCloudRelay`] is the production HTTPS adapter.

use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};

use crate::server::SyncSink;
use crate::{DeviceIdentity, IdeaMetadata, IdeaSyncOffer, SyncState};

pub trait CloudRelaySource {
    /// Idea ids currently held by this account's relay.
    fn manifest(&self) -> Result<Vec<String>, String>;
    /// One length-framed Idea offer and its audio bytes.
    fn download(&self, id: &str) -> Result<Vec<u8>, String>;
    /// The metadata the relay holds for every Idea on this account — the cloud
    /// counterpart of Bridge's own `GET /motif/library`, so an edit made on a
    /// device that is nowhere near this LAN still reaches Bridge.
    fn library(&self) -> Result<Vec<IdeaMetadata>, String>;
    /// Pushes one Bridge-side edit to the relay, returning whether it merged.
    fn push_update(&self, from: &DeviceIdentity, idea: &IdeaMetadata) -> Result<bool, String>;
}

pub struct HttpCloudRelay {
    api_url: String,
    id_token: String,
    client: reqwest::blocking::Client,
}

impl HttpCloudRelay {
    pub fn new(api_url: impl Into<String>, id_token: impl Into<String>) -> Self {
        Self {
            api_url: api_url.into().trim_end_matches('/').to_string(),
            id_token: id_token.into(),
            client: reqwest::blocking::Client::new(),
        }
    }

    fn get(&self, path: &str) -> Result<reqwest::blocking::Response, String> {
        self.client
            .get(format!("{}{}", self.api_url, path))
            .bearer_auth(&self.id_token)
            .send()
            .map_err(|error| error.to_string())?
            .error_for_status()
            .map_err(|error| error.to_string())
    }
}

#[derive(Deserialize)]
struct RelayManifest {
    have: Vec<String>,
}

#[derive(Deserialize)]
struct RelayLibrary {
    ideas: Vec<IdeaMetadata>,
}

#[derive(Deserialize)]
struct RelayUpdateAck {
    accepted: bool,
}

/// The wire form of an outbound metadata edit. Mirrors `IdeaMetadataUpdate` in
/// `@motif/shared` including its `kind` discriminant, which the receive-side
/// [`crate::IdeaMetadataUpdate`] ignores but the relay expects.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OutboundMetadataUpdate<'a> {
    kind: &'static str,
    from: &'a DeviceIdentity,
    idea: &'a IdeaMetadata,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RelayDownload {
    offer: IdeaSyncOffer,
    download_url: String,
}

impl CloudRelaySource for HttpCloudRelay {
    fn manifest(&self) -> Result<Vec<String>, String> {
        self.get("/relay/manifest")?
            .json::<RelayManifest>()
            .map(|manifest| manifest.have)
            .map_err(|error| error.to_string())
    }

    fn download(&self, id: &str) -> Result<Vec<u8>, String> {
        if id.is_empty()
            || !id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || b"-_".contains(&byte))
        {
            return Err("invalid Idea id in relay manifest".to_string());
        }
        let descriptor = self
            .get(&format!("/relay/ideas/{id}"))?
            .json::<RelayDownload>()
            .map_err(|error| error.to_string())?;
        let audio = self
            .client
            .get(&descriptor.download_url)
            .send()
            .map_err(|error| error.to_string())?
            .error_for_status()
            .map_err(|error| error.to_string())?
            .bytes()
            .map_err(|error| error.to_string())?;
        let metadata = serde_json::to_vec(&descriptor.offer).map_err(|error| error.to_string())?;
        let mut frame = Vec::with_capacity(4 + metadata.len() + audio.len());
        frame.extend_from_slice(&(metadata.len() as u32).to_be_bytes());
        frame.extend_from_slice(&metadata);
        frame.extend_from_slice(&audio);
        Ok(frame)
    }

    fn library(&self) -> Result<Vec<IdeaMetadata>, String> {
        self.get("/relay/library")?
            .json::<RelayLibrary>()
            .map(|library| library.ideas)
            .map_err(|error| error.to_string())
    }

    fn push_update(&self, from: &DeviceIdentity, idea: &IdeaMetadata) -> Result<bool, String> {
        self.client
            .post(format!("{}/relay/updates", self.api_url))
            .bearer_auth(&self.id_token)
            .json(&OutboundMetadataUpdate {
                kind: "idea-metadata-update",
                from,
                idea,
            })
            .send()
            .map_err(|error| error.to_string())?
            .error_for_status()
            .map_err(|error| error.to_string())?
            .json::<RelayUpdateAck>()
            .map(|ack| ack.accepted)
            .map_err(|error| error.to_string())
    }
}

/// Imports every relay Idea Bridge does not already hold. The Library dedup is
/// shared with local sync, so the two transports can race safely without
/// creating duplicate Ideas.
pub fn sync_from_cloud(
    source: &dyn CloudRelaySource,
    state: &Arc<Mutex<SyncState>>,
    sink: &dyn SyncSink,
) -> Result<usize, String> {
    let remote = source.manifest()?;
    let mut imported = 0;

    for id in remote {
        if state
            .lock()
            .map_err(|_| "Library unavailable")?
            .library()
            .has(&id)
        {
            continue;
        }
        let frame = source.download(&id)?;
        let (offer, audio) = parse_frame(&frame)?;
        if offer.idea.id != id {
            return Err("relay Idea did not match its manifest id".to_string());
        }

        let mut state = state.lock().map_err(|_| "Library unavailable")?;
        if state.library().has(&id) {
            continue;
        }
        sink.store_audio(&offer.idea, audio)
            .map_err(|error| error.to_string())?;
        if state.import_relay_idea(offer.idea) {
            sink.persist_library(state.library());
            imported += 1;
        }
    }

    Ok(imported)
}

/// Exchanges metadata edits with the account relay in both directions
/// (motif-kka.9): pulls the relay's copies, merges each Idea Bridge also holds
/// by per-field last-write-wins, and pushes back the ones whose local copy is
/// ahead. Returns how many edits the relay accepted.
///
/// Metadata-only — no audio moves, so this is safe to run alongside
/// [`sync_from_cloud`] and never disturbs where an Idea's audio lives. A push
/// that fails ends the pass with the merge already persisted, so the next poll
/// simply retries the remaining edits.
pub fn sync_metadata_with_cloud(
    source: &dyn CloudRelaySource,
    state: &Arc<Mutex<SyncState>>,
    sink: &dyn SyncSink,
) -> Result<usize, String> {
    let remote = source.library()?;
    let (identity, reconciliation) = {
        let mut state = state.lock().map_err(|_| "Library unavailable")?;
        let reconciliation = state.reconcile_relay_metadata(&remote);
        if reconciliation.changed {
            sink.persist_library(state.library());
        }
        (state.identity().clone(), reconciliation)
    };

    let mut pushed = 0;
    for idea in &reconciliation.to_push {
        if source.push_update(&identity, idea)? {
            pushed += 1;
        }
    }
    Ok(pushed)
}

fn parse_frame(frame: &[u8]) -> Result<(IdeaSyncOffer, &[u8]), String> {
    if frame.len() < 4 {
        return Err("relay frame was truncated".to_string());
    }
    let json_len = u32::from_be_bytes([frame[0], frame[1], frame[2], frame[3]]) as usize;
    if frame.len() < 4 + json_len {
        return Err("relay frame metadata was truncated".to_string());
    }
    let offer: IdeaSyncOffer =
        serde_json::from_slice(&frame[4..4 + json_len]).map_err(|error| error.to_string())?;
    let audio = &frame[4 + json_len..];
    if offer.audio_byte_length != audio.len() as i64 {
        return Err("relay audio length did not match its offer".to_string());
    }
    Ok((offer, audio))
}
