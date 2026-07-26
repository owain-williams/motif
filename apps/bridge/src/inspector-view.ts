import {
  distinctFieldValues,
  formatDuration,
  ideaFacets,
  RECENTLY_DELETED_RETENTION_DAYS,
} from "@motif/shared";
import type { IdeaFacetKind, IdeaMetadata, MultiValueIdeaField } from "@motif/shared";
import {
  el,
  need,
  paintWaveform,
  pauseIcon,
  playIcon,
  renderWaveform,
} from "./dom.js";
import { selectedIdea } from "./state.js";
import type { Actions, AppState, ComposerField } from "./state.js";

/**
 * The selected Idea: rename it, retag it, play it, drag its WAV out, delete it.
 *
 * Every edit here goes through `edit_idea`, which stamps the changed fields for
 * last-write-wins merge (ADR 0006) — so a rename or a tag made at the desk
 * reaches the phone on its next sync, and a stale one never clobbers a newer
 * edit made there.
 */

const WAVE_BARS = 46;

const COMPOSER_FIELDS: readonly { field: ComposerField; label: string }[] = [
  { field: "tags", label: "TAG" },
  { field: "instrument", label: "INSTR" },
  { field: "style", label: "STYLE" },
  { field: "tempo", label: "BPM" },
];

function kindColor(kind: IdeaFacetKind): string {
  return `var(--kind-${kind})`;
}

