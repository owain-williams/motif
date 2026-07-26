/**
 * Billing — the framework-agnostic half of Capture's RevenueCat integration.
 *
 * Capture unlocks Pro from the RevenueCat entitlement directly, so a purchase
 * takes effect the moment it clears rather than waiting on a webhook round trip
 * (`unlockedTier`). The Motif account Tier — projected by the verified
 * RevenueCat webhook and reported by `GET /me` (infra/README.md) — remains the
 * authority for anything the *backend* serves, cloud relay above all, because a
 * client claim can't move server-side quota. `cloudSyncPending` names the brief
 * window where those two disagree.
 *
 * Nothing here imports the RevenueCat SDK at runtime, so it runs under Vitest in
 * Node. `src/billing.ts` owns the native calls and converts SDK objects into the
 * plain shapes below.
 */

import type { Tier } from "@motif/shared";
import type { AccountSession } from "./account-session";

/**
 * The entitlement identifier configured in the RevenueCat dashboard. This must
 * stay equal to the Lambda's `REVENUECAT_PRO_ENTITLEMENT_ID`, because the
 * webhook only projects Pro for entitlement ids it recognizes — a dashboard
 * entitlement named anything else silently never grants Tier.
 */
export const PRO_ENTITLEMENT_ID = "Motif Pro";

/** How the Pro entitlement is spoken about in the UI and the store listing. */
export const PRO_DISPLAY_NAME = "Motif Pro";

/**
 * A store entitlement reduced to what Capture actually decides with. Keeping
 * this separate from RevenueCat's `CustomerInfo` is what lets the tier rules be
 * tested without a device, and stops store vocabulary leaking into the domain
 * (see the caution in docs/research/subscription-handling.md).
 */
export interface EntitlementSnapshot {
  readonly proIsActive: boolean;
  /** False once a subscription is cancelled but still inside its paid period. */
  readonly willRenew: boolean;
  /** Null for lifetime entitlements. */
  readonly expiresAtMillis: number | null;
  /** Set while the store is retrying a failed payment. */
  readonly billingIssue: boolean;
  /** True for a sandbox/TestFlight purchase, which never bills real money. */
  readonly isSandbox: boolean;
  /** Deep link to the store's subscription management screen, when there is one. */
  readonly managementUrl: string | null;
  /** The store product behind the entitlement, e.g. `motif_pro_yearly`. */
  readonly productIdentifier: string | null;
}

/** No purchase on record — also the shape used before the SDK has answered. */
export const NO_ENTITLEMENT: EntitlementSnapshot = {
  proIsActive: false,
  willRenew: false,
  expiresAtMillis: null,
  billingIssue: false,
  isSandbox: false,
  managementUrl: null,
  productIdentifier: null,
};

/** How often a plan bills. `other` covers the periods Motif does not sell. */
export type OfferPeriod = "annual" | "monthly" | "lifetime" | "other";

/**
 * A purchasable plan, reduced to what Capture quotes and buys. Comes from the
 * RevenueCat offering, which is where prices and plans are configured — so
 * changing what Motif charges is a dashboard edit, not an app release.
 */
export interface ProOffer {
  /** RevenueCat package identifier, e.g. `$rc_annual`. */
  readonly packageId: string;
  /** The store product behind the package, e.g. `motif_pro_yearly`. */
  readonly productId: string;
  /**
   * The store's own formatted price, already in the device's currency and
   * locale (`£39.99`, `¥5,800`). Deliberately the string and not the number:
   * Apple returns the storefront's price and formatting, and re-deriving either
   * from the numeric price gets both wrong outside the developer's own country.
   */
  readonly priceString: string;
  readonly period: OfferPeriod;
}

/** The quoted price with its billing period, or null before the store answers. */
export function offerPriceLine(offer: ProOffer | null): string | null {
  if (offer === null) return null;
  switch (offer.period) {
    case "annual":
      return `${offer.priceString} / year`;
    case "monthly":
      return `${offer.priceString} / month`;
    case "lifetime":
      return `${offer.priceString} once`;
    default:
      return offer.priceString;
  }
}

/**
 * The upgrade button's text. Carrying the price means a tap is never an
 * unquoted charge — which also makes the direct-purchase fallback safe when no
 * hosted paywall is configured.
 */
