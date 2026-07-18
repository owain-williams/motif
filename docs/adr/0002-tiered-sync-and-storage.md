# Tiered sync and storage model

Motif has three account tiers — Free, Basic, Pro — that gate sync transport, cloud storage, recording channels, and audio format. Free syncs over local network only, needs no account, and has zero cloud storage. Basic and Pro both use cloud relay (requiring a user account) with 25GB/1TB quotas; only Pro records/stores uncompressed stereo (Free/Basic are mono, compressed AAC). A single Basic/Pro account can pair multiple Capture devices to one Bridge. Offloading an Idea to cloud-only storage is always an explicit, opt-in action — syncing or tiering never auto-deletes the on-device copy.

## Consequences

Free tier has no cross-network sync and no cloud backup — losing the phone loses any un-synced Idea. This is accepted deliberately to keep Free simple and infrastructure-free, and to make the paid tiers' value proposition (backup + remote sync) concrete.
