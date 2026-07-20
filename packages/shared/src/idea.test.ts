import { describe, expect, it } from "vitest";
import {
  applyIdeaEdit,
  autoIdeaName,
  createIdea,
  distinctFieldValues,
  formatCoordinates,
  formatLocationLabel,
  ideaMetadataLabels,
  mergeIdea,
  normalizeMultiValue,
  normalizeTempo,
  sameEditableMetadata,
  withMetadataDefaults,
} from "./idea.js";
import type { IdeaLocation, IdeaMetadata } from "./idea.js";

/**
 * Idea lifecycle helpers (motif-6fu.3). On stop, Capture auto-saves an Idea
 * with an auto-generated name and no naming prompt (CONTEXT.md). These pure
 * helpers own that naming + construction so the device shell stays thin.
 */

// 2026-07-19 14:30:07 UTC — pinned instant for deterministic naming.
const CAPTURED_AT = Date.UTC(2026, 6, 19, 14, 30, 7);

describe("autoIdeaName", () => {
  it("derives a human-readable timestamp name from the capture instant", () => {
    expect(autoIdeaName(CAPTURED_AT, "UTC")).toBe("19 Jul 2026, 14:30:07");
  });

  it("renders the wall-clock time of the supplied time zone", () => {
    // +14:00 pushes past midnight into the next calendar day.
    expect(autoIdeaName(CAPTURED_AT, "Pacific/Kiritimati")).toBe(
      "20 Jul 2026, 04:30:07",
    );
  });

  it("gives distinct names to recordings a second apart", () => {
    expect(autoIdeaName(CAPTURED_AT, "UTC")).not.toBe(
      autoIdeaName(CAPTURED_AT + 1_000, "UTC"),
    );
  });
});

describe("createIdea", () => {
  it("auto-names the Idea and lands it on-device", () => {
    const idea = createIdea({
      id: "idea-1",
      capturedAt: CAPTURED_AT,
      durationMs: 42_000,
      audioFormat: "aac",
      channels: 1,
      timeZone: "UTC",
    });
    expect(idea).toEqual({
      id: "idea-1",
      name: "19 Jul 2026, 14:30:07",
      capturedAt: CAPTURED_AT,
      durationMs: 42_000,
      audioFormat: "aac",
      channels: 1,
      storageState: "on-device",
      tags: [],
      instrument: [],
      style: [],
      tempo: null,
      location: null,
      fieldUpdatedAt: {
        name: CAPTURED_AT,
        tags: 0,
        instrument: 0,
        style: 0,
        tempo: 0, location: 0,
      },
    });
  });

  it("preserves the recording's format and channel count", () => {
    const idea = createIdea({
      id: "idea-2",
      capturedAt: CAPTURED_AT,
      durationMs: 1_000,
      audioFormat: "wav",
      channels: 2,
    });
    expect(idea.audioFormat).toBe("wav");
    expect(idea.channels).toBe(2);
  });

  it("starts with empty editable metadata", () => {
    const idea = createIdea({
      id: "idea-3",
      capturedAt: CAPTURED_AT,
      durationMs: 1_000,
      audioFormat: "aac",
      channels: 1,
    });
    expect(idea.tags).toEqual([]);
    expect(idea.instrument).toEqual([]);
    expect(idea.style).toEqual([]);
    expect(idea.tempo).toBeNull();
  });
});

function baseIdea(overrides: Partial<IdeaMetadata> = {}): IdeaMetadata {
  return {
    id: "idea",
    name: "Idea",
    capturedAt: CAPTURED_AT,
    durationMs: 1_000,
    audioFormat: "aac",
    channels: 1,
    storageState: "on-device",
    tags: [],
    instrument: [],
    style: [],
    tempo: null,
    location: null,
    fieldUpdatedAt: {
      name: CAPTURED_AT,
      tags: 0,
      instrument: 0,
      style: 0,
      tempo: 0, location: 0,
    },
    ...overrides,
  };
}