export function upgradeActionLabel(offer: ProOffer | null): string {
  const price = offerPriceLine(offer);
  return price === null ? `Upgrade to ${PRO_DISPLAY_NAME}` : `Upgrade — ${price}`;
}

/**
 * The Tier Capture actually runs at: Pro if *either* the store entitlement or
 * the Motif account says so.
 *
 * Taking the store's word means a purchase unlocks Pro the instant it clears,
 * without waiting on the RevenueCat webhook. The two sources disagree only
 * briefly, and each covers the other's gap: the store is ahead right after a
 * purchase, and the account is the only source for a Tier bought on another
 * platform or seeded for development.
 *
 * This governs device-local capabilities only — stereo, WAV, the UI. Callers
 * must *not* reach for it when deciding anything the backend authorizes: cloud
 * relay, offload and redownload are checked against the account Tier
 * server-side, so offering them on this Tier would only produce 403s and a
 * failing Offload button. Use the account's own Tier there, and see
 * `cloudSyncPending` for the window in which the two differ.
 */
export function unlockedTier(
  account: AccountSession,
  store: EntitlementSnapshot,
): Tier {
  if (store.proIsActive) return "pro";
  return account.kind === "authenticated" ? account.tier : "free";
}

/**
 * True while the store has granted Pro but the backend has not caught up, so
 * cloud sync will still be refused. Local Pro features already work.
 */
export function cloudSyncPending(
  account: AccountSession,
  store: EntitlementSnapshot,
): boolean {
  return (
    store.proIsActive &&
    (account.kind !== "authenticated" || account.tier !== "pro")
  );
}

/**
 * RevenueCat error codes Capture words differently. Mirrors the SDK's
 * `PURCHASES_ERROR_CODE`; `src/billing.ts` proves the mirror at compile time.
 */
export const BILLING_ERROR_CODES = {
  purchaseCancelled: "1",
  storeProblem: "2",
  purchaseNotAllowed: "3",
  productNotAvailable: "5",
  productAlreadyPurchased: "6",
  receiptAlreadyInUse: "7",
  network: "10",
  invalidCredentials: "11",
  operationAlreadyInProgress: "15",
  paymentPending: "20",
  configuration: "23",
  offlineConnection: "35",
} as const;

export type BillingErrorCode =
  (typeof BILLING_ERROR_CODES)[keyof typeof BILLING_ERROR_CODES];

/**
 * What to say when the store failed without saying why. Naming the absence of a
 * charge is the part that matters: the commonest support question after a failed
 * purchase is whether money left the account.
 */
export const GENERIC_PURCHASE_FAILURE =
  "That purchase couldn't be completed. No payment was taken.";

/** What to say when the store has no Pro product to sell right now. */
export const PRO_UNAVAILABLE_FROM_STORE = `${PRO_DISPLAY_NAME} isn't available from your store right now. Try again shortly.`;

/**
 * Turns a store failure into something worth showing. Returns null when the
 * user cancelled: a dismissed paywall is a choice, not an error, and surfacing
 * it as one is the most common paywall annoyance.
 */
export function purchaseFailureMessage(code: string | undefined): string | null {
  switch (code) {
    case BILLING_ERROR_CODES.purchaseCancelled:
      return null;
    case BILLING_ERROR_CODES.paymentPending:
      // Slow bank approval or Play's pending-purchase flow. The webhook will
      // arrive on its own, so this is deliberately not phrased as a failure.
      return `Your ${PRO_DISPLAY_NAME} payment is still being approved. We'll unlock Pro as soon as it clears.`;
    case BILLING_ERROR_CODES.productAlreadyPurchased:
      return `You already own ${PRO_DISPLAY_NAME}. Use Restore purchases to attach it to this account.`;
    case BILLING_ERROR_CODES.receiptAlreadyInUse:
      return `That store subscription is already attached to another Motif account. Log in with that account, or contact support to move it.`;
    case BILLING_ERROR_CODES.purchaseNotAllowed:
      return "This device isn't allowed to make purchases. Check your device's purchase restrictions and try again.";
    case BILLING_ERROR_CODES.productNotAvailable:
      return PRO_UNAVAILABLE_FROM_STORE;
    case BILLING_ERROR_CODES.network:
    case BILLING_ERROR_CODES.offlineConnection:
      return "The store couldn't be reached. Check your connection and try again.";
    case BILLING_ERROR_CODES.storeProblem:
      return "The store had a problem completing that. No payment was taken — try again shortly.";
    case BILLING_ERROR_CODES.operationAlreadyInProgress:
      return "There's already a purchase in progress.";
    case BILLING_ERROR_CODES.configuration:
    case BILLING_ERROR_CODES.invalidCredentials:
      // A build/dashboard mistake rather than anything the user can fix.
      return "Motif's store setup isn't ready yet. Please report this.";
    default:
      return GENERIC_PURCHASE_FAILURE;
  }
}

