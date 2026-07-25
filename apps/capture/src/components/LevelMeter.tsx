import { StyleSheet, View } from "react-native";
import { colors } from "../theme";

/**
 * The live loudness window above the record button. Purely presentational: it
 * renders the bar heights `src/core/level-meter` maintains and knows nothing
 * about the recorder.
 *
 * Idle bars stay at their minimum height rather than collapsing, so the meter
 * reads as a waiting instrument rather than a rendering glitch.
 */

const METER_HEIGHT = 96;
const MIN_BAR_HEIGHT = 4;

export function LevelMeter({
  levels,
  active,
}: {
  levels: readonly number[];
  active: boolean;
}) {
  return (
    <View style={styles.container} accessibilityElementsHidden>
      {levels.map((level, index) => (
        <View
          // Bars are positional and never reordered, so the index is a stable key.
          key={index}
          style={[
            styles.bar,
            {
              height: active
                ? Math.max(MIN_BAR_HEIGHT, Math.round(level * (METER_HEIGHT - 8)))
                : MIN_BAR_HEIGHT,
              backgroundColor: active ? colors.signal : colors.meterIdle,
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: METER_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  bar: {
    width: 3,
    borderRadius: 2,
  },
});
