import { describe, expect, it } from "vitest";
import { ideaWaveform } from "./idea-waveform.js";

/**
 * Library waveform selection (motif-6fu.13). The public seam receives the
 * device-local peaks, when available, and otherwise supplies the stable legacy
 * fallback used by Ideas captured before waveform sidecars existed.
 */
describe("Idea waveform", () => {
  it("renders persisted audio peaks instead of the synthetic fallback", () => {
    expect(ideaWaveform("idea-1", [0.08, 0.45, 1])).toEqual([0.08, 0.45, 1]);
  });

  it("falls back for an Idea without persisted peaks", () => {
    const first = ideaWaveform("legacy-idea");
    expect(first).toHaveLength(24);
    expect(first).toEqual(ideaWaveform("legacy-idea"));
  });

  it("falls back when a sidecar contains unusable peak data", () => {
    expect(ideaWaveform("idea-1", [0.2, Number.NaN, 0.8])).toEqual(
      ideaWaveform("idea-1"),
    );
    expect(ideaWaveform("idea-1", [])).toEqual(ideaWaveform("idea-1"));
  });
});
