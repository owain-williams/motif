import { describe, expect, it } from "vitest";
import {
  beginRecording,
  endRecording,
  IDLE_SESSION,
  isRecording,
} from "./recording-session.js";

/**
 * Recording session (motif-6fu.3) — the Capture-only toggle behind the single
 * record button: one tap starts, one tap stops. It also remembers when capture
 * began so the shell can stamp the Idea's `capturedAt`.
 */

describe("recording session toggle", () => {
  it("starts idle", () => {
    expect(isRecording(IDLE_SESSION)).toBe(false);
  });

  it("begins recording from idle, remembering when it started", () => {
    const session = beginRecording(IDLE_SESSION, 1_000);
    expect(isRecording(session)).toBe(true);
    expect(session.startedAt).toBe(1_000);
  });

  it("ends recording back to idle, reporting when capture began", () => {
    const recording = beginRecording(IDLE_SESSION, 1_000);
    const { session, startedAt } = endRecording(recording);
    expect(isRecording(session)).toBe(false);
    expect(session).toEqual(IDLE_SESSION);
    expect(startedAt).toBe(1_000);
  });
});

describe("recording session guards", () => {
  it("rejects starting while already recording", () => {
    const recording = beginRecording(IDLE_SESSION, 1_000);
    expect(() => beginRecording(recording, 2_000)).toThrow();
  });

  it("rejects stopping while idle", () => {
    expect(() => endRecording(IDLE_SESSION)).toThrow();
  });
});
