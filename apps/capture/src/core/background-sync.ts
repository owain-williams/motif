import type { IdeaMetadata } from "@motif/shared";
import { applyMergedMetadata } from "./sync-engine";

/**
 * Device-free policy for a headless sync pass: which transports run, what the
 * OS is told afterwards, and how the Library a pass produced is written back.
 *
 * A transport is one independently available path (LAN or cloud). Running all
 * of them prevents an offline Bridge from blocking cloud relay, and a failed
 * result asks the OS scheduler to try the incomplete work again later.
 */
export type BackgroundSyncTransport = () => Promise<void>;
export type BackgroundSyncOutcome = "success" | "failed";

export async function runBackgroundSyncJob(
  transports: readonly BackgroundSyncTransport[],
): Promise<BackgroundSyncOutcome> {
  const results = await Promise.allSettled(transports.map((sync) => sync()));
  return results.every((result) => result.status === "fulfilled")
    ? "success"
    : "failed";
}

/** The durable Library a headless pass reads and writes back (`idea-storage`). */
export interface LibraryStorage {
  readonly load: () => Promise<IdeaMetadata[]>;
  readonly save: (library: readonly IdeaMetadata[]) => void;
}

/** Lands one finished metadata reconciliation on the persisted Library. */
export type MetadataCommit = (
  merged: readonly IdeaMetadata[],
) => Promise<void>;

/**
 * Builds the write half of headless metadata sync (motif-kka.10). A pass
 * reconciles against the Library as it was when the job woke, so committing that
 * result blindly would undo whatever happened since — a foreground edit, a fresh
 * capture, a purge. Each commit therefore re-reads durable state and re-merges
 * ({@link applyMergedMetadata}) instead of overwriting, and writes only when
 * something actually moved.
 *
 * Commits are serialized: the LAN and cloud transports run concurrently, and
 * without this their read-modify-write cycles would interleave and drop one
 * side's edits. A failed read rejects — letting the job report failure so the OS
 * retries — without wedging the commits behind it.
 */
export function createMetadataCommit(storage: LibraryStorage): MetadataCommit {
  // Always kept on the fulfilled path so one rejected commit cannot strand the
  // ones queued behind it.
  let queue: Promise<void> = Promise.resolve();
  return (merged) => {
    const commit = queue.then(async () => {
      const { library, changed } = applyMergedMetadata(
        await storage.load(),
        merged,
      );
      if (changed) storage.save(library);
    });
    queue = commit.catch(() => undefined);
    return commit;
  };
}
