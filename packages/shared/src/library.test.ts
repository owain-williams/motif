import { describe, expect, it } from "vitest";
import type { IdeaMetadata } from "./idea.js";
import {
  formatDuration,
  insertIdea,
  normalizeIdeaName,
  removeIdea,
  renameIdea,
  setIdeaStorageState,
  sortLibrary,
} from "./library.js";

/**
 * Library ordering + display helpers (motif-6fu.3). The Library is the flat,
 * reverse-chronological list of Ideas shown in Capture and Bridge (CONTEXT.md):
 * newest first, each row showing name + duration. Rename/delete mutations
 * (motif-6fu.4) live here too so both app shells stay thin.
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

describe("renameIdea", () => {
  it("replaces the name of the matching Idea and nothing else", () => {
    const library = [idea("a", 2_000), idea("b", 1_000)];
    const renamed = renameIdea(library, "b", "Chorus hook");
    expect(renamed).toEqual([
      idea("a", 2_000),
      { ...idea("b", 1_000), name: "Chorus hook" },
    ]);
  });

  it("preserves Library order — a rename never reorders", () => {
    const library = [idea("a", 2_000), idea("b", 1_000)];
    const renamed = renameIdea(library, "a", "Zzz last alphabetically");
    expect(renamed.map((entry) => entry.id)).toEqual(["a", "b"]);
  });

  it("leaves the Library untouched when no Idea matches", () => {
    const library = [idea("a", 2_000)];
    expect(renameIdea(library, "missing", "New")).toEqual(library);
  });

  it("does not mutate the input array or its Ideas", () => {
    const library = [idea("a", 2_000)];
    const snapshot = structuredClone(library);
    renameIdea(library, "a", "Changed");
    expect(library).toEqual(snapshot);
  });
});

describe("removeIdea", () => {
  it("drops the matching Idea so it no longer appears", () => {
    const library = [idea("a", 2_000), idea("b", 1_000)];
    const remaining = removeIdea(library, "a");
    expect(remaining).toEqual([idea("b", 1_000)]);
  });

  it("leaves the Library untouched when no Idea matches", () => {
    const library = [idea("a", 2_000)];
    expect(removeIdea(library, "missing")).toEqual(library);
  });

  it("does not mutate the input array", () => {
    const library = [idea("a", 2_000), idea("b", 1_000)];
    const snapshot = [...library];
    removeIdea(library, "a");
    expect(library).toEqual(snapshot);
  });
});

describe("setIdeaStorageState", () => {
  it("keeps the Idea in place while marking its audio offloaded or on-device", () => {
    const library = [idea("a", 2_000), idea("b", 1_000)];
    const offloaded = setIdeaStorageState(library, "a", "offloaded");
    expect(offloaded).toEqual([
      { ...idea("a", 2_000), storageState: "offloaded" },
      idea("b", 1_000),
    ]);
    expect(setIdeaStorageState(offloaded, "a", "on-device")).toEqual(library);
  });

  it("does not mutate the input Library", () => {
    const library = [idea("a", 1_000)];
    setIdeaStorageState(library, "a", "offloaded");
    expect(library).toEqual([idea("a", 1_000)]);
  });
});

describe("normalizeIdeaName", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeIdeaName("  Verse idea  ")).toBe("Verse idea");
  });

  it("rejects blank names by returning null", () => {
    expect(normalizeIdeaName("")).toBeNull();
    expect(normalizeIdeaName("   ")).toBeNull();
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
