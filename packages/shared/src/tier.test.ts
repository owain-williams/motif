import { describe, expect, it } from "vitest";
import {
  availableRecordingChannels,
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
    expect(TIER_CAPABILITIES.basic.syncTransport).toBe(
      "local-network+cloud-relay",
    );
    expect(TIER_CAPABILITIES.pro.syncTransport).toBe(
      "local-network+cloud-relay",
    );
  });

  it("only requires an account for paid tiers", () => {
    expect(TIER_CAPABILITIES.free.requiresAccount).toBe(false);
    expect(TIER_CAPABILITIES.basic.requiresAccount).toBe(true);
    expect(TIER_CAPABILITIES.pro.requiresAccount).toBe(true);
  });

  it("gates uncompressed audio and stereo to Pro", () => {
    expect(recordingProfile("free", 2)).toEqual({
      audioFormat: "aac",
      channels: 1,
    });
    expect(recordingProfile("basic", 2)).toEqual({
      audioFormat: "aac",
      channels: 1,
    });
    expect(recordingProfile("pro", 2)).toEqual({
      audioFormat: "wav",
      channels: 2,
    });
    expect(availableRecordingChannels("free")).toEqual([1]);
    expect(availableRecordingChannels("basic")).toEqual([1]);
    expect(availableRecordingChannels("pro")).toEqual([1, 2]);
  });
});

describe("cloud storage quota", () => {
  const GB = 1024 ** 3;

  it("blocks cloud storage for Free with an actionable message", () => {
    expect(cloudStorageDecision("free", 0, 1)).toEqual({
      status: "blocked",
      remainingBytes: 0,
      message: "Free includes no cloud storage. Upgrade to Basic or Pro to store Ideas in the cloud.",
    });
  });

  it("allows an action below quota and warns once usage reaches 90%", () => {
    expect(cloudStorageDecision("basic", 20 * GB, 1 * GB)).toEqual({
      status: "allowed",
      remainingBytes: 4 * GB,
    });
    expect(cloudStorageDecision("basic", 22 * GB, 1 * GB)).toEqual({
      status: "warning",
      remainingBytes: 2 * GB,
      message: "Basic cloud storage is almost full (2 GB remaining).",
    });
  });

  it("blocks an action when it would exceed quota or usage already has", () => {
    expect(cloudStorageDecision("basic", 24 * GB, 2 * GB)).toEqual({
      status: "blocked",
      remainingBytes: 1 * GB,
      message: "This action needs 2 GB, but Basic has only 1 GB of cloud storage remaining.",
    });
    expect(cloudStorageDecision("basic", 26 * GB, 1)).toEqual({
      status: "blocked",
      remainingBytes: 0,
      message: "This action needs 1 KB, but Basic has only 0 KB of cloud storage remaining.",
    });
  });

  it("applies the selected tier immediately", () => {
    const used = 25 * GB;
    expect(cloudStorageDecision("basic", used, 1).status).toBe("blocked");
    expect(cloudStorageDecision("pro", used, 1).status).toBe("allowed");
  });
});

describe("sync protocol", () => {
  it("exposes a protocol version", () => {
    expect(SYNC_PROTOCOL_VERSION).toBe(1);
  });
});
