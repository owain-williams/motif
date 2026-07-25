import { StyleSheet, View } from "react-native";

/**
 * Renders waveform bars for a Library entry (CONTEXT.md: every entry shows a
 * waveform). Heights are normalized values in [0, 1]; this component is purely
 * presentational and knows nothing about whether they came from audio analysis
 * or the compatibility fallback.
 *
 * While an Idea plays, the same bars are the progress indicator — the bars
 * behind the playhead take `activeColor`, so the row needs no second element to
 * say where playback has reached.
 */

export function Waveform({
  bars,
  color,
  activeColor,
  progress = 0,
  height = 18,
}: {
  bars: readonly number[];
  color: string;
  /** Colour for bars already played; defaults to `color` (no playhead shown). */
  activeColor?: string;
  /** Playback position in [0, 1]. */
  progress?: number;
  height?: number;
}) {
  const played = Math.round(Math.min(1, Math.max(0, progress)) * bars.length);
  return (
    <View style={[styles.container, { height }]} accessibilityElementsHidden>
      {bars.map((bar, index) => (
        <View
          // Bars are positional and never reordered, so the index is a stable key.
          key={index}
          style={[
            styles.bar,
            {
              height: Math.max(2, bar * height),
              backgroundColor: index < played ? (activeColor ?? color) : color,
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  bar: {
    flex: 1,
    borderRadius: 1.5,
  },
});
