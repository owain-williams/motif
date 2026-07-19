import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { formatDuration, syntheticWaveform } from "@motif/shared";
import type { IdeaMetadata } from "@motif/shared";
import { Waveform } from "./Waveform";

/**
 * One Library entry: a waveform alongside the Idea's name and duration, with
 * playback on tap and rename/delete affordances. Purely presentational — all
 * state and side effects are the parent's (App) job.
 */
export function LibraryRow({
  idea,
  isPlaying,
  onPlayToggle,
  onRename,
  onDelete,
}: {
  idea: IdeaMetadata;
  isPlaying: boolean;
  onPlayToggle: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const bars = useMemo(() => syntheticWaveform(idea.id), [idea.id]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={isPlaying ? `Pause ${idea.name}` : `Play ${idea.name}`}
      onPress={onPlayToggle}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      <View style={styles.header}>
        <Text style={[styles.name, isPlaying && styles.namePlaying]} numberOfLines={1}>
          {isPlaying ? "❚❚ " : "▶ "}
          {idea.name}
        </Text>
        <Text style={styles.duration}>{formatDuration(idea.durationMs)}</Text>
      </View>

      <Waveform bars={bars} color={isPlaying ? "#e5484d" : "#3a3a44"} />

      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Rename ${idea.name}`}
          onPress={onRename}
          hitSlop={8}
          style={styles.action}
        >
          <Text style={styles.actionLabel}>Rename</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Delete ${idea.name}`}
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
