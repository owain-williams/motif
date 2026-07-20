import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { formatDuration, ideaMetadataLabels } from "@motif/shared";
import type { IdeaMetadata } from "@motif/shared";
import type { IdeaStorageAction } from "../core/sync-engine";
import { ideaWaveform } from "../core/idea-waveform";
import { Waveform } from "./Waveform";

/**
 * One Library entry: a waveform alongside the Idea's name and duration, with
 * playback on tap and rename/delete affordances. Purely presentational — all
 * state and side effects are the parent's (App) job.
 */
export function LibraryRow({
  idea,
  isPlaying,
  waveformPeaks,
  onPlayToggle,
  storageAction,
  disabled,
  onShare,
  onStorageAction,
  onRename,
  onEditMetadata,
  onDelete,
}: {
  idea: IdeaMetadata;
  isPlaying: boolean;
  waveformPeaks?: readonly number[];
  storageAction: IdeaStorageAction | null;
  disabled: boolean;
  onPlayToggle: () => void;
  onShare: () => void;
  onStorageAction: () => void;
  onRename: () => void;
  onEditMetadata: () => void;
  onDelete: () => void;
}) {
  const bars = useMemo(
    () => ideaWaveform(idea.id, waveformPeaks),
    [idea.id, waveformPeaks],
  );

  const metadataSummary = useMemo(() => ideaMetadataLabels(idea), [idea]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        idea.storageState === "offloaded"
          ? `${idea.name}, cloud only`
          : isPlaying
            ? `Pause ${idea.name}`
            : `Play ${idea.name}`
      }
      disabled={disabled}
      onPress={idea.storageState === "on-device" ? onPlayToggle : undefined}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      <View style={styles.header}>
        <Text style={[styles.name, isPlaying && styles.namePlaying]} numberOfLines={1}>
          {idea.storageState === "offloaded" ? "☁ " : isPlaying ? "❚❚ " : "▶ "}
          {idea.name}
        </Text>
        <Text style={styles.duration}>{formatDuration(idea.durationMs)}</Text>
      </View>

      <Waveform bars={bars} color={isPlaying ? "#e5484d" : "#3a3a44"} />

      {metadataSummary.length > 0 ? (
        <View style={styles.chips}>
          {metadataSummary.map((label, index) => (
            <View key={`${label}-${index}`} style={styles.chip}>
              <Text style={styles.chipText} numberOfLines={1}>
                {label}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.actions}>
        {idea.storageState === "on-device" ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Share ${idea.name}`}
            disabled={disabled}
            onPress={onShare}
            hitSlop={8}
            style={styles.action}
          >
            <Text style={styles.actionLabel}>Share</Text>
          </Pressable>
        ) : null}
        {storageAction ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${storageAction === "offload" ? "Offload" : "Redownload"} ${idea.name}`}
            disabled={disabled}
            onPress={onStorageAction}
            hitSlop={8}
            style={styles.action}
          >
            <Text style={styles.actionLabel}>
              {storageAction === "offload" ? "Offload" : "Redownload"}
            </Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Rename ${idea.name}`}
          disabled={disabled}
          onPress={onRename}
          hitSlop={8}
          style={styles.action}
        >
          <Text style={styles.actionLabel}>Rename</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Edit tags for ${idea.name}`}
          disabled={disabled}
          onPress={onEditMetadata}
          hitSlop={8}
          style={styles.action}
        >
          <Text style={styles.actionLabel}>Tags</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Delete ${idea.name}`}
          disabled={disabled}
          onPress={onDelete}
          hitSlop={8}
          style={styles.action}
        >
          <Text style={styles.deleteLabel}>Delete</Text>
        </Pressable>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#1c1c22",
  },
  cardPressed: {
    opacity: 0.7,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  name: {
    color: "#f5f5f7",
    fontSize: 15,
    flexShrink: 1,
    marginRight: 12,
  },
  namePlaying: {
    color: "#e5484d",
  },
  duration: {
    color: "#8a8a92",
    fontSize: 14,
    fontVariant: ["tabular-nums"],
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 10,
  },
  chip: {
    backgroundColor: "#20202a",
    borderRadius: 12,
    paddingVertical: 3,
    paddingHorizontal: 10,
    maxWidth: "100%",
  },
  chipText: {
    color: "#b9b9c4",
    fontSize: 12,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 18,
    marginTop: 10,
  },
  action: {
    paddingVertical: 2,
  },
  actionLabel: {
    color: "#8a8a92",
    fontSize: 13,
    fontWeight: "500",
  },
  deleteLabel: {
    color: "#e5484d",
    fontSize: 13,
    fontWeight: "500",
  },
});
