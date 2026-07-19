import { Directory, File, Paths } from "expo-file-system";
import type { IdeaMetadata } from "@motif/shared";

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

/** Resolves the on-device audio URI for an Idea, for playback. */
export function ideaAudioUri(ideaId: string, extension: string): string {
  return ideaAudioFile(ideaId, extension).uri;
}

/** Deletes an Idea's on-device audio, best-effort (a missing file is fine). */
export function deleteIdeaAudio(ideaId: string, extension: string): void {
  const file = ideaAudioFile(ideaId, extension);
  if (file.exists) {
    file.delete();
  }
}

/** Reads the persisted Library, or an empty list if none has been saved yet. */
export async function loadLibrary(): Promise<IdeaMetadata[]> {
  const manifest = libraryManifest();
  if (!manifest.exists) {
    return [];
  }
  const raw = await manifest.text();
  const parsed: unknown = JSON.parse(raw);
  return Array.isArray(parsed) ? (parsed as IdeaMetadata[]) : [];
}

/** Overwrites the persisted Library manifest with the given Ideas. */
export function saveLibrary(ideas: readonly IdeaMetadata[]): void {
  const manifest = libraryManifest();
  if (!manifest.exists) {
    manifest.create();
  }
  manifest.write(JSON.stringify(ideas));
}
