import { describe, expect, it } from "vitest";
import {
  nextOnboardingStep,
  onboardingStep,
  ONBOARDING_STEPS,
} from "./onboarding";

describe("onboarding", () => {
  it("advances through every card in turn", () => {
    let step: number | null = 0;
    const seen: number[] = [];
    while (step !== null) {
      seen.push(step);
      step = nextOnboardingStep(step);
    }
    expect(seen).toEqual([0, 1, 2]);
  });

  it("finishes after the last card", () => {
    expect(nextOnboardingStep(ONBOARDING_STEPS.length - 1)).toBeNull();
  });

  it("treats an out-of-range position as finished rather than stranding the user", () => {
    expect(nextOnboardingStep(99)).toBeNull();
    expect(onboardingStep(99)).toBeNull();
    expect(onboardingStep(-1)).toBeNull();
  });

  it("ends on a card that starts recording", () => {
    const last = ONBOARDING_STEPS[ONBOARDING_STEPS.length - 1];
    expect(last?.cta).toBe("Start recording");
  });
});
