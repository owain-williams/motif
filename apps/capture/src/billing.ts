/**
 * Billing — the RevenueCat SDK adapter.
 *
 * This is the thin shell around `react-native-purchases`; every decision it
 * makes lives in `src/core/billing.ts`, which is testable without a device. The
 * shell's whole job is to talk to the native SDK and hand plain shapes back.
 *
 * Two rules shape everything here:
 *
 * 1. **The store's word is an Entitlement, not a Tier.** Nothing in this file
 *    grants Tier. It reports what the store says, and `core/billing.ts` decides
 *    what that unlocks: device-local capabilities immediately, and everything
 *    the backend serves only once the webhook has projected it (see the
 *    Entitlement entry in CONTEXT.md).
 * 2. **Purchases belong to the Cognito account, not the device.** The webhook
 *    rejects `$RCAnonymousID:` app user ids, so a purchase made while logged out
 *    can never be projected. Capture therefore identifies the RevenueCat user
 *    with the Cognito `sub` before any paywall is shown.
 */

import { Linking, Platform } from "react-native";
import Purchases, {
  LOG_LEVEL,
  PACKAGE_TYPE,
  PURCHASES_ERROR_CODE,
  type CustomerInfo,
  type PurchasesError,
  type PurchasesPackage,
} from "react-native-purchases";
import RevenueCatUI, { PAYWALL_RESULT } from "react-native-purchases-ui";
import {
  BILLING_ERROR_CODES,
  GENERIC_PURCHASE_FAILURE,
  NO_ENTITLEMENT,
  PRO_UNAVAILABLE_FROM_STORE,
  PRO_DISPLAY_NAME,
  PRO_ENTITLEMENT_ID,
  purchaseFailureMessage,
  selectBillingApiKey,
  type EntitlementSnapshot,
  type OfferPeriod,
  type ProOffer,
} from "./core/billing";

/**
 * Public SDK keys, all safe to ship in a client — the secret key, which is not
 * used here, stays on the backend.
 *
 * The Test Store key is the development default: it needs no App Store Connect
 * or Play Console setup, and its products and offerings are configured entirely
 * in the RevenueCat dashboard. One Test Store key serves both platforms, whereas
 * the real stores each need their own. Set the store keys as EAS environment
 * variables for anything you intend to ship.
 */
const TEST_STORE_API_KEY =
  process.env.EXPO_PUBLIC_MOTIF_REVENUECAT_TEST_KEY ??
  "test_yVIfltjNMGtmHLMUoCWqLkmfNqc";
const IOS_API_KEY = process.env.EXPO_PUBLIC_MOTIF_REVENUECAT_IOS_KEY ?? "";
const ANDROID_API_KEY = process.env.EXPO_PUBLIC_MOTIF_REVENUECAT_ANDROID_KEY ?? "";
const TEST_STORE_ALLOWED =
  process.env.EXPO_PUBLIC_MOTIF_REVENUECAT_ALLOW_TEST_STORE === "true";

/** Billing needs a store; Capture's web build has none. */
const STORE_PLATFORM = Platform.OS === "ios" || Platform.OS === "android";

let configured = false;

/**
 * Picks the key for this build. A real store key wins whenever one is set, so
 * shipping never silently depends on the Test Store — RevenueCat is explicit
 * that a Test Store key must never reach the App Store or Play.
 *
 * RevenueCat's current documentation calls these public SDK API keys but does
 * not promise platform-specific prefixes. Selection and credential safety live
 * in the testable core rather than guessing from an undocumented format here.
 */
function resolveApiKey(): { key: string; testStore: boolean } | { problem: string } {
  const ios = Platform.OS === "ios";
  return selectBillingApiKey({
    platformVariable: ios
      ? "EXPO_PUBLIC_MOTIF_REVENUECAT_IOS_KEY"
      : "EXPO_PUBLIC_MOTIF_REVENUECAT_ANDROID_KEY",
    platformKey: ios ? IOS_API_KEY : ANDROID_API_KEY,
    testStoreKey: TEST_STORE_API_KEY,
    allowTestStore: __DEV__ || TEST_STORE_ALLOWED,
  });
}

