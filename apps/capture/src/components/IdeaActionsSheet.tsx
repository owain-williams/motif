import { formatDuration } from "@motif/shared";
import type { IdeaMetadata } from "@motif/shared";
import type { IdeaStorageAction } from "../core/sync-engine";
import { Sheet, SheetAction } from "./Sheet";

/**
 * Everything a Library row can do beyond playing. Rows stay scannable by
 * keeping these behind one button, and the sheet names the Idea it is about so
 * a destructive tap is never ambiguous.
 */
export function IdeaActionsSheet({
  idea,
  storageAction,
  busy,
  onShare,
  onRename,
  onEditMetadata,
  onStorageAction,
  onDelete,
  onClose,
}: {
  /** The Idea whose actions these are, or `null` when the sheet is closed. */
  idea: IdeaMetadata | null;
  /** The cloud action this tier offers for the Idea, if any. */
  storageAction: IdeaStorageAction | null;
  /** A storage move is already running — the cloud action must not restack. */
  busy: boolean;
  onShare: () => void;
  onRename: () => void;
  onEditMetadata: () => void;
  onStorageAction: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const offloaded = idea?.storageState === "offloaded";
  return (
    <Sheet
      visible={idea !== null}
      title={idea?.name ?? ""}
      subtitle={
        idea === null
          ? undefined
          : `${formatDuration(idea.durationMs)} · ${
              idea.audioFormat === "wav" ? "WAV" : "AAC"
            } · ${idea.channels === 2 ? "Stereo" : "Mono"}${
              offloaded ? " · in the cloud" : ""
            }`
      }
      onClose={onClose}
    >
      <SheetAction label="Rename" onPress={onRename} />
      <SheetAction
        label="Tags and details"
        detail="Tags, instrument, style, tempo, location"
        onPress={onEditMetadata}
      />
      {offloaded ? null : <SheetAction label="Share" onPress={onShare} />}
      {storageAction === null ? null : (
        <SheetAction
          label={storageAction === "offload" ? "Offload to cloud" : "Redownload"}
          detail={
            storageAction === "offload"
              ? "Frees space here; the audio stays in your account"
              : "Brings the audio back onto this device"
          }
          disabled={busy}
          onPress={onStorageAction}
        />
      )}
      <SheetAction
        label="Delete"
        detail="Recoverable for 30 days"
        tone="danger"
        onPress={onDelete}
      />
    </Sheet>
  );
}
