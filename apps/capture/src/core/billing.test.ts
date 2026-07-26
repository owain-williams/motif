import { describe, expect, it } from "vitest";
import {
  ANONYMOUS_ACCOUNT,
  authenticatedAccount,
  effectiveTier,
} from "./account-session";
import {
  BILLING_ERROR_CODES,
  NO_ENTITLEMENT,
  PRO_ENTITLEMENT_ID,
  awaitTierProjection,
  billingPresentation,
  cloudSyncPending,
  offerPriceLine,
  purchaseFailureMessage,
  subscriptionSummary,
  unlockedTier,
  upgradeActionLabel,
  type EntitlementSnapshot,
  type ProOffer,
} from "./billing";

const APRIL_2026 = Date.UTC(2026, 3, 1);

function activePro(
  overrides: Partial<EntitlementSnapshot> = {},
): EntitlementSnapshot {
  return {
    ...NO_ENTITLEMENT,
    proIsActive: true,
    willRenew: true,
    expiresAtMillis: APRIL_2026,
    productIdentifier: "motif_pro_yearly",
    ...overrides,
  };
}

const YEARLY: ProOffer = {
  packageId: "$rc_annual",
  productId: "motif_pro_yearly",
  priceString: "£39.99",
  period: "annual",
};

/** The default: signed in, Free, with a store that has answered. */
function inputs(overrides: Partial<Parameters<typeof billingPresentation>[0]> = {}) {
  return {
    account: authenticatedAccount({ email: "a@b.com", tier: "free" as const }),
    store: NO_ENTITLEMENT,
    offer: YEARLY,
    storeAvailable: true,
    ...overrides,
  };
}

describe("Pro entitlement", () => {
  it("uses the entitlement id the backend webhook projects", () => {
    // The Lambda only grants Pro for this id (REVENUECAT_PRO_ENTITLEMENT_ID),
    // so renaming it in the dashboard silently stops all upgrades.
    expect(PRO_ENTITLEMENT_ID).toBe("Motif Pro");
  });
});

describe("the tier Capture runs at", () => {
  const freeAccount = authenticatedAccount({ email: "a@b.com", tier: "free" });
  const proAccount = authenticatedAccount({ email: "a@b.com", tier: "pro" });

  it("unlocks Pro from the store without waiting for the backend", () => {
    // The whole point: a purchase takes effect immediately, before the
    // RevenueCat webhook has reached Motif and flipped the account Tier.
    expect(unlockedTier(freeAccount, activePro())).toBe("pro");
  });

  it("keeps Pro for an account whose tier came from elsewhere", () => {
    // A seeded development tier or a purchase made on another platform has no
    // local store entitlement, but the account is genuinely Pro.
    expect(unlockedTier(proAccount, NO_ENTITLEMENT)).toBe("pro");
  });

  it("stays Free when neither source grants Pro", () => {
    expect(unlockedTier(freeAccount, NO_ENTITLEMENT)).toBe("free");
    expect(unlockedTier(ANONYMOUS_ACCOUNT, NO_ENTITLEMENT)).toBe("free");
  });

  it("unlocks local Pro features even before the user has an account", () => {
    expect(unlockedTier(ANONYMOUS_ACCOUNT, activePro())).toBe("pro");
  });

  it("never lets the store's word reach anything the backend authorizes", () => {
    // The two Tiers Capture runs on. `unlockedTier` is device-local — stereo,
    // WAV — and may lead. Cloud relay, offload and redownload are authorized
    // server-side against the account, so using the store's word for those
    // would only produce 403s and an Offload button that fails.
    const freeAccount = authenticatedAccount({ email: "a@b.com", tier: "free" });

    expect(unlockedTier(freeAccount, activePro())).toBe("pro");
    expect(effectiveTier(freeAccount)).toBe("free");
    expect(cloudSyncPending(freeAccount, activePro())).toBe(true);
  });

  it("flags cloud sync as pending only while the two sources disagree", () => {
    // Cloud relay is enforced server-side against the account Tier, so a store
    // entitlement alone cannot turn it on.
    expect(cloudSyncPending(freeAccount, activePro())).toBe(true);
    expect(cloudSyncPending(proAccount, activePro())).toBe(false);
    expect(cloudSyncPending(freeAccount, NO_ENTITLEMENT)).toBe(false);
  });
});

