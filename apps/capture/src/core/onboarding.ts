/**
 * First-run onboarding: three cards that say what Motif is for before the
 * record button appears. It is skippable from any card and shown once — the
 * pitch is "ideas do not wait", so making the user sit through it twice would
 * contradict it.
 */

export interface OnboardingStep {
  readonly title: string;
  readonly body: string;
  /** Label on the advancing button; the last card's label starts the app. */
  readonly cta: string;
  /** The mark above the headline: a horizon line, or the record button itself. */
  readonly art: "line" | "disc";
}

export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  {
    title: "Ideas do not wait.",
    body: "Motif is a recorder with one job: catch the thing before it evaporates.",
    cta: "Show me",
    art: "line",
  },
  {
    title: "One tap is the whole app.",
    body: "Touch the circle and you are already recording. Touch it again to keep it.",
    cta: "Then what",
    art: "disc",
  },
  {
    title: "It is on your desk already.",
    body: "Every Idea lands in Bridge on your desktop before you put the phone back in your pocket.",
    cta: "Start recording",
    art: "line",
  },
];

/**
 * The card after `step`, or `null` once onboarding is finished. An out-of-range
 * step counts as finished, so a persisted position from a shorter or longer
 * onboarding can never strand a user on a card that no longer exists.
 */
export function nextOnboardingStep(step: number): number | null {
  const next = step + 1;
  return next >= 0 && next < ONBOARDING_STEPS.length ? next : null;
}

/** The card to show at `step`, or `null` when there isn't one. */
export function onboardingStep(step: number): OnboardingStep | null {
  return ONBOARDING_STEPS[step] ?? null;
}
