import { applyIdeaEdit, formatLocationLabel } from "./idea.js";
import type {
  IdeaMetadata,
  IdeaMetadataEdit,
  IdeaStorageState,
  MultiValueIdeaField,
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
 * Returns a new array of Ideas ordered longest first — an alternative reading
 * order for browsing, not a change to the Library itself, which stays defined as
 * reverse-chronological (CONTEXT.md). Stable: equal-length Ideas keep their
 * input order, so a caller that sorted by capture time first gets newest-first
 * within each length.
 */
export function sortLibraryByDuration(
  ideas: readonly IdeaMetadata[],
): IdeaMetadata[] {
  return [...ideas].sort((a, b) => b.durationMs - a.durationMs);
}

/**
 * Which metadata field a {@link IdeaFacet} came from. Tags, instrument and style
 * are the free-text multi-value fields; tempo and location are single-valued but
 * are just as browsable, so they narrow the Library the same way.
 */
export type IdeaFacetKind = MultiValueIdeaField | "tempo" | "location";

/** One browsable metadata value across a Library, with how many Ideas carry it. */
export interface IdeaFacet {
  readonly kind: IdeaFacetKind;
  /** The underlying field value a filter matches against. */
  readonly value: string;
  /** How the facet reads in a list — the value, `BPM`-suffixed for a tempo. */
  readonly label: string;
  readonly count: number;
}

/** The values one Idea contributes to the facet list for a given kind. */
function facetValues(idea: IdeaMetadata, kind: IdeaFacetKind): string[] {
  if (kind === "tempo") return idea.tempo === null ? [] : [String(idea.tempo)];
  if (kind === "location") {
    const label = formatLocationLabel(idea.location);
    return label === null ? [] : [label];
  }
  return [...idea[kind]];
}

const FACET_KINDS: readonly IdeaFacetKind[] = [
  "tags",
  "instrument",
  "style",
  "tempo",
  "location",
];

function facetLabel(kind: IdeaFacetKind, value: string): string {
  return kind === "tempo" ? `${value} BPM` : value;
}

/**
 * The metadata one Idea carries, each value tagged with the field it came from
 * — what a UI needs to colour or remove a chip per field. The label-only
 * sibling of {@link ideaMetadataLabels}, in the same order.
 */
export function ideaFacets(idea: IdeaMetadata): Omit<IdeaFacet, "count">[] {
  return FACET_KINDS.flatMap((kind) =>
    facetValues(idea, kind).map((value) => ({
      kind,
      value,
      label: facetLabel(kind, value),
    })),
  );
}

/**
 * Whether an Idea carries a facet — the membership test behind filtering the
 * Library down to one tag, instrument, style, tempo or place. Compared
 * case-insensitively, matching how the values are deduped in
 * {@link libraryFacets} and entered on either device.
 */
export function ideaMatchesFacet(
  idea: IdeaMetadata,
  kind: IdeaFacetKind,
  value: string,
): boolean {
  const wanted = value.toLocaleLowerCase();
  return facetValues(idea, kind).some(
    (candidate) => candidate.toLocaleLowerCase() === wanted,
  );
}

/**
 * Every distinct metadata value across a Library with its Idea count — what a
 * browse-by-metadata list is built from, the counted sibling of
 * {@link distinctFieldValues}. Values are deduped case-insensitively per kind
 * (first-seen casing kept) and ordered most-used first, then alphabetically, so
 * the list stays stable as Ideas arrive.
 */
export function libraryFacets(library: readonly IdeaMetadata[]): IdeaFacet[] {
  // Keyed by kind + folded value so "Guitar" and "guitar" are one facet, while
  // a tag and an instrument that read the same stay separate rows.
  const counted = new Map<string, { facet: IdeaFacet; count: number }>();
  for (const idea of library) {
    for (const kind of FACET_KINDS) {
      for (const value of facetValues(idea, kind)) {
        const key = `${kind}:${value.toLocaleLowerCase()}`;
        const seen = counted.get(key);
        if (seen) {
          seen.count += 1;
          continue;
        }
        counted.set(key, {
          count: 1,
          facet: { kind, value, label: facetLabel(kind, value), count: 0 },
        });
      }
    }
  }
  return [...counted.values()]
    .map(({ facet, count }) => ({ ...facet, count }))
    .sort(
      (a, b) =>
        b.count - a.count ||
        a.label.localeCompare(b.label) ||
        a.kind.localeCompare(b.kind),
    );
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
