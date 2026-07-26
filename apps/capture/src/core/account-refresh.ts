/**
 * Account refresh — keeping Capture's Tier in step with the one the server owns.
 *
 * Tier is the account's, and only verified billing moves it (CONTEXT.md): the
 * RevenueCat webhook projects it, `GET /me` reports it. Capture reads that at
 * login and again after a purchase it made itself, which leaves every other way
 * it can change invisible — a renewal, an expiry, a refund, a cancellation that
 * finally lapsed, or Pro bought on another device. Without this module those
 * only land on the next launch, so Capture would go on offering WAV to an
 * account that stopped paying, or withhold cloud relay from one that started.
 *
 * Nothing here touches the network or React, so the upgrade, downgrade and
 * failure paths are all testable in Node.
 */

import type { Tier } from "@motif/shared";
import type { AccountSession } from "./account-session";
import { authenticatedAccount } from "./account-session";

/**
 * Why a refresh was asked for. The two differ in how stale an answer they will
 * settle for, not in what they do with it.
 */
export type AccountRefreshTrigger = "foreground" | "gated-work";

/**
 * How old a Tier read may be before that trigger insists on another.
 *
 * Returning to the app is the tighter of the two because it is the moment the
 * user *looks* at what their account can do, and the moment a change made
 * elsewhere is most likely to have happened. Gated work tolerates more because
 * the backend authorizes it independently: acting on a stale Tier there costs a
 * refused request, never a wrong grant. Both are long enough that an app
 * switched away from and straight back, or a burst of sync passes, re-reads
 * nothing.
 */
export const ACCOUNT_TIER_MAX_AGE_MS: Readonly<
  Record<AccountRefreshTrigger, number>
> = {
  foreground: 30_000,
  "gated-work": 60_000,
};

/**
 * Starting a recording is deliberately not a trigger. Nothing authorizes a
 * capture remotely — the audio is written to this device — so a Tier read there
 * would buy nothing but latency on the one action Capture exists to make
 * instant. The choices offered follow the Tier the foreground and Sync-screen
 * triggers have already settled on.
 */

/**
 * How long to wait for `GET /me` before carrying on with the Tier already in
 * hand. Gated work waits on this refresh, so an unanswered request must not be
 * able to hold up an offload — or a cloud sync pass — indefinitely.
 */
const ACCOUNT_REFRESH_TIMEOUT_MS = 8_000;

/** The account as the backend reports it — `GET /me`, narrowed to Tier. */
export interface RefreshedProfile {
  readonly email: string;
  readonly tier: Tier;
}

export interface AccountRefresherDeps {
  /**
   * The session as it stands right now. Read live rather than captured: a
   * refresh outlives the render that asked for it, and the user may log out or
   * log in as someone else while it is in the air.
   */
  readonly currentAccount: () => AccountSession;
  /** Re-reads the account from the backend. Rejects when it can't be reached. */
  readonly loadProfile: () => Promise<RefreshedProfile>;
  /** Called only when the answer actually moves the session. */
  readonly onRefreshed: (account: AccountSession) => void;
  readonly now?: () => number;
  /** Resolves after `ms`; injected so the timeout needs no real clock. */
  readonly wait?: (ms: number) => Promise<void>;
}

export interface AccountRefresher {
  /**
   * Returns the session to act on, re-reading Tier first if the last answer is
   * too old for this trigger. Never rejects: a backend that can't be reached
   * leaves Capture on the Tier it already knew, which is the last Tier the
   * account was actually seen to hold.
   */
  refresh(trigger: AccountRefreshTrigger): Promise<AccountSession>;
  /**
   * Drops the freshness of the last answer, so the next trigger re-reads. For
   * the moments Capture already knows the Tier may have moved — a login, a
   * logout, a purchase just reconciled.
   */
  invalidate(): void;
}

export function createAccountRefresher(
  deps: AccountRefresherDeps,
): AccountRefresher {
  const now = deps.now ?? Date.now;
  const wait =
    deps.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  /** When the backend was last asked, successfully or not; null before any ask. */
  let lastAskedAt: number | null = null;
  /**
   * Bumped by every invalidation, so a read can tell whether Capture has been
   * told something newer than the answer it is holding.
   */
  let generation = 0;
  /** The read in flight, so concurrent triggers share one request. */
  let inFlight: { promise: Promise<AccountSession>; generation: number } | null =
    null;

  async function read(askedGeneration: number): Promise<AccountSession> {
    // Neither branch rejects, so racing them can't leave a rejection unhandled
    // when the loser settles later.
    const answer = await Promise.race([
      deps.loadProfile().then(
        (profile) => profile,
        () => null,
      ),
      wait(ACCOUNT_REFRESH_TIMEOUT_MS).then(() => null),
    ]);
    const account = deps.currentAccount();

    // An invalidation while this was in the air means Capture has since learned
    // the Tier by a surer route — the poll that follows a purchase reads the
    // same endpoint later — so this answer is the older of the two.
    if (askedGeneration !== generation) return account;

    // Stamped even on failure: an unreachable backend is unreachable for the
    // next trigger too, and a sync pass every few seconds must not turn into a
    // retry storm. The Tier in hand stays usable until it answers.
    lastAskedAt = now();
    if (answer === null) return account;

    // The session may have changed under the request. A Tier belonging to an
    // account that has since signed out — or been replaced by another — is
    // worse than no answer at all, so it is dropped and its freshness with it.
    if (
      account.kind !== "authenticated" ||
      !sameEmail(account.email, answer.email)
    ) {
      lastAskedAt = null;
      return account;
    }

    if (account.tier === answer.tier) return account;

    const refreshed = authenticatedAccount({
      email: account.email,
      tier: answer.tier,
    });
    deps.onRefreshed(refreshed);
    return refreshed;
  }

  return {
    async refresh(trigger) {
      const account = deps.currentAccount();
      // Capture needs no account, and an anonymous one has no Tier to read:
      // it is Free by definition, on any network or none.
      if (account.kind !== "authenticated") return account;

      // A read invalidated mid-flight is no longer an answer anyone can use, so
      // it is left to expire and a fresh one started in its place.
      if (inFlight && inFlight.generation === generation) return inFlight.promise;
      if (
        lastAskedAt !== null &&
        now() - lastAskedAt < ACCOUNT_TIER_MAX_AGE_MS[trigger]
      ) {
        return account;
      }

      const askedGeneration = generation;
      const promise = read(askedGeneration).finally(() => {
        if (inFlight?.promise === promise) inFlight = null;
      });
      inFlight = { promise, generation: askedGeneration };
      return promise;
    },

    invalidate() {
      lastAskedAt = null;
      generation += 1;
    },
  };
}

function sameEmail(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}
