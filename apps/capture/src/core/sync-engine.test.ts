import { describe, expect, it } from "vitest";
import type { IdeaMetadata } from "@motif/shared";
import {
  ideaStorageAction,
  ideasToOffer,
  isPaired,
  pairWithBridge,
  reconcileMetadata,
  syncTransports,
  UNPAIRED,
  unpair,
} from "./sync-engine";

/**
 * Capture-side sync engine (motif-6fu.6) — the device-free brain behind
 * Free-tier local-network sync. It owns the paired-Bridge state and decides
 * which Ideas still need offering, given what Bridge reports already having.
 * The actual discovery/transfer is the thin shell (`src/idea-sync.ts`); this
 * pure core is what the tests pin down.
 */

function idea(
  id: string,
  capturedAt: number,
  overrides: Partial<IdeaMetadata> = {},
): IdeaMetadata {
  return {
    id,
    name: `Idea ${id}`,
    capturedAt,
    durationMs: 3000,
    audioFormat: "aac",
    channels: 1,
    storageState: "on-device",
    tags: [],
    instrument: [],
    style: [],
    tempo: null,
    fieldUpdatedAt: {
      name: capturedAt,
      tags: 0,
      instrument: 0,
      style: 0,
      tempo: 0,
    },
    ...overrides,
  };
}

const BRIDGE = {
  deviceId: "br-1",
  displayName: "Studio Mac",
  endpoint: { host: "192.168.1.20", port: 47600 },
};

describe("pairing state (Free tier: one Capture ↔ one Bridge)", () => {
  it("starts unpaired", () => {
    expect(isPaired(UNPAIRED)).toBe(false);
    expect(UNPAIRED.pairedBridge).toBeNull();
  });

  it("pairs with a Bridge", () => {
    const state = pairWithBridge(UNPAIRED, BRIDGE);
    expect(isPaired(state)).toBe(true);
    expect(state.pairedBridge).toEqual(BRIDGE);
  });

  it("replaces the existing pairing when paired again (single peer)", () => {
    const other = {
      deviceId: "br-2",
      displayName: "Home PC",
      endpoint: { host: "192.168.1.30", port: 47600 },
    };
    const state = pairWithBridge(pairWithBridge(UNPAIRED, BRIDGE), other);
    expect(state.pairedBridge).toEqual(other);
  });

  it("unpairs back to the resting state", () => {
    const state = unpair(pairWithBridge(UNPAIRED, BRIDGE));
    expect(isPaired(state)).toBe(false);
    expect(state.pairedBridge).toBeNull();
  });

  it("does not mutate the input state", () => {
    const start = UNPAIRED;
    pairWithBridge(start, BRIDGE);
    expect(start.pairedBridge).toBeNull();
  });
});

describe("tiered sync transports", () => {
  it("keeps local-network sync available for every tier when paired", () => {
    expect(syncTransports("free", true)).toEqual(["local-network"]);
    expect(syncTransports("basic", true)).toEqual([
      "local-network",
      "cloud-relay",
    ]);
    expect(syncTransports("pro", true)).toEqual([
      "local-network",
      "cloud-relay",
    ]);
  });

  it("uses cloud relay off the local network for Basic and Pro", () => {
    expect(syncTransports("basic", false)).toEqual(["cloud-relay"]);
    expect(syncTransports("pro", false)).toEqual(["cloud-relay"]);
  });

  it("never gives Free a cloud relay path", () => {
    expect(syncTransports("free", false)).toEqual([]);
  });
});

describe("explicit Idea storage actions", () => {
  it("offers Offload only for on-device Ideas on Basic and Pro", () => {
    expect(ideaStorageAction("free", idea("free", 1))).toBeNull();
    expect(ideaStorageAction("basic", idea("basic", 1))).toBe("offload");
    expect(ideaStorageAction("pro", idea("pro", 1))).toBe("offload");
  });

  it("offers redownload for an offloaded Idea only while cloud access is available", () => {
    const offloaded = idea("cloud", 1, { storageState: "offloaded" });
    expect(ideaStorageAction("free", offloaded)).toBeNull();
    expect(ideaStorageAction("basic", offloaded)).toBe("redownload");
    expect(ideaStorageAction("pro", offloaded)).toBe("redownload");
  });
});

