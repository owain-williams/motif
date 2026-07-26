# Subscription handling for Motif

_Researched 2026-03-06. Store rules and fees change frequently; re-check them before release._

## Recommendation

Use **RevenueCat as the entitlement/receipt layer**, backed by:

1. **Apple In-App Purchase** in iOS Capture.
2. **Google Play Billing** in Android Capture.
3. Optionally, **Stripe Billing** for later web sales.

Treat Motif's backend account record as the application-facing Tier projection. A verified RevenueCat webhook should grant or revoke Pro on the Motif account; Bridge should read that Tier after login rather than integrating with a payment provider itself.

For the MVP, mobile-store subscriptions alone are the simplest path. Add Stripe only when Motif has a meaningful web acquisition channel. RevenueCat can import Stripe Billing purchases and expose their entitlements to its mobile SDK, so this does not require two separate entitlement systems.

## Why a web checkout alone is insufficient

Pro unlocks app functionality and cloud storage, making it a digital service. Apple's guideline 3.1.1 says functionality unlocked in an app must use In-App Purchase. Its multiplatform-services rule allows access to features bought on the web or another platform provided those features are also available as In-App Purchases. Storefront-specific exceptions exist, including different US linking rules.

Google Play similarly requires Play Billing for Play-distributed apps accepting payment for app functionality, subscriptions, and cloud services, subject to its listed exceptions and regional programs.

Consequently, Stripe or Lemon Squeezy can complement mobile store billing, but neither is a safe global replacement for it.

## Options

| Option | Fit for Motif | Main trade-off |
|---|---|---|
| RevenueCat + Apple/Google billing | Best MVP fit | Adds a vendor and costs 1% of monthly tracked revenue after the free threshold, but normalizes receipts, renewals, restores, and entitlements. |
| Stripe Billing | Best later web channel | Strong APIs and already intended by ADR 0004, but ordinary Stripe is not Merchant of Record and does not replace mobile store billing. |
| Lemon Squeezy | Reasonable web Merchant-of-Record option | Handles tax liability/filing, but has higher transaction pricing and still does not replace mobile store billing. It also adds another entitlement integration. |
| Paddle | Alternative web Merchant of Record | Worth comparing with Lemon Squeezy if Merchant-of-Record coverage is required; RevenueCat documents Paddle as a supported web billing provider. |
| Shopify / Shop Pay | Poor fit | Motif needs account entitlements for a digital SaaS-style service, not a retail storefront/catalogue. Shop Pay is a checkout method, not a cross-store subscription authority. |
| Direct StoreKit + Play Billing | Possible, not preferred for a solo MVP | Avoids RevenueCat's fee but requires receipt validation, webhook handling, restore behavior, grace periods, refunds, and cross-platform entitlement reconciliation. |

## Published pricing snapshots

These are not directly equivalent because some providers include tax/compliance responsibilities that others do not.

- RevenueCat Pro: free up to **$2,500 monthly tracked revenue**, then **1% of tracked revenue**.
- Apple Small Business Program: **15%** commission for eligible developers.
- Google Play: subscriptions are currently listed at **15%** in remaining markets; Google has announced a revised fee structure beginning **30 June 2026** for the EEA, UK, and US.
- Stripe UK standard domestic cards: **1.5% + 20p**; Stripe Billing pay-as-you-go adds **0.7% of Billing volume**. Tax/compliance products can add cost.
- Lemon Squeezy ecommerce: **5% + 50¢**, with some edge-case additional fees; it states that it is Merchant of Record and handles sales-tax/VAT collection and filing.

## Motif-specific cautions

- Store product IDs and payment-provider customer IDs should not become Motif's domain model. Map them to the single `Pro` entitlement/Tier at the billing boundary.
- Link purchases to the Cognito account, not a device. Free remains accountless, while Pro requires an account.
- Process webhooks idempotently and preserve expiration/grace-period state; do not trust a client-supplied Tier.
- Keep the existing temporary tier-assignment endpoint out of production once billing owns paid Tier changes.
- Model StoreKit/Play/Stripe as interchangeable purchase sources so web billing can be added without changing Capture or Bridge's Tier rules.
- The economics must include 150 GB cloud storage, relay transfer, and store commission—not only payment-processing fees.

## Primary sources

- Apple, App Review Guidelines, sections 3.1.1 and 3.1.3(b): https://developer.apple.com/app-store/review/guidelines/
- Apple, App Store Small Business Program: https://developer.apple.com/app-store/small-business-program/
- Google Play, Payments policy: https://support.google.com/googleplay/android-developer/answer/9858738
- Google Play, Service fees: https://support.google.com/googleplay/android-developer/answer/112622
- RevenueCat, Pricing: https://www.revenuecat.com/pricing/
- RevenueCat, Stripe Billing integration: https://www.revenuecat.com/docs/web/integrations/stripe
- Stripe UK, Pricing: https://stripe.com/gb/pricing
- Stripe Tax documentation: https://docs.stripe.com/tax
- Lemon Squeezy, Pricing and Merchant-of-Record statement: https://www.lemonsqueezy.com/pricing