/**
 * Configures the SDK once, as early in app start as possible so that renewals
 * and restores are observed even if the user never opens the Account dialog.
 *
 * Deliberately configured *without* an app user id: RevenueCat starts anonymous
 * and `identifyBillingAccount` aliases it to the Cognito `sub` at login.
 * Returns a diagnostic when billing is unavailable, so callers can disable the
 * upgrade path rather than fail at the paywall.
 */
export function configureBilling(): { problem: string } | null {
  if (configured) return null;
  if (!STORE_PLATFORM) {
    return { problem: "In-app purchases aren't available on the web build." };
  }

  const resolved = resolveApiKey();
  if ("problem" in resolved) return resolved;

  if (__DEV__) Purchases.setLogLevel(LOG_LEVEL.DEBUG);

  Purchases.configure({ apiKey: resolved.key });
  configured = true;
  return null;
}

export function billingIsAvailable(): boolean {
  return configured;
}

/**
 * The package behind the last offer Capture quoted. Kept so the direct-purchase
 * fallback buys exactly the plan the button named, rather than re-deciding.
 */
let quotedPackage: PurchasesPackage | null = null;

/**
 * The plan currently on sale, taken from the dashboard's current offering. This
 * is what puts a real localized price in front of the user before they commit —
 * RevenueCat returns the storefront's own formatted price, so it is already
 * right for the device's country and currency.
 *
 * Returns null rather than throwing: an offer that hasn't loaded should soften
 * the upgrade button's label, never break the Account dialog.
 */
export async function currentProOffer(): Promise<ProOffer | null> {
  if (!configured) return null;
  try {
    const current = (await Purchases.getOfferings()).current;
    if (!current) return null;

    // Motif sells one Pro plan; annual is the headline where several exist.
    const chosen =
      current.annual ??
      current.monthly ??
      current.lifetime ??
      current.availablePackages[0] ??
      null;
    if (!chosen) return null;

    quotedPackage = chosen;
    return {
      packageId: chosen.identifier,
      productId: chosen.product.identifier,
      priceString: chosen.product.priceString,
      period: periodOf(chosen.packageType),
    };
  } catch {
    return null;
  }
}

function periodOf(packageType: PACKAGE_TYPE): OfferPeriod {
  switch (packageType) {
    case PACKAGE_TYPE.ANNUAL:
      return "annual";
    case PACKAGE_TYPE.MONTHLY:
      return "monthly";
    case PACKAGE_TYPE.LIFETIME:
      return "lifetime";
    default:
      return "other";
  }
}

/** Reduces RevenueCat's CustomerInfo to the shape the domain reasons about. */
export function snapshotOf(customerInfo: CustomerInfo): EntitlementSnapshot {
  const pro = customerInfo.entitlements.active[PRO_ENTITLEMENT_ID];
  if (!pro) {
    return { ...NO_ENTITLEMENT, managementUrl: customerInfo.managementURL };
  }

  return {
    proIsActive: pro.isActive,
    willRenew: pro.willRenew,
    expiresAtMillis: pro.expirationDateMillis,
    billingIssue: pro.billingIssueDetectedAt !== null,
    isSandbox: pro.isSandbox,
    managementUrl: customerInfo.managementURL,
    productIdentifier: pro.productIdentifier,
  };
}

/**
 * Attaches the store customer to a Motif account. Called on login and on
 * session restore, because RevenueCat's identity is per-install and must be
 * re-pointed at the account every launch.
 */
export async function identifyBillingAccount(
  sub: string,
): Promise<EntitlementSnapshot> {
  if (!configured) return NO_ENTITLEMENT;
  const { customerInfo } = await Purchases.logIn(sub);
  return snapshotOf(customerInfo);
}

/**
 * Returns the store customer to anonymous on logout, so the next account signed
 * in on this device does not inherit the previous one's entitlements.
 */
export async function forgetBillingAccount(): Promise<void> {
  if (!configured) return;
  try {
    await Purchases.logOut();
  } catch {
    // Logging out an already-anonymous customer throws; that is the state we
    // wanted anyway, and it must never block signing out of Motif.
  }
}