/**
 * What the Account dialog should offer. Free users get an upgrade path, Pro
 * users get subscription management, and the awkward middle — store says paid,
 * backend hasn't caught up — gets explained rather than hidden.
 */
export type BillingPresentation =
  | { readonly kind: "unavailable"; readonly message: string }
  | {
      readonly kind: "requires-account";
      readonly message: string;
      /** Quoted before login, so signing in is not asked for on faith. */
      readonly priceLine: string | null;
    }
  | {
      readonly kind: "offer-upgrade";
      readonly message: string;
      readonly actionLabel: string;
      readonly priceLine: string | null;
    }
  | {
      readonly kind: "active";
      readonly message: string;
      /** Cloud sync is still catching up; local Pro features already work. */
      readonly cloudSyncPending: boolean;
      /** This store sold the subscription, so it can also manage it. */
      readonly canManage: boolean;
    };

export type BillingPlatform = "ios" | "android" | "web";

export interface BillingInputs {
  readonly account: AccountSession;
  readonly store: EntitlementSnapshot;
  /** The plan on sale, or null until `getOfferings` answers. */
  readonly offer: ProOffer | null;
  /** False on the web build, or when the SDK could not be configured. */
  readonly storeAvailable: boolean;
  readonly storePlatform: BillingPlatform;
}

export function billingPresentation(
  inputs: BillingInputs,
): BillingPresentation {
  const { account, store, offer, storeAvailable, storePlatform } = inputs;
  const pending = cloudSyncPending(account, store);

  if (unlockedTier(account, store) === "pro") {
    return {
      kind: "active",
      message: pending
        ? `${subscriptionSummary(store)} Cloud sync switches on once your account catches up.`
        : subscriptionSummary(store),
      cloudSyncPending: pending,
      // A Tier this store did not sell — seeded for development, or bought on
      // another platform — has nothing for Apple's sheet to manage.
      canManage: store.proIsActive,
    };
  }

  if (!storeAvailable) {
    return {
      kind: "unavailable",
      message:
        storePlatform === "web"
          ? `Subscribe to ${PRO_DISPLAY_NAME} in Capture on iOS or Android.`
          : "Purchases are temporarily unavailable. Please try again later.",
    };
  }

  // Pro requires an account (TIER_CAPABILITIES.pro.requiresAccount) and the
  // webhook rejects anonymous RevenueCat ids outright, so a purchase made while
  // logged out could never reach the account that pays for cloud storage.
  if (account.kind !== "authenticated") {
    return {
      kind: "requires-account",
      message: `Log in to buy or restore ${PRO_DISPLAY_NAME}.`,
      priceLine: offerPriceLine(offer),
    };
  }

  return {
    kind: "offer-upgrade",
    message: `${PRO_DISPLAY_NAME} adds cloud sync, stereo capture, and WAV recording.`,
    actionLabel: upgradeActionLabel(offer),
    priceLine: offerPriceLine(offer),
  };
}

