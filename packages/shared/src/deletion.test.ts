import { describe, expect, it } from "vitest";
import type { IdeaMetadata } from "./idea.js";
import {
  activeIdeas,
  expiredDeletions,
  formatRestoreWindow,
  isIdeaDeleted,
  markIdeaDeleted,
  markIdeaRestored,
  mergeDeletions,
  purgeAt,
  recentlyDeletedIdeas,
  RECENTLY_DELETED_RETENTION_DAYS,
  RECENTLY_DELETED_RETENTION_MS,
  sameDeletions,
} from "./deletion.js";
import type { IdeaDeletion } from "./deletion.js";

/**
 * Cross-device delete (ADR 0005). Each device keeps its own per-Idea
 * delete/restore record and exchanges the whole set when two devices next
 * connect, so a delete lands everywhere however long a peer stays offline.
 * The behavior that matters is convergence: merging in any order, any number
 * of times, must leave both devices agreeing on what's deleted.
 */

const DAY = 24 * 60 * 60 * 1000;
const T0 = 1_700_000_000_000;

function idea(id: string, capturedAt = T0): IdeaMetadata {
  return {
    id,
    name: `Idea ${id}`,
    capturedAt,
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
      name: capturedAt,
      tags: 0,
      instrument: 0,
      style: 0,
      tempo: 0,
      location: 0,
    },
  };
}

describe("markIdeaDeleted", () => {
  it("records a deletion the log didn't have", () => {
    const log = markIdeaDeleted([], "a", T0);
    expect(isIdeaDeleted(log, "a")).toBe(true);
  });

  it("leaves other Ideas alone", () => {
    const log = markIdeaDeleted([], "a", T0);
    expect(isIdeaDeleted(log, "b")).toBe(false);
  });

  it("does not restart the grace period when the same Idea is deleted twice", () => {
    const once = markIdeaDeleted([], "a", T0);
    const twice = markIdeaDeleted(once, "a", T0 + DAY);
    expect(twice).toEqual(once);
  });

  it("deletes an Idea again after it was restored", () => {
    const deleted = markIdeaDeleted([], "a", T0);
    const restored = markIdeaRestored(deleted, "a", T0 + DAY);
    const redeleted = markIdeaDeleted(restored, "a", T0 + 2 * DAY);
    expect(isIdeaDeleted(redeleted, "a")).toBe(true);
  });

  it("wins over a restore even when this device's clock lags behind it", () => {
    const restored = markIdeaRestored(markIdeaDeleted([], "a", T0), "a", T0 + DAY);
    // A local action is always the user's latest intent, whatever the clocks say.
    expect(isIdeaDeleted(markIdeaDeleted(restored, "a", T0), "a")).toBe(true);
  });

  it("leaves the input log untouched", () => {
    const log: IdeaDeletion[] = [];
    markIdeaDeleted(log, "a", T0);
    expect(log).toEqual([]);
  });
});

describe("markIdeaRestored", () => {
  it("brings a deleted Idea back", () => {
    const deleted = markIdeaDeleted([], "a", T0);
    expect(isIdeaDeleted(markIdeaRestored(deleted, "a", T0 + DAY), "a")).toBe(false);
  });

  it("ignores an Idea that was never deleted", () => {
    expect(markIdeaRestored([], "a", T0)).toEqual([]);
  });

  it("wins over the delete even when this device's clock lags behind it", () => {
    const deleted = markIdeaDeleted([], "a", T0 + DAY);
    expect(isIdeaDeleted(markIdeaRestored(deleted, "a", T0), "a")).toBe(false);
  });
});

describe("mergeDeletions", () => {
  it("applies a peer's delete to an Idea this device still holds", () => {
    const peer = markIdeaDeleted([], "a", T0);
    expect(isIdeaDeleted(mergeDeletions([], peer), "a")).toBe(true);
  });

  it("applies a delete however long the peer was offline", () => {
    const local = markIdeaDeleted([], "b", T0);
    const peer = markIdeaDeleted([], "a", T0);
    // Reconnecting a year later still lands the delete.
    const merged = mergeDeletions(local, peer);
    expect(isIdeaDeleted(merged, "a")).toBe(true);
    expect(isIdeaDeleted(merged, "b")).toBe(true);
  });

  it("lets a peer's later restore undo a delete this device applied", () => {
    const local = markIdeaDeleted([], "a", T0);
    const peer = markIdeaRestored(local, "a", T0 + DAY);
    expect(isIdeaDeleted(mergeDeletions(local, peer), "a")).toBe(false);
  });

  it("keeps a delete that came after the peer's restore", () => {
    const restored = markIdeaRestored(markIdeaDeleted([], "a", T0), "a", T0 + DAY);
    const local = markIdeaDeleted(restored, "a", T0 + 2 * DAY);
    expect(isIdeaDeleted(mergeDeletions(local, restored), "a")).toBe(true);
  });

  it("converges whichever side merges first", () => {
    const capture = markIdeaDeleted(markIdeaDeleted([], "a", T0), "b", T0 + DAY);
    const bridge = markIdeaRestored(markIdeaDeleted([], "a", T0), "a", T0 + 2 * DAY);
    const onCapture = mergeDeletions(capture, bridge);
    const onBridge = mergeDeletions(bridge, capture);
    expect(new Set(onCapture)).toEqual(new Set(onBridge));
  });

  it("is idempotent — re-exchanging the same log changes nothing", () => {
    const local = markIdeaDeleted([], "a", T0);
    const peer = markIdeaRestored(markIdeaDeleted([], "b", T0), "b", T0 + DAY);
    const once = mergeDeletions(local, peer);
    expect(mergeDeletions(once, peer)).toEqual(once);
  });

  it("leaves both input logs untouched", () => {
    const local = markIdeaDeleted([], "a", T0);
    const peer = markIdeaDeleted([], "b", T0);
    mergeDeletions(local, peer);
    expect(local).toHaveLength(1);
    expect(peer).toHaveLength(1);
  });
});

