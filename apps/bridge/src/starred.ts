/**
 * Starring, kept on this Bridge only.
 *
 * A star is a desk-side bookmark — "the one I'm working on today" — not part of
 * an Idea. `IdeaMetadata` has no starred field and the sync protocol carries no
 * such flag, so a star deliberately stops at this machine: it never reaches the
 * paired phone and never enters a last-write-wins merge (ADR 0006). Promoting it
 * to synced metadata would be a domain change, not a storage one.
 */

const STARRED_KEY = "motif.bridge.starred";
const ONBOARDED_KEY = "motif.bridge.onboarded";

/** Reads the starred ids, tolerating a missing, unreadable or corrupt entry. */
export function loadStarred(): Set<string> {
  try {
    const raw = window.localStorage.getItem(STARRED_KEY);
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((id): id is string => typeof id === "string")
        : [],
    );
  } catch {
    return new Set();
  }
}

/** Best effort: a star that fails to persist still applies to this session. */
export function saveStarred(starred: ReadonlySet<string>): void {
  try {
    window.localStorage.setItem(STARRED_KEY, JSON.stringify([...starred]));
  } catch {
    // Storage full or unavailable — nothing to recover, and nothing at risk.
  }
}

/** Whether the pairing walkthrough has already been completed or skipped. */
export function hasOnboarded(): boolean {
  try {
    return window.localStorage.getItem(ONBOARDED_KEY) === "true";
  } catch {
    return false;
  }
}

export function markOnboarded(): void {
  try {
    window.localStorage.setItem(ONBOARDED_KEY, "true");
  } catch {
    // The walkthrough will show again next launch; harmless.
  }
}
