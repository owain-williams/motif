import { activeIdeas } from "@motif/shared";
import type { IdeaDeletion, IdeaMetadata } from "@motif/shared";
import { ideasToOffer } from "./sync-engine";

/**
 * What the Sync screen reports: how much this Capture is holding, how much of
 * it has reached somewhere else, and the handful of Ideas behind those numbers.
 *
 * "Queued" is not a guess — it is exactly the set the sync engine would offer
 * next ({@link ideasToOffer}), computed against the ids peers have reported
 * holding. One definition, so the screen can never disagree with the pass.
 */

/** One line in the Sync screen's activity list. */
export interface SyncActivityEntry {
  readonly id: string;
  readonly name: string;
  readonly capturedAt: number;
  /** Still waiting to reach a peer. */
  readonly queued: boolean;
}

export interface SyncSummary {
  /** Ideas in the active Library. */
  readonly ideaCount: number;
  /** Their combined recorded length. */
  readonly totalDurationMs: number;
  /** Ideas whose audio no peer has reported holding yet. */
  readonly queuedCount: number;
  /** The most recent Ideas, newest first. */
  readonly activity: SyncActivityEntry[];
}

export interface SyncSummaryInput {
  readonly library: readonly IdeaMetadata[];
  readonly deletions: readonly IdeaDeletion[];
  /** Ids a peer has reported holding, or that this device has sent. */
  readonly deliveredIds: ReadonlySet<string>;
  /** How many Ideas the activity list shows. */
  readonly activityLimit?: number;
}

const DEFAULT_ACTIVITY_LIMIT = 5;

/**
 * The Ideas still waiting to reach a peer — the ids of exactly what the next
 * sync pass would offer. The Library's per-row marker and the Sync screen's
 * count both read this, so they can never tell different stories.
 */
export function queuedIdeaIds(
  library: readonly IdeaMetadata[],
  deletions: readonly IdeaDeletion[],
  deliveredIds: ReadonlySet<string>,
): Set<string> {
  return new Set(
    ideasToOffer(library, deliveredIds, deletions).map((idea) => idea.id),
  );
}

export function syncSummary(input: SyncSummaryInput): SyncSummary {
  const active = activeIdeas(input.library, input.deletions);
  const queued = queuedIdeaIds(input.library, input.deletions, input.deliveredIds);
  return {
    ideaCount: active.length,
    totalDurationMs: active.reduce((total, idea) => total + idea.durationMs, 0),
    queuedCount: queued.size,
    activity: active
      .slice(0, input.activityLimit ?? DEFAULT_ACTIVITY_LIMIT)
      .map((idea) => ({
        id: idea.id,
        name: idea.name,
        capturedAt: idea.capturedAt,
        queued: queued.has(idea.id),
      })),
  };
}

/**
 * Folds a completed pass's knowledge into what this device believes peers hold:
 * the ids a peer reported having, plus the ids it just accepted. Monotonic on
 * purpose — an Idea that has reached Bridge has reached it, and a later pass
 * that can't reach Bridge at all shouldn't make the Library look unsynced.
 */
export function withDelivered(
  delivered: ReadonlySet<string>,
  ...batches: readonly (readonly string[])[]
): ReadonlySet<string> {
  const added = batches.flat().filter((id) => !delivered.has(id));
  if (added.length === 0) return delivered;
  return new Set([...delivered, ...added]);
}
