//! A tiny, dependency-free HTTP receiver that wires [`SyncState`] to real
//! sockets — the local-network transport for Free-tier sync (motif-6fu.6).
//!
//! Capture (a React Native app that can only speak HTTP, not Tauri commands)
//! reaches Bridge over the LAN through three routes:
//!
//! - `GET  /motif/manifest` → the ids Bridge already holds ([`SyncManifest`]).
//! - `POST /motif/pair`     → a [`PairingRequest`] JSON body → [`PairingResponse`].
//! - `POST /motif/ideas`    → an offered Idea + its audio → [`IdeaSyncAck`].
//!
//! The `/motif/ideas` body is length-framed so metadata and binary audio ride
//! in one request without base64 or multipart:
//! `[4-byte big-endian JSON length][offer JSON][audio bytes]`.
//!
//! The HTTP handling is intentionally minimal — enough for this closed protocol
//! between our own two apps — so it needs no web-framework dependency and stays
//! testable with a plain [`std::net::TcpStream`] client (see `tests/server.rs`).

use std::io::{self, Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream, ToSocketAddrs};
use std::sync::{Arc, Mutex};

use crate::{BridgeLibrary, IdeaMetadata, IdeaSyncOffer, PairingRequest, PairingState, SyncState};

/// Where a receiver persists a synced Idea. Implemented by the Tauri shell
/// (writes audio to the app data dir and the manifest to disk); a test double
/// records the calls. Keeping it a trait lets the transport stay ignorant of
/// the filesystem.
pub trait SyncSink: Send + Sync {
    /// Stores an accepted Idea's audio payload. An `Err` aborts acceptance so
    /// the Library never lists an Idea whose audio didn't land.
    fn store_audio(&self, idea: &IdeaMetadata, bytes: &[u8]) -> io::Result<()>;

    /// Called after the Library changes, so the shell can persist it.
    fn persist_library(&self, library: &BridgeLibrary);

    /// Called after a successful pairing, so the shell can persist it. Sinks
    /// used only for cloud relay can keep the default no-op implementation.
    fn persist_pairing(&self, _pairing: &PairingState) {}
}

/// The local-network sync receiver. Bind it, then run [`serve_forever`] on a
/// background thread.
///
/// [`serve_forever`]: SyncServer::serve_forever
pub struct SyncServer {
    listener: TcpListener,
    state: Arc<Mutex<SyncState>>,
    sink: Arc<dyn SyncSink>,
}

impl SyncServer {
    pub fn bind<A: ToSocketAddrs>(
        addr: A,
        state: Arc<Mutex<SyncState>>,
        sink: Arc<dyn SyncSink>,
    ) -> io::Result<Self> {
        Ok(Self {
            listener: TcpListener::bind(addr)?,
            state,
            sink,
        })
    }

    /// The address the receiver is listening on — the port Bridge shows the
    /// user for manual pairing (zero-config discovery is a follow-up).
    pub fn local_addr(&self) -> io::Result<SocketAddr> {
        self.listener.local_addr()
    }

    /// Serves connections one at a time until the listener closes. A single
    /// paired Capture syncing sequentially needs no concurrency; handling one
    /// connection at a time keeps the shared state lock trivial.
    pub fn serve_forever(&self) {
        for stream in self.listener.incoming() {
            match stream {
                // A bad/broken connection must not take the receiver down.
                Ok(stream) => {
                    let _ = self.handle(stream);
                }
                Err(_) => continue,
            }
        }
    }

    /// Accepts and handles exactly one connection. Used by tests to drive the
    /// receiver deterministically.
    pub fn accept_one(&self) -> io::Result<()> {
        let (stream, _) = self.listener.accept()?;
        self.handle(stream)
    }

    fn handle(&self, mut stream: TcpStream) -> io::Result<()> {
        let request = match read_request(&mut stream)? {
            Some(request) => request,
            None => return Ok(()),
        };
        match (request.method.as_str(), request.path.as_str()) {
            ("GET", "/motif/manifest") => {
                let manifest = self.state.lock().unwrap().manifest();
                write_json(&mut stream, "200 OK", &to_json(&manifest))
            }
            ("POST", "/motif/pair") => {
                match serde_json::from_slice::<PairingRequest>(&request.body) {
                    Ok(req) => {
                        let mut state = self.state.lock().unwrap();
                        let response = state.handle_pairing(&req);
                        if response.accepted {
                            self.sink.persist_pairing(state.pairing());
                        }
                        drop(state);
                        write_json(&mut stream, "200 OK", &to_json(&response))
                    }
                    Err(_) => write_status(&mut stream, "400 Bad Request"),
                }
            }
            ("POST", "/motif/ideas") => self.handle_offer(&mut stream, &request.body),
            _ => write_status(&mut stream, "404 Not Found"),
        }
    }

