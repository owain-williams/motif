import {
  ideaMatchesFacet,
  ideaMetadataLabels,
  searchLibrary,
  sortLibrary,
  sortLibraryByDuration,
} from "@motif/shared";
import type {
  IdeaFacetKind,
  IdeaMetadata,
  MultiValueIdeaField,
  RecentlyDeletedIdea,
} from "@motif/shared";
import type { DeviceIdentity, PairingInfo } from "./bridge-api.js";

/**
 * Bridge's window state and the reading of the Library it implies. The Library
 * itself stays what CONTEXT.md says it is — one flat, reverse-chronological list
 * — so everything here is a *view* of it: which Ideas a filter admits, what
 * order to read them in, and what the sidebar counts.
 */

/** Which slice of the Library the middle pane is showing. */
export type LibraryFilter =
  | { readonly kind: "all" | "starred" | "untagged" | "deleted" }
  | {
      readonly kind: "facet";
      readonly facet: IdeaFacetKind;
      readonly value: string;
    };

export type SortOrder = "newest" | "longest";

/** The metadata field the inspector's tag composer is adding to. */
export type ComposerField = MultiValueIdeaField | "tempo";

export interface AppState {
  screen: "pair" | "app";
  /** Which of the three pairing steps is on screen. */
  step: number;
  library: IdeaMetadata[];
  deleted: RecentlyDeletedIdea[];
  pairing: PairingInfo | null;
  device: DeviceIdentity | null;
  ideasDir: string;
  /** The signed-in relay account, or null when Bridge is local-only. */
  relayEmail: string | null;
  query: string;
  filter: LibraryFilter;
  sort: SortOrder;
  /** Ideas the user starred. Bridge-local: starring is not synced metadata. */
  starred: Set<string>;
  selectedId: string | null;
  playingId: string | null;
  /** Playback position through the playing Idea, 0–1. */
  progress: number;
  /** Whether Delete is armed and the next press really deletes. */
  deleteArmed: boolean;
  dragDone: boolean;
  composerField: ComposerField | null;
}

export function createState(starred: Set<string>): AppState {
  return {
    screen: "app",
    step: 0,
    library: [],
    deleted: [],
    pairing: null,
    device: null,
    ideasDir: "",
    relayEmail: null,
    query: "",
    filter: { kind: "all" },
    sort: "newest",
    starred,
    selectedId: null,
    playingId: null,
    progress: 0,
    deleteArmed: false,
    dragDone: false,
    composerField: null,
  };
}

/** An Idea carrying no searchable metadata at all — nothing to find it by. */
export function isUntagged(idea: IdeaMetadata): boolean {
  return ideaMetadataLabels(idea).length === 0;
}

/** A stable identity for a filter, for comparing one render against the next. */
export function filterKey(filter: LibraryFilter): string {
  return filter.kind === "facet"
    ? `facet:${filter.facet}:${filter.value}`
    : filter.kind;
}

export function sameFilter(a: LibraryFilter, b: LibraryFilter): boolean {
  return filterKey(a) === filterKey(b);
}

/** The Ideas a filter admits, before the search box narrows them further. */
function filtered(state: AppState): IdeaMetadata[] {
  switch (state.filter.kind) {
    case "deleted":
      return state.deleted.map((entry) => entry.idea);
    case "starred":
      return state.library.filter((idea) => state.starred.has(idea.id));
    case "untagged":
      return state.library.filter(isUntagged);
    case "facet": {
      const { facet, value } = state.filter;
      return state.library.filter((idea) => ideaMatchesFacet(idea, facet, value));
    }
    default:
      return [...state.library];
  }
}

/**
 * The rows the middle pane shows: the current filter, narrowed by the search
 * box, in the chosen reading order. Recently Deleted arrives newest-deletion
 * first from the core, so "Newest" leaves it as-is rather than re-sorting it by
 * capture time — the useful order there is when it was deleted.
 */
export function visibleIdeas(state: AppState): IdeaMetadata[] {
  const matching = searchLibrary(filtered(state), state.query);
  if (state.sort === "longest") return sortLibraryByDuration(matching);
  return state.filter.kind === "deleted" ? matching : sortLibrary(matching);
}

/** How many Ideas sit behind each of the fixed sidebar entries. */
export function navCounts(state: AppState): Record<string, number> {
  return {
    all: state.library.length,
    starred: state.library.filter((idea) => state.starred.has(idea.id)).length,
    untagged: state.library.filter(isUntagged).length,
    deleted: state.deleted.length,
  };
}

export function selectedIdea(state: AppState): IdeaMetadata | null {
  return (
    state.library.find((idea) => idea.id === state.selectedId) ?? null
  );
}

/**
 * What the panes can ask the app to do. The views build DOM and call these; the
 * app owns the state changes, the Rust commands, and when to re-render.
 */
export interface Actions {
  selectIdea(id: string): void;
  togglePlay(id: string): void;
  toggleStar(id: string): void;
  restoreIdea(id: string): void;
  setFilter(filter: LibraryFilter): void;
  clearFilters(): void;
  /** Drops one metadata value from the selected Idea. */
  removeMetadata(kind: IdeaFacetKind, value: string): void;
  openComposer(field: ComposerField): void;
  closeComposer(): void;
  /** Adds the composer's current field/value to the selected Idea. */
  addMetadata(value: string): void;
}
