import type { IdeaMetadata } from "./idea.js";

/**
 * Library — the flat, reverse-chronological list of a user's Ideas shown in
 * both Capture and Bridge (CONTEXT.md). No folders or tags; ordering is purely
 * by capture time, newest first. These helpers keep that ordering and the
 * duration formatting device-independent so both app shells stay thin.
 */

/**
 * Returns a new array of Ideas ordered newest first by capture time. Stable:
 * Ideas captured at the same instant keep their input order.
 */
export function sortLibrary(ideas: readonly IdeaMetadata[]): IdeaMetadata[] {
  return [...ideas].sort((a, b) => b.capturedAt - a.capturedAt);
}

/**
 * Adds a captured Idea to the Library, returning a new newest-first list.
 * Sorting (rather than a blind unshift) keeps ordering correct even if an
 * Idea arrives out of capture order — e.g. a synced Idea from another device.
 */
export function insertIdea(
  library: readonly IdeaMetadata[],
  idea: IdeaMetadata,
): IdeaMetadata[] {
  return sortLibrary([idea, ...library]);
}

/**
 * Formats a recording length as a clock duration: `M:SS` under an hour,
 * `H:MM:SS` beyond it. Partial seconds are floored; invalid or negative
 * input clamps to zero.
 */
export function formatDuration(durationMs: number): string {
  const totalSeconds = Number.isFinite(durationMs)
    ? Math.max(0, Math.floor(durationMs / 1000))
    : 0;
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const pad = (n: number) => String(n).padStart(2, "0");

  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${minutes}:${pad(seconds)}`;
}
