import type { AudioFormat, IdeaMetadata } from "@motif/shared";

/**
 * Sharing an Idea — the pure decision behind Capture's Library Share action
 * (motif-6fu.5). Per ADR 0001, sharing hands the audio to the phone's native OS
 * share sheet (Messages, WhatsApp, AirDrop, …) rather than any in-app social
 * layer, and the shared file is *always* the compressed format regardless of
 * the sender's tier — so a Pro user's uncompressed WAV is never sent as an
 * oversized attachment. This module owns that decision; the share sheet itself,
 * the file staging, and any transcoding live in the device shell.
 */

/**
 * The compressed format every shared Idea is delivered in (ADR 0001): AAC in an
 * `.m4a` container. An Idea stored in any other format is transcoded to this
 * before it reaches the share sheet.
 */
export const SHARE_AUDIO_FORMAT: AudioFormat = "aac";
export const SHARE_AUDIO_EXTENSION = ".m4a";
/** MIME type for an `.m4a`/AAC attachment (Android share intents). */
export const SHARE_AUDIO_MIME_TYPE = "audio/mp4";
/** Apple Uniform Type Identifier for the shared file (the iOS share sheet). */
export const SHARE_AUDIO_UTI = "public.mpeg-4-audio";

/** Longest base filename (before the extension) we hand to the OS. */
const MAX_FILE_NAME_LENGTH = 100;

/**
 * Punctuation reserved by iOS, Android, or a recipient's filesystem: `< > : " /
 * \ | ? *`. Auto-generated Idea names carry colons (`"…, 14:32:05"`) and user
 * names may carry slashes, so this runs on every shared filename.
 */
const ILLEGAL_FILE_NAME_CHARS = /[<>:"/\\|?*]/g;

export interface IdeaSharePlan {
  /**
   * Whether the stored audio must be transcoded to the compressed share format
   * before sharing. `false` when the Idea is already compressed. The shared
   * file is compressed either way (ADR 0001); this only says whether a
   * conversion step is needed to get there.
   */
  readonly needsTranscode: boolean;
  /** MIME type to advertise to the share sheet (Android intents). */
  readonly mimeType: string;
  /** Apple Uniform Type Identifier for the shared file (iOS). */
  readonly uti: string;
  /** Human-friendly filename for the attachment, e.g. `"Chorus riff.m4a"`. */
  readonly fileName: string;
}

/**
 * Builds a safe, human-friendly filename for a shared Idea from its (possibly
 * user-entered or auto-generated) name: strips characters illegal in filenames,
 * collapses whitespace, caps the length, and appends the compressed extension.
 * A name that reduces to nothing usable falls back to a generic `"Idea"`.
 */
export function shareFileName(ideaName: string): string {
  const cleaned = ideaName
    .replace(ILLEGAL_FILE_NAME_CHARS, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_FILE_NAME_LENGTH)
    .trim();
  const base = cleaned.length > 0 ? cleaned : "Idea";
  return `${base}${SHARE_AUDIO_EXTENSION}`;
}

/**
 * Decides how to hand the given Idea to the OS share sheet: whether its stored
 * audio needs transcoding to the compressed format first (ADR 0001), and the
 * format, extension, MIME type, UTI, and filename of the file the recipient
 * receives.
 */
export function planIdeaShare(idea: IdeaMetadata): IdeaSharePlan {
  return {
    needsTranscode: idea.audioFormat !== SHARE_AUDIO_FORMAT,
    mimeType: SHARE_AUDIO_MIME_TYPE,
    uti: SHARE_AUDIO_UTI,
    fileName: shareFileName(idea.name),
  };
}