export async function currentEntitlement(): Promise<EntitlementSnapshot> {
  if (!configured) return NO_ENTITLEMENT;
  try {
    return snapshotOf(await Purchases.getCustomerInfo());
  } catch {
    // Cached info is unavailable and the network is down. Reporting Free here is
    // safe: the backend, not this call, decides what the account may do.
    return NO_ENTITLEMENT;
  }
}

/**
 * Observes renewals, expirations, and Family Sharing changes that happen while
 * the app is open. Returns an unsubscribe function.
 */
export function observeEntitlement(
  onChange: (snapshot: EntitlementSnapshot) => void,
): () => void {
  if (!configured) return () => {};
  const listener = (customerInfo: CustomerInfo) =>
    onChange(snapshotOf(customerInfo));
  Purchases.addCustomerInfoUpdateListener(listener);
  return () => Purchases.removeCustomerInfoUpdateListener(listener);
}

export type PaywallOutcome =
  | { readonly kind: "purchased" }
  | { readonly kind: "restored" }
  | { readonly kind: "dismissed" }
  | { readonly kind: "failed"; readonly message: string };

/**
 * Presents the paywall configured in the RevenueCat dashboard for the current
 * offering. Using the hosted paywall rather than a hand-built screen means
 * pricing, copy, and the yearly/monthly layout are changed without an app
 * release — which is the point of Paywalls.
 */
export async function presentProPaywall(): Promise<PaywallOutcome> {
  if (!configured) {
    return {
      kind: "failed",
      message: `${PRO_DISPLAY_NAME} isn't available on this device.`,
    };
  }

  try {
    const result = await RevenueCatUI.presentPaywall({
      displayCloseButton: true,
    });

    switch (result) {
      case PAYWALL_RESULT.PURCHASED:
        return { kind: "purchased" };
      case PAYWALL_RESULT.RESTORED:
        return { kind: "restored" };
      case PAYWALL_RESULT.CANCELLED:
        return { kind: "dismissed" };
      case PAYWALL_RESULT.NOT_PRESENTED:
        // No paywall is configured against the current offering. Silently doing
        // nothing here is the worst outcome — the button would simply not work
        // — so buy the plan the button quoted instead.
        return purchaseQuotedOffer();
      default:
        return { kind: "failed", message: GENERIC_PURCHASE_FAILURE };
    }
  } catch (caught) {
    return failureFrom(caught);
  }
}

/**
 * Buys the plan without a paywall screen, for when the dashboard has products
 * but no paywall. Safe because the upgrade button already carries the exact
 * price (`upgradeActionLabel`) and the store still shows its own confirmation
 * sheet — nothing is charged without the user approving it there.
 */
async function purchaseQuotedOffer(): Promise<PaywallOutcome> {
  if (!quotedPackage) await currentProOffer();
  const pkg = quotedPackage;
  if (!pkg) {
    return { kind: "failed", message: PRO_UNAVAILABLE_FROM_STORE };
  }

  try {
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    return snapshotOf(customerInfo).proIsActive
      ? { kind: "purchased" }
      : {
          kind: "failed",
          message: `Your ${PRO_DISPLAY_NAME} purchase hasn't cleared yet. We'll unlock Pro as soon as it does.`,
        };
  } catch (caught) {
    return failureFrom(caught);
  }
}

/**
 * Presents the Customer Center: cancellation, plan changes, refund requests
 * (iOS), and restore, all driven by the RevenueCat dashboard. Handing these to
 * the Customer Center is what keeps subscription-management support out of
 * Motif's own UI.
 */
export async function presentSubscriptionManagement(
  onRestored?: (snapshot: EntitlementSnapshot) => void,
): Promise<boolean> {
  if (!configured) return false;
  try {
    await RevenueCatUI.presentCustomerCenter({
      callbacks: {
        onRestoreCompleted: ({ customerInfo }) =>
          onRestored?.(snapshotOf(customerInfo)),
      },
    });
    return true;
  } catch {
    // The Customer Center is dashboard-configured, so it can be missing before
    // that setup lands. Cancelling must never become unreachable — Apple
    // requires a route to it — so fall through to the store's own screen.
    return openStoreSubscriptionSettings();
  }
}

