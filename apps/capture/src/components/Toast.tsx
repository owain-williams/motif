import { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import { colors, fonts, radii } from "../theme";

/**
 * A transient confirmation floating above the tab bar — "Saved", "On your
 * Bridge". It never asks for anything and never blocks a tap, because the
 * moment after a capture is exactly when the user may want to start the next
 * one.
 */
export function Toast({ message }: { message: string | null }) {
  const enter = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (message === null) return;
    enter.setValue(0);
    Animated.timing(enter, {
      toValue: 1,
      duration: 280,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start();
  }, [enter, message]);

  if (message === null) return null;

  return (
    <View style={styles.layer} pointerEvents="none">
      <Animated.View
        accessibilityLiveRegion="polite"
        style={[
          styles.toast,
          {
            opacity: enter,
            transform: [
              {
                translateY: enter.interpolate({
                  inputRange: [0, 1],
                  outputRange: [10, 0],
                }),
              },
            ],
          },
        ]}
      >
        <View style={styles.dot} />
        <Text style={styles.message}>{message}</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 110,
    alignItems: "center",
  },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingVertical: 11,
    paddingHorizontal: 16,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceFloating,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    shadowColor: "#000",
    shadowOpacity: 0.5,
    shadowRadius: 32,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: radii.pill,
    backgroundColor: colors.relay,
  },
  message: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.text,
  },
});