/** One line describing a live subscription, for the Account dialog. */
export function subscriptionSummary(
  store: EntitlementSnapshot,
  now: number = Date.now(),
): string {
  if (!store.proIsActive) {
    // Tier is Pro but no store entitlement is visible: a seeded development
    // Tier, a web/Stripe purchase, or another device's receipt not yet synced.
    return `${PRO_DISPLAY_NAME} is active on your account.`;
  }

  const sandbox = store.isSandbox ? " (sandbox)" : "";

  if (store.billingIssue) {
    return `${PRO_DISPLAY_NAME} has a billing problem — update your payment method to keep it${sandbox}.`;
  }

  if (store.expiresAtMillis === null) {
    return `${PRO_DISPLAY_NAME} is active for life${sandbox}.`;
  }

  const date = formatDate(store.expiresAtMillis);
  if (store.expiresAtMillis <= now) {
    return `${PRO_DISPLAY_NAME} expired on ${date}${sandbox}.`;
  }

  return store.willRenew
    ? `${PRO_DISPLAY_NAME} renews on ${date}${sandbox}.`
    : `${PRO_DISPLAY_NAME} is cancelled and ends on ${date}${sandbox}.`;
}

/**
 * Selects the public SDK key without relying on RevenueCat's historical key
 * prefixes. Current RevenueCat docs guarantee only that secret keys start
 * `sk_` and OAuth tokens start `atk_`; app-specific SDK key formats are not an
 * API contract. Test Store keys remain identifiable and require an explicit
 * build-profile opt-in, so production cannot accidentally ship simulated purchases.
 */
export function selectBillingApiKey(inputs: {
  readonly platformVariable: string;
  readonly platformKey: string;
  readonly testStoreKey: string;
  readonly allowTestStore: boolean;
}): { readonly key: string; readonly testStore: boolean } | { readonly problem: string } {
  const key = inputs.platformKey || inputs.testStoreKey;
  if (!key) {
    return {
      problem: `${inputs.platformVariable} is not set, and no Test Store key is configured.`,
    };
  }

  if (key.startsWith("sk_") || key.startsWith("atk_")) {
    return {
      problem:
        `${inputs.platformVariable} must contain the app's public SDK API key, ` +
        "not a secret API key or OAuth token.",
    };
  }

  const testStore = key.startsWith("test_");
  if (inputs.platformKey === "" && !testStore) {
    return {
      problem:
        "EXPO_PUBLIC_MOTIF_REVENUECAT_TEST_KEY must contain a RevenueCat Test Store key.",
    };
  }

  if (testStore && !inputs.allowTestStore) {
    return {
      problem:
        "Refusing to configure billing: this build has not explicitly enabled " +
        "RevenueCat Test Store. Provide the platform app's public SDK API key.",
    };
  }

  return { key, testStore };
}

function formatDate(millis: number): string {
  return new Date(millis).toISOString().slice(0, 10);
}

/**
 * How long Capture waits for the webhook to land, in milliseconds between
 * `GET /me` polls. Front-loaded because the webhook usually lands within a
 * second or two; the long tail covers a retry after a store-side delay.
 */
export const TIER_PROJECTION_BACKOFF_MS: readonly number[] = [
  400, 800, 1500, 2500, 4000, 6000,
] as const;

export interface TierProjectionResult {
  readonly tier: Tier;
  /** False when the polls ran out before the backend agreed. */
  readonly settled: boolean;
}

/**
 * Waits for the backend to project a purchase onto the account. Pro is already
 * unlocked locally by then; this reconciliation is what turns cloud relay on,
 * since the backend refuses those routes until its own Tier says Pro.
 *
 * Transient `loadTier` failures are swallowed and retried — a dropped request
 * mid-poll says nothing about whether the user paid. `settled: false` means the
 * webhook hasn't shown yet, which delays cloud sync but never the purchase.
 */
export async function awaitTierProjection(
  target: Tier,
  deps: {
    readonly loadTier: () => Promise<Tier>;
    readonly wait: (ms: number) => Promise<void>;
    readonly backoffMs?: readonly number[];
  },
): Promise<TierProjectionResult> {
  const schedule = deps.backoffMs ?? TIER_PROJECTION_BACKOFF_MS;
  let latest: Tier = "free";

  for (const delay of schedule) {
    await deps.wait(delay);
    try {
      latest = await deps.loadTier();
      if (latest === target) return { tier: latest, settled: true };
    } catch {
      // Keep polling: the purchase is already recorded at the store, so a
      // failed read here says nothing about whether the user paid.
    }
  }

  return { tier: latest, settled: false };
}
