import type { IdeaMetadata } from "./idea.js";

/**
 * Cross-device delete (ADR 0005). Free tier has no server to coordinate a
 * delete, so each device keeps its own per-Idea delete/restore record and
 * exchanges the whole set during the sync handshake — a delete lands on a peer
 * whenever the two next connect, however long that takes.
 *
 * Deletion is soft: the Idea's metadata and audio stay put for
 * {@link RECENTLY_DELETED_RETENTION_MS} (Recently Deleted, CONTEXT.md), so
 * restoring is possible while any paired device is still inside its own window.
 * Purging once that window elapses is the caller's job (motif-kka.8); this
 * module only says which records have expired.
 *
 * Each record carries two grow-only clocks, so merging is just a per-field max:
 * order-independent, repeatable, and free of any "who won" tie-breaking. That's
 * what lets the same exchange carry a restore without a protocol message of its
 * own — a restore is simply a `restoredAt` newer than the peer's `deletedAt`.
 */

/** How long a deleted Idea stays restorable on a device before it is purged. */
export const RECENTLY_DELETED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * One device's view of whether an Idea is deleted. Both timestamps are epoch ms
 * and only ever move forward; the Idea is deleted when its deletion is the more
 * recent of the two. A record with `restoredAt` ahead is kept rather than
 * dropped — it's what stops a peer's older tombstone from re-deleting the Idea
 * on the next exchange.
 */
export interface IdeaDeletion {
  readonly id: string;
  /** When this Idea was last deleted, on whichever device deleted it. */
  readonly deletedAt: number;
  /** When it was last restored; `0` when it never has been. */
  readonly restoredAt: number;
}

/** A deleted Idea as shown in Recently Deleted, with when it stops being restorable. */
export interface RecentlyDeletedIdea<T extends IdeaMetadata = IdeaMetadata> {
  readonly idea: T;
  readonly deletedAt: number;
  /** The instant this device may purge the Idea for good. */
  readonly purgeAt: number;
}

function isDeleted(record: IdeaDeletion): boolean {
  return record.deletedAt > record.restoredAt;
}

function recordFor(
  log: readonly IdeaDeletion[],
  id: string,
): IdeaDeletion | undefined {
  return log.find((record) => record.id === id);
}

/** Replaces the record for `next.id`, or appends it when the log has none. */
function upsert(
  log: readonly IdeaDeletion[],
  next: IdeaDeletion,
): IdeaDeletion[] {
  const replaced = log.map((record) => (record.id === next.id ? next : record));
  return recordFor(log, next.id) ? replaced : [...replaced, next];
}

/** Whether this device currently considers `id` deleted. */
export function isIdeaDeleted(
  log: readonly IdeaDeletion[],
  id: string,
): boolean {
  const record = recordFor(log, id);
  return record !== undefined && isDeleted(record);
}

/**
 * Records a local delete of `id` at `deletedAt`, returning a new log. Deleting
 * an already-deleted Idea is a no-op rather than a fresh tombstone, so a
 * re-delete (or a delete racing an inbound copy of the same delete) never
 * restarts the 30-day window. The stamp is nudged past any restore this device
 * knows about, so a local action always reflects the user's latest intent even
 * if a peer's clock ran ahead.
 */
export function markIdeaDeleted(
  log: readonly IdeaDeletion[],
  id: string,
  deletedAt: number,
): IdeaDeletion[] {
  const existing = recordFor(log, id);
  if (existing && isDeleted(existing)) return [...log];
  const restoredAt = existing?.restoredAt ?? 0;
  return upsert(log, {
    id,
    deletedAt: Math.max(deletedAt, restoredAt + 1),
    restoredAt,
  });
}

/**
 * Records a local restore of `id` at `restoredAt`, returning a new log.
 * Restoring an Idea that isn't deleted is a no-op. As with a delete, the stamp
 * is nudged past the deletion it undoes so the restore holds locally regardless
 * of clock skew between devices.
 */
export function markIdeaRestored(
  log: readonly IdeaDeletion[],
  id: string,
  restoredAt: number,
): IdeaDeletion[] {
  const existing = recordFor(log, id);
  if (!existing || !isDeleted(existing)) return [...log];
  return upsert(log, {
    ...existing,
    restoredAt: Math.max(restoredAt, existing.deletedAt + 1),
  });
}

/**
 * Merges a peer's log into this device's, taking the later of each clock per
 * Idea. Commutative, associative, and idempotent, so both devices reach the
 * same answer no matter which merges first or how many times they re-exchange.
 * `incoming` comes off the wire, so a stamp a peer omitted reads as `0` (never
 * happened) rather than poisoning the merge. Neither input is mutated.
 */
export function mergeDeletions(
  local: readonly IdeaDeletion[],
  incoming: readonly IdeaDeletion[],
): IdeaDeletion[] {
  let merged: IdeaDeletion[] = [...local];
  for (const record of incoming) {
    const existing = recordFor(merged, record.id);
    merged = upsert(merged, {
      id: record.id,
      deletedAt: Math.max(record.deletedAt ?? 0, existing?.deletedAt ?? 0),
      restoredAt: Math.max(record.restoredAt ?? 0, existing?.restoredAt ?? 0),
    });
  }
  return merged;
}

/**
 * Whether two logs say exactly the same thing about every Idea. Lets a caller
 * skip persisting and re-rendering after an exchange that changed nothing —
 * the common case, since sync runs on a timer.
 */
export function sameDeletions(
  a: readonly IdeaDeletion[],
  b: readonly IdeaDeletion[],
): boolean {
  if (a.length !== b.length) return false;
  return a.every((record) => {
    const other = recordFor(b, record.id);
    return (
      other !== undefined &&
      other.deletedAt === record.deletedAt &&
      other.restoredAt === record.restoredAt
    );
  });
}

/**
 * The Library minus everything this device considers deleted — what the user
 * sees. Order is preserved; the input is left untouched.
 */
export function activeIdeas<T extends IdeaMetadata>(
  library: readonly T[],
  log: readonly IdeaDeletion[],
): T[] {
  return library.filter((idea) => !isIdeaDeleted(log, idea.id));
}

/**
 * The Recently Deleted list: the Ideas this device still holds and considers
 * deleted, most recently deleted first, each with the instant it may be purged.
 * A record whose Idea has already been purged is skipped — the record outlives
 * the Idea so peers still learn about the delete.
 */
export function recentlyDeletedIdeas<T extends IdeaMetadata>(
  library: readonly T[],
  log: readonly IdeaDeletion[],
): RecentlyDeletedIdea<T>[] {
  return log
    .filter(isDeleted)
    .flatMap((record) => {
      const idea = library.find((candidate) => candidate.id === record.id);
      return idea === undefined
        ? []
        : [{ idea, deletedAt: record.deletedAt, purgeAt: purgeAt(record) }];
    })
    .sort((a, b) => b.deletedAt - a.deletedAt);
}

/** When a deleted Idea stops being restorable on this device. */
export function purgeAt(record: IdeaDeletion): number {
  return record.deletedAt + RECENTLY_DELETED_RETENTION_MS;
}

/**
 * The deletions whose grace period has elapsed by `now` — the Ideas this device
 * may purge for good (motif-kka.8). Restored Ideas never expire.
 */
export function expiredDeletions(
  log: readonly IdeaDeletion[],
  now: number,
): IdeaDeletion[] {
  return log.filter((record) => isDeleted(record) && purgeAt(record) <= now);
}
