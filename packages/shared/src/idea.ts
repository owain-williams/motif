import type { AudioFormat } from "./tier.js";

/**
 * Idea — a single captured audio recording of a musical fragment (see
 * CONTEXT.md). One recording session produces exactly one Idea.
 *
 * Placeholder metadata schema for the scaffold. Fields will be firmed up
 * alongside the Capture core module (Idea lifecycle, auto-naming, Library
 * ordering) in a later ticket.
 */

/** Where an Idea's audio currently lives. */
export type IdeaStorageState = "on-device" | "offloaded";

export interface IdeaMetadata {
  /** Stable unique identifier for the Idea. */
  readonly id: string;
  /** Auto-generated on creation; renameable later by the user. */
  readonly name: string;
  /** Epoch milliseconds when the recording was captured. */
  readonly capturedAt: number;
  /** Recording length in milliseconds. */
  readonly durationMs: number;
  readonly audioFormat: AudioFormat;
  readonly channels: 1 | 2;
  readonly storageState: IdeaStorageState;
}
