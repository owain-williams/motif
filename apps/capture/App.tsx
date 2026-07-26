import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, AppState, StyleSheet, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import * as Sharing from "expo-sharing";
import {
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
} from "expo-audio";
import {
  extractPreviewBars,
  useAudioRecorder as useStudioAudioRecorder,
} from "@siteed/audio-studio";
import {
  activeIdeas,
  availableRecordingChannels,
  availableRecordingFormats,
  createIdea,
  distinctFieldValues,
  editIdea,
  formatDuration,
  insertIdea,
  isIdeaDeleted,
  markIdeaDeleted,
  markIdeaRestored,
  mergeDeletions,
  normalizeIdeaName,
  recentlyDeletedIdeas,
  RECENTLY_DELETED_RETENTION_DAYS,
  renameIdea,
  recordingProfile,
  sameDeletions,
  sameEditableMetadata,
  setIdeaStorageState,
  SYNC_PROTOCOL_VERSION,
} from "@motif/shared";
import type {
  DeviceIdentity,
  IdeaDeletion,
  IdeaMetadata,
  IdeaMetadataEdit,
  PairingRequest,
} from "@motif/shared";
import {
  beginRecording,
  endRecording,
  IDLE_SESSION,
} from "./src/core/recording-session";
import { planIdeaShare } from "./src/core/idea-share";
import { purgeExpiredIdeas } from "./src/core/idea-purge";
import {
  applyMergedMetadata,
  ideaStorageAction,
  isPaired,
  pairWithBridge,
  syncTransports,
  UNPAIRED,
  unpair,
} from "./src/core/sync-engine";
import type { PairedBridge, SyncEngineState } from "./src/core/sync-engine";
import { formatRecordingClock } from "./src/core/recording-clock";
import { IDLE_METER, pushLevels } from "./src/core/level-meter";
import {
  activeChipId,
  ALL_CHIP_ID,
  filterLibrary,
  libraryChips,
  libraryEmptyState,
} from "./src/core/library-filter";
import {
  queuedIdeaIds,
  syncSummary,
  withDelivered,
} from "./src/core/sync-summary";
import { nextOnboardingStep, onboardingStep } from "./src/core/onboarding";
import {
  audioExtension,
  recordingConfig,
} from "./src/recording-config";
import {
  deleteIdeaAudio,
  deleteIdeaWaveform,
  ideaAudioUri,
  loadDeletions,
  loadIdeaWaveforms,
  loadLibrary,
  persistIdeaAudioBytes,
  persistIdeaWaveform,
  persistRecordingAudio,
  readIdeaAudioBytes,
  saveDeletions,
  saveLibrary,
  stageIdeaForShare,
} from "./src/idea-storage";
import {
  deleteCloudIdea,
  downloadCloudIdea,
  ensureIdeaInCloud,
  pushIdeaUpdate,
  requestPairing,
  syncMetadataWithBridge,
  syncMetadataWithCloud,
  syncPendingCloudIdeas,
  syncPendingIdeas,
} from "./src/idea-sync";
import {
  clearPairedBridge,
  loadSyncState,
  savePairedBridge,
} from "./src/sync-storage";
import { resolveCaptureLocation } from "./src/core/capture-location";
import {
  ensureLocationPermission,
  readLastKnownPosition,
  reverseGeocode,
} from "./src/geolocation";
import { loadSettings, saveSettings } from "./src/settings-storage";
import type { CaptureSettings } from "./src/settings-storage";
import { DEFAULT_SETTINGS } from "./src/settings-storage";
import { MOTIF_FONTS } from "./src/fonts";
import { colors } from "./src/theme";
import { OnboardingScreen } from "./src/components/OnboardingScreen";
import { RecordScreen } from "./src/components/RecordScreen";
import { LibraryScreen } from "./src/components/LibraryScreen";
import { SyncScreen } from "./src/components/SyncScreen";
import type { SyncStatus } from "./src/components/SyncScreen";
import { TabBar } from "./src/components/TabBar";
import type { CaptureTab } from "./src/components/TabBar";
import { Toast } from "./src/components/Toast";
import { IdeaActionsSheet } from "./src/components/IdeaActionsSheet";
import { RecentlyDeletedDialog } from "./src/components/RecentlyDeletedDialog";
import { RenameDialog } from "./src/components/RenameDialog";
import { MetadataDialog } from "./src/components/MetadataDialog";
import { PairBridgeDialog } from "./src/components/PairBridgeDialog";
import type { PairBridgeInput } from "./src/components/PairBridgeDialog";
import {
  confirmSignUp,
  loadAccount,
  signIn,
  signUp,
} from "./src/account-client";
import type { AuthTokens } from "./src/account-client";
import {
  clearAuthTokens,
  loadAuthTokens,
  saveAuthTokens,
} from "./src/account-storage";
import {
  ANONYMOUS_ACCOUNT,
  authenticatedAccount,
  effectiveTier as effectiveAccountTier,
} from "./src/core/account-session";
import type { AccountSession } from "./src/core/account-session";
import { createAccountRefresher } from "./src/core/account-refresh";
import { AccountDialog } from "./src/components/AccountDialog";
import {
  billingIsAvailable,
  configureBilling,
  currentEntitlement,
  currentProOffer,
  forgetBillingAccount,
  identifyBillingAccount,
  observeEntitlement,
  presentProPaywall,
  presentSubscriptionManagement,
  restoreProPurchase,
} from "./src/billing";
import {
  NO_ENTITLEMENT,
  PRO_DISPLAY_NAME,
  awaitTierProjection,
  cloudSyncPending,
  offerPriceLine,
  unlockedTier,
} from "./src/core/billing";
import type { EntitlementSnapshot, ProOffer } from "./src/core/billing";
import { LIBRARY_WAVEFORM_BAR_COUNT } from "./src/core/idea-waveform";
import { setBackgroundSyncEnabled } from "./src/background-sync";

/**
 * Capture's device shell. It presents three screens — Record, Library and Sync
 * — plus first-run onboarding, and owns the state that moves between them.
 *
 * Everything decidable without a device lives elsewhere: the record/stop toggle
 * and level meter in `src/core`, naming, Library ordering, search, rename and
 * delete in `@motif/shared`, filtering and sync figures in `src/core`. This file
 * wires those to the audio engine, the filesystem and the network, and the
 * components under `src/components` render the result.
 */
function newIdeaId(capturedAt: number): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `${capturedAt.toString(36)}-${random}`;
}

/** How often a paired Capture retries offering pending Ideas to Bridge. */
const SYNC_INTERVAL_MS = 15_000;

/**
 * How often the Library re-reads the clock behind its "Today"/"Yesterday"
 * labels. A minute is well inside the smallest unit those labels use.
 */
const RELATIVE_TIME_REFRESH_MS = 60_000;

/** How long a confirmation stays up before it stops being news. */
const TOAST_MS = 2600;

/**
 * Long enough for the Account dialog's fade-out to finish. Only the store
 * paywall needs this: it is a native modal, and iOS refuses to present one
 * while a React Native modal is still dismissing.
 */
const DIALOG_DISMISS_MS = 400;

