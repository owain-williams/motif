# Motif

A quick-capture tool for musical ideas. Musicians hum, sing, or play fragments of compositions; Motif captures them as fast as possible and gets them into a DAW with minimal friction.

## Language

**Idea**:
A single captured audio recording of a musical fragment. One recording session produces exactly one Idea — re-recording the same tune later creates a new, separate Idea, not a new take of the same one.
_Avoid_: Song, memo, recording, tune

**Capture**:
The mobile app (Android/iOS). Its job is recording Ideas as fast as possible — big red record button, auto-saved on stop, no naming prompt — and holding the user's Library.
_Avoid_: The mobile app, the recorder

**Bridge**:
The desktop app (Mac/Windows/Linux, Tauri). Its job is receiving Ideas synced from Capture and handing them off to a DAW via drag-and-drop.
_Avoid_: The desktop app, the sync app, the companion app

**Library**:
The flat, reverse-chronological list of a user's Ideas, shown in both Capture and Bridge. No folders or tags — each entry shows waveform, duration, and an auto-generated name that can be renamed later.
_Avoid_: Collection, gallery

**Offloaded**:
An Idea whose audio has been moved to cloud storage and removed from the device to free up space, redownloadable to Capture on demand. Every Idea is on-device by default; only Basic/Pro accounts can offload one (Free has no cloud storage to offload to). Syncing to Bridge never offloads or deletes the Capture copy — that only happens by explicit user action.
_Avoid_: Archived, cloud-only

**Tier**:
The subscription level of an account — Free, Basic, or Pro — that determines sync transport, cloud storage quota, recording channel count, and audio format. Basic and Pro require a user account; Free does not.
_Avoid_: Plan, subscription level

### Tiers

| Tier  | Sync transport            | Cloud storage | Recording channels | Audio format          |
| ----- | -------------------------- | -------------- | ------------------- | ---------------------- |
| Free  | Local network only         | None (0GB)      | Mono only            | Compressed (AAC)        |
| Basic | Local network + cloud relay | 25GB            | Mono only            | Compressed (AAC)        |
| Pro   | Local network + cloud relay | 1TB             | Mono or stereo       | Uncompressed (WAV)       |