describe("withMetadataDefaults", () => {
  it("fills editable fields absent from a pre-schema persisted Idea", () => {
    const legacy = {
      id: "old",
      name: "Old idea",
      capturedAt: CAPTURED_AT,
      durationMs: 2_000,
      audioFormat: "aac" as const,
      channels: 1 as const,
      storageState: "on-device" as const,
    };
    expect(withMetadataDefaults(legacy)).toEqual(
      baseIdea({ id: "old", name: "Old idea", durationMs: 2_000 }),
    );
  });

  it("keeps values and timestamps already present", () => {
    const idea = baseIdea({
      tags: ["dreamy"],
      tempo: 120,
      fieldUpdatedAt: {
        name: CAPTURED_AT,
        tags: 5_000,
        instrument: 0,
        style: 0,
        tempo: 6_000, location: 0,
      },
    });
    expect(withMetadataDefaults(idea)).toEqual(idea);
  });
});

describe("applyIdeaEdit", () => {
  it("stamps only the fields that actually change", () => {
    const idea = baseIdea({ tags: ["verse"] });
    const edited = applyIdeaEdit(
      idea,
      { tags: ["verse", "chorus"], tempo: 128 },
      9_000,
    );
    expect(edited.tags).toEqual(["verse", "chorus"]);
    expect(edited.tempo).toBe(128);
    expect(edited.fieldUpdatedAt.tags).toBe(9_000);
    expect(edited.fieldUpdatedAt.tempo).toBe(9_000);
    // name/instrument/style untouched keep their old timestamps.
    expect(edited.fieldUpdatedAt.name).toBe(CAPTURED_AT);
    expect(edited.fieldUpdatedAt.style).toBe(0);
  });

  it("does not bump a field re-submitted with an unchanged value", () => {
    const idea = baseIdea({ tags: ["verse"], fieldUpdatedAt: { name: CAPTURED_AT, tags: 3_000, instrument: 0, style: 0, tempo: 0, location: 0 } });
    const edited = applyIdeaEdit(idea, { tags: ["verse"] }, 9_000);
    expect(edited.fieldUpdatedAt.tags).toBe(3_000);
  });

  it("clears tempo and stamps the change when set to null", () => {
    const idea = baseIdea({ tempo: 120, fieldUpdatedAt: { name: CAPTURED_AT, tags: 0, instrument: 0, style: 0, tempo: 1_000, location: 0 } });
    const edited = applyIdeaEdit(idea, { tempo: null }, 9_000);
    expect(edited.tempo).toBeNull();
    expect(edited.fieldUpdatedAt.tempo).toBe(9_000);
  });

  it("does not mutate the input Idea", () => {
    const idea = baseIdea({ tags: ["verse"] });
    const snapshot = structuredClone(idea);
    applyIdeaEdit(idea, { tags: ["verse", "chorus"] }, 9_000);
    expect(idea).toEqual(snapshot);
  });
});

