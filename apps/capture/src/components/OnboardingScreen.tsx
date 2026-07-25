import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, fonts, radii } from "../theme";
import { ONBOARDING_STEPS } from "../core/onboarding";
import type { OnboardingStep } from "../core/onboarding";

/**
 * The three first-run cards. Presentational — which card is showing, and what
 * finishing means, is App's business.
 */
export function OnboardingScreen({
  index,
  step,
  onNext,
  onSkip,
}: {
  index: number;
  step: OnboardingStep;
  onNext: () => void;
  onSkip: () => void;
}) {
  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.brand}>MOTIF</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Skip introduction"
          onPress={onSkip}
          hitSlop={12}
        >
          <Text style={styles.skip}>Skip</Text>
        </Pressable>
      </View>

      <View style={styles.body}>
        <View style={styles.art}>
          {step.art === "disc" ? <Disc /> : <Horizon />}
        </View>
        <Text style={styles.title}>{step.title}</Text>
        <Text style={styles.copy}>{step.body}</Text>
      </View>

      <View style={styles.footer}>
        <View style={styles.dots} accessibilityElementsHidden>
          {ONBOARDING_STEPS.map((_, dot) => (
            <View
              key={dot}
              style={[styles.dot, dot === index ? styles.dotActive : styles.dotIdle]}
            />
          ))}
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={onNext}
          style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
        >
          <Text style={styles.ctaLabel}>{step.cta}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** The record button, promised. */
function Disc() {
  return (
    <View style={styles.discHalo}>
      <View style={styles.disc} />
    </View>
  );
}

/**
 * A line running out of the signal colour and fading — the design's gradient
 * rule, drawn as stepped segments so it needs no gradient dependency.
 */
function Horizon() {
  return (
    <View style={styles.horizon} accessibilityElementsHidden>
      {[1, 0.75, 0.5, 0.28, 0.12].map((opacity, segment) => (
        <View key={segment} style={[styles.horizonSegment, { opacity }]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    paddingTop: 78,
    paddingBottom: 44,
    paddingHorizontal: 28,
    backgroundColor: colors.canvas,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  brand: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 12,
    letterSpacing: 2.6,
    color: colors.text,
  },
  skip: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.textDim,
    paddingVertical: 6,
  },
  body: {
    flex: 1,
    justifyContent: "center",
    gap: 20,
  },
  art: {
    height: 132,
    justifyContent: "center",
    marginBottom: 8,
  },
  discHalo: {
    width: 128,
    height: 128,
    borderRadius: radii.pill,
    backgroundColor: colors.signalSoft,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
  },
  disc: {
    width: 104,
    height: 104,
    borderRadius: radii.pill,
    backgroundColor: colors.signal,
    shadowColor: colors.signal,
    shadowOpacity: 0.45,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 0 },
  },
  horizon: {
    flexDirection: "row",
    width: 132,
  },
  horizonSegment: {
    flex: 1,
    height: 1,
    backgroundColor: colors.signal,
  },
  title: {
    fontFamily: fonts.serif,
    fontSize: 44,
    lineHeight: 46,
    color: colors.text,
  },
  copy: {
    fontFamily: fonts.sans,
    fontSize: 16,
    lineHeight: 24,
    color: colors.textMuted,
    maxWidth: 300,
  },
  footer: {
    gap: 20,
  },
  dots: {
    flexDirection: "row",
    gap: 6,
  },
  dot: {
    height: 6,
    borderRadius: radii.pill,
  },
  dotActive: {
    width: 20,
    backgroundColor: colors.text,
  },
  dotIdle: {
    width: 6,
    backgroundColor: colors.borderStrong,
  },
  cta: {
    height: 54,
    borderRadius: radii.control,
    backgroundColor: colors.text,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaPressed: {
    opacity: 0.85,
  },
  ctaLabel: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 16,
    color: colors.canvas,
  },
});
