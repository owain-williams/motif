import { el, need } from "./dom.js";
import type { AppState } from "./state.js";

/**
 * The pairing walkthrough — Bridge's first run, and where "Pair another phone"
 * returns to. Three steps: what Bridge is, the code to type on the phone, and
 * where received audio lands.
 *
 * The code and its countdown are the core's, not the view's: `pairing_info`
 * rotates an expired code before returning it, so what is on screen is always a
 * credential the phone will actually accept.
 */

interface Step {
  readonly title: string;
  readonly body: string;
  readonly cta: string;
}

export const PAIRING_STEPS: readonly Step[] = [
  {
    title: "Your desk is listening.",
    body: "Motif Bridge sits quietly on your Mac and catches every Idea your phone records — over the local network, in full quality, no upload step.",
    cta: "Pair my phone",
  },
  {
    title: "Six characters, once.",
    body: "Open Motif on your phone, tap the sync pill, and type this code. The pairing is remembered for good.",
    cta: "It worked",
  },
  {
    title: "Where the WAVs land.",
    body: "Bridge writes a real file for every Idea, so you can drag one straight into a session.",
    cta: "Open Bridge",
  },
];

function countdown(seconds: number): string {
  const safe = Math.max(0, seconds);
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

export function renderPairing(state: AppState): void {
  const step = PAIRING_STEPS[state.step] ?? PAIRING_STEPS[0]!;
  need("#pair-title").textContent = step.title;
  need("#pair-body").textContent = step.body;
  need("#pair-next").textContent = step.cta;

  need("#pair-dots").replaceChildren(
    ...PAIRING_STEPS.map((_, index) =>
      el("span", { className: index === state.step ? "current" : "" }),
    ),
  );

  PAIRING_STEPS.forEach((_, index) => {
    need<HTMLElement>(`#pair-step-${index}`).hidden = index !== state.step;
  });

  renderCode(state);
  const dir = need("#ideas-dir");
  dir.textContent = state.ideasDir;
  // The card truncates a long path; the full one is a hover away, and Reveal
  // beside it is the real way to go looking.
  dir.title = state.ideasDir;
  need("#pair-relay").textContent =
    state.relayEmail === null
      ? "Sign in to cloud relay"
      : `Signed in as ${state.relayEmail}`;
}

/**
 * Draws the live pairing code. A lockout takes the place of the countdown: a
 * code typed during one is refused, so the wait is the useful thing to show.
 */
function renderCode(state: AppState): void {
  const chars = need("#code-chars");
  const timer = need("#code-timer-text");
  const pip = need("#code-pip");

  if (state.pairing === null) {
    chars.replaceChildren();
    timer.textContent = "Sync receiver unavailable";
    pip.className = "pip idle";
    return;
  }

  chars.replaceChildren(
    ...[...state.pairing.code].map((character) =>
      el("span", { text: character }),
    ),
  );

  const now = Math.floor(Date.now() / 1000);
  const { lockedUntil, expiresAt } = state.pairing;
  if (lockedUntil !== null && lockedUntil > now) {
    timer.textContent = `Locked · try again in ${countdown(lockedUntil - now)}`;
    pip.className = "pip idle";
    return;
  }
  timer.textContent = `Refreshes in ${countdown(expiresAt - now)}`;
  pip.className = "pip live";
}
