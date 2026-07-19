import { RecordingPresets } from "expo-audio";
import type { RecordingOptions } from "expo-audio";
import type { AudioFormat } from "@motif/shared";

/**
 * How Capture records an Idea. Mono compressed (AAC in an `.m4a` container),
 * matching the Free-tier default in CONTEXT.md. Per-tier format/channel gating
 * (stereo, WAV) lands in motif-6fu.9; this ticket records the baseline.
 */
export const RECORDING_OPTIONS: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  numberOfChannels: 1,
};

/** File extension the recorder writes; kept in step with RECORDING_OPTIONS. */
export const AUDIO_EXTENSION = RECORDING_OPTIONS.extension ?? ".m4a";

/** Idea metadata describing a recording made with {@link RECORDING_OPTIONS}. */
export const AUDIO_FORMAT: AudioFormat = "aac";
export const AUDIO_CHANNELS = 1 as const;
