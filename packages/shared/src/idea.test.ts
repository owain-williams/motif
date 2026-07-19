import { describe, expect, it } from "vitest";
import { autoIdeaName, createIdea } from "./idea.js";

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
});
