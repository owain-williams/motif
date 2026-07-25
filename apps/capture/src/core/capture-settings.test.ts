import { describe, expect, it } from "vitest";
import { DEFAULT_CAPTURE_SETTINGS, parseCaptureSettings } from "./capture-settings";

describe("Capture settings", () => {
  it("defaults recording preferences to AAC mono", () => {
    expect(DEFAULT_CAPTURE_SETTINGS.requestedAudioFormat).toBe("aac");
    expect(DEFAULT_CAPTURE_SETTINGS.requestedChannels).toBe(1);
  });

  it("restores persisted format and channel preferences", () => {
    expect(
      parseCaptureSettings({
        locationTaggingEnabled: true,
        onboardingCompleted: true,
        requestedAudioFormat: "wav",
        requestedChannels: 2,
      }),
    ).toEqual({
      locationTaggingEnabled: true,
      onboardingCompleted: true,
      requestedAudioFormat: "wav",
      requestedChannels: 2,
    });
  });

  it("safely defaults missing or illegal persisted values", () => {
    expect(
      parseCaptureSettings({
        locationTaggingEnabled: "yes",
        onboardingCompleted: 1,
        requestedAudioFormat: "mp3",
        requestedChannels: 8,
      }),
    ).toEqual(DEFAULT_CAPTURE_SETTINGS);
  });
});
