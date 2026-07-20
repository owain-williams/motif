import type { AudioFormat } from "./tier.js";

/**
 * Idea — a single captured audio recording of a musical fragment (see
 * CONTEXT.md). One recording session produces exactly one Idea.
 */

/** Where an Idea's audio currently lives. */
export type IdeaStorageState = "on-device" | "offloaded";

/**
 * The Idea metadata fields a user can edit on either device. Each carries its
 * own last-edit timestamp so bidirectional sync merges them independently by
 * last-write-wins (ADR 0006) — a stale edit to one field never clobbers a newer
 * edit to a different field. `location` is intentionally not here yet; its
 * editing lands with geotagging (motif-kka.3).
 */
export type EditableIdeaField = "name" | "tags" | "instrument" | "style" | "tempo";

/** The editable fields, in a fixed order for merge/equality iteration. */
export const EDITABLE_IDEA_FIELDS: readonly EditableIdeaField[] = [
  "name",
  "tags",
  "instrument",
  "style",
  "tempo",
];

/** Editable fields that hold zero-or-many free-text values with autocomplete. */
export type MultiValueIdeaField = "tags" | "instrument" | "style";

/** Per-field last-edit timestamps (epoch ms) — the clocks behind ADR 0006. */
export type IdeaFieldTimestamps = Readonly<Record<EditableIdeaField, number>>;

export interface IdeaMetadata {
  /** Stable unique identifier for the Idea. */
  readonly id: string;
  /** Auto-generated on creation; renameable later by the user. */
  readonly name: string;
  /** Epoch milliseconds when the recording was captured. */
  readonly capturedAt: number;
  /** Recording length in milliseconds. */
  readonly durationMs: number;
  readonly audioFormat: AudioFormat;
  readonly channels: 1 | 2;
  readonly storageState: IdeaStorageState;
  /** Free-text tags; zero or many, autocompleted from the Library's distinct
   * values (CONTEXT.md). Not a managed entity — just strings. */
  readonly tags: readonly string[];
  /** Instruments heard on the recording; same zero-or-many free-text shape as
   * {@link IdeaMetadata.tags}. */
  readonly instrument: readonly string[];
  /** Musical styles; same shape as {@link IdeaMetadata.tags}. */
  readonly style: readonly string[];
  /** Tempo in BPM, or `null` when unset. */
  readonly tempo: number | null;
  /** Per-field last-edit timestamps driving last-write-wins merges (ADR 0006). */
  readonly fieldUpdatedAt: IdeaFieldTimestamps;
}

/**
 * Builds the auto-generated name shown when an Idea is saved with no naming
 * prompt (CONTEXT.md). A readable local-time stamp — down to the second so
 * back-to-back captures stay distinguishable before the user renames them.
 *
 * @param capturedAt Epoch milliseconds the recording was captured.
 * @param timeZone   IANA zone to render in; defaults to the runtime's zone.
 */
export function autoIdeaName(capturedAt: number, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone,
  }).format(capturedAt);
}

/** The recording facts needed to mint an Idea from a completed capture. */
export interface NewIdeaInput {
  readonly id: string;
  readonly capturedAt: number;
  readonly durationMs: number;
  readonly audioFormat: AudioFormat;
  readonly channels: 1 | 2;
  /** Time zone for the auto-generated name; defaults to the runtime's zone. */
  readonly timeZone?: string;
}

/**
 * Assembles a freshly captured Idea with its auto-generated name — Capture
 * saves with no naming prompt (CONTEXT.md); renaming is a later, separate
 * action. New Ideas always start on-device (offloading is explicit and later).
 */
export function createIdea(input: NewIdeaInput): IdeaMetadata {
  return {
    id: input.id,
    name: autoIdeaName(input.capturedAt, input.timeZone),
    capturedAt: input.capturedAt,
    durationMs: input.durationMs,
    audioFormat: input.audioFormat,
    channels: input.channels,
    storageState: "on-device",
    tags: [],
    instrument: [],
    style: [],
    tempo: null,
    // The name is "set" at capture, so a later rename (with a larger timestamp)
    // wins the merge; the other fields start unedited (0) so any edit wins.
    fieldUpdatedAt: {
      name: input.capturedAt,
      tags: 0,
      instrument: 0,
      style: 0,
      tempo: 0,
    },
  };
}

/**
 * A persisted Idea that may predate the editable-metadata fields — the shape
 * {@link withMetadataDefaults} accepts when loading a Library written before
 * this schema existed.
 */
export type PersistedIdea = Omit<
  IdeaMetadata,
  "tags" | "instrument" | "style" | "tempo" | "fieldUpdatedAt"
> &
  Partial<
    Pick<IdeaMetadata, "tags" | "instrument" | "style" | "tempo">
  > & { readonly fieldUpdatedAt?: Partial<IdeaFieldTimestamps> };

/**
 * Fills in the editable-metadata fields a persisted Idea may be missing, so a
 * Library written before this schema loads without special-casing. Absent
 * multi-value fields become empty; an absent name timestamp defaults to the
 * capture instant (the name was effectively set then), and the rest to 0 (never
 * edited) so any real edit wins the merge.
 */
