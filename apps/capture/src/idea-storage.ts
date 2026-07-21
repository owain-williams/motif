import { Directory, File, Paths } from "expo-file-system";
import { withMetadataDefaults } from "@motif/shared";
import type { IdeaDeletion, IdeaMetadata, PersistedIdea } from "@motif/shared";
import type { IdeaSharePlan } from "./core/idea-share";

/**
 * On-device persistence for the Library — the thin filesystem shell around the
 * pure Library helpers in `@motif/shared`. Every Idea is on-device by default
 * (CONTEXT.md), so its audio is moved out of the recorder's cache into the
 * document directory (safe from eviction) and its metadata is written to a
 * JSON manifest.
 *
 * The audio for Idea `id` lives at `ideas/<id><extension>` by convention — a
 * device-local detail deliberately kept out of the portable, syncable
 * `IdeaMetadata` schema.
 */

function ideasDirectory(): Directory {
  return new Directory(Paths.document, "ideas");
}

function ideaAudioFile(ideaId: string, extension: string): File {
  return new File(ideasDirectory(), `${ideaId}${extension}`);
}

function libraryManifest(): File {
  return new File(Paths.document, "library.json");
}

function deletionsManifest(): File {
  return new File(Paths.document, "deletions.json");
}

function ideaWaveformFile(ideaId: string): File {
  return new File(ideasDirectory(), `${ideaId}.waveform.json`);
}

/**
 * Moves a just-finished recording out of the recorder's temporary location
 * into permanent on-device storage, returning the persisted file's URI.
 */
export async function persistRecordingAudio(
  sourceUri: string,
  ideaId: string,
  extension: string,
): Promise<string> {
  const dir = ideasDirectory();
  if (!dir.exists) {
    dir.create({ intermediates: true });
  }
  const destination = ideaAudioFile(ideaId, extension);
  await new File(sourceUri).move(destination, { overwrite: true });
  return destination.uri;
}

/** Writes downloaded cloud audio back into permanent on-device storage. */
export function persistIdeaAudioBytes(
  audio: Uint8Array,
  ideaId: string,
  extension: string,
): string {
  const dir = ideasDirectory();
  if (!dir.exists) {
    dir.create({ intermediates: true });
  }
  const destination = ideaAudioFile(ideaId, extension);
  if (!destination.exists) destination.create();
  destination.write(audio);
  return destination.uri;
}

/** Resolves the on-device audio URI for an Idea, for playback. */
export function ideaAudioUri(ideaId: string, extension: string): string {
  return ideaAudioFile(ideaId, extension).uri;
}

/**
 * Reads an Idea's on-device audio as raw bytes, for uploading to Bridge during
 * local-network sync (motif-6fu.6). Reading never alters the file — syncing is
 * copy semantics, so the Capture-side Idea stays intact and playable.
 */
export async function readIdeaAudioBytes(
  ideaId: string,
  extension: string,
): Promise<Uint8Array> {
  const buffer = await ideaAudioFile(ideaId, extension).arrayBuffer();
  return new Uint8Array(buffer);
}

/**
 * Stages an Idea's audio as a friendly-named file in the (evictable) cache
 * directory, ready to hand to the OS share sheet, and returns its URI. The
 * staged file is named after the Idea (`plan.fileName`) so the recipient sees a
 * readable name, and is always in the compressed share format (ADR 0001): a
 * compressed Idea is copied as-is; an uncompressed one is transcoded first.
 *
 * Staging into the cache (not the document directory) keeps the app's private
 * storage paths out of the share sheet and lets the OS reclaim the copy later.
 */
