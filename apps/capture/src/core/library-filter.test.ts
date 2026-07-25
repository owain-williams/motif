import { describe, expect, it } from "vitest";
import type { IdeaMetadata } from "@motif/shared";
import {
  activeChipId,
  ALL_CHIP_ID,
  filterLibrary,
  isFiltering,
  libraryChips,
  libraryEmptyState,
  NO_LIBRARY_FILTER,
} from "./library-filter";

const T0 = 1_700_000_000_000;

function idea(id: string, overrides: Partial<IdeaMetadata> = {}): IdeaMetadata {
  return {
    id,
    name: `Idea ${id}`,
    capturedAt: T0,
    durationMs: 4200,
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

const LIBRARY: IdeaMetadata[] = [
  idea("a", { name: "Cold open", tags: ["film"] }),
  idea("b", { name: "Bridge, half step up", tags: ["Lyrics", "melody"] }),
  idea("c", { name: "Chorus but slower", tags: ["lyrics"] }),
  idea("d", { name: "Untagged hum" }),
];

describe("libraryChips", () => {
  it("leads with All and then the Library's own Tags", () => {
    expect(libraryChips(LIBRARY)).toEqual([
      { id: ALL_CHIP_ID, label: "All" },
      { id: "film", label: "film" },
      { id: "Lyrics", label: "Lyrics" },
      { id: "melody", label: "melody" },
    ]);
  });

  it("offers only All for an untagged Library", () => {
    expect(libraryChips([idea("d")])).toEqual([{ id: ALL_CHIP_ID, label: "All" }]);
  });
});

describe("activeChipId", () => {
  it("keeps a selection that is still on offer", () => {
    expect(activeChipId(libraryChips(LIBRARY), "film")).toBe("film");
  });

  it("falls back to All when the selected Tag has vanished", () => {
    expect(activeChipId(libraryChips(LIBRARY), "dream")).toBe(ALL_CHIP_ID);
  });
});

describe("filterLibrary", () => {
  it("returns everything when nothing is selected", () => {
    expect(filterLibrary(LIBRARY, NO_LIBRARY_FILTER)).toHaveLength(4);
  });

  it("matches a Tag regardless of how it was capitalised", () => {
    const filtered = filterLibrary(LIBRARY, { tag: "lyrics", query: "" });
    expect(filtered.map((entry) => entry.id)).toEqual(["b", "c"]);
  });

  it("applies the query within the selected Tag", () => {
    const filtered = filterLibrary(LIBRARY, { tag: "lyrics", query: "chorus" });
    expect(filtered.map((entry) => entry.id)).toEqual(["c"]);
  });

  it("leaves Library order untouched", () => {
    const filtered = filterLibrary(LIBRARY, { tag: ALL_CHIP_ID, query: "o" });
    expect(filtered.map((entry) => entry.id)).toEqual(
      LIBRARY.filter((entry) => filtered.includes(entry)).map((entry) => entry.id),
    );
  });
});

describe("libraryEmptyState", () => {
  it("invites a first recording when nothing is filtered", () => {
    expect(isFiltering(NO_LIBRARY_FILTER)).toBe(false);
    expect(libraryEmptyState(NO_LIBRARY_FILTER).action).toBe("record");
  });

  it("offers a way out when a filter matched nothing", () => {
    const filter = { tag: "film", query: "" };
    expect(isFiltering(filter)).toBe(true);
    expect(libraryEmptyState(filter).action).toBe("clear-filters");
  });

  it("treats a whitespace-only query as no query", () => {
    expect(isFiltering({ tag: ALL_CHIP_ID, query: "   " })).toBe(false);
  });
});
