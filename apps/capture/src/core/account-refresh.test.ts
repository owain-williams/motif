import { describe, expect, it, vi } from "vitest";
import {
  availableRecordingChannels,
  availableRecordingFormats,
} from "@motif/shared";
import {
  ACCOUNT_TIER_MAX_AGE_MS,
  createAccountRefresher,
} from "./account-refresh";
import type { RefreshedProfile } from "./account-refresh";
import type { AccountSession } from "./account-session";
import {
  ANONYMOUS_ACCOUNT,
  authenticatedAccount,
  effectiveTier,
} from "./account-session";
import { NO_ENTITLEMENT, unlockedTier } from "./billing";
import { ideaStorageAction, syncTransports } from "./sync-engine";
import type { IdeaMetadata } from "@motif/shared";

const FREE = authenticatedAccount({ email: "musician@example.com", tier: "free" });
const PRO = authenticatedAccount({ email: "musician@example.com", tier: "pro" });

/** A promise the test resolves by hand, for reads that are still in flight. */
function deferred<T>() {
  let settle!: (value: T) => void;
  let fail!: (reason: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  return { promise, settle, fail };
}

/**
 * A refresher over a mutable session, as App holds it: the callback writes the
 * adopted session back, which is what the next read sees.
 */
function harness(options: {
  readonly account?: AccountSession;
  readonly loadProfile?: () => Promise<RefreshedProfile>;
  readonly wait?: (ms: number) => Promise<void>;
}) {
  let account = options.account ?? FREE;
  let clock = 1_000_000;
  const onRefreshed = vi.fn((next: AccountSession) => {
    account = next;
  });
  const loadProfile = vi.fn(
    options.loadProfile ??
      (async () => ({ email: "musician@example.com", tier: "pro" as const })),
  );
  const refresher = createAccountRefresher({
    currentAccount: () => account,
    loadProfile,
    onRefreshed,
    now: () => clock,
    wait: options.wait ?? (() => new Promise<void>(() => {})),
  });
  return {
    refresher,
    loadProfile,
    onRefreshed,
    setSession: (next: AccountSession) => {
      account = next;
    },
    advance: (ms: number) => {
      clock += ms;
    },
    get account() {
      return account;
    },
  };
}

describe("Capture account refresh", () => {
  it("adopts a Free-to-Pro upgrade made server-side, without a restart", async () => {
    const app = harness({ account: FREE });

    const session = await app.refresher.refresh("foreground");

    expect(session).toEqual(PRO);
    expect(app.onRefreshed).toHaveBeenCalledWith(PRO);
    expect(app.account).toEqual(PRO);
  });

  it("adopts a Pro-to-Free downgrade before gated work begins", async () => {
    const app = harness({
      account: PRO,
      loadProfile: async () => ({ email: "musician@example.com", tier: "free" }),
    });

    const session = await app.refresher.refresh("gated-work");

    expect(session).toEqual(FREE);
    expect(app.onRefreshed).toHaveBeenCalledWith(FREE);
  });

  it("leaves an anonymous session Free without asking the backend", async () => {
    const app = harness({ account: ANONYMOUS_ACCOUNT });

    const session = await app.refresher.refresh("foreground");

    expect(session).toBe(ANONYMOUS_ACCOUNT);
    expect(app.loadProfile).not.toHaveBeenCalled();
    expect(app.onRefreshed).not.toHaveBeenCalled();
  });

  it("keeps the last known Tier when the read fails", async () => {
    const app = harness({
      account: PRO,
      loadProfile: async () => {
        throw new Error("offline");
      },
    });

    const session = await app.refresher.refresh("gated-work");

    expect(session).toBe(PRO);
    expect(app.onRefreshed).not.toHaveBeenCalled();
  });

  it("gives up on a read that never answers, keeping the last known Tier", async () => {
    const hung = deferred<RefreshedProfile>();
    const app = harness({
      account: PRO,
      loadProfile: () => hung.promise,
      // Times out immediately, standing in for the deadline elapsing.
      wait: async () => {},
    });

    const session = await app.refresher.refresh("gated-work");

    expect(session).toBe(PRO);
    expect(app.onRefreshed).not.toHaveBeenCalled();
  });

  it("does not re-read the backend while the last answer is still fresh", async () => {
    const app = harness({ account: FREE });

    await app.refresher.refresh("foreground");
    app.advance(ACCOUNT_TIER_MAX_AGE_MS.foreground - 1);
    await app.refresher.refresh("foreground");

    expect(app.loadProfile).toHaveBeenCalledTimes(1);
  });

  it("re-reads once the answer is old enough to have moved", async () => {
    const app = harness({ account: FREE });

    await app.refresher.refresh("foreground");
    app.advance(ACCOUNT_TIER_MAX_AGE_MS.foreground);
    await app.refresher.refresh("foreground");

    expect(app.loadProfile).toHaveBeenCalledTimes(2);
  });

  it("lets gated work settle for an answer a foreground return would refuse", async () => {
    const app = harness({ account: FREE });

    await app.refresher.refresh("gated-work");
    // Old enough that returning to the app would ask again; the relay, which
    // the backend authorizes for itself, still runs on the answer in hand.
    app.advance(ACCOUNT_TIER_MAX_AGE_MS.foreground);
    await app.refresher.refresh("gated-work");
    expect(app.loadProfile).toHaveBeenCalledTimes(1);

    app.advance(
      ACCOUNT_TIER_MAX_AGE_MS["gated-work"] -
        ACCOUNT_TIER_MAX_AGE_MS.foreground,
    );
    await app.refresher.refresh("gated-work");
    expect(app.loadProfile).toHaveBeenCalledTimes(2);
  });

  it("backs off after a failure rather than retrying on every trigger", async () => {
    const app = harness({
      account: PRO,
      loadProfile: async () => {
        throw new Error("the account service is unavailable");
      },
    });

    await app.refresher.refresh("gated-work");
    await app.refresher.refresh("gated-work");

    expect(app.loadProfile).toHaveBeenCalledTimes(1);
  });

  it("serves concurrent triggers from a single read", async () => {
    const pending = deferred<RefreshedProfile>();
    const app = harness({ account: FREE, loadProfile: () => pending.promise });

    const both = Promise.all([
      app.refresher.refresh("foreground"),
      app.refresher.refresh("gated-work"),
    ]);
    pending.settle({ email: "musician@example.com", tier: "pro" });

    expect(await both).toEqual([PRO, PRO]);
    expect(app.loadProfile).toHaveBeenCalledTimes(1);
  });

  it("publishes nothing when the Tier has not moved", async () => {
    const app = harness({
      account: PRO,
      loadProfile: async () => ({ email: "musician@example.com", tier: "pro" }),
    });

    const session = await app.refresher.refresh("foreground");

    expect(session).toBe(PRO);
    expect(app.onRefreshed).not.toHaveBeenCalled();
  });

  it("discards an answer for an account that has since signed out", async () => {
    const pending = deferred<RefreshedProfile>();
    const app = harness({ account: FREE, loadProfile: () => pending.promise });

    const inFlight = app.refresher.refresh("foreground");
    app.setSession(ANONYMOUS_ACCOUNT);
    pending.settle({ email: "musician@example.com", tier: "pro" });

    expect(await inFlight).toBe(ANONYMOUS_ACCOUNT);
    expect(app.onRefreshed).not.toHaveBeenCalled();
  });

  it("discards an answer for an account that has since been replaced", async () => {
    const pending = deferred<RefreshedProfile>();
    const app = harness({ account: FREE, loadProfile: () => pending.promise });
    const other = authenticatedAccount({ email: "other@example.com", tier: "free" });

    const inFlight = app.refresher.refresh("foreground");
    app.setSession(other);
    pending.settle({ email: "musician@example.com", tier: "pro" });

    expect(await inFlight).toBe(other);
    expect(app.onRefreshed).not.toHaveBeenCalled();
  });

  it("discards an answer that an invalidation has already outdated", async () => {
    const pending = deferred<RefreshedProfile>();
    const app = harness({ account: FREE, loadProfile: () => pending.promise });

    const inFlight = app.refresher.refresh("foreground");
    // Capture learns the Tier by another route mid-read: the poll that follows
    // a purchase reads the same endpoint later, so its Pro is the newer answer
    // and this read's Free is stale by the time it lands.
    app.refresher.invalidate();
    app.setSession(PRO);
    pending.settle({ email: "musician@example.com", tier: "free" });

    expect(await inFlight).toBe(PRO);
    expect(app.onRefreshed).not.toHaveBeenCalled();
  });

  it("starts a fresh read when the one in flight has been invalidated", async () => {
    const first = deferred<RefreshedProfile>();
    const second = deferred<RefreshedProfile>();
    const reads = [first, second];
    const app = harness({
      account: FREE,
      loadProfile: () => reads.shift()!.promise,
    });

    void app.refresher.refresh("foreground");
    app.refresher.invalidate();
    const reread = app.refresher.refresh("foreground");
    first.settle({ email: "musician@example.com", tier: "free" });
    second.settle({ email: "musician@example.com", tier: "pro" });

    expect(await reread).toEqual(PRO);
    expect(app.loadProfile).toHaveBeenCalledTimes(2);
  });

  it("re-reads on the next trigger once the session is invalidated", async () => {
    const app = harness({ account: FREE });

    await app.refresher.refresh("foreground");
    app.refresher.invalidate();
    await app.refresher.refresh("foreground");

    expect(app.loadProfile).toHaveBeenCalledTimes(2);
  });
});

/**
 * What the refreshed Tier is for. The capability rules are proved by their own
 * tests; these pin down that a Tier change made server-side actually reaches
 * them, which is the whole point of refreshing.
 *
 * Recording choices are read through `unlockedTier` with no store entitlement,
 * as App composes them. That is the case the account Tier governs alone —
 * a Tier seeded for development or bought on another platform. A live store
 * entitlement deliberately keeps device-local Pro on regardless (see
 * `unlockedTier`), which is why it is not the case that proves this.
 */
describe("the Tier a refresh settles on", () => {
  const onDevice: IdeaMetadata = {
    id: "idea-1",
    name: "Idea",
    capturedAt: 1,
    durationMs: 3000,
    audioFormat: "aac",
    channels: 1,
    storageState: "on-device",
    tags: [],
    instrument: [],
    style: [],
    tempo: null,
    location: null,
    fieldUpdatedAt: {
      name: 1,
      tags: 0,
      instrument: 0,
      style: 0,
      tempo: 0,
      location: 0,
    },
  };

  it("opens paid recording choices and the cloud relay on an upgrade", async () => {
    const app = harness({ account: FREE });

    const session = await app.refresher.refresh("foreground");

    const recording = unlockedTier(session, NO_ENTITLEMENT);
    expect(availableRecordingFormats(recording)).toContain("wav");
    expect(availableRecordingChannels(recording)).toContain(2);
    const cloud = effectiveTier(session);
    expect(syncTransports(cloud, false)).toEqual(["cloud-relay"]);
    expect(ideaStorageAction(cloud, onDevice)).toBe("offload");
  });

  it("withdraws them on a downgrade", async () => {
    const app = harness({
      account: PRO,
      loadProfile: async () => ({ email: "musician@example.com", tier: "free" }),
    });

    const session = await app.refresher.refresh("gated-work");

    const recording = unlockedTier(session, NO_ENTITLEMENT);
    expect(availableRecordingFormats(recording)).toEqual(["aac"]);
    expect(availableRecordingChannels(recording)).toEqual([1]);
    const cloud = effectiveTier(session);
    expect(syncTransports(cloud, true)).toEqual(["local-network"]);
    expect(ideaStorageAction(cloud, onDevice)).toBeNull();
  });

  it("leaves a paid account fully usable when the refresh fails", async () => {
    const app = harness({
      account: PRO,
      loadProfile: async () => {
        throw new Error("the account service is unavailable");
      },
    });

    const session = await app.refresher.refresh("gated-work");

    expect(
      availableRecordingFormats(unlockedTier(session, NO_ENTITLEMENT)),
    ).toContain("wav");
    expect(syncTransports(effectiveTier(session), true)).toEqual([
      "local-network",
      "cloud-relay",
    ]);
  });

  it("leaves an anonymous session on Free, offline or not", async () => {
    const app = harness({
      account: ANONYMOUS_ACCOUNT,
      loadProfile: async () => {
        throw new Error("the account service is unavailable");
      },
    });

    const session = await app.refresher.refresh("gated-work");

    expect(
      availableRecordingFormats(unlockedTier(session, NO_ENTITLEMENT)),
    ).toEqual(["aac"]);
    expect(syncTransports(effectiveTier(session), true)).toEqual([
      "local-network",
    ]);
  });
});
