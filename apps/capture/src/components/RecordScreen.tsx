import { useEffect, useRef } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, fonts, radii, SCREEN_TOP_INSET, TAB_BAR_HEIGHT } from "../theme";
import { LevelMeter } from "./LevelMeter";
import { RecordButton } from "./RecordButton";

/**
 * The home screen: a clock, a level meter, and the record button. Everything
 * else on it is status — nothing here can be configured, because the point is
 * that the first tap after opening the app starts a recording.
 *
 * Presentational: the recorder, the clock's value and the sync state are all
 * passed in.
 */

export function RecordScreen({
  recording,
  busy,
  clock,
  levels,
  syncLabel,
  syncing,
  hint,
  meta,
  onToggleRecord,
  onOpenSync,
}: {
  recording: boolean;
  /** A capture is starting or being saved — the button must not be tapped again. */
  busy: boolean;
  clock: string;
  levels: readonly number[];
  syncLabel: string;
  /** Whether a sync path exists at all; a dead path shouldn't read as live. */
  syncing: boolean;
  hint: string;
  meta: string;
  onToggleRecord: () => void;
  onOpenSync: () => void;
}) {
  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.brand}>MOTIF</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Sync — ${syncLabel}`}
          onPress={onOpenSync}
          disabled={recording}
          style={({ pressed }) => [styles.syncPill, pressed && styles.pressed]}
        >
          <View
            style={[
              styles.syncDot,
              { backgroundColor: syncing ? colors.relay : colors.textInactive },
            ]}
          />
          <Text style={styles.syncLabel}>{syncLabel}</Text>
        </Pressable>
      </View>

      <View style={styles.stage}>
        <View style={styles.clockBlock}>
          <View style={styles.recordingFlag}>
            {recording ? <RecordingFlag /> : null}
          </View>
          <Text
            style={[styles.clock, recording ? styles.clockLive : styles.clockIdle]}
            accessibilityLabel={recording ? `Recording, ${clock}` : undefined}
          >
            {clock}
          </Text>
        </View>

        <LevelMeter levels={levels} active={recording} />

        <RecordButton
          recording={recording}
          disabled={busy}
          onPress={onToggleRecord}
        />

        <View style={styles.hintBlock}>
          <Text style={styles.hint}>{hint}</Text>
          <Text style={styles.meta}>{meta}</Text>
        </View>
      </View>
    </View>
  );
}

/** The blinking "RECORDING" flag — the screen's one piece of live chrome. */
function RecordingFlag() {
  const blink = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(blink, {
          toValue: 0.2,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(blink, {
          toValue: 1,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [blink]);

  return (
    <Animated.View style={[styles.flag, { opacity: blink }]}>
      <View style={styles.flagDot} />
      <Text style={styles.flagLabel}>RECORDING</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    paddingTop: SCREEN_TOP_INSET,
    paddingBottom: TAB_BAR_HEIGHT,
    backgroundColor: colors.canvas,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
  },
  brand: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 12,
    letterSpacing: 2.6,
    color: colors.text,
  },
  syncPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingVertical: 6,
    paddingLeft: 9,
    paddingRight: 11,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pressed: {
    opacity: 0.7,
  },
  syncDot: {
    width: 6,
    height: 6,
    borderRadius: radii.pill,
  },
  syncLabel: {
    fontFamily: fonts.mono,
    fontSize: 10.5,
    letterSpacing: 0.6,
    color: colors.textMuted,
  },
  stage: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 34,
    paddingHorizontal: 24,
  },
  clockBlock: {
    alignItems: "center",
    gap: 14,
  },
  recordingFlag: {
    height: 16,
    justifyContent: "center",
  },
  flag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  flagDot: {
    width: 7,
    height: 7,
    borderRadius: radii.pill,
    backgroundColor: colors.signal,
  },
  flagLabel: {
    fontFamily: fonts.mono,
    fontSize: 10.5,
    letterSpacing: 1.9,
    color: colors.signal,
  },
  clock: {
    fontFamily: fonts.mono,
    fontSize: 46,
    fontVariant: ["tabular-nums"],
  },
  clockLive: {
    color: colors.text,
  },
  clockIdle: {
    color: colors.textIdle,
  },
  hintBlock: {
    alignItems: "center",
    gap: 6,
    height: 38,
  },
  hint: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.textMuted,
  },
  meta: {
    fontFamily: fonts.mono,
    fontSize: 10.5,
    letterSpacing: 0.6,
    color: colors.textFaint,
    textAlign: "center",
  },
});
