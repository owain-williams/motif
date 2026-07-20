import { applyIdeaEdit } from "./idea.js";
import type {
  IdeaMetadata,
  IdeaMetadataEdit,
  IdeaStorageState,
} from "./idea.js";

/**
 * Library — the flat, reverse-chronological list of a user's Ideas shown in
 * both Capture and Bridge (CONTEXT.md). No folders; ordering is purely by
 * capture time, newest first, though Ideas carry searchable metadata (tags,
 * instrument, style, tempo, location). These helpers keep that ordering, search,
 * and the duration formatting device-independent so both app shells stay thin.
 */

function editDistance(left: string, right: string): number {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1]! + 1,
        previous[rightIndex]! + 1,
        previous[rightIndex - 1]! +
          (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[right.length]!;
}

function fuzzyTextMatch(text: string, query: string): boolean {
  const normalized = text.toLocaleLowerCase();
  if (normalized.includes(query)) return true;
  if (query.length < 4) return false;

  const tolerance = query.length >= 9 ? 2 : 1;
  const words = normalized.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return words.some((word) => editDistance(word, query) <= tolerance);
}

/**
 * Narrows a Library using one free-text query across an Idea's searchable
 * metadata. Matching is case-insensitive, tolerates small typos, and leaves
 * Library order unchanged.
 */
export function searchLibrary<T extends IdeaMetadata>(
  library: readonly T[],
  rawQuery: string,
): T[] {
  const query = rawQuery.trim().toLocaleLowerCase();
  if (query.length === 0) return [...library];

  const tempoQuery = query.match(
    /^(\d+(?:\.\d+)?)\s*(?:[-–—]\s*(\d+(?:\.\d+)?))?$/,
  );
  if (tempoQuery) {
    const first = Number(tempoQuery[1]);
    const second = tempoQuery[2] === undefined ? first : Number(tempoQuery[2]);
    const minimum = Math.min(first, second);
    const maximum = Math.max(first, second);
    return library.filter((idea) => {
      const { tempo } = idea;
      return tempo !== null && tempo >= minimum && tempo <= maximum;
    });
  }

  return library.filter((idea) => {
    const fields = [
      idea.name,
      ...idea.tags,
      ...idea.instrument,
      ...idea.style,
      idea.location?.label ?? "",
    ];
    return fields.some((field) => fuzzyTextMatch(field, query));
  });
}

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
 * Applies an editable-metadata change to the matching Idea, stamping the changed
 * fields at `editedAt` for last-write-wins sync (ADR 0006). Returns a new
 * Library; order is unchanged (an edit never reorders). Non-matching Ideas and
 * unchanged fields are left untouched.
 */
export function editIdea(
  library: readonly IdeaMetadata[],
  id: string,
  edit: IdeaMetadataEdit,
  editedAt: number,
): IdeaMetadata[] {
  return library.map((idea) =>
    idea.id === id ? applyIdeaEdit(idea, edit, editedAt) : idea,
  );
}

/**
 * Renames the matching Idea, returning a new Library. Order is unchanged — a
 * rename never reorders (the Library is sorted by capture time, not name). The
 * caller is expected to pass a name already validated via
 * {@link normalizeIdeaName}. Convenience wrapper over {@link editIdea} so the
 * rename stamps the name field for merge like any other edit.
 */
export function renameIdea(
  library: readonly IdeaMetadata[],
  id: string,
  name: string,
  editedAt: number,
): IdeaMetadata[] {
  return editIdea(library, id, { name }, editedAt);
}

/**
 * Changes where an Idea's audio lives without removing or reordering its
 * Library entry. The filesystem/cloud move is performed by the caller first;
 * this helper records the completed transition in portable metadata.
 */
export function setIdeaStorageState(
  library: readonly IdeaMetadata[],
  id: string,
  storageState: IdeaStorageState,
): IdeaMetadata[] {
  return library.map((idea) =>
    idea.id === id ? { ...idea, storageState } : idea,
  );
}

/** Removes the matching Idea from the Library, returning a new list. */
export function removeIdea(
  library: readonly IdeaMetadata[],
  id: string,
): IdeaMetadata[] {
  return library.filter((idea) => idea.id !== id);
}

/**
 * Normalizes a user-entered Idea name: trims surrounding whitespace and rejects
 * a blank name by returning `null`, so callers can keep the existing name
 * rather than saving an empty one.
 */
export function normalizeIdeaName(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
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