describe("the price Capture quotes", () => {
  it("quotes the store's own localized price rather than formatting one", () => {
    // priceString arrives from StoreKit already in the device's currency and
    // locale; re-deriving it from the numeric price would get both wrong.
    expect(offerPriceLine(YEARLY)).toBe("£39.99 / year");
    expect(offerPriceLine({ ...YEARLY, priceString: "¥5,800" })).toBe(
      "¥5,800 / year",
    );
  });

  it("names the billing period so the price cannot be misread", () => {
    expect(offerPriceLine({ ...YEARLY, period: "monthly" })).toBe(
      "£39.99 / month",
    );
    expect(offerPriceLine({ ...YEARLY, period: "lifetime" })).toMatch(/once$/);
  });

  it("has no price line before the store has answered", () => {
    expect(offerPriceLine(null)).toBeNull();
  });

  it("puts the price on the button, so a tap is never an unquoted charge", () => {
    expect(upgradeActionLabel(YEARLY)).toContain("£39.99 / year");
  });

  it("still offers the upgrade when the price has not loaded", () => {
    // The hosted paywall quotes the price itself, so a slow offerings fetch
    // must not remove the only way to buy.
    expect(upgradeActionLabel(null)).toBe("Upgrade to Motif Pro");
  });
});

describe("what the account dialog offers", () => {
  it("asks anonymous users to log in, because Pro is an account tier", () => {
    const presentation = billingPresentation(
      inputs({ account: ANONYMOUS_ACCOUNT }),
    );

    expect(presentation.kind).toBe("requires-account");
  });

  it("quotes the price to signed-out users, so login is not asked on faith", () => {
    const presentation = billingPresentation(
      inputs({ account: ANONYMOUS_ACCOUNT }),
    );

    expect(presentation).toMatchObject({ priceLine: "£39.99 / year" });
  });

  it("offers an upgrade to a logged-in Free account", () => {
    expect(billingPresentation(inputs()).kind).toBe("offer-upgrade");
  });

  it("labels the upgrade with the price it will charge", () => {
    expect(billingPresentation(inputs())).toMatchObject({
      kind: "offer-upgrade",
      actionLabel: "Upgrade — £39.99 / year",
    });
  });

  it("treats a fresh purchase as active, noting only that cloud sync lags", () => {
    const presentation = billingPresentation(inputs({ store: activePro() }));

    expect(presentation).toMatchObject({ kind: "active", cloudSyncPending: true });
    expect(presentation.message).toMatch(/cloud sync switches on/i);
  });

  it("says nothing about catching up once the account agrees", () => {
    const account = authenticatedAccount({ email: "a@b.com", tier: "pro" });

    const presentation = billingPresentation(
      inputs({ account, store: activePro() }),
    );

    expect(presentation).toMatchObject({ kind: "active", cloudSyncPending: false });
    expect(presentation.message).not.toMatch(/cloud sync switches on/i);
  });

  it("manages the subscription bought from this store", () => {
    const account = authenticatedAccount({ email: "a@b.com", tier: "pro" });

    expect(billingPresentation(inputs({ account, store: activePro() }))).toMatchObject({
      kind: "active",
      canManage: true,
    });
  });

  it("still reports Pro when the tier came from somewhere other than this store", () => {
    // Seeded development tiers and purchases made on another platform have no
    // local store entitlement, but the account is genuinely Pro.
    const account = authenticatedAccount({ email: "a@b.com", tier: "pro" });

    const presentation = billingPresentation(inputs({ account }));

    expect(presentation.kind).toBe("active");
    expect(presentation.message).toMatch(/active on your account/i);
  });

  it("offers no subscription management for a Tier this store did not sell", () => {
    // Apple's sheet would show nothing relevant for a Tier granted by a web
    // purchase or seeded for development.
    const account = authenticatedAccount({ email: "a@b.com", tier: "pro" });

    expect(billingPresentation(inputs({ account }))).toMatchObject({
      canManage: false,
    });
  });

  it("says so plainly when this build cannot buy anything", () => {
    // The web build has no store, and a misconfigured key disables billing.
    // Offering a button that can only fail is worse than explaining why.
    const presentation = billingPresentation(
      inputs({ storeAvailable: false, offer: null }),
    );

    expect(presentation.kind).toBe("unavailable");
  });

  it("still reports an existing Pro tier on a build that cannot buy", () => {
    const account = authenticatedAccount({ email: "a@b.com", tier: "pro" });

    expect(
      billingPresentation(inputs({ account, storeAvailable: false, offer: null })),
    ).toMatchObject({ kind: "active", canManage: false });
  });
});

