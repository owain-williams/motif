import { describe, expect, it } from "vitest";
import { ideaMetadataLabels } from "./idea.js";
import type { IdeaMetadata } from "./idea.js";
import {
  editIdea,
  formatDuration,
  ideaFacets,
  ideaMatchesFacet,
  insertIdea,
  libraryFacets,
  normalizeIdeaName,
  removeIdea,
  renameIdea,
  searchLibrary,
  setIdeaStorageState,
  sortLibrary,
  sortLibraryByDuration,
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
      tempo: 0, location: 0,
    },
  };
}

describe("searchLibrary", () => {
  it("matches text across an Idea's name and searchable metadata", () => {
    const named = { ...idea("named", 6_000), name: "Chorus hook" };
    const tagged = { ...idea("tagged", 5_000), tags: ["dreamy"] };
    const instrument = { ...idea("instrument", 4_000), instrument: ["guitar"] };
    const style = { ...idea("style", 3_000), style: ["shoegaze"] };
    const located = {
      ...idea("located", 2_000),
      location: { lat: 51.5, lon: -0.1, label: "London studio" },
    };
    const unmatched = idea("unmatched", 1_000);
    const library = [named, tagged, instrument, style, located, unmatched];

    expect(searchLibrary(library, "HOOK")).toEqual([named]);
    expect(searchLibrary(library, "dream")).toEqual([tagged]);
    expect(searchLibrary(library, "guitar")).toEqual([instrument]);
    expect(searchLibrary(library, "shoe")).toEqual([style]);
    expect(searchLibrary(library, "london")).toEqual([located]);
  });

  it("finds a tag when the query contains a small typo", () => {
    const guitar = { ...idea("guitar", 2_000), tags: ["guitar"] };
    const piano = { ...idea("piano", 1_000), tags: ["piano"] };

    expect(searchLibrary([guitar, piano], "gitar")).toEqual([guitar]);
  });

  it("treats numeric queries as exact tempos or inclusive tempo ranges", () => {
    const slow = { ...idea("slow", 4_000), tempo: 90 };
    const inRange = { ...idea("in-range", 3_000), tempo: 120 };
    const upperBound = { ...idea("upper", 2_000), tempo: 130 };
    const textOnly = { ...idea("text", 1_000), name: "120 sketches", tempo: null };
    const library = [slow, inRange, upperBound, textOnly];

    expect(searchLibrary(library, "120")).toEqual([inRange]);
    expect(searchLibrary(library, " 100 - 130 ")).toEqual([inRange, upperBound]);
  });

  it("returns the whole Library for a blank query without mutating it", () => {
    const library = [idea("a", 2_000), idea("b", 1_000)];
    const result = searchLibrary(library, "   ");

    expect(result).toEqual(library);
    expect(result).not.toBe(library);
  });
});

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
  it("replaces the name of the matching Idea and stamps it", () => {
    const library = [idea("a", 2_000), idea("b", 1_000)];
    const renamed = renameIdea(library, "b", "Chorus hook", 9_000);
    expect(renamed[0]).toEqual(idea("a", 2_000));
    expect(renamed[1]!.name).toBe("Chorus hook");
    expect(renamed[1]!.fieldUpdatedAt.name).toBe(9_000);
    // Nothing else about the Idea changes.
    expect(renamed[1]!.tags).toEqual([]);
  });

  it("preserves Library order — a rename never reorders", () => {
    const library = [idea("a", 2_000), idea("b", 1_000)];
    const renamed = renameIdea(library, "a", "Zzz last alphabetically", 9_000);
    expect(renamed.map((entry) => entry.id)).toEqual(["a", "b"]);
  });

  it("leaves the Library untouched when no Idea matches", () => {
    const library = [idea("a", 2_000)];
    expect(renameIdea(library, "missing", "New", 9_000)).toEqual(library);
  });

  it("does not mutate the input array or its Ideas", () => {
    const library = [idea("a", 2_000)];
    const snapshot = structuredClone(library);
    renameIdea(library, "a", "Changed", 9_000);
    expect(library).toEqual(snapshot);
  });
});

