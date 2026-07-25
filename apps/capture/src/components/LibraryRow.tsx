import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { formatDuration } from "@motif/shared";
import type { IdeaMetadata } from "@motif/shared";
import { ideaWaveform } from "../core/idea-waveform";
import { formatCapturedAt } from "../core/capture-time";
import { colors, fonts, radii } from "../theme";
import { CloudIcon, MoreIcon, PauseIcon, PlayIcon, QueuedIcon } from "./Icon";
import { Waveform } from "./Waveform";

/**
 * One Library entry: play control, name, and a metadata line that says how long
 * the Idea is, when it was captured, what it's tagged with and whether it has
 * reached another device yet. Its waveform doubles as the playback position.
 *
 * Everything past playing is behind the row's actions button, so a Library
 * scrolls as a list of Ideas rather than a list of controls. Purely
 * presentational — all state and side effects are App's job.
 */

/** How many Tags a row shows before it stops competing with the name. */
const VISIBLE_TAGS = 2;

export function LibraryRow({
  idea,
  isPlaying,
  progress,
  queued,
  waveformPeaks,
  now,
  disabled,
  onPlayToggle,
  onOpenActions,
}: {
  idea: IdeaMetadata;
  isPlaying: boolean;
  /** Playback position in [0, 1]; only meaningful while playing. */
  progress: number;
  /** Still waiting to reach a paired device. */
  queued: boolean;
  waveformPeaks?: readonly number[];
  /** The instant to read "Today"/"Yesterday" against. */
  now: number;
  disabled: boolean;
  onPlayToggle: () => void;
  onOpenActions: () => void;
}) {
  const bars = useMemo(
    () => ideaWaveform(idea.id, waveformPeaks),
    [idea.id, waveformPeaks],
  );
  const captured = useMemo(
    () => formatCapturedAt(idea.capturedAt, now),
    [idea.capturedAt, now],
  );
  const offloaded = idea.storageState === "offloaded";
  const tags = idea.tags.slice(0, VISIBLE_TAGS);
  const overflowTags = idea.tags.length - tags.length;

  return (
    <View style={[styles.row, isPlaying && styles.rowPlaying]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          offloaded
            ? `${idea.name}, cloud only`
            : isPlaying
              ? `Pause ${idea.name}`
              : `Play ${idea.name}`
        }
        accessibilityState={{ disabled: disabled || offloaded }}
        disabled={disabled || offloaded}
        onPress={onPlayToggle}
        style={({ pressed }) => [
          styles.play,
          isPlaying && styles.playActive,
          pressed && styles.pressed,
        ]}
      >
        {offloaded ? (
          <CloudIcon />
        ) : isPlaying ? (
          <PauseIcon />
        ) : (
          <PlayIcon />
        )}
      </Pressable>

      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>
          {idea.name}
        </Text>

        <View style={styles.meta}>
          <Text style={styles.duration}>{formatDuration(idea.durationMs)}</Text>
          <View style={styles.metaDot} />
          <Text style={styles.captured}>{captured}</Text>
          {tags.map((tag) => (
            <View key={tag} style={styles.tag}>
              <Text style={styles.tagText} numberOfLines={1}>
                {tag}
              </Text>
            </View>
          ))}
          {overflowTags > 0 ? (
            <Text style={styles.captured}>{`+${overflowTags}`}</Text>
          ) : null}
          {queued ? (
            <View accessibilityLabel="Waiting to sync">
              <QueuedIcon />
            </View>
          ) : null}
        </View>

        <Waveform
          bars={bars}
          color={isPlaying ? colors.borderStrong : colors.border}
          activeColor={colors.signal}
          progress={isPlaying ? progress : 0}
        />
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Actions for ${idea.name}`}
        disabled={disabled}
        onPress={onOpenActions}
        style={({ pressed }) => [styles.more, pressed && styles.pressed]}
      >
        <MoreIcon />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 13,
    paddingHorizontal: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  rowPlaying: {
    backgroundColor: colors.surfaceHighlight,
  },
  play: {
    width: 38,
    height: 38,
    borderRadius: radii.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  playActive: {
    backgroundColor: colors.signalSoft,
    borderColor: colors.signal,
  },
  pressed: {
    opacity: 0.6,
  },
  body: {
    flex: 1,
    minWidth: 0,
    gap: 6,
  },
  name: {
    fontFamily: fonts.sansMedium,
    fontSize: 15,
    color: colors.text,
  },
  meta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  duration: {
    fontFamily: fonts.mono,
    fontSize: 11,
    color: colors.textDim,
    fontVariant: ["tabular-nums"],
  },
  metaDot: {
    width: 3,
    height: 3,
    borderRadius: radii.pill,
    backgroundColor: colors.textIdle,
  },
  captured: {
    fontFamily: fonts.mono,
    fontSize: 11,
    color: colors.textFaint,
  },
  tag: {
    maxWidth: 96,
    paddingVertical: 2,
    paddingHorizontal: 7,
    borderRadius: radii.tag,
    backgroundColor: colors.surfaceActive,
  },
  tagText: {
    fontFamily: fonts.mono,
    fontSize: 10,
    color: colors.textMuted,
  },
  more: {
    width: 44,
    height: 44,
    marginVertical: -8,
    marginRight: -10,
    alignItems: "center",
    justifyContent: "center",
  },
});
