import { Channel, convertFileSrc, invoke } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import type {
  IdeaMetadata,
  IdeaMetadataEdit,
  RecentlyDeletedIdea,
} from "@motif/shared";

/**
 * The Tauri boundary, in one place: every command the Rust core exposes, named
 * and typed once so the views never spell an invoke string. The core owns all
 * pairing/sync/handoff decisions — these are reads and edits, nothing more.
 */

/** The live pairing code, when it rotates, and any brute-force cooldown. */
export interface PairingInfo {
  readonly code: string;
  /** Unix seconds. */
  readonly expiresAt: number;
  /** Unix seconds, or null when pairing is not locked out. */
  readonly lockedUntil: number | null;
}

/** A device on the sync session — here, the Capture this Bridge is paired with. */
export interface DeviceIdentity {
  readonly deviceId: string;
  readonly displayName: string;
  readonly role: string;
}

export const bridge = {
  library: () => invoke<IdeaMetadata[]>("library"),
  recentlyDeleted: () => invoke<RecentlyDeletedIdea[]>("recently_deleted"),
  pairingInfo: () => invoke<PairingInfo>("pairing_info"),
  pairedDevice: () => invoke<DeviceIdentity | null>("paired_device"),
  ideasDir: () => invoke<string>("ideas_dir"),
  editIdea: (id: string, edit: IdeaMetadataEdit) =>
    invoke<IdeaMetadata>("edit_idea", { id, edit }),
  deleteIdea: (id: string) => invoke<void>("delete_idea", { id }),
  restoreIdea: (id: string) => invoke<void>("restore_idea", { id }),
  audioPath: (id: string) => invoke<string>("preview_audio_path", { id }),
  prepareHandoff: (id: string) => invoke<string>("prepare_handoff", { id }),
  enableCloudSync: (idToken: string) =>
    invoke<void>("enable_cloud_sync", { idToken }),
  disableCloudSync: () => invoke<void>("disable_cloud_sync"),
};

/**
 * Hands a prepared file to the OS as a native drag, so the DAW on the other end
 * receives an actual file rather than browser drag data. Resolves once the drag
 * ends. `onDrop` reports whether the file was taken by another app.
 */
export async function startNativeDrag(
  path: string,
  icon: string,
  onDrop: () => void,
): Promise<void> {
  const onEvent = new Channel<unknown>();
  onEvent.onmessage = () => onDrop();
  await invoke("plugin:drag|start_drag", {
    item: [path],
    image: icon,
    options: { mode: "copy" },
    onEvent,
  });
}

export { convertFileSrc, revealItemInDir };
