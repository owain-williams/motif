import { File, Paths } from "expo-file-system";
import type { DeviceIdentity } from "@motif/shared";
import type { PairedBridge } from "./core/sync-engine";

/**
 * On-device persistence for local-network sync state (motif-6fu.6): this
 * Capture's stable device identity and, once paired, the Bridge it syncs to.
 * The thin filesystem shell around the pure sync engine — kept out of
 * `library.json` since it's about the device, not the Library.
 */

interface PersistedSync {
  readonly captureDeviceId: string;
  readonly pairedBridge: PairedBridge | null;
}

/** This Capture's identity plus its current pairing, loaded together. */
export interface SyncState {
  readonly capture: DeviceIdentity;
  readonly pairedBridge: PairedBridge | null;
}

const CAPTURE_DISPLAY_NAME = "Capture";

function syncFile(): File {
  return new File(Paths.document, "sync-state.json");
}

function mintDeviceId(): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `capture-${Date.now().toString(36)}-${random}`;
}

/** Reads the persisted state, minting a fresh device id if none is stored. */
async function readState(): Promise<PersistedSync> {
  const file = syncFile();
  if (file.exists) {
    try {
      const parsed = JSON.parse(await file.text()) as PersistedSync;
      if (typeof parsed?.captureDeviceId === "string") {
        return parsed;
      }
    } catch {
      // Corrupt state file — fall through and mint a fresh identity.
    }
  }
  return { captureDeviceId: mintDeviceId(), pairedBridge: null };
}

function writeState(state: PersistedSync): void {
  const file = syncFile();
  if (!file.exists) {
    file.create();
  }
  file.write(JSON.stringify(state));
}

/**
 * Loads this Capture's identity and current pairing, persisting a newly minted
 * device id so Bridge recognizes the same device across restarts.
 */
export async function loadSyncState(): Promise<SyncState> {
  const state = await readState();
  writeState(state);
  return {
    capture: {
      deviceId: state.captureDeviceId,
      displayName: CAPTURE_DISPLAY_NAME,
      role: "capture",
    },
    pairedBridge: state.pairedBridge,
  };
}

/** Remembers the paired Bridge, preserving this Capture's device id. */
export async function savePairedBridge(bridge: PairedBridge): Promise<void> {
  const state = await readState();
  writeState({ captureDeviceId: state.captureDeviceId, pairedBridge: bridge });
}

/** Forgets the paired Bridge, keeping this Capture's device id. */
export async function clearPairedBridge(): Promise<void> {
  const state = await readState();
  writeState({ captureDeviceId: state.captureDeviceId, pairedBridge: null });
}