export async function stageIdeaForShare(
  sourceUri: string,
  plan: IdeaSharePlan,
): Promise<string> {
  const destination = new File(Paths.cache, plan.fileName);
  if (plan.needsTranscode) {
    // Transcoding uncompressed (WAV/Pro) audio to compressed needs a native
    // encoder that isn't in the Expo stack yet. No WAV Idea can exist until
    // per-tier WAV recording (motif-6fu.9) ships, so this path is currently
    // unreachable; the real transcode lands in motif-f7w.
    throw new Error(
      "Sharing uncompressed audio isn't supported yet, so this Idea can't be shared.",
    );
  }
  await new File(sourceUri).copy(destination, { overwrite: true });
  return destination.uri;
}

/**
 * Persists waveform peaks beside an Idea's audio. Waveforms are device-local
 * presentation data and deliberately stay out of portable `IdeaMetadata`.
 */
export function persistIdeaWaveform(ideaId: string, peaks: readonly number[]): void {
  const dir = ideasDirectory();
  if (!dir.exists) {
    dir.create({ intermediates: true });
  }
  const sidecar = ideaWaveformFile(ideaId);
  if (!sidecar.exists) sidecar.create();
  sidecar.write(JSON.stringify(peaks));
}

/** Loads valid JSON waveform sidecars; absent/corrupt files are omitted. */
export async function loadIdeaWaveforms(
  ideaIds: readonly string[],
): Promise<Record<string, number[]>> {
  const entries = await Promise.all(
    ideaIds.map(async (ideaId): Promise<readonly [string, number[]] | null> => {
      const sidecar = ideaWaveformFile(ideaId);
      if (!sidecar.exists) return null;
      try {
        const parsed: unknown = JSON.parse(await sidecar.text());
        return Array.isArray(parsed) ? [ideaId, parsed as number[]] : null;
      } catch {
        return null;
      }
    }),
  );
  return Object.fromEntries(entries.filter((entry) => entry !== null));
}

/** Deletes an Idea's on-device audio, best-effort (a missing file is fine). */
export function deleteIdeaAudio(ideaId: string, extension: string): void {
  const file = ideaAudioFile(ideaId, extension);
  if (file.exists) {
    file.delete();
  }
}

/** Deletes an Idea's local waveform sidecar after permanent Idea deletion. */
export function deleteIdeaWaveform(ideaId: string): void {
  const sidecar = ideaWaveformFile(ideaId);
  if (sidecar.exists) sidecar.delete();
}

/** Reads the persisted Library, or an empty list if none has been saved yet. */
export async function loadLibrary(): Promise<IdeaMetadata[]> {
  const manifest = libraryManifest();
  if (!manifest.exists) {
    return [];
  }
  const raw = await manifest.text();
  const parsed: unknown = JSON.parse(raw);
  // Normalize so a Library written before the editable-metadata schema (tags,
  // instrument, style, tempo, per-field timestamps) loads with sane defaults.
  return Array.isArray(parsed)
    ? (parsed as PersistedIdea[]).map(withMetadataDefaults)
    : [];
}

/** Overwrites the persisted Library manifest with the given Ideas. */
export function saveLibrary(ideas: readonly IdeaMetadata[]): void {
  const manifest = libraryManifest();
  if (!manifest.exists) {
    manifest.create();
  }
  manifest.write(JSON.stringify(ideas));
}

/**
 * Loads this device's delete/restore records, or an empty log if none exists
 * yet or the file is corrupt. They live beside the Library rather than in it: a
 * record outlives the Idea it refers to, since it must keep reaching a peer
 * that hasn't applied the delete yet (ADR 0005).
 */
export async function loadDeletions(): Promise<IdeaDeletion[]> {
  const file = deletionsManifest();
  if (!file.exists) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(await file.text());
    return Array.isArray(parsed) ? (parsed as IdeaDeletion[]) : [];
  } catch {
    return [];
  }
}

/** Overwrites the persisted delete/restore records. */
export function saveDeletions(deletions: readonly IdeaDeletion[]): void {
  const file = deletionsManifest();
  if (!file.exists) {
    file.create();
  }
  file.write(JSON.stringify(deletions));
}