describe("sameDeletions", () => {
  it("sees no change after an exchange that added nothing", () => {
    const log = markIdeaDeleted([], "a", T0);
    expect(sameDeletions(log, mergeDeletions(log, log))).toBe(true);
  });

  it("spots a peer's delete", () => {
    const log = markIdeaDeleted([], "a", T0);
    expect(sameDeletions(log, markIdeaDeleted(log, "b", T0))).toBe(false);
  });

  it("spots a peer's restore of an Idea both sides had deleted", () => {
    const log = markIdeaDeleted([], "a", T0);
    expect(sameDeletions(log, markIdeaRestored(log, "a", T0 + DAY))).toBe(false);
  });

  it("ignores the order records happen to be stored in", () => {
    const log = markIdeaDeleted(markIdeaDeleted([], "a", T0), "b", T0);
    expect(sameDeletions(log, [...log].reverse())).toBe(true);
  });
});

describe("activeIdeas", () => {
  it("hides deleted Ideas from the Library", () => {
    const library = [idea("a"), idea("b")];
    const log = markIdeaDeleted([], "a", T0);
    expect(activeIdeas(library, log).map((i) => i.id)).toEqual(["b"]);
  });

  it("shows a restored Idea again", () => {
    const library = [idea("a")];
    const log = markIdeaRestored(markIdeaDeleted([], "a", T0), "a", T0 + DAY);
    expect(activeIdeas(library, log).map((i) => i.id)).toEqual(["a"]);
  });

  it("keeps Library order", () => {
    const library = [idea("c"), idea("b"), idea("a")];
    expect(activeIdeas(library, []).map((i) => i.id)).toEqual(["c", "b", "a"]);
  });
});

describe("recentlyDeletedIdeas", () => {
  it("lists deleted Ideas most recently deleted first, with their purge date", () => {
    const library = [idea("a"), idea("b"), idea("c")];
    const log = markIdeaDeleted(markIdeaDeleted([], "a", T0), "b", T0 + DAY);
    expect(recentlyDeletedIdeas(library, log)).toEqual([
      {
        idea: idea("b"),
        deletedAt: T0 + DAY,
        purgeAt: T0 + DAY + RECENTLY_DELETED_RETENTION_MS,
      },
      {
        idea: idea("a"),
        deletedAt: T0,
        purgeAt: T0 + RECENTLY_DELETED_RETENTION_MS,
      },
    ]);
  });

  it("omits a record whose Idea this device no longer holds", () => {
    expect(recentlyDeletedIdeas([], markIdeaDeleted([], "a", T0))).toEqual([]);
  });

  it("omits a restored Idea", () => {
    const log = markIdeaRestored(markIdeaDeleted([], "a", T0), "a", T0 + DAY);
    expect(recentlyDeletedIdeas([idea("a")], log)).toEqual([]);
  });
});

describe("purgeAt", () => {
  it("is 30 days after the deletion", () => {
    const [record] = markIdeaDeleted([], "a", T0);
    expect(purgeAt(record!)).toBe(T0 + 30 * DAY);
    expect(RECENTLY_DELETED_RETENTION_MS).toBe(30 * DAY);
  });

  it("enforces exactly the window users are told about", () => {
    expect(RECENTLY_DELETED_RETENTION_DAYS * DAY).toBe(
      RECENTLY_DELETED_RETENTION_MS,
    );
  });
});

describe("formatRestoreWindow", () => {
  it("counts a whole 30-day window from the moment of deletion", () => {
    expect(formatRestoreWindow(T0 + 30 * DAY, T0)).toBe("30 days left");
  });

  it("rounds a part-day up, so a window never reads shorter than it is", () => {
    expect(formatRestoreWindow(T0 + 2 * DAY, T0 + 1.5 * DAY)).toBe("1 day left");
  });

  it("says one day in the singular", () => {
    expect(formatRestoreWindow(T0 + DAY, T0)).toBe("1 day left");
  });

  it("warns once the window is all but gone", () => {
    expect(formatRestoreWindow(T0, T0)).toBe("Deleting soon");
  });

  it("warns rather than counting backwards past the window", () => {
    expect(formatRestoreWindow(T0, T0 + 5 * DAY)).toBe("Deleting soon");
  });
});

describe("expiredDeletions", () => {
  it("holds an Idea for the whole grace period", () => {
    const log = markIdeaDeleted([], "a", T0);
    expect(expiredDeletions(log, T0 + 30 * DAY - 1)).toEqual([]);
  });

  it("reports an Idea once its grace period elapses", () => {
    const log = markIdeaDeleted([], "a", T0);
    expect(expiredDeletions(log, T0 + 30 * DAY).map((r) => r.id)).toEqual(["a"]);
  });

  it("never reports a restored Idea, however old the deletion", () => {
    const log = markIdeaRestored(markIdeaDeleted([], "a", T0), "a", T0 + DAY);
    expect(expiredDeletions(log, T0 + 365 * DAY)).toEqual([]);
  });

  it("keeps reporting a purged Idea, so a peer offline for years still hears", () => {
    // The audio is long gone; the record is all that can still carry the
    // delete to a device that has never been reachable since (ADR 0005).
    const log = markIdeaDeleted([], "a", T0);
    expect(expiredDeletions(log, T0 + 5 * 365 * DAY).map((r) => r.id)).toEqual(["a"]);
  });
});
