import { describe, expect, it } from "vitest";
import {
  availableRecordingChannels,
  availableRecordingFormats,
  cloudStorageDecision,
  recordingProfile,
  TIER_CAPABILITIES,
} from "./tier.js";
import { SYNC_PROTOCOL_VERSION } from "./sync.js";

/**
 * Scaffold smoke test: establishes the Vitest seam for the shared package
 * and pins the tier matrix to the values documented in CONTEXT.md. Later
 * tickets add behavioral tests for the Capture core module here.
 */
describe("tier matrix", () => {
  it("matches the documented sync transports", () => {
    expect(TIER_CAPABILITIES.free.syncTransport).toBe("local-network");
    expect(TIER_CAPABILITIES.pro.syncTransport).toBe(
      "local-network+cloud-relay",
    );
  });

  it("only requires an account for Pro", () => {
    expect(TIER_CAPABILITIES.free.requiresAccount).toBe(false);
    expect(TIER_CAPABILITIES.pro.requiresAccount).toBe(true);
  });

  it("keeps allowed recording choices and defaults in the tier table", () => {
    expect(TIER_CAPABILITIES.free.recordingChannels).toEqual([1]);
    expect(TIER_CAPABILITIES.free.audioFormats).toEqual(["aac"]);
    expect(TIER_CAPABILITIES.free.defaultAudioFormat).toBe("aac");
    expect(TIER_CAPABILITIES.pro.recordingChannels).toEqual([1, 2]);
    expect(TIER_CAPABILITIES.pro.audioFormats).toEqual(["aac", "wav"]);
    expect(TIER_CAPABILITIES.pro.defaultAudioFormat).toBe("aac");

    expect(availableRecordingChannels("free")).toBe(
      TIER_CAPABILITIES.free.recordingChannels,
    );
    expect(availableRecordingFormats("pro")).toBe(
      TIER_CAPABILITIES.pro.audioFormats,
    );
  });

  it("uses AAC by default for both tiers", () => {
    expect(recordingProfile("free", undefined, undefined)).toEqual({
      audioFormat: "aac",
      channels: 1,
    });
    expect(recordingProfile("pro", undefined, undefined)).toEqual({
      audioFormat: "aac",
      channels: 1,
    });
  });

  it("allows Pro recording choices", () => {
    expect(recordingProfile("pro", "wav", 2)).toEqual({
      audioFormat: "wav",
      channels: 2,
    });
    expect(recordingProfile("pro", "aac", 1)).toEqual({
      audioFormat: "aac",
      channels: 1,
    });
  });

  it("degrades illegal requests without losing a restorable preference", () => {
    const requestedFormat = "wav";
    const requestedChannels = 2;

    expect(recordingProfile("free", requestedFormat, requestedChannels)).toEqual({
      audioFormat: "aac",
      channels: 1,
    });
    expect(recordingProfile("pro", requestedFormat, requestedChannels)).toEqual({
      audioFormat: "wav",
      channels: 2,
    });
  });
});

describe("cloud storage quota", () => {
  const GB = 1024 ** 3;

  it("gives Pro 150GB and Free none", () => {
    expect(TIER_CAPABILITIES.pro.cloudStorageQuotaBytes).toBe(150 * GB);
    expect(TIER_CAPABILITIES.free.cloudStorageQuotaBytes).toBe(0);
  });

  it("blocks cloud storage for Free with an actionable message", () => {
    expect(cloudStorageDecision("free", 0, 1)).toEqual({
      status: "blocked",
      remainingBytes: 0,
      message: "Free includes no cloud storage. Upgrade to Pro to store Ideas in the cloud.",
    });
  });

  it("allows an action below quota and warns once usage reaches 90%", () => {
    expect(cloudStorageDecision("pro", 100 * GB, 1 * GB)).toEqual({
      status: "allowed",
      remainingBytes: 49 * GB,
    });
    expect(cloudStorageDecision("pro", 134 * GB, 2 * GB)).toEqual({
      status: "warning",
      remainingBytes: 14 * GB,
      message: "Pro cloud storage is almost full (14 GB remaining).",
    });
  });

  it("blocks an action when it would exceed quota or usage already has", () => {
    expect(cloudStorageDecision("pro", 149 * GB, 2 * GB)).toEqual({
      status: "blocked",
      remainingBytes: 1 * GB,
      message: "This action needs 2 GB, but Pro has only 1 GB of cloud storage remaining.",
    });
    expect(cloudStorageDecision("pro", 151 * GB, 1)).toEqual({
      status: "blocked",
      remainingBytes: 0,
      message: "This action needs 1 KB, but Pro has only 0 KB of cloud storage remaining.",
    });
  });
});

describe("sync protocol", () => {
  it("exposes a protocol version", () => {
    expect(SYNC_PROTOCOL_VERSION).toBe(1);
  });
});
