import { expiredDeletions, removeIdea } from "@motif/shared";
import type { IdeaDeletion, IdeaMetadata } from "@motif/shared";

/**
 * The purge sweep (motif-kka.8). Once an Idea's 30-day Recently Deleted window
 * elapses it goes for good on this device: its audio, its waveform sidecar, its
 * cloud copy, and its Library entry. There is no server to run this on a
 * schedule (ADR 0005), so Capture sweeps at launch.
 *
 * The delete record itself stays — it is the only thing that can still carry
 * the delete to a device offline since before the window, and the guarantee is
 * "however long that takes" (CONTEXT.md). Keeping it also makes the sweep
 * idempotent: the second launch finds the Idea already gone and does nothing.
 *
 * The deletes are injected, keeping this free of `expo-file-system` and of the
 * account client — what's left is the ordering that matters: cloud storage is
 * released before this device forgets the Idea that would name it.
 */

export interface PurgeIo {
  /** Removes an Idea's on-device audio and waveform sidecar. */
  readonly deleteLocalCopy: (idea: IdeaMetadata) => void;
  /**
   * Removes an Idea's copy from cloud storage, or `null` for an account with
   * no cloud storage (Free has none to delete from). Rejecting leaves the Idea
   * for the next sweep.
   */
  readonly deleteCloudCopy: ((idea: IdeaMetadata) => Promise<void>) | null;
}

export interface PurgeRequest {
  readonly library: readonly IdeaMetadata[];
  readonly deletions: readonly IdeaDeletion[];
  readonly now: number;
  readonly io: PurgeIo;
}

export interface PurgeResult {
  /** Ids purged this sweep; empty means the launch has nothing to persist. */
  readonly purged: string[];
  /** The Library with them gone. */
  readonly library: IdeaMetadata[];
}

export async function purgeExpiredIdeas(
  request: PurgeRequest,
): Promise<PurgeResult> {
  const { library, deletions, now, io } = request;

  const purged: string[] = [];
  let remaining = [...library];
  for (const record of expiredDeletions(deletions, now)) {
    const idea = library.find((candidate) => candidate.id === record.id);
    // Already purged on an earlier launch — the record outlives it on purpose.
    if (idea === undefined) continue;
    // Cloud first: while the Idea is still listed here, its id is what names
    // the object to release. Dropping it locally first would strand that copy
    // in the account's quota with nothing left to point at it.
    if (io.deleteCloudCopy !== null) {
      try {
        await io.deleteCloudCopy(idea);
      } catch {
        continue;
      }
    }
    io.deleteLocalCopy(idea);
    remaining = removeIdea(remaining, idea.id);
    purged.push(idea.id);
  }

  return { purged, library: remaining };
}