describe("mergeIdea", () => {
  it("takes each field from whichever side edited it most recently", () => {
    const local = baseIdea({
      tags: ["local-tag"],
      instrument: ["guitar"],
      fieldUpdatedAt: { name: CAPTURED_AT, tags: 100, instrument: 300, style: 0, tempo: 0, location: 0 },
    });
    const incoming = baseIdea({
      tags: ["remote-tag"],
      instrument: ["piano"],
      fieldUpdatedAt: { name: CAPTURED_AT, tags: 200, instrument: 150, style: 0, tempo: 0, location: 0 },
    });
    const merged = mergeIdea(local, incoming);
    // Remote's tag edit is newer; local's instrument edit is newer.
    expect(merged.tags).toEqual(["remote-tag"]);
    expect(merged.instrument).toEqual(["guitar"]);
    expect(merged.fieldUpdatedAt.tags).toBe(200);
    expect(merged.fieldUpdatedAt.instrument).toBe(300);
  });

  it("an older edit never clobbers a newer edit to a different field (ADR 0006)", () => {
    // Concurrent-edit scenario, both edits after capture: device A renamed at
    // t=+500 while device B, whose clock was slightly behind, added a tag at
    // t=+400. Neither edit should be lost — name follows A, tags follow B,
    // regardless of which side's copy the merge starts from.
    const renamedByA = baseIdea({
      name: "Chorus hook",
      tags: [],
      fieldUpdatedAt: { name: CAPTURED_AT + 500, tags: 0, instrument: 0, style: 0, tempo: 0, location: 0 },
    });
    const taggedByB = baseIdea({
      name: "Idea",
      tags: ["dreamy"],
      fieldUpdatedAt: { name: CAPTURED_AT, tags: CAPTURED_AT + 400, instrument: 0, style: 0, tempo: 0, location: 0 },
    });
    const onA = mergeIdea(renamedByA, taggedByB);
    const onB = mergeIdea(taggedByB, renamedByA);
    for (const merged of [onA, onB]) {
      expect(merged.name).toBe("Chorus hook");
      expect(merged.tags).toEqual(["dreamy"]);
    }
  });

  it("resolves each field independently when both sides edited both fields", () => {
    // Both devices edited name and tags, at different real (non-zero) times:
    // A's name edit is newer, B's tags edit is newer. The winner differs per
    // field, and must be the same whichever copy the merge starts from.
    const deviceA = baseIdea({
      name: "A name",
      tags: ["a-tag"],
      fieldUpdatedAt: { name: 600, tags: 500, instrument: 0, style: 0, tempo: 0, location: 0 },
    });
    const deviceB = baseIdea({
      name: "B name",
      tags: ["b-tag"],
      fieldUpdatedAt: { name: 400, tags: 700, instrument: 0, style: 0, tempo: 0, location: 0 },
    });
    for (const merged of [mergeIdea(deviceA, deviceB), mergeIdea(deviceB, deviceA)]) {
      expect(merged.name).toBe("A name"); // A's name edit (600) beats B's (400)
      expect(merged.tags).toEqual(["b-tag"]); // B's tag edit (700) beats A's (500)
      expect(merged.fieldUpdatedAt.name).toBe(600);
      expect(merged.fieldUpdatedAt.tags).toBe(700);
    }
  });

  it("keeps the local value and storageState on a tie", () => {
    const local = baseIdea({
      tags: ["mine"],
      storageState: "offloaded",
      fieldUpdatedAt: { name: CAPTURED_AT, tags: 500, instrument: 0, style: 0, tempo: 0, location: 0 },
    });
    const incoming = baseIdea({
      tags: ["theirs"],
      storageState: "on-device",
      fieldUpdatedAt: { name: CAPTURED_AT, tags: 500, instrument: 0, style: 0, tempo: 0, location: 0 },
    });
    const merged = mergeIdea(local, incoming);
    expect(merged.tags).toEqual(["mine"]);
    // storageState is per-device and never merged.
    expect(merged.storageState).toBe("offloaded");
  });
});

describe("sameEditableMetadata", () => {
  it("is true for identical editable metadata regardless of storage state", () => {
    const a = baseIdea({ tags: ["x"], storageState: "on-device" });
    const b = baseIdea({ tags: ["x"], storageState: "offloaded" });
    expect(sameEditableMetadata(a, b)).toBe(true);
  });

  it("is false when a field value or its timestamp differs", () => {
    const a = baseIdea({ tags: ["x"], fieldUpdatedAt: { name: CAPTURED_AT, tags: 1, instrument: 0, style: 0, tempo: 0, location: 0 } });
    const b = baseIdea({ tags: ["x"], fieldUpdatedAt: { name: CAPTURED_AT, tags: 2, instrument: 0, style: 0, tempo: 0, location: 0 } });
    expect(sameEditableMetadata(a, b)).toBe(false);
    expect(sameEditableMetadata(a, baseIdea({ tags: ["y"] }))).toBe(false);
  });
});

const LONDON: IdeaLocation = { lat: 51.5074, lon: -0.1278, label: "London" };