describe("editIdea", () => {
  it("applies a multi-field edit to the matching Idea and stamps changes", () => {
    const library = [idea("a", 2_000), idea("b", 1_000)];
    const edited = editIdea(
      library,
      "a",
      { tags: ["dreamy"], tempo: 120 },
      9_000,
    );
    expect(edited[0]!.tags).toEqual(["dreamy"]);
    expect(edited[0]!.tempo).toBe(120);
    expect(edited[0]!.fieldUpdatedAt.tags).toBe(9_000);
    expect(edited[0]!.fieldUpdatedAt.tempo).toBe(9_000);
    expect(edited[1]).toEqual(idea("b", 1_000));
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

describe("sortLibraryByDuration", () => {
  it("orders the longest Ideas first", () => {
    const short = idea("short", 3_000, 20_000);
    const long = idea("long", 1_000, 180_000);
    const middle = idea("middle", 2_000, 60_000);

    expect(sortLibraryByDuration([short, long, middle])).toEqual([
      long,
      middle,
      short,
    ]);
  });

  it("keeps input order among equal-length Ideas, so a newest-first list stays newest-first within a length", () => {
    const newer = idea("newer", 2_000, 30_000);
    const older = idea("older", 1_000, 30_000);

    expect(sortLibraryByDuration([newer, older])).toEqual([newer, older]);
  });

  it("leaves the input untouched", () => {
    const library = [idea("a", 1_000, 10_000), idea("b", 2_000, 90_000)];
    const before = [...library];

    sortLibraryByDuration(library);

    expect(library).toEqual(before);
  });
});

describe("libraryFacets", () => {
  it("counts every distinct metadata value across the Library", () => {
    const first = {
      ...idea("first", 3_000),
      tags: ["dreamy"],
      instrument: ["guitar"],
      tempo: 120,
    };
    const second = {
      ...idea("second", 2_000),
      instrument: ["guitar", "vocal"],
      style: ["ballad"],
    };
    const third = {
      ...idea("third", 1_000),
      location: { lat: 53.05, lon: -2.99, label: "Wrexham" },
    };

    // Most-used first, then alphabetically by label.
    expect(libraryFacets([first, second, third])).toEqual([
      { kind: "instrument", value: "guitar", label: "guitar", count: 2 },
      { kind: "tempo", value: "120", label: "120 BPM", count: 1 },
      { kind: "style", value: "ballad", label: "ballad", count: 1 },
      { kind: "tags", value: "dreamy", label: "dreamy", count: 1 },
      { kind: "instrument", value: "vocal", label: "vocal", count: 1 },
      { kind: "location", value: "Wrexham", label: "Wrexham", count: 1 },
    ]);
  });

  it("folds values that differ only in case into one facet, keeping the casing first seen", () => {
    const first = { ...idea("first", 2_000), tags: ["Guitar"] };
    const second = { ...idea("second", 1_000), tags: ["guitar"] };

    expect(libraryFacets([first, second])).toEqual([
      { kind: "tags", value: "Guitar", label: "Guitar", count: 2 },
    ]);
  });

  it("keeps the same word in different fields as separate facets", () => {
    const library = [{ ...idea("both", 1_000), tags: ["vocal"], instrument: ["vocal"] }];

    expect(libraryFacets(library)).toEqual([
      { kind: "instrument", value: "vocal", label: "vocal", count: 1 },
      { kind: "tags", value: "vocal", label: "vocal", count: 1 },
    ]);
  });

  it("falls back to a location's coordinates when it has no place label", () => {
    const located = {
      ...idea("located", 1_000),
      location: { lat: 53.05, lon: -2.99, label: "" },
    };

    expect(libraryFacets([located])).toEqual([
      { kind: "location", value: "53.050, -2.990", label: "53.050, -2.990", count: 1 },
    ]);
  });

  it("has nothing to offer for a Library with no metadata", () => {
    expect(libraryFacets([idea("bare", 1_000)])).toEqual([]);
  });
});

describe("ideaMatchesFacet", () => {
  const tagged = {
    ...idea("tagged", 1_000),
    tags: ["Dreamy"],
    instrument: ["guitar"],
    tempo: 120,
    location: { lat: 53.05, lon: -2.99, label: "Wrexham" },
  };

  it("matches a value the Idea carries, ignoring case", () => {
    expect(ideaMatchesFacet(tagged, "tags", "dreamy")).toBe(true);
    expect(ideaMatchesFacet(tagged, "instrument", "GUITAR")).toBe(true);
    expect(ideaMatchesFacet(tagged, "tempo", "120")).toBe(true);
    expect(ideaMatchesFacet(tagged, "location", "wrexham")).toBe(true);
  });

  it("does not match a value carried by a different field", () => {
    expect(ideaMatchesFacet(tagged, "instrument", "dreamy")).toBe(false);
    expect(ideaMatchesFacet(tagged, "style", "guitar")).toBe(false);
  });

  it("does not match an Idea that has no value for the field", () => {
    const bare = idea("bare", 1_000);

    expect(ideaMatchesFacet(bare, "tempo", "120")).toBe(false);
    expect(ideaMatchesFacet(bare, "location", "Wrexham")).toBe(false);
    expect(ideaMatchesFacet(bare, "tags", "dreamy")).toBe(false);
  });
});

describe("ideaFacets", () => {
  it("tags each of an Idea's metadata values with the field it came from", () => {
    const tagged = {
      ...idea("tagged", 1_000),
      tags: ["dreamy"],
      instrument: ["guitar"],
      style: ["ballad"],
      tempo: 120,
      location: { lat: 53.05, lon: -2.99, label: "Wrexham" },
    };

    expect(ideaFacets(tagged)).toEqual([
      { kind: "tags", value: "dreamy", label: "dreamy" },
      { kind: "instrument", value: "guitar", label: "guitar" },
      { kind: "style", value: "ballad", label: "ballad" },
      { kind: "tempo", value: "120", label: "120 BPM" },
      { kind: "location", value: "Wrexham", label: "Wrexham" },
    ]);
  });

  it("reads the same values, in the same order, as the label-only sibling", () => {
    const tagged = {
      ...idea("tagged", 1_000),
      tags: ["dreamy"],
      instrument: ["guitar"],
      tempo: 120,
    };

    expect(ideaFacets(tagged).map((facet) => facet.label)).toEqual(
      ideaMetadataLabels(tagged).map((label) => label.replace("\u{1F4CD} ", "")),
    );
  });

  it("has nothing to list for an Idea with no metadata", () => {
    expect(ideaFacets(idea("bare", 1_000))).toEqual([]);
  });
});
