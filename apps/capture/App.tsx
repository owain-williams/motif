import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import * as Sharing from "expo-sharing";
import {
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
} from "expo-audio";
import { useAudioRecorder as useStudioAudioRecorder } from "@siteed/audio-studio";
import {
  availableRecordingChannels,
  createIdea,
  formatDuration,
  insertIdea,
  normalizeIdeaName,
  removeIdea,
  renameIdea,
  recordingProfile,
  SYNC_PROTOCOL_VERSION,
} from "@motif/shared";
import type {
  DeviceIdentity,
  IdeaMetadata,
  PairingRequest,
  RecordingChannelCount,
  Tier,
} from "@motif/shared";
import {
  beginRecording,
  endRecording,
  IDLE_SESSION,
} from "./src/core/recording-session";
import { planIdeaShare } from "./src/core/idea-share";
import {
  isPaired,
  pairWithBridge,
  syncTransports,
  UNPAIRED,
  unpair,
} from "./src/core/sync-engine";
import type { PairedBridge, SyncEngineState } from "./src/core/sync-engine";
import {
  audioExtension,
  recordingConfig,
} from "./src/recording-config";
import {
  deleteIdeaAudio,
  ideaAudioUri,
  loadLibrary,
  persistRecordingAudio,
  readIdeaAudioBytes,
  saveLibrary,
  stageIdeaForShare,
} from "./src/idea-storage";
import {
  requestPairing,
  syncPendingCloudIdeas,
  syncPendingIdeas,
} from "./src/idea-sync";
import {
  clearPairedBridge,
  loadSyncState,
  savePairedBridge,
} from "./src/sync-storage";
import { LibraryRow } from "./src/components/LibraryRow";
import { RenameDialog } from "./src/components/RenameDialog";
import { PairBridgeDialog } from "./src/components/PairBridgeDialog";
import type { PairBridgeInput } from "./src/components/PairBridgeDialog";
import {
  confirmSignUp,
  loadAccount,
  setAccountTier,
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
import { AccountDialog } from "./src/components/AccountDialog";

/**
 * Capture home screen: a single record button that captures an Idea and
 * auto-saves it — no naming prompt (motif-6fu.3) — into a reverse-chronological
 * Library where each entry shows a waveform, plays on tap, and can be renamed
 * or deleted (motif-6fu.4).
 *
 * This is the thin device shell. The record/stop toggle lives in the tested
 * `src/core` recording session; naming, Idea construction, Library ordering,
 * rename/delete, and the waveform live in `@motif/shared`; persistence lives in
 * `src/idea-storage`. Everything here just wires those to the audio engine.
 */
function newIdeaId(capturedAt: number): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `${capturedAt.toString(36)}-${random}`;
}

/** How often a paired Capture retries offering pending Ideas to Bridge. */
const SYNC_INTERVAL_MS = 15_000;

/** Everything a sync pass needs: the paired Bridge, who we are, what we have. */
interface SyncInputs {
  readonly bridge: PairedBridge | null;
  readonly capture: DeviceIdentity;
  readonly library: IdeaMetadata[];
  readonly tier: Tier;
  readonly idToken: string | null;
}