/**
 * Opens the store's native subscription screen: the App Store management sheet
 * on iOS 13+, Play's subscription page on Android. This is the flow Apple
 * expects an app to be able to reach, and the last resort when RevenueCat's own
 * UI is unavailable.
 *
 * Returns false when no route could be opened, so callers can say so rather
 * than appear to have done nothing.
 */
export async function openStoreSubscriptionSettings(): Promise<boolean> {
  if (!configured) return false;

  try {
    await Purchases.showManageSubscriptions();
    return true;
  } catch {
    // Older iOS, or a store that has no sheet. RevenueCat reports a management
    // URL for the store that sold the subscription; open that instead.
    const { managementUrl } = await currentEntitlement();
    if (!managementUrl) return false;
    try {
      await Linking.openURL(managementUrl);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Reattaches a subscription bought earlier — on a reinstall, a new device, or a
 * different Motif account. Stores require this path to exist.
 */
export async function restoreProPurchase(): Promise<
  { readonly snapshot: EntitlementSnapshot } | { readonly message: string }
> {
  if (!configured) {
    return { message: `${PRO_DISPLAY_NAME} isn't available on this device.` };
  }
  try {
    return { snapshot: snapshotOf(await Purchases.restorePurchases()) };
  } catch (caught) {
    const failure = failureFrom(caught);
    return {
      message:
        failure.kind === "failed"
          ? failure.message
          : "Nothing to restore on this account.",
    };
  }
}

function failureFrom(caught: unknown): PaywallOutcome {
  const error = caught as Partial<PurchasesError> | null;
  const message = purchaseFailureMessage(
    error?.code === undefined ? undefined : String(error.code),
  );
  return message === null ? { kind: "dismissed" } : { kind: "failed", message };
}

/**
 * The domain layer mirrors RevenueCat's error codes as plain strings so it can
 * be tested in Node. Naming the enum members here means a renamed member fails
 * the build, and the values are checked in development builds.
 */
const SDK_ERROR_CODES: Record<
  keyof typeof BILLING_ERROR_CODES,
  PURCHASES_ERROR_CODE
> = {
  purchaseCancelled: PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR,
  storeProblem: PURCHASES_ERROR_CODE.STORE_PROBLEM_ERROR,
  purchaseNotAllowed: PURCHASES_ERROR_CODE.PURCHASE_NOT_ALLOWED_ERROR,
  productNotAvailable:
    PURCHASES_ERROR_CODE.PRODUCT_NOT_AVAILABLE_FOR_PURCHASE_ERROR,
  productAlreadyPurchased:
    PURCHASES_ERROR_CODE.PRODUCT_ALREADY_PURCHASED_ERROR,
  receiptAlreadyInUse: PURCHASES_ERROR_CODE.RECEIPT_ALREADY_IN_USE_ERROR,
  network: PURCHASES_ERROR_CODE.NETWORK_ERROR,
  invalidCredentials: PURCHASES_ERROR_CODE.INVALID_CREDENTIALS_ERROR,
  operationAlreadyInProgress:
    PURCHASES_ERROR_CODE.OPERATION_ALREADY_IN_PROGRESS_ERROR,
  paymentPending: PURCHASES_ERROR_CODE.PAYMENT_PENDING_ERROR,
  configuration: PURCHASES_ERROR_CODE.CONFIGURATION_ERROR,
  offlineConnection: PURCHASES_ERROR_CODE.OFFLINE_CONNECTION_ERROR,
};

if (__DEV__) {
  for (const [name, value] of Object.entries(SDK_ERROR_CODES)) {
    const mirrored =
      BILLING_ERROR_CODES[name as keyof typeof BILLING_ERROR_CODES];
    if (mirrored !== String(value)) {
      console.warn(
        `[billing] core/billing.ts mirrors ${name} as "${mirrored}" but the ` +
          `RevenueCat SDK now uses "${value}". Update BILLING_ERROR_CODES.`,
      );
    }
  }
}