describe("subscription summary", () => {
  const before = Date.UTC(2026, 0, 1);

  it("reports the renewal date while it renews", () => {
    expect(subscriptionSummary(activePro(), before)).toBe(
      "Motif Pro renews on 2026-04-01.",
    );
  });

  it("reports the end date once cancelled but still paid up", () => {
    expect(
      subscriptionSummary(activePro({ willRenew: false }), before),
    ).toBe("Motif Pro is cancelled and ends on 2026-04-01.");
  });

  it("leads with a billing problem over the renewal date", () => {
    expect(subscriptionSummary(activePro({ billingIssue: true }), before)).toMatch(
      /billing problem/i,
    );
  });

  it("handles lifetime entitlements that never expire", () => {
    expect(
      subscriptionSummary(activePro({ expiresAtMillis: null }), before),
    ).toMatch(/for life/i);
  });

  it("marks sandbox purchases so test buys are not mistaken for real ones", () => {
    expect(subscriptionSummary(activePro({ isSandbox: true }), before)).toMatch(
      /\(sandbox\)/,
    );
  });
});

describe("purchase failures", () => {
  it("says nothing when the user dismisses the paywall", () => {
    expect(purchaseFailureMessage(BILLING_ERROR_CODES.purchaseCancelled)).toBeNull();
  });

  it("treats a pending payment as in-progress rather than failed", () => {
    const message = purchaseFailureMessage(BILLING_ERROR_CODES.paymentPending);

    expect(message).toMatch(/still being approved/i);
    expect(message).not.toMatch(/failed|couldn't/i);
  });

  it("points an already-owned subscription at restore", () => {
    expect(
      purchaseFailureMessage(BILLING_ERROR_CODES.productAlreadyPurchased),
    ).toMatch(/restore/i);
  });

  it("explains that a receipt attached elsewhere needs the other account", () => {
    expect(
      purchaseFailureMessage(BILLING_ERROR_CODES.receiptAlreadyInUse),
    ).toMatch(/another Motif account/i);
  });

  it("reassures that no money moved when the store fails", () => {
    expect(purchaseFailureMessage(BILLING_ERROR_CODES.storeProblem)).toMatch(
      /no payment was taken/i,
    );
    expect(purchaseFailureMessage(undefined)).toMatch(/no payment was taken/i);
  });

  it("distinguishes a connection failure from a declined purchase", () => {
    expect(purchaseFailureMessage(BILLING_ERROR_CODES.network)).toMatch(
      /connection/i,
    );
  });
});

describe("waiting for the backend to project a purchase", () => {
  const noWait = () => Promise.resolve();

  it("settles as soon as the webhook has landed", async () => {
    let calls = 0;
    const result = await awaitTierProjection("pro", {
      loadTier: async () => {
        calls += 1;
        return calls >= 2 ? "pro" : "free";
      },
      wait: noWait,
    });

    expect(result).toEqual({ tier: "pro", settled: true });
    expect(calls).toBe(2);
  });

  it("keeps polling through transient failures rather than reporting a failed purchase", async () => {
    let calls = 0;
    const result = await awaitTierProjection("pro", {
      loadTier: async () => {
        calls += 1;
        if (calls < 3) throw new Error("network");
        return "pro";
      },
      wait: noWait,
    });

    expect(result.settled).toBe(true);
    expect(result.tier).toBe("pro");
  });

  it("gives up unsettled instead of claiming the purchase failed", async () => {
    const result = await awaitTierProjection("pro", {
      loadTier: async () => "free",
      wait: noWait,
      backoffMs: [0, 0],
    });

    expect(result).toEqual({ tier: "free", settled: false });
  });

  it("waits between polls so a slow webhook is given room", async () => {
    const waits: number[] = [];
    await awaitTierProjection("pro", {
      loadTier: async () => "free",
      wait: async (ms) => {
        waits.push(ms);
      },
      backoffMs: [100, 200],
    });

    expect(waits).toEqual([100, 200]);
  });
});