function clock(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

export function renderInspector(state: AppState, actions: Actions): void {
  const idea = selectedIdea(state);
  need<HTMLElement>("#inspector-empty").hidden = idea !== null;
  need<HTMLElement>("#inspector-body").hidden = idea === null;
  if (idea === null) return;

  renderIdentity(state, idea);
  renderPlayer(state, idea);
  renderChips(state, idea, actions);
  renderComposer(state, idea, actions);
  renderDetails(idea);
  renderActions(state);
}

/**
 * The name field is left alone while it has focus: the app polls the core every
 * few seconds, and overwriting a half-typed rename would be maddening.
 */
function renderIdentity(state: AppState, idea: IdeaMetadata): void {
  const name = need<HTMLInputElement>("#name");
  if (document.activeElement !== name && name.value !== idea.name) {
    name.value = idea.name;
  }
  name.dataset.ideaId = idea.id;
  name.setAttribute("aria-label", `Rename ${idea.name}`);

  const from = state.device === null ? "" : ` · from ${state.device.displayName}`;
  need("#meta").textContent = `${new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(idea.capturedAt)}${from}`;
}

function renderPlayer(state: AppState, idea: IdeaMetadata): void {
  const wave = need<HTMLElement>("#wave");
  if (wave.dataset.waveFor !== idea.id) {
    renderWaveform(wave, idea.id, WAVE_BARS, 5, 62);
  }

  const playing = state.playingId === idea.id;
  const play = need<HTMLButtonElement>("#play");
  play.classList.toggle("playing", playing);
  play.setAttribute("aria-label", playing ? "Pause" : "Play");
  if (play.dataset.playing !== String(playing)) {
    play.dataset.playing = String(playing);
    play.replaceChildren(playing ? pauseIcon(13) : playIcon(13));
  }

  need("#format").textContent = `${idea.audioFormat.toUpperCase()} · ${
    idea.channels === 2 ? "STEREO" : "MONO"
  }`;
  renderProgress(state);
}

/**
 * Just the parts that move while a recording plays. Kept separate from the full
 * inspector render because playback ticks several times a second, and rebuilding
 * the chips and the tag composer at that rate would fight whatever the user is
 * doing with them.
 */
export function renderProgress(state: AppState): void {
  const idea = selectedIdea(state);
  if (idea === null) return;
  const ratio = state.playingId === idea.id ? state.progress : 0;
  paintWaveform(need<HTMLElement>("#wave"), ratio);
  const seconds = idea.durationMs / 1000;
  need("#clock").textContent = `${clock(ratio * seconds)} / ${clock(seconds)}`;
}

/**
 * One chip per metadata value, coloured by the field it came from. Removing a
 * location is allowed; adding one is not — Bridge has no GPS, so it can only
 * relabel or drop what Capture recorded (motif-kka.3).
 */
function renderChips(
  state: AppState,
  idea: IdeaMetadata,
  actions: Actions,
): void {
  const chips = ideaFacets(idea).map((facet) => {
    const chip = el("button", {
      className: "chip-button",
      attrs: {
        type: "button",
        "aria-label": `Remove ${facet.label}`,
      },
      children: [
        el("span", { text: facet.label }),
        el("span", { className: "remove", text: "×" }),
      ],
      onClick: () => actions.removeMetadata(facet.kind, facet.value),
    });
    chip.style.color = kindColor(facet.kind);
    return chip;
  });

  const add = el("button", {
    className: "chip-add",
    attrs: { type: "button" },
    text: state.composerField === null ? "+ tag" : "cancel",
    onClick: () =>
      state.composerField === null
        ? actions.openComposer("tags")
        : actions.closeComposer(),
  });

  need("#chips").replaceChildren(...chips, add);
}

function renderComposer(
  state: AppState,
  idea: IdeaMetadata,
  actions: Actions,
): void {
  const composer = need<HTMLElement>("#composer");
  composer.hidden = state.composerField === null;
  if (state.composerField === null) return;
  const field = state.composerField;

  need("#composer-kinds").replaceChildren(
    ...COMPOSER_FIELDS.map((option) =>
      el("button", {
        className: option.field === field ? "current" : "",
        attrs: {
          type: "button",
          "aria-pressed": String(option.field === field),
        },
        text: option.label,
        onClick: () => actions.openComposer(option.field),
      }),
    ),
  );

  const input = need<HTMLInputElement>("#composer-input");
  input.placeholder = field === "tempo" ? "e.g. 120" : "Type and press Enter";
  input.setAttribute("aria-label", `Add ${field === "tags" ? "tag" : field}`);
  input.type = field === "tempo" ? "number" : "text";

  // Tempo is one number, not a set — nothing to suggest from the Library.
  need("#composer-suggestions").replaceChildren(
    ...(field === "tempo" ? [] : suggestionsFor(state, idea, field, actions)),
  );
}

/** Values already used elsewhere in the Library that this Idea doesn't carry. */
function suggestionsFor(
  state: AppState,
  idea: IdeaMetadata,
  field: MultiValueIdeaField,
  actions: Actions,
): HTMLElement[] {
  const held = new Set(idea[field].map((value) => value.toLocaleLowerCase()));
  return distinctFieldValues(state.library, field)
    .filter((value) => !held.has(value.toLocaleLowerCase()))
    .map((value) =>
      el("button", {
        className: "chip-suggestion",
        attrs: { type: "button" },
        text: value,
        onClick: () => actions.addMetadata(value),
      }),
    );
}

function renderDetails(idea: IdeaMetadata): void {
  const rows: readonly [string, string][] = [
    ["Length", formatDuration(idea.durationMs)],
    ["Channels", idea.channels === 2 ? "Stereo" : "Mono"],
    [
      "Audio",
      idea.storageState === "on-device" ? "Held on this Bridge" : "Offloaded",
    ],
  ];
  need("#fields").replaceChildren(
    ...rows.map(([label, value]) =>
      el("div", {
        className: "detail-row",
        children: [
          el("dt", { text: label }),
          el("dd", { text: value }),
        ],
      }),
    ),
  );
}

/**
 * Delete arms before it fires. CONTEXT.md requires a confirmation, and the note
 * that appears while armed is where the consequence is spelled out: the Idea
 * leaves the Library on every paired device, restorable for 30 days.
 */
function renderActions(state: AppState): void {
  const drag = need<HTMLButtonElement>("#drag");
  drag.classList.toggle("done", state.dragDone);
  need("#drag-label").textContent = state.dragDone
    ? "Dropped into your session"
    : "Drag WAV out";

  const remove = need<HTMLButtonElement>("#delete");
  remove.classList.toggle("armed", state.deleteArmed);
  remove.textContent = state.deleteArmed ? "Really delete" : "Delete";

  const note = need<HTMLElement>("#delete-note");
  note.hidden = !state.deleteArmed;
  note.textContent = `This Idea leaves the Library here and on your paired phone. You can restore it for ${RECENTLY_DELETED_RETENTION_DAYS} days.`;
}
