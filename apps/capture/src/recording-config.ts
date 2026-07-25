import type { RecordingConfig } from "@siteed/audio-studio";
import type { AudioFormat, RecordingProfile } from "@motif/shared";

/**
 * Converts the tier-approved profile into a cross-platform PCM recording.
 * AAC enables the compressed output; WAV retains the uncompressed primary.
 */
export function recordingConfig(profile: RecordingProfile): RecordingConfig {
  return {
    sampleRate: 44_100,
    channels: profile.channels,
    encoding: "pcm_16bit",
    // The Record screen's clock and level meter are driven by these emissions,
    // so they arrive ten times a second: enough for a clock that ticks in
    // tenths and a meter that tracks a hummed line.
    interval: 100,
    intervalAnalysis: 100,
    enableProcessing: true,
    // Only the live window is ever shown, so the hook must not accumulate every
    // data point for the length of a recording.
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
 * format choices mix AAC and WAV Ideas in one Library.
 */
export function audioExtension(format: AudioFormat): string {
  return format === "wav" ? ".wav" : ".m4a";
}
