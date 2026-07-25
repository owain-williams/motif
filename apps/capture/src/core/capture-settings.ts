import type { AudioFormat, RecordingChannelCount } from "@motif/shared";

/** User choices persisted on this Capture across cold starts and tier changes. */
export interface CaptureSettings {
  readonly locationTaggingEnabled: boolean;
  readonly onboardingCompleted: boolean;
  readonly requestedAudioFormat: AudioFormat;
  readonly requestedChannels: RecordingChannelCount;
}

export const DEFAULT_CAPTURE_SETTINGS: CaptureSettings = {
  locationTaggingEnabled: false,
  onboardingCompleted: false,
  requestedAudioFormat: "aac",
  requestedChannels: 1,
};

/** Parses the settings file without allowing corrupt values into app state. */
export function parseCaptureSettings(parsed: unknown): CaptureSettings {
  const value =
    typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};

  return {
    locationTaggingEnabled: value.locationTaggingEnabled === true,
    onboardingCompleted: value.onboardingCompleted === true,
    requestedAudioFormat: value.requestedAudioFormat === "wav" ? "wav" : "aac",
    requestedChannels: value.requestedChannels === 2 ? 2 : 1,
  };
}
