/**
 * The live clock on the Record screen. Distinct from `formatDuration` in
 * `@motif/shared`, which labels a finished Idea: while recording, the tenths
 * digit is what tells the user the capture is actually running, so it ticks
 * even when the seconds don't.
 */

/**
 * Formats elapsed recording time as `M:SS.T`. Minutes are never padded and
 * simply keep counting past an hour — a captured fragment is short by nature,
 * and an `H:MM:SS.T` clock would jump the layout for a case that shouldn't
 * happen. Partial tenths are floored (the clock never shows time not yet
 * recorded), and invalid or negative input rests at zero.
 */
export function formatRecordingClock(elapsedMs: number): string {
  const total = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  const tenths = Math.floor(total / 100);
  const minutes = Math.floor(tenths / 600);
  const seconds = Math.floor(tenths / 10) % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}.${tenths % 10}`;
}
