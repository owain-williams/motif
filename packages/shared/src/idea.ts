import type { AudioFormat } from "./tier.js";

/**
 * Idea — a single captured audio recording of a musical fragment (see
 * CONTEXT.md). One recording session produces exactly one Idea.
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

/**
 * Builds the auto-generated name shown when an Idea is saved with no naming
 * prompt (CONTEXT.md). A readable local-time stamp — down to the second so
 * back-to-back captures stay distinguishable before the user renames them.
 *
 * @param capturedAt Epoch milliseconds the recording was captured.
 * @param timeZone   IANA zone to render in; defaults to the runtime's zone.
 */
export function autoIdeaName(capturedAt: number, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone,
  }).format(capturedAt);
}

/** The recording facts needed to mint an Idea from a completed capture. */
export interface NewIdeaInput {
  readonly id: string;
  readonly capturedAt: number;
  readonly durationMs: number;
  readonly audioFormat: AudioFormat;
  readonly channels: 1 | 2;
  /** Time zone for the auto-generated name; defaults to the runtime's zone. */
  readonly timeZone?: string;
}

/**
 * Assembles a freshly captured Idea with its auto-generated name — Capture
 * saves with no naming prompt (CONTEXT.md); renaming is a later, separate
 * action. New Ideas always start on-device (offloading is explicit and later).
 */
export function createIdea(input: NewIdeaInput): IdeaMetadata {
  return {
    id: input.id,
    name: autoIdeaName(input.capturedAt, input.timeZone),
    capturedAt: input.capturedAt,
    durationMs: input.durationMs,
    audioFormat: input.audioFormat,
    channels: input.channels,
    storageState: "on-device",
  };
}
