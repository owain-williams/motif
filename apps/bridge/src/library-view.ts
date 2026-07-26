import {
  formatDuration,
  formatRestoreWindow,
  ideaFacets,
  libraryFacets,
  RECENTLY_DELETED_RETENTION_DAYS,
} from "@motif/shared";
import type { IdeaFacetKind, IdeaMetadata } from "@motif/shared";
import { el, need, pauseIcon, playIcon, renderWaveform, starIcon } from "./dom.js";
import { filterKey, navCounts, sameFilter, visibleIdeas } from "./state.js";
import type { Actions, AppState, LibraryFilter } from "./state.js";

/**
 * The sidebar and the Library rows.
 *
 * Rows are rebuilt only when what they'd say changes — a signature over the
 * visible Ideas is compared against the last render — because the app polls the
 * core every few seconds and a blind rebuild would drop keyboard focus and
 * flicker the row that is playing.
 */

const ROW_BARS = 18;
const NAV_ITEMS: readonly {
  readonly filter: LibraryFilter;
  readonly label: string;
  readonly key: string;
}[] = [
  { filter: { kind: "all" }, label: "All Ideas", key: "all" },
  { filter: { kind: "starred" }, label: "Starred", key: "starred" },
  { filter: { kind: "untagged" }, label: "Untagged", key: "untagged" },
  { filter: { kind: "deleted" }, label: "Recently Deleted", key: "deleted" },
];

/** One CSS custom property per metadata field, matching the chip colours. */
function kindColor(kind: IdeaFacetKind): string {
  return `var(--kind-${kind})`;
}

function formatWhen(capturedAt: number): string {
  const date = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(capturedAt);
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(capturedAt);
  return `${date} · ${time}`;
}

export function renderSidebar(state: AppState, actions: Actions): void {
  const counts = navCounts(state);
  need("#nav").replaceChildren(
    ...NAV_ITEMS.map((item) =>
      navButton(
        item.label,
        counts[item.key] ?? 0,
        sameFilter(state.filter, item.filter),
        () => actions.setFilter(item.filter),
      ),
    ),
  );

  // Nothing tagged yet means no browse-by-metadata list at all, heading included.
  const facets = libraryFacets(state.library);
  need<HTMLElement>("#facets-group").hidden = facets.length === 0;
  need("#facets").replaceChildren(
    ...facets.map((facet) => {
      const current =
        state.filter.kind === "facet" &&
        state.filter.facet === facet.kind &&
        state.filter.value === facet.value;
      const button = navButton(facet.label, facet.count, current, () =>
        actions.setFilter({
          kind: "facet",
          facet: facet.kind,
          value: facet.value,
        }),
      );
      const dot = el("span", { className: "nav-dot" });
      dot.style.background = kindColor(facet.kind);
      button.prepend(dot);
      return button;
    }),
  );

  const device = state.device;
  need("#device-name").textContent = device?.displayName ?? "No phone paired";
  const deviceState = need("#device-state");
  deviceState.textContent = device === null ? "Pair one to start" : "Paired";
  deviceState.classList.toggle("idle", device === null);
  need("#device-pip").className = device === null ? "pip idle" : "pip";

  need("#relay-state").textContent =
    state.relayEmail === null ? "Local only" : "Relay on";
  need("#relay-action").textContent =
    state.relayEmail === null ? "Sign in" : "Sign out";
}

function navButton(
  label: string,
  count: number,
  current: boolean,
  onClick: () => void,
): HTMLButtonElement {
  return el("button", {
    className: current ? "nav-item current" : "nav-item",
    attrs: { type: "button", "aria-pressed": String(current) },
    onClick,
    children: [
      el("span", { className: "nav-label", text: label }),
      el("span", { className: "nav-count", text: String(count) }),
    ],
  });
}

/** What the rows would say, so an unchanged Library skips a rebuild. */
function rowsSignature(state: AppState, ideas: readonly IdeaMetadata[]): string {
  const purgeAt = new Map(
    state.deleted.map((entry) => [entry.idea.id, entry.purgeAt]),
  );
  return [
    filterKey(state.filter),
    state.sort,
    ...ideas.map((idea) =>
      [
        idea.id,
        idea.name,
        idea.durationMs,
        state.starred.has(idea.id) ? "*" : "",
        purgeAt.get(idea.id) ?? "",
        ...ideaFacets(idea).map((facet) => facet.label),
      ].join(""),
    ),
  ].join("");
}

export function renderRows(state: AppState, actions: Actions): void {
  const ideas = visibleIdeas(state);
  const container = need<HTMLElement>("#rows");

  need("#sort").textContent = state.sort === "newest" ? "Newest" : "Longest";
  need("#count").textContent =
    state.filter.kind === "deleted"
      ? `${ideas.length}/${state.deleted.length}`
      : `${ideas.length}/${state.library.length}`;
  need<HTMLElement>("#search-clear").hidden = state.query.length === 0;

  const signature = rowsSignature(state, ideas);
  if (container.dataset.signature !== signature) {
    container.dataset.signature = signature;
    container.replaceChildren(
      ...ideas.map((idea) =>
        state.filter.kind === "deleted"
          ? deletedRow(state, idea, actions)
          : libraryRow(idea, state, actions),
      ),
    );
  }

  renderEmptyState(state, ideas.length);
  markRowStates(container, state);
}

