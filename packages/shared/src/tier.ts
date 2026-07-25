/**
 * Tier — the subscription level of an account (see CONTEXT.md).
 * The capability table and decision helpers are the shared source of truth for
 * recording choices and client-side cloud-storage quota behavior.
 */

export type Tier = "free" | "pro";

export type SyncTransport = "local-network" | "local-network+cloud-relay";

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
  readonly recordingChannels: readonly RecordingChannelCount[];
  readonly audioFormats: readonly AudioFormat[];
  readonly defaultAudioFormat: AudioFormat;
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
    recordingChannels: [1],
    audioFormats: ["aac"],
    defaultAudioFormat: "aac",
    requiresAccount: false,
  },
  pro: {
    tier: "pro",
    syncTransport: "local-network+cloud-relay",
    cloudStorageQuotaBytes: 150 * GB,
    recordingChannels: [1, 2],
    audioFormats: ["aac", "wav"],
    defaultAudioFormat: "aac",
    requiresAccount: true,
  },
};

/** Channel choices Capture may present for a tier. */
export function availableRecordingChannels(
  tier: Tier,
): readonly RecordingChannelCount[] {
  return TIER_CAPABILITIES[tier].recordingChannels;
}

/** Format choices Capture may present for a tier. */
export function availableRecordingFormats(tier: Tier): readonly AudioFormat[] {
  return TIER_CAPABILITIES[tier].audioFormats;
}

/**
 * Resolves requested recording preferences against the tier matrix. Illegal or
 * missing choices degrade to the tier defaults, so tier changes never leave
 * Capture in an invalid configuration while preserving the stored preference.
 */
export function recordingProfile(
  tier: Tier,
  requestedAudioFormat?: AudioFormat,
  requestedChannels?: RecordingChannelCount,
): RecordingProfile {
  const capabilities = TIER_CAPABILITIES[tier];
  return {
    audioFormat:
      requestedAudioFormat !== undefined &&
      capabilities.audioFormats.includes(requestedAudioFormat)
        ? requestedAudioFormat
        : capabilities.defaultAudioFormat,
    channels:
      requestedChannels !== undefined &&
      capabilities.recordingChannels.includes(requestedChannels)
        ? requestedChannels
        : capabilities.recordingChannels[0]!,
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
        "Free includes no cloud storage. Upgrade to Pro to store Ideas in the cloud.",
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