describe("ideasToOffer — the copy-semantics sync diff", () => {
  it("offers nothing from an empty library", () => {
    expect(ideasToOffer([], [])).toEqual([]);
  });

  it("offers every Idea Bridge does not already have", () => {
    const library = [idea("a", 3), idea("b", 2), idea("c", 1)];
    const offered = ideasToOffer(library, ["b"]);
    expect(offered.map((i) => i.id)).toEqual(["c", "a"]);
  });

  it("offers nothing when Bridge already has everything", () => {
    const library = [idea("a", 2), idea("b", 1)];
    expect(ideasToOffer(library, ["a", "b"])).toEqual([]);
  });

  it("offers oldest first, so a fresh Bridge fills chronologically", () => {
    const library = [idea("new", 30), idea("old", 10), idea("mid", 20)];
    expect(ideasToOffer(library, []).map((i) => i.id)).toEqual([
      "old",
      "mid",
      "new",
    ]);
  });

  it("accepts the remote 'have' set as an array or a Set", () => {
    const library = [idea("a", 2), idea("b", 1)];
    expect(ideasToOffer(library, new Set(["a"])).map((i) => i.id)).toEqual(["b"]);
  });

  it("never offers an offloaded Idea — its audio is not on the device to send", () => {
    const library = [
      idea("here", 2),
      idea("gone", 1, { storageState: "offloaded" }),
    ];
    expect(ideasToOffer(library, []).map((i) => i.id)).toEqual(["here"]);
  });

  it("does not mutate or reorder the caller's library (copy semantics)", () => {
    const library = [idea("a", 2), idea("b", 1)];
    const snapshot = library.map((i) => i.id);
    ideasToOffer(library, []);
    expect(library.map((i) => i.id)).toEqual(snapshot);
  });
});

describe("reconcileMetadata — bidirectional metadata sync", () => {
  const stamps = (over: Partial<IdeaMetadata["fieldUpdatedAt"]>) => ({
    name: 0,
    tags: 0,
    instrument: 0,
    style: 0,
    tempo: 0,
    ...over,
  });

  it("merges a peer's newer edit into the local Idea", () => {
    const local = idea("a", 1, { tags: ["mine"], fieldUpdatedAt: stamps({ tags: 100 }) });
    const remote = idea("a", 1, { tags: ["theirs"], fieldUpdatedAt: stamps({ tags: 200 }) });
    const { merged, toPush } = reconcileMetadata([local], [remote]);
    expect(merged[0].tags).toEqual(["theirs"]);
    // The peer is already ahead, so nothing to push back.
    expect(toPush).toEqual([]);
  });

  it("collects Ideas whose local edit is newer than the peer's to push back", () => {
    const local = idea("a", 1, { tags: ["mine"], fieldUpdatedAt: stamps({ tags: 300 }) });
    const remote = idea("a", 1, { tags: ["stale"], fieldUpdatedAt: stamps({ tags: 100 }) });
    const { merged, toPush } = reconcileMetadata([local], [remote]);
    expect(merged[0].tags).toEqual(["mine"]);
    expect(toPush.map((i) => i.id)).toEqual(["a"]);
  });

  it("passes through local Ideas the peer does not hold, without pushing them", () => {
    const local = idea("only-local", 1, { tags: ["x"], fieldUpdatedAt: stamps({ tags: 300 }) });
    const { merged, toPush } = reconcileMetadata([local], []);
    expect(merged).toEqual([local]);
    expect(toPush).toEqual([]);
  });

  it("does not push when both sides already agree", () => {
    const shared = idea("a", 1, { tags: ["same"], fieldUpdatedAt: stamps({ tags: 100 }) });
    const { toPush } = reconcileMetadata([shared], [{ ...shared }]);
    expect(toPush).toEqual([]);
  });

  it("does not mutate the local Library", () => {
    const local = idea("a", 1, { tags: ["mine"], fieldUpdatedAt: stamps({ tags: 100 }) });
    const remote = idea("a", 1, { tags: ["theirs"], fieldUpdatedAt: stamps({ tags: 200 }) });
    const snapshot = structuredClone(local);
    reconcileMetadata([local], [remote]);
    expect(local).toEqual(snapshot);
  });
});
