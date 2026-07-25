import { distinctFieldValues, searchLibrary } from "@motif/shared";
import type { IdeaMetadata } from "@motif/shared";

/**
 * What the Library screen is currently showing: a Tag chip and a free-text
 * query, narrowing the same list in that order.
 *
 * Chips are Tags, not a separate taxonomy — Motif has no folders, and Tags are
 * how an Idea is made findable (CONTEXT.md). The chip row is therefore just the
 * Library's own distinct Tags, appearing and disappearing as Ideas are tagged.
 */

/** The chip that clears the Tag filter. Never a real Tag — Tags are non-empty. */
export const ALL_CHIP_ID = "";

export interface LibraryChip {
  /** The Tag this chip filters by; `ALL_CHIP_ID` for the leading "All" chip. */
  readonly id: string;
  readonly label: string;
}

export interface LibraryFilter {
  /** The selected Tag, or `ALL_CHIP_ID` for no Tag filter. */
  readonly tag: string;
  readonly query: string;
}

/** No Tag, no query — the whole Library. */
export const NO_LIBRARY_FILTER: LibraryFilter = { tag: ALL_CHIP_ID, query: "" };

/** "All", then every Tag in the Library — the autocomplete set, as buttons. */
export function libraryChips(library: readonly IdeaMetadata[]): LibraryChip[] {
  return [
    { id: ALL_CHIP_ID, label: "All" },
    ...distinctFieldValues(library, "tags").map((tag) => ({ id: tag, label: tag })),
  ];
}

/**
 * The chip to render as selected. A Tag can vanish while it's selected — the
 * last Idea carrying it is deleted, or a sync removes it — and a filter with no
 * visible chip would leave the Library looking mysteriously empty, so the
 * selection falls back to "All".
 */
export function activeChipId(
  chips: readonly LibraryChip[],
  selected: string,
): string {
  return chips.some((chip) => chip.id === selected) ? selected : ALL_CHIP_ID;
}

/**
 * Narrows a Library by the selected Tag and then by the free-text query. Tag
 * matching is exact but case-insensitive (Tags are free text, so "Lyrics" and
 * "lyrics" are the same label to a user); the query keeps `searchLibrary`'s
 * fuzzy behaviour across every searchable field. Order is left untouched.
 */
export function filterLibrary(
  library: readonly IdeaMetadata[],
  filter: LibraryFilter,
): IdeaMetadata[] {
  const tag = filter.tag.toLocaleLowerCase();
  const tagged =
    filter.tag === ALL_CHIP_ID
      ? library
      : library.filter((idea) =>
          idea.tags.some((value) => value.toLocaleLowerCase() === tag),
        );
  return searchLibrary(tagged, filter.query);
}

/** Whether the Library is being narrowed at all. */
export function isFiltering(filter: LibraryFilter): boolean {
  return filter.tag !== ALL_CHIP_ID || filter.query.trim().length > 0;
}

/** What to offer when the list comes back empty. */
export interface LibraryEmptyState {
  readonly title: string;
  readonly body: string;
  readonly cta: string;
  /** What the call to action should do. */
  readonly action: "clear-filters" | "record";
}

/**
 * The empty state for an empty result — which is two quite different messages.
 * A Library with no Ideas in it needs an invitation to record; a filtered one
 * that matched nothing needs a way back to the Ideas the user knows are there.
 */
export function libraryEmptyState(filter: LibraryFilter): LibraryEmptyState {
  return isFiltering(filter)
    ? {
        title: "Nothing matches",
        body: "Try a shorter word, or clear the filter to see everything.",
        cta: "Clear filters",
        action: "clear-filters",
      }
    : {
        title: "No ideas yet",
        body: "Your first recording shows up here the moment you stop it.",
        cta: "Record something",
        action: "record",
      };
}