describe("location editing and merge (motif-kka.3)", () => {
  it("stamps location when a location tag is set", () => {
    const edited = applyIdeaEdit(baseIdea(), { location: LONDON }, 9_000);
    expect(edited.location).toEqual(LONDON);
    expect(edited.fieldUpdatedAt.location).toBe(9_000);
  });

  it("stamps location when a location tag is removed", () => {
    const idea = baseIdea({
      location: LONDON,
      fieldUpdatedAt: { name: CAPTURED_AT, tags: 0, instrument: 0, style: 0, tempo: 0, location: 1_000 },
    });
    const edited = applyIdeaEdit(idea, { location: null }, 9_000);
    expect(edited.location).toBeNull();
    expect(edited.fieldUpdatedAt.location).toBe(9_000);
  });

  it("does not re-stamp a location re-submitted unchanged", () => {
    const idea = baseIdea({
      location: LONDON,
      fieldUpdatedAt: { name: CAPTURED_AT, tags: 0, instrument: 0, style: 0, tempo: 0, location: 3_000 },
    });
    const edited = applyIdeaEdit(idea, { location: { ...LONDON } }, 9_000);
    expect(edited.fieldUpdatedAt.location).toBe(3_000);
  });

  it("takes the location from whichever side edited it most recently", () => {
    const relabelled: IdeaLocation = { ...LONDON, label: "London studio" };
    const local = baseIdea({
      location: LONDON,
      fieldUpdatedAt: { name: CAPTURED_AT, tags: 0, instrument: 0, style: 0, tempo: 0, location: 100 },
    });
    const incoming = baseIdea({
      location: relabelled,
      fieldUpdatedAt: { name: CAPTURED_AT, tags: 0, instrument: 0, style: 0, tempo: 0, location: 200 },
    });
    for (const merged of [mergeIdea(local, incoming), mergeIdea(incoming, local)]) {
      expect(merged.location).toEqual(relabelled);
      expect(merged.fieldUpdatedAt.location).toBe(200);
    }
  });

  it("lets a newer removal win the merge over an older location tag", () => {
    const tagged = baseIdea({
      location: LONDON,
      fieldUpdatedAt: { name: CAPTURED_AT, tags: 0, instrument: 0, style: 0, tempo: 0, location: 100 },
    });
    const removed = baseIdea({
      location: null,
      fieldUpdatedAt: { name: CAPTURED_AT, tags: 0, instrument: 0, style: 0, tempo: 0, location: 200 },
    });
    expect(mergeIdea(tagged, removed).location).toBeNull();
  });

  it("treats differing locations as different editable metadata", () => {
    const a = baseIdea({ location: LONDON });
    const b = baseIdea({ location: { ...LONDON, label: "Elsewhere" } });
    expect(sameEditableMetadata(a, b)).toBe(false);
    expect(sameEditableMetadata(baseIdea({ location: LONDON }), a)).toBe(true);
  });
});

describe("formatCoordinates", () => {
  it("renders rounded lat, lon", () => {
    expect(formatCoordinates(LONDON)).toBe("51.507, -0.128");
  });
});

describe("formatLocationLabel", () => {
  it("uses the place label when present", () => {
    expect(formatLocationLabel(LONDON)).toBe("London");
  });

  it("falls back to rounded coordinates when the label is empty", () => {
    expect(formatLocationLabel({ lat: 51.5074, lon: -0.1278, label: "  " })).toBe(
      "51.507, -0.128",
    );
  });

  it("is null for an untagged Idea", () => {
    expect(formatLocationLabel(null)).toBeNull();
  });
});

describe("ideaMetadataLabels", () => {
  it("appends a pin-prefixed location after tags, instrument, style, and tempo", () => {
    const idea = baseIdea({ tags: ["verse"], tempo: 120, location: LONDON });
    expect(ideaMetadataLabels(idea)).toEqual(["verse", "120 BPM", "📍 London"]);
  });

  it("omits location for an untagged Idea", () => {
    expect(ideaMetadataLabels(baseIdea({ tags: ["verse"] }))).toEqual(["verse"]);
  });
});

describe("normalizeMultiValue", () => {
  it("trims, drops blanks, and dedupes case-insensitively keeping order", () => {
    expect(normalizeMultiValue([" Guitar ", "guitar", "", "Piano"])).toEqual([
      "Guitar",
      "Piano",
    ]);
  });
});

describe("normalizeTempo", () => {
  it("parses a positive integer BPM and rounds", () => {
    expect(normalizeTempo(" 128 ")).toBe(128);
    expect(normalizeTempo("119.6")).toBe(120);
  });

  it("returns null for blank, zero, negative, or non-numeric input", () => {
    expect(normalizeTempo("")).toBeNull();
    expect(normalizeTempo("0")).toBeNull();
    expect(normalizeTempo("-5")).toBeNull();
    expect(normalizeTempo("fast")).toBeNull();
  });
});

describe("distinctFieldValues", () => {
  it("returns sorted, case-insensitively deduped values for a field", () => {
    const library = [
      baseIdea({ id: "a", instrument: ["Guitar", "Bass"] }),
      baseIdea({ id: "b", instrument: ["guitar", "Synth"] }),
    ];
    expect(distinctFieldValues(library, "instrument")).toEqual([
      "Bass",
      "Guitar",
      "Synth",
    ]);
  });
});
