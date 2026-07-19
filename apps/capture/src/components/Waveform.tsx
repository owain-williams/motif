import { StyleSheet, View } from "react-native";

/**
 * Renders waveform bars for a Library entry. Heights are values in (0, 1]
 * (see `syntheticWaveform` in `@motif/shared`); this component is purely
 * presentational — it knows nothing about where the heights came from.
 */
const WAVEFORM_HEIGHT = 40;

export function Waveform({
  bars,
  color,
}: {
  bars: readonly number[];
  color: string;
}) {
  return (
    <View style={styles.container} accessibilityElementsHidden>
      {bars.map((height, index) => (
        <View
          // Bars are positional and never reordered, so the index is a stable key.
          key={index}
          style={[
            styles.bar,
            { height: Math.max(2, height * WAVEFORM_HEIGHT), backgroundColor: color },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: WAVEFORM_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  bar: {
    flex: 1,
    borderRadius: 1.5,
  },
});
