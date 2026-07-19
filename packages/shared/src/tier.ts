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
export type RecordingChannelCount = 1 | 2;

export interface RecordingProfile {
  readonly audioFormat: AudioFormat;
  readonly channels: RecordingChannelCount;
}

export type CloudStorageDecision =
  | { readonly status: "allowed"; readonly remainingBytes: number }
  | {
      readonly status: "warning" | "blocked";
      readonly remainingBytes: number;
      readonly message: string;
    };

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

/** Channel choices Capture may present for a tier. */
export function availableRecordingChannels(
  tier: Tier,
): readonly RecordingChannelCount[] {
  return tier === "pro" ? [1, 2] : [1];
}

/**
 * Resolves a tier's recording facts. An unavailable stereo request safely
 * degrades to mono, so a tier change can never leave Capture in an illegal
 * configuration.
 */
export function recordingProfile(
  tier: Tier,
  requestedChannels: RecordingChannelCount,
): RecordingProfile {
  const capabilities = TIER_CAPABILITIES[tier];
  return {
    audioFormat: capabilities.audioFormat,
    channels: tier === "pro" ? requestedChannels : 1,
  };
}

/** Decides whether adding bytes to cloud storage is allowed for a tier. */
export function cloudStorageDecision(
  tier: Tier,
  usedBytes: number,
  additionalBytes: number,
): CloudStorageDecision {
  const quota = TIER_CAPABILITIES[tier].cloudStorageQuotaBytes;
  const remainingBytes = Math.max(0, quota - usedBytes);

  if (quota === 0) {
    return {
      status: "blocked",
      remainingBytes,
      message:
        "Free includes no cloud storage. Upgrade to Basic or Pro to store Ideas in the cloud.",
    };
  }

  if (additionalBytes > remainingBytes) {
    return {
      status: "blocked",
      remainingBytes,
      message: `This action needs ${formatStorage(additionalBytes)}, but ${titleCase(tier)} has only ${formatStorage(remainingBytes)} of cloud storage remaining.`,
    };
  }

  const remainingAfterAction = remainingBytes - additionalBytes;
  if (usedBytes + additionalBytes >= quota * 0.9) {
    return {
      status: "warning",
      remainingBytes: remainingAfterAction,
      message: `${titleCase(tier)} cloud storage is almost full (${formatStorage(remainingAfterAction)} remaining).`,
    };
  }

  return { status: "allowed", remainingBytes: remainingAfterAction };
}

function formatStorage(bytes: number): string {
  if (bytes >= 1024 * GB) return `${formatNumber(bytes / (1024 * GB))} TB`;
  if (bytes >= GB) return `${formatNumber(bytes / GB)} GB`;
  if (bytes >= 1024 * 1024) return `${formatNumber(bytes / (1024 * 1024))} MB`;
  return `${Math.ceil(bytes / 1024)} KB`;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function titleCase(tier: Tier): string {
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}
