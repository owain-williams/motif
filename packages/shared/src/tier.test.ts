import { describe, expect, it } from "vitest";
import { TIER_CAPABILITIES } from "./tier.js";
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
    expect(TIER_CAPABILITIES.free.audioFormat).toBe("aac");
    expect(TIER_CAPABILITIES.basic.audioFormat).toBe("aac");
    expect(TIER_CAPABILITIES.pro.audioFormat).toBe("wav");
    expect(TIER_CAPABILITIES.pro.recordingChannels).toBe("mono-or-stereo");
  });
});

describe("sync protocol", () => {
  it("exposes a protocol version", () => {
    expect(SYNC_PROTOCOL_VERSION).toBe(1);
  });
});
