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

/** Idea metadata describing a recording made with {@link RECORDING_OPTIONS}. */
export const AUDIO_FORMAT: AudioFormat = "aac";
export const AUDIO_CHANNELS = 1 as const;

/**
 * The on-device file extension for an Idea's audio, derived from its format:
 * AAC lives in an `.m4a` container, WAV in `.wav`. Callers pass an Idea's own
 * `audioFormat` so playback/delete resolve the right file even once per-tier
 * formats (motif-6fu.9) mix AAC and WAV Ideas in one Library.
 */
export function audioExtension(format: AudioFormat): string {
  return format === "wav" ? ".wav" : ".m4a";
}

/** Extension the recorder writes for a fresh capture (matches AUDIO_FORMAT). */
export const AUDIO_EXTENSION = audioExtension(AUDIO_FORMAT);