    fn handle_offer(&self, stream: &mut TcpStream, body: &[u8]) -> io::Result<()> {
        // Framing: [4-byte BE JSON length][offer JSON][audio bytes].
        if body.len() < 4 {
            return write_status(stream, "400 Bad Request");
        }
        let json_len = u32::from_be_bytes([body[0], body[1], body[2], body[3]]) as usize;
        if body.len() < 4 + json_len {
            return write_status(stream, "400 Bad Request");
        }
        let (json, audio) = (&body[4..4 + json_len], &body[4 + json_len..]);
        let offer: IdeaSyncOffer = match serde_json::from_slice(json) {
            Ok(offer) => offer,
            Err(_) => return write_status(stream, "400 Bad Request"),
        };
        if offer.audio_byte_length != audio.len() as i64 {
            return write_status(stream, "400 Bad Request");
        }

        // Decide, store, and insert under one lock so the manifest never lists
        // an Idea whose audio failed to persist (copy semantics: nothing on the
        // Capture side is touched either way). `would_accept` is checked here to
        // gate the audio write, and again inside `accept_offer` to do the insert
        // atomically — the small double-check is what lets us store before insert.
        let mut state = self.state.lock().unwrap();
        if !state.would_accept(&offer) {
            let ack = state.accept_offer(&offer); // acks accepted:false
            let payload = to_json(&ack);
            drop(state);
            return write_json(stream, "200 OK", &payload);
        }
        if self.sink.store_audio(&offer.idea, audio).is_err() {
            drop(state);
            return write_status(stream, "500 Internal Server Error");
        }
        let ack = state.accept_offer(&offer);
        self.sink.persist_library(state.library());
        let payload = to_json(&ack);
        drop(state);
        write_json(stream, "200 OK", &payload)
    }
}

struct HttpRequest {
    method: String,
    path: String,
    body: Vec<u8>,
}

/// Reads one HTTP/1.1 request: the request line, headers, and a body sized by
/// `Content-Length`. Returns `None` if the peer closes before sending a
/// request. Deliberately minimal — no chunked encoding, no keep-alive — which
/// is all our own client needs.
fn read_request(stream: &mut TcpStream) -> io::Result<Option<HttpRequest>> {
    const MAX_HEADER_BYTES: usize = 64 * 1024;
    let mut buf: Vec<u8> = Vec::new();
    let mut chunk = [0u8; 8192];

    let header_end = loop {
        if let Some(pos) = find(&buf, b"\r\n\r\n") {
            break pos + 4;
        }
        if buf.len() > MAX_HEADER_BYTES {
            return Ok(None);
        }
        let n = stream.read(&mut chunk)?;
        if n == 0 {
            return Ok(None);
        }
        buf.extend_from_slice(&chunk[..n]);
    };

    let header_text = String::from_utf8_lossy(&buf[..header_end]);
    let mut lines = header_text.split("\r\n");
    let mut request_line = lines.next().unwrap_or("").split_whitespace();
    let method = request_line.next().unwrap_or("").to_string();
    let path = request_line.next().unwrap_or("").to_string();

    let mut content_length = 0usize;
    for line in lines {
        if let Some((name, value)) = line.split_once(':') {
            if name.trim().eq_ignore_ascii_case("content-length") {
                content_length = value.trim().parse().unwrap_or(0);
            }
        }
    }

    let mut body = buf[header_end..].to_vec();
    while body.len() < content_length {
        let n = stream.read(&mut chunk)?;
        if n == 0 {
            break;
        }
        body.extend_from_slice(&chunk[..n]);
    }
    body.truncate(content_length);

    Ok(Some(HttpRequest { method, path, body }))
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || haystack.len() < needle.len() {
        return None;
    }
    (0..=haystack.len() - needle.len()).find(|&i| &haystack[i..i + needle.len()] == needle)
}

/// Serializes one of our own protocol types. They always serialize, so a
/// failure is a bug, not a runtime condition to surface.
fn to_json<T: serde::Serialize>(value: &T) -> Vec<u8> {
    serde_json::to_vec(value).expect("protocol types are always serializable")
}

fn write_json(stream: &mut TcpStream, status: &str, body: &[u8]) -> io::Result<()> {
    let header = format!(
        "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    stream.write_all(header.as_bytes())?;
    stream.write_all(body)?;
    stream.flush()
}

fn write_status(stream: &mut TcpStream, status: &str) -> io::Result<()> {
    write_json(stream, status, b"")
}
