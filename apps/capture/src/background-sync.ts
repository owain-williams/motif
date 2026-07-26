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
  saveLibrary,
} from "./idea-storage";
import {
  syncMetadataWithBridge,
  syncMetadataWithCloud,
  syncPendingCloudIdeas,
  syncPendingIdeas,
} from "./idea-sync";
import { loadSyncState } from "./sync-storage";
import {
  createMetadataCommit,
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
    // Both transports write the Library back, so they share one serialized
    // committer that re-merges against durable state (motif-kka.10).
    const commitMetadata = createMetadataCommit({
      load: loadLibrary,
      save: saveLibrary,
    });
    // A metadata pass reads the Library as it stands rather than the job's
    // opening snapshot — the foreground does the same with its live one — so an
    // edit the other transport has just committed goes out on this run instead
    // of waiting for the next.
    const syncMetadata = async (
      pass: (library: readonly IdeaMetadata[]) => Promise<IdeaMetadata[]>,
    ) => commitMetadata(await pass(await loadLibrary()));
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
        // Metadata is bidirectional too (ADR 0006): without this pass, a tag
        // typed on Bridge would wait for someone to open Capture.
        await syncMetadata((current) =>
          syncMetadataWithBridge({
            endpoint: bridge.endpoint,
            capture: syncState.capture,
            library: current,
          }),
        );
      });
    }

    const idToken = tokens?.idToken;
    if (idToken) {
      transports.push(async () => {
        // The token alone does not imply cloud entitlement: only Pro opens the
        // relay, so an authenticated Free account still syncs over LAN alone,
        // just like the foreground engine.
        const account = await loadAccount(idToken);
        if (account.tier !== "pro") return;
        await syncPendingCloudIdeas({
          idToken,
          capture: syncState.capture,
          library,
          deletions,
          readAudio,
        });
        // The relay is the only path between devices that never share a LAN, so
        // a headless run has to reconcile metadata here as well.
        await syncMetadata((current) =>
          syncMetadataWithCloud({
            idToken,
            capture: syncState.capture,
            library: current,
          }),
        );
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