/**
 * Everything a sync pass needs: the paired Bridge, who we are, what we have.
 * Deliberately no Tier — a pass re-reads the account's own before it decides
 * which transports are open, so a Tier that moved server-side while this was
 * queued is honoured by the pass rather than the one after it.
 */
interface SyncInputs {
  readonly bridge: PairedBridge | null;
  readonly capture: DeviceIdentity;
  readonly library: IdeaMetadata[];
  readonly idToken: string | null;
}

export default function App() {
  const [fontsLoaded] = useFonts(MOTIF_FONTS);
  const [account, setAccount] = useState<AccountSession>(ANONYMOUS_ACCOUNT);
  const [entitlement, setEntitlement] =
    useState<EntitlementSnapshot>(NO_ENTITLEMENT);
  const [proOffer, setProOffer] = useState<ProOffer | null>(null);
  const [storeAvailable, setStoreAvailable] = useState(false);
  const [settings, setSettings] = useState<CaptureSettings | null>(null);
  // Two Tiers, deliberately. `tier` is what this device may do on its own —
  // stereo, WAV, the UI — and follows the store, so a purchase takes effect the
  // moment it clears rather than waiting on the webhook.
  const tier = unlockedTier(account, entitlement);
  // `cloudTier` is what the *backend* will honour, and follows the account
  // alone. Cloud relay, offload and redownload are authorized server-side, so
  // acting on a store entitlement the webhook hasn't projected yet would only
  // produce 403s and an Offload button that fails. `cloudSyncPending` names the
  // window where the two disagree; it closes within seconds.
  const cloudTier = effectiveAccountTier(account);
  const channelChoices = availableRecordingChannels(tier);
  const formatChoices = availableRecordingFormats(tier);
  const profile = recordingProfile(
    tier,
    settings?.requestedAudioFormat,
    settings?.requestedChannels,
  );
  const recorder = useStudioAudioRecorder();
  const sessionRef = useRef(IDLE_SESSION);
  const activeRecordingProfileRef = useRef(profile);

  const player = useAudioPlayer();
  const playerStatus = useAudioPlayerStatus(player);

  const [library, setLibrary] = useState<IdeaMetadata[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTag, setSelectedTag] = useState(ALL_CHIP_ID);
  const [waveforms, setWaveforms] = useState<Record<string, readonly number[]>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isRecording, setIsRecording] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [meter, setMeter] = useState(IDLE_METER);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [actionsTarget, setActionsTarget] = useState<IdeaMetadata | null>(null);
  const [renameTarget, setRenameTarget] = useState<IdeaMetadata | null>(null);
  const [metadataTarget, setMetadataTarget] = useState<IdeaMetadata | null>(null);
  const [storageBusyId, setStorageBusyId] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<SyncEngineState>(UNPAIRED);
  const [captureIdentity, setCaptureIdentity] = useState<DeviceIdentity | null>(null);
  const [showPair, setShowPair] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  // Whether the last local-network pass reached Bridge; `null` before any ran.
  const [bridgeReachable, setBridgeReachable] = useState<boolean | null>(null);
  const [showAccount, setShowAccount] = useState(false);
  const [showRecentlyDeleted, setShowRecentlyDeleted] = useState(false);
  // The instant Recently Deleted was last opened. Its "N days left" figures are
  // read as of then, so they hold still while the sheet is up (and through its
  // closing animation) rather than drifting under the user.
  const [recentlyDeletedAsOf, setRecentlyDeletedAsOf] = useState(0);
  const [onboardingIndex, setOnboardingIndex] = useState(0);
  const [tab, setTab] = useState<CaptureTab>("record");
  const [showSync, setShowSync] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const authTokensRef = useRef<AuthTokens | null>(null);
  // The session as it stands, for work that outlives the render that began it:
  // a Tier read in flight is judged against the account signed in when the
  // answer lands, not the one on screen when it was asked for.
  const accountRef = useRef(account);
  useEffect(() => {
    accountRef.current = account;
  }, [account]);
  // Only verified billing moves a Tier, and most of the ways it moves — a
  // renewal, an expiry, a refund, Pro bought on another device — involve this
  // device not at all. This re-reads it on return to the foreground and before
  // anything the backend authorizes, so those changes land without a logout or
  // a restart.
  const accountRefresher = useMemo(
    () =>
      createAccountRefresher({
        currentAccount: () => accountRef.current,
        loadProfile: async () => {
          const idToken = authTokensRef.current?.idToken;
          if (!idToken) throw new Error("There is no account session to refresh.");
          return loadAccount(idToken);
        },
        // Reached only when the Tier actually moved, so a refresh that finds
        // nothing new doesn't re-arm the sync timer or re-render the Library.
        onRefreshed: setAccount,
      }),
    [],
  );
  // Set when the user chooses Pro while signed out: the purchase resumes once
  // the login it detoured through succeeds.
  const [resumeUpgrade, setResumeUpgrade] = useState(false);
  // Latest sync inputs, so the periodic timer always offers the current Library.
  const syncInputsRef = useRef<SyncInputs | null>(null);
  // Latest Library, so a sync pass merges Bridge edits into current state (not
  // the snapshot it started with) without dropping Ideas captured meanwhile.
  const libraryRef = useRef<IdeaMetadata[]>(library);
  useEffect(() => {
    libraryRef.current = library;
  }, [library]);

  // Ids a peer has reported holding, or that a pass has just delivered — what
  // separates a queued Idea from a synced one on the Library and Sync screens.
  const [deliveredIds, setDeliveredIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const deliveredRef = useRef(deliveredIds);
  const rememberDelivered = useCallback((...batches: readonly string[][]) => {
    const next = withDelivered(deliveredRef.current, ...batches);
    if (next === deliveredRef.current) return;
    deliveredRef.current = next;
    setDeliveredIds(next);
  }, []);

  /** Takes down any confirmation on screen, and the timer that would have. */
  const clearToast = useCallback(() => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = null;
    setToast(null);
  }, []);

  /** Shows a transient confirmation, replacing any still on screen. */
  const showToast = useCallback(
    (message: string) => {
      clearToast();
      setToast(message);
      toastTimerRef.current = setTimeout(() => setToast(null), TOAST_MS);
    },
    [clearToast],
  );

  useEffect(
    () => () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    },
    [],
  );

  // This device's delete/restore records (ADR 0005). Held as state so the
  // Library re-renders when a peer's delete lands, and mirrored in a ref so a
  // sync pass always exchanges the latest without re-subscribing the timer.
  const [deletions, setDeletions] = useState<readonly IdeaDeletion[]>([]);
  const deletionsRef = useRef<readonly IdeaDeletion[]>(deletions);

  /**
   * Adopts delete/restore records — from a local delete or restore, or merged
   * from Bridge. Merged into whatever this device holds *now* rather than
   * replacing it: a sync pass reads the records before its uploads and reports
   * back after, so a delete made meanwhile would otherwise be overwritten by
   * the pass's stale copy. The merge is order-independent (ADR 0005), so the
   * two can't disagree. Persists only on a real change, so an idle pass writes
   * nothing.
   */
  const applyDeletions = useCallback((incoming: readonly IdeaDeletion[]) => {
    const next = mergeDeletions(deletionsRef.current, incoming);
    if (sameDeletions(deletionsRef.current, next)) return;
    deletionsRef.current = next;
    saveDeletions(next);
    setDeletions(next);
  }, []);


  // Playback follows the active Library: whether the delete was made here or
  // arrived from Bridge, an Idea that leaves the Library stops playing.
  useEffect(() => {
    // `stopPlaybackIfPlaying` is re-made each render, closing over the current
    // player and playingId, so calling it here always acts on live state.
    if (playingId !== null && isIdeaDeleted(deletions, playingId)) {
      stopPlaybackIfPlaying(playingId);
    }
  }, [deletions, playingId]);

  // Loads the Library and its delete records together, then sweeps away
  // anything whose 30-day window has elapsed (motif-kka.8) — nothing schedules
  // that server-side (ADR 0005), so launch is when it runs. The sweep happens
  // after the Library is on screen: what it removes has been out of the active
  // Library for a month already, so there is nothing to wait for it to hide,
  // and a slow cloud call must never hold the app on its loading state.
  useEffect(() => {
    let active = true;
    (async () => {
      const [ideas, records, tokens] = await Promise.all([
        loadLibrary(),
        loadDeletions().catch(() => [] as IdeaDeletion[]),
        loadAuthTokens().catch(() => null),
      ]);
      const savedWaveforms = await loadIdeaWaveforms(ideas.map((idea) => idea.id));
      if (!active) return;
      setLibrary(ideas);
      setWaveforms(savedWaveforms);
      applyDeletions(records);
      setIsLoading(false);

      const idToken = tokens?.idToken;
      const swept = await purgeExpiredIdeas({
        library: ideas,
        deletions: records,
        now: Date.now(),
        io: {
          deleteLocalCopy: (idea) => {
            deleteIdeaAudio(idea.id, audioExtension(idea.audioFormat));
            deleteIdeaWaveform(idea.id);
          },
          // With no session there is no way to reach cloud storage; anything
          // left there by an account since signed out stays until it returns.
          deleteCloudCopy: idToken
            ? (idea) => deleteCloudIdea(idToken, idea.id)
            : null,
        },
      });
      if (swept.purged.length === 0 || !active) return;
      // Ideas captured while the sweep ran must survive it, so the purged ones
      // come out of the current Library rather than the snapshot it started on.
      const purged = new Set(swept.purged);
      const kept = libraryRef.current.filter((idea) => !purged.has(idea.id));
      libraryRef.current = kept;
      saveLibrary(kept);
      setLibrary(kept);
    })()
      .catch(() => {
        // A missing or corrupt manifest just means an empty Library — and,
        // crucially, no sweep: purging against a Library that failed to load
        // would save that emptiness over the real thing.
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  // Configure billing before anything asks about entitlements, and keep
  // watching: renewals, expirations, and Family Sharing changes arrive while the
  // app is open, without any purchase happening here.
  useEffect(() => {
    const problem = configureBilling();
    if (problem) {
      // Billing being unavailable is never fatal. Capture still works at Free,
      // and the Account dialog explains that upgrading isn't possible here.
      if (__DEV__) console.warn(`[billing] ${problem.problem}`);
      return;
    }
    setStoreAvailable(billingIsAvailable());
    currentEntitlement().then(setEntitlement);
    // The price is fetched from the store, so it is quoted in the user's own
    // currency. A null offer only softens the button's label; it never removes
    // the upgrade, because the hosted paywall quotes the price itself.
    currentProOffer().then(setProOffer);
    return observeEntitlement(setEntitlement);
  }, []);

  // Picks a purchase back up after the login it detoured through. Deliberately
  // waits for the Account dialog to be gone: the paywall is a native modal, and
  // iOS will not present one over a React Native modal that is still dismissing
  // — the purchase would silently never appear.
  useEffect(() => {
    if (showAccount || !resumeUpgrade) return;
    if (account.kind !== "authenticated") return;

    // Cleared by the timer rather than here: clearing first would change this
    // effect's own dependencies, and the re-run's cleanup would cancel the
    // timer before it ever fired.
    const timer = setTimeout(() => {
      setResumeUpgrade(false);
      void upgradeToPro();
    }, DIALOG_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [showAccount, resumeUpgrade, account.kind]);

  // Coming back to the app is when a Tier change made elsewhere is most likely
  // to be waiting, and the moment the user looks at what their account can do.
  // A refresh that fails is silent: Capture stays on the Tier it last saw
  // rather than dropping a paying account to Free because the network blinked.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") void accountRefresher.refresh("foreground");
    });
    return () => subscription.remove();
  }, [accountRefresher]);

  // The Sync screen is where the paid recording choices are made and where the
  // relay's state is read, so it opens on a Tier no older than the foreground
  // window allows rather than on whatever this device last happened to see.
  useEffect(() => {
    if (!showSync) return;
    void accountRefresher.refresh("foreground");
  }, [showSync, accountRefresher]);

  // Re-read the Tier whenever the Account dialog opens, so a webhook that landed
  // after Capture gave up polling is picked up without restarting the app.
  // Opening the dialog is a deliberate look at the subscription, so it asks
  // again rather than settling for however fresh the last answer was.
  useEffect(() => {
    if (!showAccount) return;
    accountRefresher.invalidate();
    void accountRefresher.refresh("foreground");
  }, [showAccount, accountRefresher]);

  // Restore login when possible. A missing/expired account session is soft:
  // Capture remains fully available with anonymous Free-tier behavior.
  useEffect(() => {
    let active = true;
    loadAuthTokens()
      .then(async (tokens) => {
        if (!tokens) return;
        const profile = await loadAccount(tokens.idToken);
        if (!active) return;
        authTokensRef.current = tokens;
        setAccount(authenticatedAccount(profile));
        // Re-point the store customer at this account every launch: RevenueCat's
        // identity is per-install, so without this a reinstall would buy against
        // an anonymous id the webhook rejects.
        const snapshot = await identifyBillingAccount(profile.sub);
        if (active) setEntitlement(snapshot);
      })
      .catch(() => clearAuthTokens());
    return () => {
      active = false;
    };
  }, []);

  // Clear the "playing" highlight once playback reaches the end.
  useEffect(() => {
    if (playerStatus.didJustFinish) setPlayingId(null);
  }, [playerStatus.didJustFinish]);

  // Restore persisted settings — the location tag toggle (default off, so
  // nothing is ever captured until the user turns it on) and whether onboarding
  // has been seen. Until they load, the app holds on its launch screen rather
  // than risk flashing onboarding at someone who finished it months ago.
  useEffect(() => {
    let active = true;
    loadSettings()
      .then((loaded) => {
        if (active) setSettings(loaded);
      })
      .catch(() => {
        // A missing/corrupt settings file just means the defaults.
        if (active) setSettings({ ...DEFAULT_SETTINGS });
      });
    return () => {
      active = false;
    };
  }, []);

  // Load this Capture's identity and any remembered Bridge pairing.
  useEffect(() => {
    let active = true;
    loadSyncState()
      .then((state) => {
        if (!active) return;
        setCaptureIdentity(state.capture);
        setSyncState({ pairedBridge: state.pairedBridge });
      })
      .catch(() => {
        // No persisted sync state yet — Capture simply stays unpaired.
      });
    return () => {
      active = false;
    };
  }, []);

  // Keep relative capture labels honest as the day turns under a running app.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), RELATIVE_TIME_REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  // Fold each batch of recorder analysis into the live level meter. `pushLevels`
  // ignores points already shown, so a re-delivered window doesn't scroll it.
  useEffect(() => {
    if (!isRecording) return;
    const points = recorder.analysisData?.dataPoints;
    if (!points || points.length === 0) return;
    setMeter((current) => pushLevels(current, points));
  }, [isRecording, recorder.analysisData]);

  // Applies a reconciled Library from a metadata sync onto the *current* state,
  // re-merging per Idea so a concurrent local edit or a just-captured Idea is
  // never lost. Persists only when something actually changed. The headless job
  // lands its passes through the same policy, against durable state.
  const landMergedMetadata = useCallback((merged: readonly IdeaMetadata[]) => {
    const { library: next, changed } = applyMergedMetadata(
      libraryRef.current,
      merged,
    );
    if (!changed) return;
    libraryRef.current = next;
    saveLibrary(next);
    setLibrary(next);
  }, []);

  // The headless job writes the Library and the delete records too, and it runs
  // while this component sits in memory still holding both as they were. Reading
  // them again on return merges what the job persisted back into the live state,
  // so the next thing Capture saves doesn't overwrite an edit or a delete that
  // arrived from Bridge while the app was in the background (motif-kka.10).
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      if (next !== "active") return;
      loadLibrary()
        .then(landMergedMetadata)
        .catch(() => {
          // A manifest that won't load leaves the in-memory Library in charge
          // rather than emptying it; the next sync pass brings the edits back.
        });
      // Delete records merge by union, so a failed read costs nothing either.
      loadDeletions()
        .then(applyDeletions)
        .catch(() => {});
    });
    return () => subscription.remove();
  }, [landMergedMetadata, applyDeletions]);

  // Runs every path the tier allows. LAN remains preferred and independent:
  // a local failure never prevents a paid account from reaching cloud relay.
  const runSync = useCallback(
    async (inputs: SyncInputs) => {
    const readAudio = (idea: IdeaMetadata) =>
      readIdeaAudioBytes(idea.id, audioExtension(idea.audioFormat));
    const statuses: string[] = [];
    setIsSyncing(true);

    // The local path is open to every tier and needs no account at all, so it
    // runs before the Tier is read rather than behind it: a Bridge on this LAN
    // must not wait on a backend the network may have no route to.
    if (inputs.bridge) {
      try {
        // The pass exchanges delete records before offering audio, so a delete
        // made on either device while the other was offline lands first.
        const { synced, remoteHave, deletions: merged } = await syncPendingIdeas({
          endpoint: inputs.bridge.endpoint,
          capture: inputs.capture,
          library: inputs.library,
          deletions: deletionsRef.current,
          readAudio,
        });
        applyDeletions(merged);
        rememberDelivered(remoteHave, synced);
        setBridgeReachable(true);
        statuses.push(
          synced.length > 0
            ? `${synced.length} to ${inputs.bridge.displayName}`
            : `${inputs.bridge.displayName} up to date`,
        );
        // Metadata sync is bidirectional (ADR 0006): pull Bridge's edits, push
        // ours. Kept separate from the audio offer path so it stays copy-safe.
        landMergedMetadata(
          await syncMetadataWithBridge({
            endpoint: inputs.bridge.endpoint,
            capture: inputs.capture,
            library: inputs.library,
          }),
        );
      } catch {
        setBridgeReachable(false);
        statuses.push(`${inputs.bridge.displayName} offline`);
      }
    }

    // Whether the relay is open is the account Tier's to say, and it is read
    // afresh rather than taken from the pass's inputs: a subscription that
    // lapsed, or one that just started, decides this pass rather than the one
    // after it. A read that fails leaves the last known Tier in charge, so a
    // paid account keeps relaying through a blip and the backend goes on
    // refusing anything it shouldn't have.
    const cloudTier = effectiveAccountTier(
      await accountRefresher.refresh("gated-work"),
    );
    const transports = syncTransports(cloudTier, inputs.bridge !== null);

    if (transports.includes("cloud-relay") && inputs.idToken) {
      try {
        const { synced, remoteHave, storageDecision } = await syncPendingCloudIdeas({
          idToken: inputs.idToken,
          capture: inputs.capture,
          library: inputs.library,
          deletions: deletionsRef.current,
          readAudio,
        });
        rememberDelivered(remoteHave, synced);
        // Reported before the metadata pass, as the LAN branch does: the audio
        // that reached the cloud reached it whether or not the edits that
        // follow do.
        statuses.push(
          storageDecision?.status === "warning" || storageDecision?.status === "blocked"
            ? storageDecision.message
            : synced.length > 0
              ? `${synced.length} via cloud`
              : "Cloud up to date",
        );
        // Metadata reconciles over the relay too (motif-kka.9), so an edit made
        // on either device propagates without the two ever sharing a LAN. Reads
        // the live Library rather than this pass's snapshot, so an edit Bridge
        // just handed us over the LAN reaches the account's other devices now
        // instead of on the next pass.
        landMergedMetadata(
          await syncMetadataWithCloud({
            idToken: inputs.idToken,
            capture: inputs.capture,
            library: libraryRef.current,
          }),
        );
      } catch {
        statuses.push("Cloud unavailable");
      }
    }

    setIsSyncing(false);
    setSyncStatus(statuses.join(" · ") || null);
    },
    [landMergedMetadata, applyDeletions, rememberDelivered, accountRefresher],
  );

  // Keep the timer's inputs current without re-arming it on every keystroke.
  useEffect(() => {
    syncInputsRef.current = captureIdentity
      ? {
          bridge: syncState.pairedBridge,
          capture: captureIdentity,
          library,
          idToken: authTokensRef.current?.idToken ?? null,
        }
      : null;
  }, [syncState.pairedBridge, captureIdentity, library, account]);

  // Keep the OS-scheduled headless job enabled whenever a persisted sync path
  // exists. It supplements this foreground timer; the OS decides the actual
  // background execution time and may defer it well beyond the 15-minute floor.
  useEffect(() => {
    if (!captureIdentity) return;
    const enabled = syncTransports(cloudTier, syncState.pairedBridge !== null).length > 0;
    void setBackgroundSyncEnabled(enabled).catch(() => {
      // Unsupported/restricted scheduling is soft: foreground sync still works.
    });
  }, [syncState.pairedBridge, captureIdentity, cloudTier, account]);

  /** Runs a sync pass immediately with the latest inputs, if any path is open. */
  const syncNow = useCallback(() => {
    const inputs = syncInputsRef.current;
    if (inputs) void runSync(inputs);
  }, [runSync]);

  // Sync now and on an interval whenever LAN or paid cloud relay is available.
  useEffect(() => {
    if (!captureIdentity) return;
    if (syncTransports(cloudTier, syncState.pairedBridge !== null).length === 0) return;
    syncNow();
    const timer = setInterval(syncNow, SYNC_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [syncState.pairedBridge, captureIdentity, cloudTier, account, syncNow]);

  async function extractAndPersistWaveform(ideaId: string, fileUri: string) {
    try {
      const preview = await extractPreviewBars({
        fileUri,
        numberOfBars: LIBRARY_WAVEFORM_BAR_COUNT,
      });
      const peaks = preview.bars.map((bar) => bar.amplitude);
      if (peaks.length === 0) return;
      persistIdeaWaveform(ideaId, peaks);
      setWaveforms((current) => ({ ...current, [ideaId]: peaks }));
    } catch {
      // Audio remains the source of truth. If analysis is unavailable, the row
      // uses its compatibility fallback and Capture still saves the Idea.
    }
  }

  async function startRecording() {
    const { granted } = await requestRecordingPermissionsAsync();
    if (!granted) {
      Alert.alert(
        "Microphone needed",
        "Motif needs microphone access to capture your ideas.",
      );
      return;
    }
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    activeRecordingProfileRef.current = profile;
    await recorder.startRecording(recordingConfig(profile));
    sessionRef.current = beginRecording(IDLE_SESSION, Date.now());
    setMeter(IDLE_METER);
    clearToast();
    setIsRecording(true);
  }

  async function stopRecording() {
    // Read the engine's captured length before stopping — this matches the live
    // timer the user just watched and excludes file-finalization latency.
    const durationMs = Math.max(0, Math.round(recorder.durationMs));
    const completedRecording = await recorder.stopRecording();
    const { session, startedAt } = endRecording(sessionRef.current);
    sessionRef.current = session;
    setIsRecording(false);
    setMeter(IDLE_METER);

    const recordingProfileUsed = activeRecordingProfileRef.current;
    const uri =
      recordingProfileUsed.audioFormat === "aac"
        ? completedRecording.compression?.compressedFileUri
        : completedRecording.fileUri;
    if (!uri) {
      Alert.alert("Recording failed", "The capture could not be saved in the required format.");
      return;
    }

    const id = newIdeaId(startedAt);
    const persistedUri = await persistRecordingAudio(
      uri,
      id,
      audioExtension(recordingProfileUsed.audioFormat),
    );
    await extractAndPersistWaveform(id, persistedUri);
    const idea = createIdea({
      id,
      capturedAt: startedAt,
      durationMs,
      audioFormat: recordingProfileUsed.audioFormat,
      channels: recordingProfileUsed.channels,
    });
    // Recordings are sequential (the button is disabled mid-capture), so the
    // captured `library` is current. Persist outside the state updater — updaters
    // must stay pure (React may invoke them twice).
    const next = insertIdea(library, idea);
    saveLibrary(next);
    setLibrary(next);
    const transports = syncTransports(cloudTier, syncState.pairedBridge !== null);
    showToast(transports.length > 0 ? "Saved · sending to Bridge" : "Saved");
    // Nudge the new Idea to Bridge right away if paired (copy semantics — the
    // Capture-side Idea just saved stays put); the interval is the fallback.
    if (captureIdentity) {
      void runSync({
        bridge: syncState.pairedBridge,
        capture: captureIdentity,
        library: next,
        idToken: authTokensRef.current?.idToken ?? null,
      }).then(() => {
        // Only claim it landed once a peer has actually said so.
        if (deliveredRef.current.has(id)) showToast("On your Bridge");
      });
    }
    // Opt-in location tagging resolves off the record path, so a slow reverse-
    // geocode never blocks the save (motif-kka.3). When enabled and a position
    // is available it lands as a metadata edit that syncs like any other field.
    void attachCapturedLocation(id, startedAt);
  }

  /**
   * Best-effort location tag for a just-captured Idea, resolved in the
   * background so it never blocks the save. Does nothing when tagging is off
   * (the resolver is the single gate) or no position is available; otherwise it
   * applies the location as an edit stamped at the capture instant, then
   * persists and pushes it like any other metadata change (ADR 0006).
   */
  async function attachCapturedLocation(id: string, capturedAt: number) {
    const location = await resolveCaptureLocation({
      enabled: settings?.locationTaggingEnabled ?? false,
      readLastKnownPosition,
      reverseGeocode,
    });
    if (!location) return;
    const current = libraryRef.current;
    const before = current.find((entry) => entry.id === id);
    // The Idea may have been deleted while the geocode was in flight.
    if (!before) return;
    const nextLibrary = editIdea(current, id, { location }, capturedAt);
    const updated = nextLibrary.find((entry) => entry.id === id);
    if (!updated || sameEditableMetadata(updated, before)) return;
    libraryRef.current = nextLibrary;
    saveLibrary(nextLibrary);
    setLibrary(nextLibrary);
    pushMetadataEdit(nextLibrary, id);
  }

  async function onPressRecord() {
    if (isBusy || storageBusyId !== null) return;
    setIsBusy(true);
    try {
      if (isRecording) {
        await stopRecording();
      } else {
        await startRecording();
      }
    } catch (error) {
      setIsRecording(false);
      setMeter(IDLE_METER);
      sessionRef.current = IDLE_SESSION;
      Alert.alert(
        "Something went wrong",
        error instanceof Error ? error.message : "Please try again.",
      );
    } finally {
      setIsBusy(false);
    }
  }

  async function togglePlayback(idea: IdeaMetadata) {
    // Tapping the row that's playing pauses it; tapping any other row starts
    // that Idea from the top.
    if (playingId === idea.id) {
      player.pause();
      setPlayingId(null);
      return;
    }
    // Switch the session to playback (audible in silent mode) before playing —
    // awaited so it wins the race with play() on iOS. Best-effort: if it fails
    // we still try to play rather than leave the tap dead.
    try {
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    } catch {
      // Non-fatal — fall through and attempt playback anyway.
    }
    player.replace(ideaAudioUri(idea.id, audioExtension(idea.audioFormat)));
    player.play();
    setPlayingId(idea.id);
  }

  async function shareIdea(idea: IdeaMetadata) {
    // Hand the audio to the phone's native share sheet (ADR 0001) — always in
    // the compressed format so it opens in any player and is never an oversized
    // attachment. Staging/transcoding decisions live in the tested share plan
    // and the storage shell; here we just drive the OS sheet.
    try {
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert("Sharing unavailable", "This device can't share files.");
        return;
      }
      const plan = planIdeaShare(idea);
      const sourceUri = ideaAudioUri(idea.id, audioExtension(idea.audioFormat));
      const shareUri = await stageIdeaForShare(sourceUri, plan);
      await Sharing.shareAsync(shareUri, {
        mimeType: plan.mimeType,
        UTI: plan.uti,
        dialogTitle: `Share "${idea.name}"`,
      });
    } catch (error) {
      Alert.alert(
        "Couldn't share",
        error instanceof Error ? error.message : "Please try again.",
      );
    }
  }

  async function handleIdeaStorageAction(idea: IdeaMetadata) {
    const action = ideaStorageAction(cloudTier, idea);
    if (!action || storageBusyId !== null || isRecording) return;
    const tokens = authTokensRef.current;
    if (!tokens) {
      Alert.alert("Account needed", "Log in to access this Idea's cloud audio.");
      return;
    }
    const capture = captureIdentity;
    if (!capture) {
      Alert.alert("Please try again", "Capture is still getting ready.");
      return;
    }

    setStorageBusyId(idea.id);
    try {
      // Cloud storage is authorized server-side, so the account's Tier now
      // decides this — not the one the Library row was drawn from. Which action
      // it is follows the Idea's storage state, so a refreshed Tier can only
      // withdraw it. A refresh that can't reach the backend leaves the last
      // known Tier in charge and the request goes ahead; the backend refuses it
      // if the account no longer qualifies.
      const authorizedTier = effectiveAccountTier(
        await accountRefresher.refresh("gated-work"),
      );
      if (!ideaStorageAction(authorizedTier, idea)) {
        Alert.alert(
          PRO_DISPLAY_NAME,
          `Cloud storage needs ${PRO_DISPLAY_NAME}. This Idea stays on your device.`,
        );
        return;
      }

      if (action === "offload") {
        const audio = await readIdeaAudioBytes(
          idea.id,
          audioExtension(idea.audioFormat),
        );
        const storageDecision = await ensureIdeaInCloud({
          idToken: tokens.idToken,
          capture,
          idea,
          audio,
        });
        stopPlaybackIfPlaying(idea.id);
        deleteIdeaAudio(idea.id, audioExtension(idea.audioFormat));
        const next = setIdeaStorageState(library, idea.id, "offloaded");
        saveLibrary(next);
        setLibrary(next);
        showToast(
          storageDecision?.status === "warning"
            ? storageDecision.message
            : "Offloaded to your account",
        );
      } else {
        const audio = await downloadCloudIdea(tokens.idToken, idea.id);
        const persistedUri = persistIdeaAudioBytes(
          audio,
          idea.id,
          audioExtension(idea.audioFormat),
        );
        if (!waveforms[idea.id]) {
          await extractAndPersistWaveform(idea.id, persistedUri);
        }
        const next = setIdeaStorageState(library, idea.id, "on-device");
        saveLibrary(next);
        setLibrary(next);
        showToast("Back on this device");
      }
    } catch (error) {
      Alert.alert(
        action === "offload" ? "Couldn't offload Idea" : "Couldn't redownload Idea",
        error instanceof Error ? error.message : "Please try again.",
      );
    } finally {
      setStorageBusyId(null);
    }
  }

  function stopPlaybackIfPlaying(id: string) {
    if (playingId === id) {
      player.pause();
      setPlayingId(null);
    }
  }

  function submitRename(rawName: string) {
    const target = renameTarget;
    setRenameTarget(null);
    if (!target) return;
    const name = normalizeIdeaName(rawName);
    // A blank name keeps the existing one — nothing to save.
    if (name === null || name === target.name) return;
    const next = renameIdea(library, target.id, name, Date.now());
    saveLibrary(next);
    setLibrary(next);
    pushMetadataEdit(next, target.id);
  }

  /**
   * Sends the (possibly newly edited) Idea's metadata to Bridge right away so a
   * paired desktop reflects it without waiting for the next interval reconcile.
   * Best-effort: the periodic metadata sync is the fallback if Bridge is offline.
   */
  function pushMetadataEdit(nextLibrary: readonly IdeaMetadata[], id: string) {
    const updated = nextLibrary.find((idea) => idea.id === id);
    const bridge = syncState.pairedBridge;
    if (!updated || !bridge || !captureIdentity) return;
    void pushIdeaUpdate(bridge.endpoint, {
      kind: "idea-metadata-update",
      from: captureIdentity,
      idea: updated,
    }).catch(() => {
      // A failed push is soft — the next reconcile re-sends the newer field.
    });
  }

  function submitMetadata(edit: IdeaMetadataEdit) {
    const target = metadataTarget;
    setMetadataTarget(null);
    if (!target) return;
    const next = editIdea(library, target.id, edit, Date.now());
    const updated = next.find((idea) => idea.id === target.id);
    // Opening and saving the editor without touching anything is a no-op.
    if (!updated || sameEditableMetadata(updated, target)) return;
    saveLibrary(next);
    setLibrary(next);
    pushMetadataEdit(next, target.id);
  }

  async function handlePair(input: PairBridgeInput) {
    setShowPair(false);
    if (!captureIdentity) return;
    const endpoint = { host: input.host, port: Number(input.port) };
    const request: PairingRequest = {
      kind: "pairing-request",
      protocolVersion: SYNC_PROTOCOL_VERSION,
      from: captureIdentity,
      pairingCode: input.code,
    };
    try {
      const response = await requestPairing(endpoint, request);
      if (!response.accepted) {
        Alert.alert(
          "Pairing failed",
          "Bridge didn't accept that code. Check the code shown on Bridge and try again.",
        );
        return;
      }
      const bridge: PairedBridge = {
        deviceId: response.bridge.deviceId,
        displayName: response.bridge.displayName,
        endpoint,
      };
      await savePairedBridge(bridge);
      setSyncState((current) => pairWithBridge(current, bridge));
      void runSync({
        bridge,
        capture: captureIdentity,
        library,
        idToken: authTokensRef.current?.idToken ?? null,
      });
    } catch {
      Alert.alert(
        "Couldn't reach Bridge",
        "Make sure Bridge is open and your phone is on the same Wi-Fi network.",
      );
    }
  }

  async function handleUnpair() {
    await clearPairedBridge();
    setSyncState((current) => unpair(current));
    setSyncStatus(null);
    setBridgeReachable(null);
  }

  /** Persists one settings change, keeping the loaded settings as the base. */
  function updateSettings(change: Partial<CaptureSettings>) {
    const next = { ...(settings ?? DEFAULT_SETTINGS), ...change };
    setSettings(next);
    saveSettings(next);
  }

  // Turning location tagging on requests location permission up front, so recording
  // itself is never interrupted by a prompt; a denied request leaves it off.
  // Turning it off is immediate and needs no permission.
  async function toggleLocationTagging(next: boolean) {
    if (next) {
      const granted = await ensureLocationPermission().catch(() => false);
      if (!granted) {
        Alert.alert(
          "Location access needed",
          "Allow location access to tag your recordings with where you made them. You can enable it later in system settings.",
        );
        return;
      }
    }
    updateSettings({ locationTaggingEnabled: next });
  }

  async function login(email: string, password: string) {
    const tokens = await signIn(email, password);
    const profile = await loadAccount(tokens.idToken);
    await saveAuthTokens(tokens);
    authTokensRef.current = tokens;
    // Nothing learned about the last account says anything about this one.
    accountRefresher.invalidate();
    setAccount(authenticatedAccount(profile));
    setEntitlement(await identifyBillingAccount(profile.sub));
    setShowAccount(false);
  }

  async function createAccount(email: string, password: string) {
    await signUp(email, password);
  }

  async function confirmAccount(email: string, code: string, password: string) {
    await confirmSignUp(email, code);
    await login(email, password);
  }

  async function logout() {
    await clearAuthTokens();
    authTokensRef.current = null;
    setResumeUpgrade(false);
    accountRefresher.invalidate();
    setAccount(ANONYMOUS_ACCOUNT);
    // Return the store customer to anonymous too, so the next account signed in
    // on this device doesn't inherit these entitlements.
    await forgetBillingAccount();
    setEntitlement(NO_ENTITLEMENT);
    setShowAccount(false);
  }

  /**
   * Catches the account Tier up with a purchase the store has already granted.
   * Pro is live locally before this runs; what it unblocks is cloud relay, which
   * the backend refuses until its own Tier says Pro. Runs in the background so a
   * slow webhook never holds up the unlock.
   */
  async function reconcileAccountTier(): Promise<void> {
    const idToken = authTokensRef.current?.idToken;
    if (!idToken) return;

    const projection = await awaitTierProjection("pro", {
      loadTier: async () => (await loadAccount(idToken)).tier,
      wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    });

    // This poll has read the account later than any refresh still in flight, so
    // its answer supersedes them — including one that started before the
    // webhook landed and would otherwise put the Tier back to Free.
    accountRefresher.invalidate();
    if (!projection.settled) return;
    setAccount((current) =>
      current.kind === "authenticated"
        ? authenticatedAccount({ email: current.email, tier: projection.tier })
        : current,
    );
  }

  /**
   * Closing the dialog abandons the purchase as well as the login. Without
   * this, an unrelated login later on would open a paywall out of nowhere.
   */
  function closeAccountDialog() {
    setResumeUpgrade(false);
    setShowAccount(false);
  }

  /**
   * Starts the upgrade from anywhere, including while signed out. Pro is an
   * account Tier — the billing webhook refuses anonymous store ids — so an
   * account has to exist first, and the purchase resumes once login lands.
   */
  function startUpgrade() {
    if (account.kind === "authenticated") {
      void upgradeToPro();
      return;
    }
    setResumeUpgrade(true);
    setShowAccount(true);
  }

  /**
   * Presents the RevenueCat paywall. A completed purchase unlocks Pro straight
   * away from the store entitlement — no waiting on Motif's backend.
   */
  async function upgradeToPro() {
    const outcome = await presentProPaywall();
    if (outcome.kind === "dismissed") return;
    if (outcome.kind === "failed") {
      // Covers cancellation-adjacent outcomes too: nothing is granted, and
      // Capture stays exactly as usable at Free as it was before.
      Alert.alert(PRO_DISPLAY_NAME, outcome.message);
      return;
    }

    // Confirm against the store rather than trusting the paywall's word: a
    // restore can succeed while restoring something other than Pro, and saying
    // "Pro is active" when it isn't is worse than saying nothing.
    const snapshot = await currentEntitlement();
    setEntitlement(snapshot);
    if (!snapshot.proIsActive) {
      Alert.alert(
        PRO_DISPLAY_NAME,
        `Your ${PRO_DISPLAY_NAME} purchase hasn't cleared yet. We'll unlock Pro as soon as it does.`,
      );
      return;
    }

    showToast(`${PRO_DISPLAY_NAME} is active.`);
    void reconcileAccountTier();
  }

  /** Cancellations, plan changes, refunds, and restores, all via RevenueCat. */
  async function manageSubscription() {
    const opened = await presentSubscriptionManagement((snapshot) => {
      setEntitlement(snapshot);
      void reconcileAccountTier();
    });
    if (!opened) {
      // Every route to the store's own screen failed. Say so rather than let
      // the button look like it did nothing.
      Alert.alert(
        PRO_DISPLAY_NAME,
        "Motif couldn't open your store's subscription settings. Manage this subscription from the App Store app.",
      );
      return;
    }
    setEntitlement(await currentEntitlement());
  }

  /** Reattaches an existing subscription after a reinstall or device change. */
  async function restorePurchases() {
    const result = await restoreProPurchase();
    if ("message" in result) {
      Alert.alert(PRO_DISPLAY_NAME, result.message);
      return;
    }

    setEntitlement(result.snapshot);
    if (!result.snapshot.proIsActive) {
      Alert.alert(
        `${PRO_DISPLAY_NAME}`,
        "No previous purchase was found for this store account.",
      );
      return;
    }

    showToast(`${PRO_DISPLAY_NAME} restored.`);
    void reconcileAccountTier();
  }

  /**
   * Deletes an Idea everywhere, after confirming. Soft: the audio and waveform
   * stay on the device for the 30-day Recently Deleted window (ADR 0005), and
   * the record is what reaches Bridge on the next exchange — nudged here so the
   * delete lands on the paired device right away rather than at the next tick.
   */
  function confirmDelete(idea: IdeaMetadata) {
    Alert.alert(
      "Delete idea?",
      `"${idea.name}" moves to Recently Deleted here, and on your paired devices when they're next reachable. You can restore it for ${RECENTLY_DELETED_RETENTION_DAYS} days.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            applyDeletions(markIdeaDeleted(deletionsRef.current, idea.id, Date.now()));
            syncNow();
          },
        },
      ],
    );
  }

  /**
   * Brings a deleted Idea back. Its audio never left this device, so this is
   * just the record; the same exchange that carried the delete carries the
   * restore back to Bridge, which re-offers the audio if it had purged it.
   */
  function restoreIdea(idea: IdeaMetadata) {
    applyDeletions(markIdeaRestored(deletionsRef.current, idea.id, Date.now()));
    syncNow();
  }

  /** Runs a row action against the Idea whose sheet is open, then closes it. */
  function runIdeaAction(action: (idea: IdeaMetadata) => void) {
    const target = actionsTarget;
    setActionsTarget(null);
    if (target) action(target);
  }

  // Deleted Ideas drop out of the Library the moment a delete lands, here or
  // from Bridge; their audio stays for the grace period (ADR 0005).
  const activeLibrary = activeIdeas(library, deletions);
  const deletedIdeas = recentlyDeletedIdeas(library, deletions);
  const chips = libraryChips(activeLibrary);
  const activeChip = activeChipId(chips, selectedTag);
  const libraryFilter = { tag: activeChip, query: searchQuery };
  const visibleLibrary = filterLibrary(activeLibrary, libraryFilter);
  const metadataSuggestions = {
    tags: distinctFieldValues(activeLibrary, "tags"),
    instrument: distinctFieldValues(activeLibrary, "instrument"),
    style: distinctFieldValues(activeLibrary, "style"),
  };

  const summary = syncSummary({ library, deletions, deliveredIds });
  const queuedIds = queuedIdeaIds(library, deletions, deliveredIds);
  const paired = isPaired(syncState);
  const canSync = syncTransports(cloudTier, paired).length > 0;
  const playbackProgress =
    playerStatus.duration > 0
      ? Math.min(1, Math.max(0, playerStatus.currentTime / playerStatus.duration))
      : 0;

  const recordingFormat = `${
    profile.audioFormat === "wav" ? "Uncompressed WAV" : "Compressed AAC"
  } · ${profile.channels === 2 ? "Stereo" : "Mono"}`;

  const syncPillLabel = !canSync
    ? "Not paired"
    : isSyncing
      ? "Sending"
      : summary.queuedCount > 0
        ? `Queued ${summary.queuedCount}`
        : "Synced";

  const syncScreenStatus: SyncStatus = paired
    ? bridgeReachable === false
      ? { label: "OFFLINE", tone: "warn" }
      : bridgeReachable === true
        ? { label: "LIVE", tone: "live" }
        : { label: "PAIRED", tone: "idle" }
    : canSync
      ? { label: "CLOUD", tone: "live" }
      : { label: "NOT PAIRED", tone: "idle" };

  // Hold the launch screen until the typefaces and the persisted settings are
  // both in: a first frame in a fallback face, or onboarding shown to someone
  // who finished it long ago, are worse than a few more milliseconds of black.
  if (!fontsLoaded || settings === null) {
    return (
      <View style={styles.launch}>
        <StatusBar style="light" />
      </View>
    );
  }

  const step = settings.onboardingCompleted ? null : onboardingStep(onboardingIndex);
  if (step !== null) {
    return (
      <View style={styles.app}>
        <OnboardingScreen
          index={onboardingIndex}
          step={step}
          onNext={() => {
            const next = nextOnboardingStep(onboardingIndex);
            if (next === null) updateSettings({ onboardingCompleted: true });
            else setOnboardingIndex(next);
          }}
          onSkip={() => updateSettings({ onboardingCompleted: true })}
        />
        <StatusBar style="light" />
      </View>
    );
  }

  return (
    <View style={styles.app}>
      {showSync ? (
        <SyncScreen
          bridgeName={syncState.pairedBridge?.displayName ?? null}
          bridgeDetail={
            syncState.pairedBridge
              ? `${syncState.pairedBridge.endpoint.host}:${syncState.pairedBridge.endpoint.port}`
              : "Pair to send Ideas straight to your desktop"
          }
          status={syncScreenStatus}
          statusLine={syncStatus}
          summary={summary}
          syncing={isSyncing}
          paired={paired}
          canSync={canSync}
          now={now}
          accountLabel={
            account.kind === "authenticated"
              ? `${account.email} · ${account.tier}`
              : "Free · not signed in"
          }
          tier={tier}
          proPriceLine={storeAvailable ? offerPriceLine(proOffer) : null}
          cloudSyncPending={cloudSyncPending(account, entitlement)}
          recordingFormat={recordingFormat}
          formatChoices={formatChoices}
          audioFormat={profile.audioFormat}
          channelChoices={channelChoices}
          channels={profile.channels}
          locationTaggingEnabled={settings.locationTaggingEnabled}
          onBack={() => setShowSync(false)}
          onSyncNow={syncNow}
          onPair={() => setShowPair(true)}
          onUnpair={handleUnpair}
          onOpenAccount={() => setShowAccount(true)}
          onUpgrade={startUpgrade}
          onSelectFormat={(requestedAudioFormat) =>
            updateSettings({ requestedAudioFormat })
          }
          onSelectChannels={(requestedChannels) =>
            updateSettings({ requestedChannels })
          }
          onToggleLocationTagging={(next) => void toggleLocationTagging(next)}
        />
      ) : tab === "record" ? (
        <RecordScreen
          recording={isRecording}
          busy={isBusy || storageBusyId !== null}
          clock={formatRecordingClock(isRecording ? recorder.durationMs : 0)}
          levels={meter.levels}
          syncLabel={syncPillLabel}
          syncing={canSync}
          hint={isRecording ? "Tap again to keep it" : "Tap to record"}
          meta={
            isRecording
              ? canSync
                ? "Saving locally · will sync"
                : "Saving locally"
              : `${activeLibrary.length} ${
                  activeLibrary.length === 1 ? "idea" : "ideas"
                } · ${recordingFormat}`
          }
          onToggleRecord={() => void onPressRecord()}
          onOpenSync={() => setShowSync(true)}
        />
      ) : (
        <LibraryScreen
          ideas={visibleLibrary}
          totalCount={activeLibrary.length}
          chips={chips}
          activeChip={activeChip}
          query={searchQuery}
          loading={isLoading}
          playingId={playingId}
          progress={playbackProgress}
          waveforms={waveforms}
          queuedIds={queuedIds}
          now={now}
          disabled={storageBusyId !== null}
          deletedCount={deletedIdeas.length}
          emptyState={libraryEmptyState(libraryFilter)}
          onQueryChange={setSearchQuery}
          onSelectChip={setSelectedTag}
          onPlayToggle={(idea) => void togglePlayback(idea)}
          onOpenActions={setActionsTarget}
          onOpenRecentlyDeleted={() => {
            setRecentlyDeletedAsOf(Date.now());
            setShowRecentlyDeleted(true);
          }}
          onEmptyAction={() => {
            if (libraryEmptyState(libraryFilter).action === "record") {
              setTab("record");
            } else {
              setSearchQuery("");
              setSelectedTag(ALL_CHIP_ID);
            }
          }}
        />
      )}

      {showSync ? null : (
        <TabBar active={tab} disabled={isRecording} onSelect={setTab} />
      )}

      <Toast message={toast} />

      <IdeaActionsSheet
        idea={actionsTarget}
        storageAction={
          actionsTarget ? ideaStorageAction(cloudTier, actionsTarget) : null
        }
        busy={storageBusyId !== null}
        onShare={() => runIdeaAction((idea) => void shareIdea(idea))}
        onRename={() => runIdeaAction(setRenameTarget)}
        onEditMetadata={() => runIdeaAction(setMetadataTarget)}
        onStorageAction={() =>
          runIdeaAction((idea) => void handleIdeaStorageAction(idea))
        }
        onDelete={() => runIdeaAction(confirmDelete)}
        onClose={() => setActionsTarget(null)}
      />

      <RecentlyDeletedDialog
        visible={showRecentlyDeleted}
        ideas={deletedIdeas}
        now={recentlyDeletedAsOf}
        onRestore={restoreIdea}
        onClose={() => setShowRecentlyDeleted(false)}
      />

      <RenameDialog
        visible={renameTarget !== null}
        initialName={renameTarget?.name ?? ""}
        onCancel={() => setRenameTarget(null)}
        onSubmit={submitRename}
      />

      <MetadataDialog
        visible={metadataTarget !== null}
        idea={metadataTarget}
        suggestions={metadataSuggestions}
        onCancel={() => setMetadataTarget(null)}
        onSubmit={submitMetadata}
      />

      <PairBridgeDialog
        visible={showPair}
        onCancel={() => setShowPair(false)}
        onSubmit={handlePair}
      />

      <AccountDialog
        visible={showAccount}
        account={account}
        entitlement={entitlement}
        offer={proOffer}
        storeAvailable={storeAvailable}
        onClose={closeAccountDialog}
        onLogin={login}
        onSignUp={createAccount}
        onConfirm={confirmAccount}
        onLogout={logout}
        onUpgrade={upgradeToPro}
        onManageSubscription={manageSubscription}
        onRestorePurchases={restorePurchases}
      />

      <StatusBar style="light" />
    </View>
  );
}

const styles = StyleSheet.create({
  app: {
    flex: 1,
    backgroundColor: colors.canvas,
  },
  launch: {
    flex: 1,
    backgroundColor: colors.canvas,
  },
});
