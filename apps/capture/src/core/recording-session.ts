/**
 * Recording session — the Capture-only state behind the single record button.
 *
 * A recording is a toggle: one tap starts it, one tap stops it (motif-6fu.3).
 * This module owns that transition, its guards, and the instant the recording
 * began (which stamps the Idea's `capturedAt`). It is pure and device-free; the
 * audio engine, the file, and the recording's *length* live in the shell — the
 * length is what the engine actually encoded, not something this module guesses.
 */

export type RecordingStatus = "idle" | "recording";

export interface RecordingSession {
  readonly status: RecordingStatus;
  /** Epoch milliseconds the current recording began; `null` when idle. */
  readonly startedAt: number | null;
}

/** The resting state: no recording in progress. */
export const IDLE_SESSION: RecordingSession = { status: "idle", startedAt: null };

export function isRecording(session: RecordingSession): boolean {
  return session.status === "recording";
}

/**
 * Starts a recording at `now`. Throws if one is already in progress — the
 * shell should read {@link isRecording} to decide which action a tap performs.
 */
export function beginRecording(
  session: RecordingSession,
  now: number,
): RecordingSession {
  if (session.status === "recording") {
    throw new Error("Cannot begin recording: a recording is already in progress");
  }
  return { status: "recording", startedAt: now };
}

/**
 * Stops the in-progress recording, returning the idle session and the instant
 * capture began (for the Idea's `capturedAt`). Throws if nothing is recording.
 */
export function endRecording(session: RecordingSession): {
  session: RecordingSession;
  startedAt: number;
} {
  if (session.status !== "recording" || session.startedAt === null) {
    throw new Error("Cannot end recording: nothing is recording");
  }
  return { session: IDLE_SESSION, startedAt: session.startedAt };
}
