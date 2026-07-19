import { describe, expect, it } from "vitest";
import { syntheticWaveform } from "./waveform.js";

/**
 * Waveform bars (motif-6fu.4). Each Library entry renders a waveform alongside
 * its name and duration (CONTEXT.md). Until real amplitude peaks are captured,
 * these are synthesized deterministically from the Idea id so an Idea always
 * looks the same across renders, reloads, and both apps.
 */

describe("syntheticWaveform", () => {
  it("returns the requested number of bars", () => {
    expect(syntheticWaveform("idea-1", 24)).toHaveLength(24);
  });

  it("keeps every bar height within (0, 1]", () => {
    for (const height of syntheticWaveform("idea-1", 64)) {
      expect(height).toBeGreaterThan(0);
      expect(height).toBeLessThanOrEqual(1);
    }
  });

  it("is deterministic — the same seed yields the same bars", () => {
    expect(syntheticWaveform("idea-1")).toEqual(syntheticWaveform("idea-1"));
  });

  it("gives visibly different Ideas different shapes", () => {
    expect(syntheticWaveform("idea-1")).not.toEqual(syntheticWaveform("idea-2"));
  });

  it("returns no bars when asked for none", () => {
    expect(syntheticWaveform("idea-1", 0)).toEqual([]);
  });
});
