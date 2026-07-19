import type { RecordingConfig } from "@siteed/audio-studio";
import type { AudioFormat, RecordingProfile } from "@motif/shared";

/**
 * Converts the tier-approved profile into a cross-platform PCM recording.
 * Free/Basic additionally produce AAC; Pro retains the uncompressed WAV.
 */
export function recordingConfig(profile: RecordingProfile): RecordingConfig {
  return {
    sampleRate: 44_100,
    channels: profile.channels,
    encoding: "pcm_16bit",
    keepFullAnalysis: false,
    output:
      profile.audioFormat === "aac"
        ? {
            primary: { enabled: false },
            compressed: { enabled: true, format: "aac", bitrate: 128_000 },
          }
        : {
            primary: { enabled: true, format: "wav" },
            compressed: { enabled: false },
          },
  };
}

/**
 * The on-device file extension for an Idea's audio, derived from its format:
 * AAC lives in an `.m4a` container, WAV in `.wav`. Callers pass an Idea's own
 * `audioFormat` so playback/delete resolve the right file even once per-tier
 * formats (motif-6fu.9) mix AAC and WAV Ideas in one Library.
 */
export function audioExtension(format: AudioFormat): string {
  return format === "wav" ? ".wav" : ".m4a";
}
