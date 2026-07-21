import { describe, expect, it } from "vitest";
import type { IdeaMetadata } from "./idea.js";
import {
  isSyncProtocolCompatible,
  isValidPairingCode,
  PAIRING_CODE_LENGTH,
  SYNC_PROTOCOL_VERSION,
} from "./sync.js";
import type {
  IdeaMetadataUpdate,
  IdeaSyncAck,
  IdeaSyncOffer,
  IdeaUpdateAck,
  PairingRequest,
  PairingResponse,
  SyncManifest,
  SyncMessage,
} from "./sync.js";

/**
 * Sync protocol vocabulary (motif-6fu.6). These are the wire types Capture and
 * Bridge exchange over the local network; Bridge's Rust core mirrors them, so
 * the `kind` discriminants and field names here are the contract both sides
 * serialize to. The interesting behavior is the version + pairing-code guards
 * both ends use to reject an incompatible or mistyped peer.
 */

function idea(id: string): IdeaMetadata {
  return {
    id,
    name: `Idea ${id}`,
    capturedAt: 1_700_000_000_000,
    durationMs: 4200,
    audioFormat: "aac",
    channels: 1,
    storageState: "on-device",
    tags: [],
    instrument: [],
    style: [],
    tempo: null,
    location: null,
    fieldUpdatedAt: {
      name: 1_700_000_000_000,
      tags: 0,
      instrument: 0,
      style: 0,
      tempo: 0, location: 0,
    },
  };
}

describe("isSyncProtocolCompatible", () => {
  it("accepts a peer speaking this build's protocol version", () => {
    expect(isSyncProtocolCompatible(SYNC_PROTOCOL_VERSION)).toBe(true);
  });

  it("rejects a peer on any other version", () => {
    expect(isSyncProtocolCompatible(SYNC_PROTOCOL_VERSION + 1)).toBe(false);
    expect(isSyncProtocolCompatible(0)).toBe(false);
    expect(isSyncProtocolCompatible(-1)).toBe(false);
  });
});

describe("isValidPairingCode", () => {
  it("accepts a code of exactly the expected number of digits", () => {
    const code = "1".repeat(PAIRING_CODE_LENGTH);
    expect(isValidPairingCode(code)).toBe(true);
  });

  it("rejects a code of the wrong length", () => {
    expect(isValidPairingCode("1".repeat(PAIRING_CODE_LENGTH - 1))).toBe(false);
    expect(isValidPairingCode("1".repeat(PAIRING_CODE_LENGTH + 1))).toBe(false);
    expect(isValidPairingCode("")).toBe(false);
  });

  it("rejects a code containing non-digits", () => {
    const almost = "1".repeat(PAIRING_CODE_LENGTH - 1);
    expect(isValidPairingCode(`${almost}a`)).toBe(false);
    expect(isValidPairingCode(`${almost} `)).toBe(false);
  });
});

describe("sync message shapes", () => {
  it("tags each message with its wire discriminant", () => {
    const from = { deviceId: "cap-1", displayName: "Pixel", role: "capture" } as const;
    const bridge = { deviceId: "br-1", displayName: "Studio Mac", role: "bridge" } as const;

    const pairReq: PairingRequest = {
      kind: "pairing-request",
      protocolVersion: SYNC_PROTOCOL_VERSION,
      from,
      pairingCode: "0".repeat(PAIRING_CODE_LENGTH),
    };
    const pairRes: PairingResponse = {
      kind: "pairing-response",
      protocolVersion: SYNC_PROTOCOL_VERSION,
      accepted: true,
      bridge,
    };
    const manifest: SyncManifest = {
      kind: "sync-manifest",
      from: bridge,
      have: ["a", "b"],
      deleted: [{ id: "c", deletedAt: 1_700_000_000_000, restoredAt: 0 }],
    };
    const offer: IdeaSyncOffer = {
      kind: "idea-sync-offer",
      from,
      idea: idea("a"),
      audioByteLength: 12_345,
    };
    const ack: IdeaSyncAck = {
      kind: "idea-sync-ack",
      ideaId: "a",
      accepted: false,
    };
    const update: IdeaMetadataUpdate = {
      kind: "idea-metadata-update",
      from,
      idea: idea("a"),
    };
    const updateAck: IdeaUpdateAck = {
      kind: "idea-update-ack",
      ideaId: "a",
      accepted: true,
    };

    const messages: SyncMessage[] = [
      pairReq,
      pairRes,
      manifest,
      offer,
      ack,
      update,
      updateAck,
    ];
    expect(messages.map((m) => m.kind)).toEqual([
      "pairing-request",
      "pairing-response",
      "sync-manifest",
      "idea-sync-offer",
      "idea-sync-ack",
      "idea-metadata-update",
      "idea-update-ack",
    ]);
  });
});
