import * as BackgroundTask from "expo-background-task";
import * as TaskManager from "expo-task-manager";
import type { IdeaMetadata } from "@motif/shared";
import { loadAuthTokens } from "./account-storage";
import { loadAccount } from "./account-client";
import { audioExtension } from "./recording-config";
import {
  loadDeletions,
  loadLibrary,
  readIdeaAudioBytes,
  saveDeletions,
} from "./idea-storage";
import { syncPendingCloudIdeas, syncPendingIdeas } from "./idea-sync";
import { loadSyncState } from "./sync-storage";
import {
  runBackgroundSyncJob,
  type BackgroundSyncTransport,
} from "./core/background-sync";

export const BACKGROUND_SYNC_TASK = "motif.capture.sync-pending";

/** The platform minimum; execution remains inexact and OS-controlled. */
const BACKGROUND_SYNC_MINIMUM_INTERVAL_MINUTES = 15;

async function syncPersistedPendingIdeas(): Promise<BackgroundTask.BackgroundTaskResult> {
  try {
    // A headless launch cannot use React state, so rebuild the complete sync plan
    // from durable Capture state every time the scheduler wakes us.
    const [library, deletions, syncState, tokens] = await Promise.all([
      loadLibrary(),
      loadDeletions(),
      loadSyncState(),
      loadAuthTokens(),
    ]);
    const readAudio = (idea: IdeaMetadata) =>
      readIdeaAudioBytes(idea.id, audioExtension(idea.audioFormat));
    const transports: BackgroundSyncTransport[] = [];

    const bridge = syncState.pairedBridge;
    if (bridge) {
      transports.push(async () => {
        // A headless pass still exchanges delete records, so a delete made on
        // Bridge lands even if Capture is never opened (ADR 0005).
        const result = await syncPendingIdeas({
          endpoint: bridge.endpoint,
          capture: syncState.capture,
          library,
          deletions,
          readAudio,
        });
        saveDeletions(result.deletions);
      });
    }

    const idToken = tokens?.idToken;
    if (idToken) {
      transports.push(async () => {
        // The token alone does not imply cloud entitlement: authenticated Free
        // accounts still sync only over LAN, just like the foreground engine.
        const account = await loadAccount(idToken);
        if (account.tier === "free") return;
        await syncPendingCloudIdeas({
          idToken,
          capture: syncState.capture,
          library,
          deletions,
          readAudio,
        });
      });
    }

    return (await runBackgroundSyncJob(transports)) === "success"
      ? BackgroundTask.BackgroundTaskResult.Success
      : BackgroundTask.BackgroundTaskResult.Failed;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
}

// TaskManager requires definitions at module scope so the executor exists when
// the OS starts the JavaScript bundle without mounting the React component.
if (!TaskManager.isTaskDefined(BACKGROUND_SYNC_TASK)) {
  TaskManager.defineTask(BACKGROUND_SYNC_TASK, syncPersistedPendingIdeas);
}

/**
 * Keeps OS scheduling aligned with whether Capture has any usable sync path.
 * Registration persists across launches; callers should disable it only after
 * both the Bridge pairing and paid-account relay have gone away.
 */
export async function setBackgroundSyncEnabled(enabled: boolean): Promise<void> {
  if (enabled) {
    await BackgroundTask.registerTaskAsync(BACKGROUND_SYNC_TASK, {
      minimumInterval: BACKGROUND_SYNC_MINIMUM_INTERVAL_MINUTES,
    });
    return;
  }
  await BackgroundTask.unregisterTaskAsync(BACKGROUND_SYNC_TASK);
}