export function withMetadataDefaults(raw: PersistedIdea): IdeaMetadata {
  return {
    id: raw.id,
    name: raw.name,
    capturedAt: raw.capturedAt,
    durationMs: raw.durationMs,
    audioFormat: raw.audioFormat,
    channels: raw.channels,
    storageState: raw.storageState,
    tags: raw.tags ?? [],
    instrument: raw.instrument ?? [],
    style: raw.style ?? [],
    tempo: raw.tempo ?? null,
    fieldUpdatedAt: {
      name: raw.fieldUpdatedAt?.name ?? raw.capturedAt,
      tags: raw.fieldUpdatedAt?.tags ?? 0,
      instrument: raw.fieldUpdatedAt?.instrument ?? 0,
      style: raw.fieldUpdatedAt?.style ?? 0,
      tempo: raw.fieldUpdatedAt?.tempo ?? 0,
    },
  };
}

/** A partial set of editable-field changes to apply to an Idea. */
export interface IdeaMetadataEdit {
  readonly name?: string;
  readonly tags?: readonly string[];
  readonly instrument?: readonly string[];
  readonly style?: readonly string[];
  readonly tempo?: number | null;
}

function multiValueEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** Whether an editable field's value differs between two Ideas. */
function fieldValueEqual(
  field: EditableIdeaField,
  a: IdeaMetadata,
  b: IdeaMetadata,
): boolean {
  switch (field) {
    case "name":
      return a.name === b.name;
    case "tempo":
      return a.tempo === b.tempo;
    default:
      return multiValueEqual(a[field], b[field]);
  }
}

/**
 * Applies an edit to an Idea, stamping each field that actually changes with
 * `editedAt`. Fields whose value is unchanged (or not in the edit) keep their
 * existing timestamp, so re-saving an editor without touching a field never
 * makes it spuriously win a later merge. Returns a new Idea; the input is left
 * untouched.
 */
export function applyIdeaEdit(
  idea: IdeaMetadata,
  edit: IdeaMetadataEdit,
  editedAt: number,
): IdeaMetadata {
  const next = { ...idea, fieldUpdatedAt: { ...idea.fieldUpdatedAt } };
  const candidate: IdeaMetadata = {
    ...idea,
    name: edit.name ?? idea.name,
    tags: edit.tags ?? idea.tags,
    instrument: edit.instrument ?? idea.instrument,
    style: edit.style ?? idea.style,
    tempo: edit.tempo === undefined ? idea.tempo : edit.tempo,
  };
  for (const field of EDITABLE_IDEA_FIELDS) {
    if (edit[field] === undefined) continue;
    if (fieldValueEqual(field, candidate, idea)) continue;
    if (field === "name") next.name = candidate.name;
    else if (field === "tempo") next.tempo = candidate.tempo;
    else next[field] = candidate[field];
    next.fieldUpdatedAt[field] = editedAt;
  }
  return next;
}

/**
 * Merges two versions of the same Idea by per-field last-write-wins (ADR 0006):
 * for each editable field, the value from whichever side edited it more recently
 * wins, independently of the others. Ties keep `local`. Device-local facts
 * (id, capture details, audio format/channels, and especially `storageState` —
 * which is per-device) always come from `local`, so a merge never changes where
 * this device's audio lives.
 */
export function mergeIdea(
  local: IdeaMetadata,
  incoming: IdeaMetadata,
): IdeaMetadata {
  const merged = { ...local, fieldUpdatedAt: { ...local.fieldUpdatedAt } };
  for (const field of EDITABLE_IDEA_FIELDS) {
    if (incoming.fieldUpdatedAt[field] > local.fieldUpdatedAt[field]) {
      if (field === "name") merged.name = incoming.name;
      else if (field === "tempo") merged.tempo = incoming.tempo;
      else merged[field] = incoming[field];
      merged.fieldUpdatedAt[field] = incoming.fieldUpdatedAt[field];
    }
  }
  return merged;
}

/** Whether two Ideas carry identical editable metadata and field timestamps. */
export function sameEditableMetadata(a: IdeaMetadata, b: IdeaMetadata): boolean {
  return EDITABLE_IDEA_FIELDS.every(
    (field) =>
      fieldValueEqual(field, a, b) &&
      a.fieldUpdatedAt[field] === b.fieldUpdatedAt[field],
  );
}

/**
 * Normalizes user-entered values for a multi-value field (tags/instrument/
 * style): trims each, drops blanks, and removes case-insensitive duplicates
 * while keeping first-seen order and casing.
 */
export function normalizeMultiValue(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    const key = trimmed.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

/**
 * Parses a user-entered tempo into a positive integer BPM, or `null` for blank
 * or non-numeric input (which clears the tempo).
 */
export function normalizeTempo(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value);
}

/**
 * The human-readable metadata labels shown on a Library row — the multi-value
 * fields followed by a `BPM`-suffixed tempo. Shared so Capture and Bridge render
 * an Idea's metadata identically rather than each deriving the list.
 */
export function ideaMetadataLabels(idea: IdeaMetadata): string[] {
  const labels = [...idea.tags, ...idea.instrument, ...idea.style];
  if (idea.tempo !== null) labels.push(`${idea.tempo} BPM`);
  return labels;
}

/**
 * The distinct values of a multi-value field across a Library — the
 * autocomplete suggestions when entering that field (CONTEXT.md). Deduped
 * case-insensitively (first-seen casing kept) and sorted for stable display.
 */
export function distinctFieldValues(
  library: readonly IdeaMetadata[],
  field: MultiValueIdeaField,
): string[] {
  const seen = new Map<string, string>();
  for (const idea of library) {
    for (const value of idea[field]) {
      const key = value.toLocaleLowerCase();
      if (!seen.has(key)) seen.set(key, value);
    }
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}
