/**
 * Tier — the subscription level of an account (see CONTEXT.md).
 *
 * Placeholder shape for the scaffold: the concrete rule-evaluation logic
 * (quota/channel/format gating) lands with the Capture core module in a
 * later ticket. These types exist so Capture and Bridge can already refer
 * to the same tier vocabulary.
 */

export type Tier = "free" | "basic" | "pro";

export type SyncTransport = "local-network" | "local-network+cloud-relay";

export type RecordingChannels = "mono" | "mono-or-stereo";

/** Stored audio format for an Idea's recording. */
export type AudioFormat = "aac" | "wav";

export interface TierCapabilities {
  readonly tier: Tier;
  readonly syncTransport: SyncTransport;
  /** Cloud storage quota in bytes; 0 for Free. */
  readonly cloudStorageQuotaBytes: number;
  readonly recordingChannels: RecordingChannels;
  readonly audioFormat: AudioFormat;
  /** Whether an account is required for this tier. */
  readonly requiresAccount: boolean;
}

const GB = 1024 * 1024 * 1024;

/** The tier matrix as documented in CONTEXT.md. */
export const TIER_CAPABILITIES: Readonly<Record<Tier, TierCapabilities>> = {
  free: {
    tier: "free",
    syncTransport: "local-network",
    cloudStorageQuotaBytes: 0,
    recordingChannels: "mono",
    audioFormat: "aac",
    requiresAccount: false,
  },
  basic: {
    tier: "basic",
    syncTransport: "local-network+cloud-relay",
    cloudStorageQuotaBytes: 25 * GB,
    recordingChannels: "mono",
    audioFormat: "aac",
    requiresAccount: true,
  },
  pro: {
    tier: "pro",
    syncTransport: "local-network+cloud-relay",
    cloudStorageQuotaBytes: 1024 * GB,
    recordingChannels: "mono-or-stereo",
    audioFormat: "wav",
    requiresAccount: true,
  },
};
