import { describe, expect, it } from "vitest";
import { markIdeaDeleted } from "@motif/shared";
import type { IdeaMetadata } from "@motif/shared";
import { syncSummary, withDelivered } from "./sync-summary";

const T0 = 1_700_000_000_000;
const MINUTE = 60_000;

function idea(id: string, overrides: Partial<IdeaMetadata> = {}): IdeaMetadata {
  return {
    id,
    name: `Idea ${id}`,
    capturedAt: T0,
    durationMs: MINUTE,
    audioFormat: "aac",
    channels: 1,
    storageState: "on-device",
    tags: [],
    instrument: [],
    style: [],
    tempo: null,
    location: null,
    fieldUpdatedAt: { name: T0, tags: 0, instrument: 0, style: 0, tempo: 0, location: 0 },
    ...overrides,
  };
}

// Newest first, as the Library is held.
const LIBRARY = [
  idea("c", { capturedAt: T0 + 2 * MINUTE, durationMs: 30_000 }),
  idea("b", { capturedAt: T0 + MINUTE }),
  idea("a", { capturedAt: T0 }),
];

const NOTHING_DELIVERED: ReadonlySet<string> = new Set();

describe("syncSummary", () => {
  it("counts the active Library and its combined length", () => {
    const summary = syncSummary({
      library: LIBRARY,
      deletions: [],
      deliveredIds: new Set(["a", "b", "c"]),
    });
    expect(summary.ideaCount).toBe(3);
    expect(summary.totalDurationMs).toBe(2 * MINUTE + 30_000);
    expect(summary.queuedCount).toBe(0);
  });

  it("queues exactly what a peer has not reported holding", () => {
    const summary = syncSummary({
      library: LIBRARY,
      deletions: [],
      deliveredIds: new Set(["a"]),
    });
    expect(summary.queuedCount).toBe(2);
    expect(summary.activity.map((entry) => entry.queued)).toEqual([true, true, false]);
  });

  it("never queues an offloaded Idea — its audio is not here to send", () => {
    const summary = syncSummary({
      library: [idea("x", { storageState: "offloaded" })],
      deletions: [],
      deliveredIds: NOTHING_DELIVERED,
    });
    expect(summary.queuedCount).toBe(0);
    expect(summary.ideaCount).toBe(1);
  });

  it("leaves deleted Ideas out of every figure", () => {
    const deletions = markIdeaDeleted([], "b", T0 + 5 * MINUTE);
    const summary = syncSummary({
      library: LIBRARY,
      deletions,
      deliveredIds: NOTHING_DELIVERED,
    });
    expect(summary.ideaCount).toBe(2);
    expect(summary.queuedCount).toBe(2);
    expect(summary.activity.map((entry) => entry.id)).toEqual(["c", "a"]);
  });

  it("shows the most recent Ideas first, capped", () => {
    const summary = syncSummary({
      library: LIBRARY,
      deletions: [],
      deliveredIds: NOTHING_DELIVERED,
      activityLimit: 2,
    });
    expect(summary.activity.map((entry) => entry.id)).toEqual(["c", "b"]);
  });
});

describe("withDelivered", () => {
  it("accumulates what peers hold and what this pass sent", () => {
    const delivered = withDelivered(NOTHING_DELIVERED, ["a", "b"], ["c"]);
    expect([...delivered].sort()).toEqual(["a", "b", "c"]);
  });

  it("does not forget an Idea when a later pass cannot reach the peer", () => {
    const delivered = withDelivered(new Set(["a"]), []);
    expect([...delivered]).toEqual(["a"]);
  });

  it("returns the same set when nothing is new, so nothing re-renders", () => {
    const delivered = new Set(["a"]);
    expect(withDelivered(delivered, ["a"])).toBe(delivered);
  });
});