/** Selection and playback are classes, not a rebuild — they change constantly. */
function markRowStates(container: HTMLElement, state: AppState): void {
  for (const row of container.children) {
    const id = (row as HTMLElement).dataset.ideaId;
    row.classList.toggle("selected", id === state.selectedId);
    const playing = id === state.playingId;
    row.classList.toggle("playing", playing);
    const play = row.querySelector<HTMLButtonElement>(".row-play");
    if (play && play.dataset.playing !== String(playing)) {
      play.dataset.playing = String(playing);
      play.replaceChildren(playing ? pauseIcon() : playIcon());
      play.setAttribute("aria-label", playing ? "Pause" : "Play");
    }
  }
}

function libraryRow(
  idea: IdeaMetadata,
  state: AppState,
  actions: Actions,
): HTMLElement {
  const starred = state.starred.has(idea.id);

  const play = el("button", {
    className: "row-play",
    attrs: { type: "button", "aria-label": "Play" },
    children: [playIcon()],
    onClick: (event) => {
      event.stopPropagation();
      actions.togglePlay(idea.id);
    },
  });

  const star = el("button", {
    className: starred ? "row-star on" : "row-star",
    attrs: {
      type: "button",
      "aria-label": starred ? `Unstar ${idea.name}` : `Star ${idea.name}`,
      "aria-pressed": String(starred),
    },
    children: [starIcon(starred)],
    onClick: (event) => {
      event.stopPropagation();
      actions.toggleStar(idea.id);
    },
  });

  const wave = el("div", { className: "wave" });
  renderWaveform(wave, idea.id, ROW_BARS, 3, 22);

  const row = el("div", {
    className: "row",
    attrs: {
      role: "listitem",
      tabindex: "0",
      "aria-label": `${idea.name}, ${formatDuration(idea.durationMs)}`,
    },
    children: [
      el("span", { className: "row-mark" }),
      play,
      el("div", {
        className: "row-copy",
        children: [
          el("span", {
            className: isAutoNamed(idea.name)
              ? "row-title unnamed"
              : "row-title",
            text: idea.name,
          }),
          el("div", {
            className: "row-sub",
            children: [
              el("span", {
                className: "row-when",
                text: formatWhen(idea.capturedAt),
              }),
              ...ideaFacets(idea).map((facet) => {
                const chip = el("span", {
                  className: "chip",
                  text: facet.label,
                });
                chip.style.color = kindColor(facet.kind);
                return chip;
              }),
            ],
          }),
        ],
      }),
      wave,
      el("span", {
        className: "row-dur",
        text: formatDuration(idea.durationMs),
      }),
      star,
    ],
    onClick: () => actions.selectIdea(idea.id),
  });
  row.dataset.ideaId = idea.id;
  row.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    actions.selectIdea(idea.id);
  });
  return row;
}

/**
 * A deleted Idea is listed, not played or edited — Restore is the only thing to
 * do with it, so the row drops the rest of the affordances and says how long is
 * left to change your mind (ADR 0005).
 */
function deletedRow(
  state: AppState,
  idea: IdeaMetadata,
  actions: Actions,
): HTMLElement {
  const entry = state.deleted.find((candidate) => candidate.idea.id === idea.id);
  const remaining =
    entry === undefined ? "" : formatRestoreWindow(entry.purgeAt, Date.now());

  const row = el("div", {
    className: "row deleted",
    attrs: { role: "listitem" },
    children: [
      el("span", { className: "row-mark" }),
      el("div", {
        className: "row-copy",
        children: [
          el("span", {
            className: isAutoNamed(idea.name)
              ? "row-title unnamed"
              : "row-title",
            text: idea.name,
          }),
          el("div", {
            className: "row-sub",
            children: [
              el("span", {
                className: "row-when",
                text: `${formatDuration(idea.durationMs)} · ${remaining}`,
              }),
            ],
          }),
        ],
      }),
      el("button", {
        className: "row-restore",
        attrs: { type: "button", "aria-label": `Restore ${idea.name}` },
        text: "Restore",
        onClick: () => actions.restoreIdea(idea.id),
      }),
    ],
  });
  row.dataset.ideaId = idea.id;
  return row;
}

/** An Idea still carrying the timestamp name it was saved with. */
function isAutoNamed(name: string): boolean {
  return /^\d/.test(name);
}

function renderEmptyState(state: AppState, visible: number): void {
  const empty = need<HTMLElement>("#empty");
  empty.hidden = visible > 0;
  if (visible > 0) return;

  const narrowed =
    state.query.trim().length > 0 || state.filter.kind !== "all";
  const nothingHeld =
    state.filter.kind === "deleted"
      ? state.deleted.length === 0
      : state.library.length === 0;

  const title = need("#empty-title");
  const body = need("#empty-body");
  const clear = need<HTMLElement>("#empty-clear");

  if (state.filter.kind === "deleted" && nothingHeld) {
    title.textContent = "Nothing deleted";
    body.textContent = `Ideas you delete wait here for ${RECENTLY_DELETED_RETENTION_DAYS} days before they go for good.`;
    clear.hidden = true;
    return;
  }
  if (nothingHeld && !narrowed) {
    title.textContent = "Nothing here yet";
    body.textContent =
      "Record an Idea on your phone and it lands here on its own — no upload step.";
    clear.hidden = true;
    return;
  }
  const total =
    state.filter.kind === "deleted" ? state.deleted.length : state.library.length;
  title.textContent = "Nothing matches";
  body.textContent = `Try a shorter word, or clear the filter to see all ${total} Ideas.`;
  clear.hidden = !narrowed;
}
