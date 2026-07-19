import { describe, expect, it } from "vitest";
import type { IdeaMetadata } from "./idea.js";
import { formatDuration, insertIdea, sortLibrary } from "./library.js";

/**
 * Library ordering + display helpers (motif-6fu.3). The Library is the flat,
 * reverse-chronological list of Ideas shown in Capture and Bridge (CONTEXT.md):
 * newest first, each row showing name + duration.
 */

function idea(id: string, capturedAt: number, durationMs = 1000): IdeaMetadata {
  return {
    id,
    name: `Idea ${id}`,
    capturedAt,
    durationMs,
    audioFormat: "aac",
    channels: 1,
    storageState: "on-device",
  };
}

describe("sortLibrary", () => {
  it("orders Ideas newest first by capture time", () => {
    const older = idea("a", 1_000);
    const newer = idea("b", 2_000);
    expect(sortLibrary([older, newer])).toEqual([newer, older]);
  });

  it("does not mutate the input array", () => {
    const input = [idea("a", 1_000), idea("b", 2_000)];
    const snapshot = [...input];
    sortLibrary(input);
    expect(input).toEqual(snapshot);
  });

  it("is stable for Ideas captured at the same instant", () => {
    const first = idea("first", 5_000);
    const second = idea("second", 5_000);
    expect(sortLibrary([first, second])).toEqual([first, second]);
  });
});

describe("insertIdea", () => {
  it("places a newly captured Idea at the top of the Library", () => {
    const existing = [idea("a", 2_000), idea("b", 1_000)];
    const fresh = idea("c", 3_000);
    expect(insertIdea(existing, fresh)).toEqual([fresh, existing[0], existing[1]]);
  });

  it("re-sorts if the inserted Idea is older than existing ones", () => {
    const existing = [idea("a", 3_000)];
    const old = idea("b", 1_000);
    expect(insertIdea(existing, old)).toEqual([existing[0], old]);
  });

  it("does not mutate the existing Library", () => {
    const existing = [idea("a", 2_000)];
    const snapshot = [...existing];
    insertIdea(existing, idea("c", 3_000));
    expect(existing).toEqual(snapshot);
  });
});

describe("formatDuration", () => {
  it("formats sub-minute recordings as M:SS with a padded seconds field", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(7_000)).toBe("0:07");
    expect(formatDuration(59_000)).toBe("0:59");
  });

  it("formats minutes without zero-padding the leading field", () => {
    expect(formatDuration(65_000)).toBe("1:05");
    expect(formatDuration(12 * 60_000 + 3_000)).toBe("12:03");
  });

  it("promotes to H:MM:SS past an hour", () => {
    expect(formatDuration(60 * 60_000)).toBe("1:00:00");
    expect(formatDuration(60 * 60_000 + 2 * 60_000 + 3_000)).toBe("1:02:03");
  });

  it("floors partial seconds", () => {
    expect(formatDuration(7_999)).toBe("0:07");
  });

  it("clamps invalid or negative input to zero", () => {
    expect(formatDuration(-1_000)).toBe("0:00");
    expect(formatDuration(Number.NaN)).toBe("0:00");
  });
});
