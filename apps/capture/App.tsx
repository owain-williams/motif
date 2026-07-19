import { useEffect, useRef, useState } from "react";
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
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import {
  createIdea,
  formatDuration,
  insertIdea,
  normalizeIdeaName,
  removeIdea,
  renameIdea,
} from "@motif/shared";
import type { IdeaMetadata } from "@motif/shared";
import {
  beginRecording,
  endRecording,
  IDLE_SESSION,
} from "./src/core/recording-session";
import { planIdeaShare } from "./src/core/idea-share";
import {
  AUDIO_CHANNELS,
  AUDIO_EXTENSION,
  AUDIO_FORMAT,
  audioExtension,
  RECORDING_OPTIONS,
} from "./src/recording-config";
import {
  deleteIdeaAudio,
  ideaAudioUri,
  loadLibrary,
  persistRecordingAudio,
  saveLibrary,
  stageIdeaForShare,
} from "./src/idea-storage";
import { LibraryRow } from "./src/components/LibraryRow";
import { RenameDialog } from "./src/components/RenameDialog";

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

export default function App() {
  const recorder = useAudioRecorder(RECORDING_OPTIONS);
  const recorderState = useAudioRecorderState(recorder);
  const sessionRef = useRef(IDLE_SESSION);

  const player = useAudioPlayer();
  const playerStatus = useAudioPlayerStatus(player);

  const [library, setLibrary] = useState<IdeaMetadata[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRecording, setIsRecording] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<IdeaMetadata | null>(null);

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

  // Clear the "playing" highlight once playback reaches the end.
  useEffect(() => {
    if (playerStatus.didJustFinish) setPlayingId(null);
  }, [playerStatus.didJustFinish]);

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
    await recorder.prepareToRecordAsync();
    recorder.record();
    sessionRef.current = beginRecording(IDLE_SESSION, Date.now());
    setIsRecording(true);
  }

  async function stopRecording() {
    // Read the engine's encoded length before stopping — this is the Idea's
    // true duration, and matches the live timer the user just watched. `stop()`
    // finalizes the file, so measuring after it would add finalization latency.
    const durationMs = Math.max(0, Math.round(recorder.currentTime * 1000));
    await recorder.stop();
    const { session, startedAt } = endRecording(sessionRef.current);
    sessionRef.current = session;
    setIsRecording(false);

    const uri = recorder.uri;
    if (!uri) {
      Alert.alert("Recording failed", "The capture could not be saved.");
      return;
    }

    const id = newIdeaId(startedAt);
    await persistRecordingAudio(uri, id, AUDIO_EXTENSION);
    const idea = createIdea({
      id,
      capturedAt: startedAt,
      durationMs,
      audioFormat: AUDIO_FORMAT,
      channels: AUDIO_CHANNELS,
    });
    // Recordings are sequential (the button is disabled mid-capture), so the
    // captured `library` is current. Persist outside the state updater — updaters
    // must stay pure (React may invoke them twice).
    const next = insertIdea(library, idea);
    saveLibrary(next);
    setLibrary(next);
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
            ? formatDuration(recorderState.durationMillis)
            : "Tap to capture an idea"}
        </Text>
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
  recordArea: {
    alignItems: "center",
    paddingVertical: 40,
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