export default function App() {
  const [account, setAccount] = useState<AccountSession>(ANONYMOUS_ACCOUNT);
  const [requestedChannels, setRequestedChannels] =
    useState<RecordingChannelCount>(1);
  const tier = effectiveAccountTier(account);
  const channelChoices = availableRecordingChannels(tier);
  const profile = recordingProfile(tier, requestedChannels);
  const recorder = useStudioAudioRecorder();
  const sessionRef = useRef(IDLE_SESSION);
  const activeRecordingProfileRef = useRef(profile);

  const player = useAudioPlayer();
  const playerStatus = useAudioPlayerStatus(player);

  const [library, setLibrary] = useState<IdeaMetadata[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRecording, setIsRecording] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<IdeaMetadata | null>(null);
  const [syncState, setSyncState] = useState<SyncEngineState>(UNPAIRED);
  const [captureIdentity, setCaptureIdentity] = useState<DeviceIdentity | null>(null);
  const [showPair, setShowPair] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [showAccount, setShowAccount] = useState(false);
  const authTokensRef = useRef<AuthTokens | null>(null);
  // Latest sync inputs, so the periodic timer always offers the current Library.
  const syncInputsRef = useRef<SyncInputs | null>(null);

  useEffect(() => {
    let active = true;
    loadLibrary()
      .then((ideas) => {
        if (active) setLibrary(ideas);
      })
      .catch(() => {
        // A missing/corrupt manifest just means an empty Library.
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

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

  // Runs every path the tier allows. LAN remains preferred and independent:
  // a local failure never prevents a paid account from reaching cloud relay.
  const runSync = useCallback(async (inputs: SyncInputs) => {
    const transports = syncTransports(inputs.tier, inputs.bridge !== null);
    const readAudio = (idea: IdeaMetadata) =>
      readIdeaAudioBytes(idea.id, audioExtension(idea.audioFormat));
    const statuses: string[] = [];

    if (transports.includes("local-network") && inputs.bridge) {
      try {
        const synced = await syncPendingIdeas({
          endpoint: inputs.bridge.endpoint,
          capture: inputs.capture,
          library: inputs.library,
          readAudio,
        });
        statuses.push(
          synced.length > 0
            ? `${synced.length} to ${inputs.bridge.displayName}`
            : `${inputs.bridge.displayName} up to date`,
        );
      } catch {
        statuses.push(`${inputs.bridge.displayName} offline`);
      }
    }

    if (transports.includes("cloud-relay") && inputs.idToken) {
      try {
        const synced = await syncPendingCloudIdeas({
          idToken: inputs.idToken,
          capture: inputs.capture,
          library: inputs.library,
          readAudio,
        });
        statuses.push(synced.length > 0 ? `${synced.length} via cloud` : "Cloud up to date");
      } catch {
        statuses.push("Cloud unavailable");
      }
    }

    setSyncStatus(statuses.join(" · ") || null);
  }, []);

  // Keep the timer's inputs current without re-arming it on every keystroke.
  useEffect(() => {
    syncInputsRef.current = captureIdentity
      ? {
          bridge: syncState.pairedBridge,
          capture: captureIdentity,
          library,
          tier,
          idToken: authTokensRef.current?.idToken ?? null,
        }
      : null;
  }, [syncState.pairedBridge, captureIdentity, library, tier, account]);

  // Sync now and on an interval whenever LAN or paid cloud relay is available.
  useEffect(() => {
    if (!captureIdentity) return;
    if (syncTransports(tier, syncState.pairedBridge !== null).length === 0) return;
    const tick = () => {
      const inputs = syncInputsRef.current;
      if (inputs) void runSync(inputs);
    };
    tick();
    const timer = setInterval(tick, SYNC_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [syncState.pairedBridge, captureIdentity, tier, account, runSync]);

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
    await persistRecordingAudio(
      uri,
      id,
      audioExtension(recordingProfileUsed.audioFormat),
    );
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
    // Nudge the new Idea to Bridge right away if paired (copy semantics — the
    // Capture-side Idea just saved stays put); the interval is the fallback.
    if (captureIdentity) {
      void runSync({
        bridge: syncState.pairedBridge,
        capture: captureIdentity,
        library: next,
        tier,
        idToken: authTokensRef.current?.idToken ?? null,
      });
    }
  }

  async function onPressRecord() {
    if (isBusy) return;
    setIsBusy(true);
    try {
      if (isRecording) {
        await stopRecording();
      } else {
        await startRecording();
      }
    } catch (error) {
      setIsRecording(false);
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
    const next = renameIdea(library, target.id, name);
    saveLibrary(next);
    setLibrary(next);
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
        tier,
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
  }

  async function login(email: string, password: string) {
    const tokens = await signIn(email, password);
    const profile = await loadAccount(tokens.idToken);
    await saveAuthTokens(tokens);
    authTokensRef.current = tokens;
    setAccount(authenticatedAccount(profile));
    setShowAccount(false);
  }

  async function createAccount(email: string, password: string) {
    await signUp(email, password);
  }

  async function confirmAccount(email: string, code: string, password: string) {
    await confirmSignUp(email, code);
    await login(email, password);
  }

  async function changeTier(tier: Tier) {
    const tokens = authTokensRef.current;
    if (!tokens) throw new Error("Please log in again.");
    const profile = await setAccountTier(tokens.idToken, tier);
    setAccount(authenticatedAccount(profile));
  }

  async function logout() {
    await clearAuthTokens();
    authTokensRef.current = null;
    setAccount(ANONYMOUS_ACCOUNT);
    setShowAccount(false);
  }

  function confirmDelete(idea: IdeaMetadata) {
    Alert.alert("Delete idea?", `"${idea.name}" will be permanently deleted.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          stopPlaybackIfPlaying(idea.id);
          deleteIdeaAudio(idea.id, audioExtension(idea.audioFormat));
          const next = removeIdea(library, idea.id);
          saveLibrary(next);
          setLibrary(next);
        },
      },
    ]);
  }

  return (
    <View style={styles.container}>
      <Text style={styles.brand}>Motif</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Account"
        onPress={() => setShowAccount(true)}
        disabled={isRecording}
        style={styles.accountButton}
      >
        <Text style={styles.accountText} numberOfLines={1}>
          {account.kind === "authenticated"
            ? `${account.email} · ${account.tier}`
            : "Free · Log in or create account"}
        </Text>
      </Pressable>

      <View style={styles.recordArea}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isRecording ? "Stop recording" : "Start recording"}
          onPress={onPressRecord}
          disabled={isBusy}
          style={({ pressed }) => [
            styles.recordButton,
            isRecording && styles.recordButtonActive,
            pressed && styles.recordButtonPressed,
          ]}
        >
          <View style={isRecording ? styles.stopIcon : styles.recordIcon} />
        </Pressable>
        <Text style={styles.recordHint}>
          {isRecording
            ? formatDuration(recorder.durationMs)
            : "Tap to capture an idea"}
        </Text>
        <Text style={styles.recordingFormat}>
          {profile.audioFormat === "wav" ? "Uncompressed WAV" : "Compressed AAC"}
          {" · "}
          {profile.channels === 2 ? "Stereo" : "Mono"}
        </Text>
        {channelChoices.length > 1 ? (
          <View style={styles.channelChoices}>
            {channelChoices.map((channels) => (
              <Pressable
                key={channels}
                accessibilityRole="button"
                accessibilityLabel={channels === 1 ? "Record in mono" : "Record in stereo"}
                disabled={isRecording || isBusy}
                onPress={() => setRequestedChannels(channels)}
                style={[
                  styles.channelChoice,
                  profile.channels === channels && styles.channelChoiceActive,
                ]}
              >
                <Text style={styles.channelChoiceText}>
                  {channels === 1 ? "Mono" : "Stereo"}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>

      <View style={styles.syncRow}>
        <View style={styles.syncInfo}>
          <Text style={styles.syncTitle}>
            {isPaired(syncState) && syncState.pairedBridge
              ? `Paired · ${syncState.pairedBridge.displayName}`
              : "Not paired with Bridge"}
          </Text>
          {syncStatus ? (
            <Text style={styles.syncStatus} numberOfLines={1}>
              {syncStatus}
            </Text>
          ) : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isPaired(syncState) ? "Unpair Bridge" : "Pair with Bridge"}
          onPress={isPaired(syncState) ? handleUnpair : () => setShowPair(true)}
          style={styles.syncButton}
        >
          <Text style={styles.syncButtonLabel}>
            {isPaired(syncState) ? "Unpair" : "Pair"}
          </Text>
        </Pressable>
      </View>

      <View style={styles.library}>
        <Text style={styles.libraryHeading}>Library</Text>
        {isLoading ? (
          <ActivityIndicator color="#8a8a92" style={styles.libraryLoading} />
        ) : library.length === 0 ? (
          <Text style={styles.empty}>No ideas yet. Tap the button to record one.</Text>
        ) : (
          <FlatList
            data={library}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => (
              <LibraryRow
                idea={item}
                isPlaying={playingId === item.id}
                onPlayToggle={() => togglePlayback(item)}
                onShare={() => shareIdea(item)}
                onRename={() => setRenameTarget(item)}
                onDelete={() => confirmDelete(item)}
              />
            )}
          />
        )}
      </View>

      <RenameDialog
        visible={renameTarget !== null}
        initialName={renameTarget?.name ?? ""}
        onCancel={() => setRenameTarget(null)}
        onSubmit={submitRename}
      />

      <PairBridgeDialog
        visible={showPair}
        onCancel={() => setShowPair(false)}
        onSubmit={handlePair}
      />

      <AccountDialog
        visible={showAccount}
        account={account}
        onClose={() => setShowAccount(false)}
        onLogin={login}
        onSignUp={createAccount}
        onConfirm={confirmAccount}
        onSetTier={changeTier}
        onLogout={logout}
      />

      <StatusBar style="light" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0b0b0f",
    paddingTop: 72,
    paddingHorizontal: 20,
  },
  brand: {
    color: "#f5f5f7",
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center",
  },
  accountButton: {
    alignSelf: "center",
    marginTop: 10,
    paddingVertical: 7,
    paddingHorizontal: 12,
    maxWidth: "100%",
    borderRadius: 16,
    backgroundColor: "#16161c",
  },
  accountText: {
    color: "#a0a0a8",
    fontSize: 12,
    textTransform: "capitalize",
  },
  recordArea: {
    alignItems: "center",
    paddingVertical: 28,
  },
  recordButton: {
    width: 132,
    height: 132,
    borderRadius: 66,
    backgroundColor: "#e5484d",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#e5484d",
    shadowOpacity: 0.5,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 0 },
  },
  recordButtonActive: {
    backgroundColor: "#3a1315",
    borderWidth: 2,
    borderColor: "#e5484d",
  },
  recordButtonPressed: {
    opacity: 0.85,
  },
  recordIcon: {
    width: 108,
    height: 108,
    borderRadius: 54,
    borderWidth: 4,
    borderColor: "rgba(255,255,255,0.85)",
  },
  stopIcon: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: "#e5484d",
  },
  recordHint: {
    color: "#8a8a92",
    fontSize: 15,
    marginTop: 20,
    fontVariant: ["tabular-nums"],
  },
  recordingFormat: {
    color: "#686872",
    fontSize: 12,
    marginTop: 8,
  },
  channelChoices: {
    flexDirection: "row",
    gap: 8,
    marginTop: 12,
  },
  channelChoice: {
    borderRadius: 8,
    backgroundColor: "#22222a",
    paddingVertical: 7,
    paddingHorizontal: 16,
  },
  channelChoiceActive: {
    backgroundColor: "#9d3035",
  },
  channelChoiceText: {
    color: "#f5f5f7",
    fontSize: 13,
    fontWeight: "600",
  },
  syncRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 16,
    backgroundColor: "#16161c",
    borderRadius: 12,
  },
  syncInfo: {
    flex: 1,
  },
  syncTitle: {
    color: "#f5f5f7",
    fontSize: 14,
    fontWeight: "600",
  },
  syncStatus: {
    color: "#8a8a92",
    fontSize: 12,
    marginTop: 2,
  },
  syncButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: "#22222a",
  },
  syncButtonLabel: {
    color: "#f5f5f7",
    fontSize: 14,
    fontWeight: "600",
  },
  library: {
    flex: 1,
  },
  libraryHeading: {
    color: "#f5f5f7",
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 8,
  },
  libraryLoading: {
    marginTop: 24,
  },
  empty: {
    color: "#5a5a62",
    fontSize: 14,
    marginTop: 8,
  },
  listContent: {
    paddingBottom: 24,
  },
});
