import { useEffect, useRef } from "react";
import { Animated, Easing, Pressable, StyleSheet, View } from "react-native";
import { colors, radii } from "../theme";

/**
 * The one control the app is really about: a circle that starts a capture and,
 * once running, becomes a square that keeps it.
 *
 * The morph is the feedback — there is no separate stop button to find — and
 * the ring pulsing out of it is the only thing on the screen that says "this is
 * live" from across a room. Both stop dead when recording stops.
 */

const BUTTON_SIZE = 168;
const IDLE_CORE = 112;
const RECORDING_CORE = 60;

export function RecordButton({
  recording,
  disabled,
  onPress,
}: {
  recording: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  // 0 = idle circle, 1 = recording square. One value drives the whole morph so
  // the core can never be caught half-way between two shapes.
  const morph = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(morph, {
      toValue: recording ? 1 : 0,
      duration: 220,
      easing: Easing.bezier(0.2, 0.8, 0.2, 1),
      // Size and corner radius are layout properties; the native driver only
      // animates transform and opacity, so this one stays on the JS thread.
      useNativeDriver: false,
    }).start();
  }, [morph, recording]);

  useEffect(() => {
    if (!recording) {
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(pulse, {
        toValue: 1,
        duration: 1800,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, recording]);

  const coreSize = morph.interpolate({
    inputRange: [0, 1],
    outputRange: [IDLE_CORE, RECORDING_CORE],
  });

  return (
    <View style={styles.container}>
      {recording ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.ring,
            {
              opacity: pulse.interpolate({
                inputRange: [0, 0.7, 1],
                outputRange: [0.55, 0, 0],
              }),
              transform: [
                {
                  scale: pulse.interpolate({
                    inputRange: [0, 0.7, 1],
                    outputRange: [1, 1.22, 1.22],
                  }),
                },
              ],
            },
          ]}
        />
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={recording ? "Stop recording" : "Start recording"}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => [
          styles.button,
          recording ? styles.buttonRecording : styles.buttonIdle,
          pressed && styles.buttonPressed,
          disabled && styles.buttonDisabled,
        ]}
      >
        <Animated.View
          style={[
            styles.core,
            !recording && styles.coreGlow,
            {
              width: coreSize,
              height: coreSize,
              borderRadius: morph.interpolate({
                inputRange: [0, 1],
                outputRange: [IDLE_CORE / 2, radii.control],
              }),
            },
          ]}
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
  },
  ring: {
    position: "absolute",
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.signal,
  },
  button: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: radii.pill,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  buttonIdle: {
    backgroundColor: colors.surface,
    borderColor: colors.borderStrong,
  },
  buttonRecording: {
    backgroundColor: colors.signalFaint,
    borderColor: colors.signal,
  },
  buttonPressed: {
    transform: [{ scale: 0.97 }],
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  core: {
    backgroundColor: colors.signal,
  },
  coreGlow: {
    shadowColor: colors.signal,
    shadowOpacity: 0.35,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 0 },
  },
});
