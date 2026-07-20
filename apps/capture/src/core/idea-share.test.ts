import { describe, expect, it } from "vitest";
import type { IdeaMetadata } from "@motif/shared";
import {
  planIdeaShare,
  shareFileName,
  SHARE_AUDIO_EXTENSION,
  SHARE_AUDIO_MIME_TYPE,
  SHARE_AUDIO_UTI,
} from "./idea-share.js";

/**
 * Sharing an Idea (motif-6fu.5) — the pure decision behind the Library's Share
 * action. Per ADR 0001, an Idea is always handed to the OS share sheet in the
 * compressed format regardless of how it was recorded/stored, so a Pro user's
 * uncompressed WAV is never sent as an oversized attachment. This module owns
 * that decision; the share sheet and the file staging live in the device shell.
 */

function makeIdea(overrides: Partial<IdeaMetadata> = {}): IdeaMetadata {
  return {
    id: "abc",
    name: "Chorus riff",
    capturedAt: 1_700_000_000_000,
    durationMs: 4_200,
    audioFormat: "aac",
    channels: 1,
    storageState: "on-device",
    tags: [],
    instrument: [],
    style: [],
    tempo: null,
    location: null,
    fieldUpdatedAt: { name: 1_700_000_000_000, tags: 0, instrument: 0, style: 0, tempo: 0, location: 0 },
    ...overrides,
  };
}

describe("planIdeaShare", () => {
  it("shares a compressed (AAC) Idea as-is — no transcode needed", () => {
    const plan = planIdeaShare(makeIdea({ audioFormat: "aac" }));
    expect(plan.needsTranscode).toBe(false);
  });

  it("transcodes an uncompressed (WAV/Pro) Idea before sharing", () => {
    const plan = planIdeaShare(makeIdea({ audioFormat: "wav" }));
    expect(plan.needsTranscode).toBe(true);
  });

  it("advertises the compressed type to the share sheet whatever the source", () => {
    // ADR 0001: the shared file is always compressed regardless of the sender's
    // tier, so an uncompressed (Pro/WAV) source still goes out as `.m4a`/AAC.
    for (const audioFormat of ["aac", "wav"] as const) {
      const plan = planIdeaShare(makeIdea({ audioFormat }));
      expect(plan.mimeType).toBe(SHARE_AUDIO_MIME_TYPE);
      expect(plan.uti).toBe(SHARE_AUDIO_UTI);
      expect(plan.fileName.endsWith(SHARE_AUDIO_EXTENSION)).toBe(true);
    }
  });

  it("names the shared file after the Idea, with the compressed extension", () => {
    const plan = planIdeaShare(makeIdea({ name: "Chorus riff" }));
    expect(plan.fileName).toBe("Chorus riff.m4a");
  });
});

describe("shareFileName", () => {
  it("appends the compressed extension to the Idea name", () => {
    expect(shareFileName("Bridge idea")).toBe("Bridge idea.m4a");
  });

  it("strips characters illegal in filenames across platforms", () => {
    // Auto-generated names carry colons (e.g. "…, 14:32:05"); other names may
    // carry slashes. None are safe in a filename handed to the OS.
    expect(shareFileName('a/b\\c:d*e?f"g<h>i|j')).toBe("a b c d e f g h i j.m4a");
  });

  it("keeps the auto-generated timestamp name readable", () => {
    expect(shareFileName("19 Jul 2026, 14:32:05")).toBe(
      "19 Jul 2026, 14 32 05.m4a",
    );
  });

  it("collapses whitespace runs and trims the edges", () => {
    expect(shareFileName("  loud   idea  ")).toBe("loud idea.m4a");
  });

  it("falls back to a generic name when nothing usable remains", () => {
    expect(shareFileName("   ")).toBe("Idea.m4a");
    expect(shareFileName("///")).toBe("Idea.m4a");
  });

  it("caps an overlong name so it stays a valid filename", () => {
    const result = shareFileName("x".repeat(300));
    const base = result.slice(0, -SHARE_AUDIO_EXTENSION.length);
    expect(base.length).toBeLessThanOrEqual(100);
    expect(result.endsWith(".m4a")).toBe(true);
  });
});
