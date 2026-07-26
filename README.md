# Motif

Quick-capture for musical ideas. Two connected apps:

- **Capture** (`apps/capture`) — mobile (Android/iOS), Expo/React Native/TypeScript. Records Ideas and holds the Library.
- **Bridge** (`apps/bridge`) — desktop (macOS/Windows/Linux), Tauri (Rust core + TypeScript frontend). Receives synced Ideas and hands them off to a DAW.

Domain vocabulary (Idea, Capture, Bridge, Library, Tier, Offloaded) lives in [`CONTEXT.md`](./CONTEXT.md); architecture decisions in [`docs/adr/`](./docs/adr).

## Monorepo layout

```
motif/
├── apps/
│   ├── capture/            Expo / React Native app (Capture)
│   └── bridge/             Tauri app (Bridge)
│       ├── src/            TypeScript frontend (Vite)
│       ├── core/           bridge-core — Rust domain logic + cargo tests
│       └── src-tauri/      Tauri shell — thin adapter over bridge-core
├── packages/
│   └── shared/             @motif/shared — Idea schema + sync protocol types
├── pnpm-workspace.yaml     pnpm workspaces
└── turbo.json              Turborepo task pipeline
```

Tooling: **pnpm workspaces + Turborepo** (ADR 0003). The shared package is plain
TypeScript consumed by both apps' frontends; Bridge's Rust core keeps its own
equivalent types. `.npmrc` sets `node-linker=hoisted` because Expo/Metro do not
support pnpm's default symlinked layout.

## Prerequisites

- **Node** ≥ 20 and **pnpm** 11 (`corepack enable`)
- **Rust** (stable) + Cargo — for Bridge
- **Capture native runs**: Xcode + iOS Simulator (macOS) for iOS; Android Studio + an emulator for Android. Capture uses a custom audio native module, so use its development build rather than Expo Go.
- **Bridge native runs**: platform Tauri prerequisites — see https://tauri.app/start/prerequisites/ (WebKitGTK + build tools on Linux; nothing extra on macOS/Windows beyond the toolchain)

## Install

```bash
pnpm install
```

## Build & test all targets

```bash
pnpm build       # turbo: shared → bridge frontend + capture web bundle
pnpm typecheck   # tsc --noEmit across shared, capture, bridge
pnpm test        # JS/TS test suites (Vitest in @motif/shared + apps/capture)
```

Rust side (Bridge):

```bash
cd apps/bridge && cargo test --workspace   # bridge-core integration tests
cd apps/bridge && cargo check --workspace  # compiles Tauri shell + core
```

## Capture (mobile)

```bash
cd apps/capture
pnpm start          # Metro dev server for an installed development build
pnpm ios            # build + launch on an iOS Simulator          (macOS + Xcode)
pnpm android        # build + launch on an Android emulator/device (Android SDK)
pnpm web            # run in a browser (react-native-web)
pnpm build          # expo export (all platforms) → apps/capture/dist
```

Capture is three screens — Record and Library as tabs, Sync pushed from Record's
status pill — behind a three-card first run (ADR 0007). Record is the core
capture loop: a single button that starts and stops on tap, over a live clock
and level meter, auto-saving each recording as an Idea (no naming prompt) into a
reverse-chronological Library. Each Library entry shows a waveform, name,
duration, capture time and Tags; tapping it plays the audio (the waveform
doubles as the playhead), and rename, tags, share, offload and delete sit behind
the row's actions sheet. Sync reports what has reached the paired Bridge and
what is still queued, and holds the account, recording format and location
tagging.

Design tokens (palette, radii, type scale) live in `src/theme.ts`, and the
Geist / Geist Mono / Instrument Serif typefaces load through `expo-font`; nothing
under `src/components` hard-codes a colour or a font name. Presentation logic
that needs no device — the recording clock, the level meter's rolling window,
Library filtering and empty-state copy, relative capture labels, onboarding, and
the Sync screen's figures — lives in tested `src/core` modules; naming, Idea
construction, and Library ordering/rename/delete come from `@motif/shared`. Audio
persistence, device-local waveform sidecars, and playback wiring are in
`src/idea-storage` and `App.tsx`.

Capture can be used without an account at the Free tier. Its Account dialog also
supports Cognito email sign-up/confirmation and login, and offers the RevenueCat
paywall that sells Pro (see [Subscriptions](#subscriptions-revenuecat)). A
completed purchase unlocks Pro immediately from the store entitlement. Cloud relay
is the exception: the backend checks its own account Tier on those routes, and
that Tier is only ever assigned by a verified RevenueCat webhook — so cloud sync
switches on a moment later, once the webhook lands. Development accounts get a
Tier through [`pnpm --filter @motif/infra tier`](infra/README.md). Pro Ideas are copied to the
authenticated cloud relay as well as using the existing local-network path when
available. Signing
Capture into a paid account pairs that Capture through the account, so multiple
phones/tablets signed into the same account contribute to one relay
Library; Free never calls the relay and retains its single direct Capture ↔
Bridge pairing. Capture discovers a running Bridge automatically over
Bonjour/mDNS on the same local network, leaving only Bridge's six-digit pairing
code for the user to enter. Native discovery requires an installed development
build rather than Expo Go; use a physical Android device because emulators do
not reliably support multicast DNS.

Capture extracts normalized amplitude peaks from each saved audio file and keeps
them in a device-local sidecar, outside portable Idea metadata. Library entries
render those real peaks; Ideas captured before sidecars existed retain a stable
synthetic fallback.

## Subscriptions (RevenueCat)

Capture sells Pro through RevenueCat's SDK and hosted Paywall
(`react-native-purchases` + `react-native-purchases-ui`). Two rules govern the
integration, and most setup mistakes are a violation of one of them:

1. **The store unlocks Pro; the backend unlocks cloud relay.** A completed
   purchase makes `unlockedTier` return Pro straight away, so stereo, WAV, and the
   rest are live before any webhook. Cloud relay routes are checked server-side
   against the account Tier, which only a verified RevenueCat webhook assigns — so
   Capture reconciles `GET /me` in the background and reports `cloudSyncPending`
   until it agrees. See [infra/README.md](infra/README.md).
2. **Purchases belong to the account, not the device.** The webhook rejects
   anonymous (`$RCAnonymousID:`) app user ids, so Capture calls
   `Purchases.logIn(<Cognito sub>)` at login and on every session restore. A
   purchase made while logged out could never reach an account, so choosing Pro
   while signed out opens the Account dialog first and the purchase resumes by
   itself once login succeeds — the detour is not a dead end.

Prices come from the offering (`currentProOffer`), so the store's own localized
price is quoted on the upgrade button and on the Sync screen before anything is
tapped. If the dashboard has products but no Paywall, `presentPaywall` returns
`NOT_PRESENTED` and Capture buys the quoted package directly rather than
appearing to do nothing; the store still shows its own confirmation sheet.

### Dashboard setup

| Item | Value |
|---|---|
| Entitlement identifier | `Motif Pro` — must equal `REVENUECAT_PRO_ENTITLEMENT_ID` on the Lambda and `PRO_ENTITLEMENT_ID` in `apps/capture/src/core/billing.ts` |
| Offering | `default` (the "current" offering the paywall loads) |
| Packages | Annual (`$rc_annual`) and Monthly (`$rc_monthly`) |
| Products | Subscription products attached to those packages, both granting `Motif Pro` |

With the Test Store (below) the products and offering are created entirely in the
RevenueCat dashboard. For real sales, create the two subscription products in App
Store Connect and Google Play first, import them into RevenueCat, attach each to
its package in the `default` offering, and attach the `Motif Pro` entitlement to
both. Then design the Paywall against that offering — its pricing and copy are
dashboard-side, so they change without an app release. Enable the Customer Center
to get cancellation, plan changes, refund requests (iOS), and restore; Capture
presents it from **Account → Manage subscription** rather than building those
screens. If the Customer Center is not enabled, that button falls back to
`Purchases.showManageSubscriptions()` — the App Store's own management sheet —
and then to the store's management URL, so cancelling is never unreachable.

Webhook configuration (URL and Authorization credential) is in
[infra/README.md](infra/README.md).

### API keys

All of these are **public SDK API keys**, found under RevenueCat → **API keys →
SDK API keys** (or **Apps → select the app**). The secret `sk_` keys and OAuth
`atk_` tokens are never used by the app.

Development defaults to the **Test Store** key, which is already set in
`src/billing.ts`. It needs no App Store Connect or Play Console setup and
simulates real purchases — they update `CustomerInfo`, trigger entitlements, and
appear in the dashboard. One Test Store key serves both platforms:

```bash
EXPO_PUBLIC_MOTIF_REVENUECAT_TEST_KEY=test_xxxxxxxxxxxxxxxxxxxx   # optional override
```

The EAS `preview` profile explicitly selects and allows the Test Store key. On
iOS it uses Debug because RevenueCat intentionally terminates Release apps that
contain a Test Store key. `FORCE_BUNDLING=1` activates the local config plugin,
which embeds the JavaScript bundle anyway, so this internal build remains
standalone and does not require Metro. For anything you intend to ship, set each app's public SDK API
key as an EAS `production` environment variable. Either one takes precedence
over the Test Store key on its platform:

```bash
EXPO_PUBLIC_MOTIF_REVENUECAT_IOS_KEY=<Apple app public SDK API key>
EXPO_PUBLIC_MOTIF_REVENUECAT_ANDROID_KEY=<Google app public SDK API key>
```

RevenueCat does not document public platform-key prefixes as a stable contract,
so Capture accepts the app-specific SDK key format the dashboard provides while
rejecting documented secret (`sk_`) and OAuth (`atk_`) credentials. RevenueCat
forbids submitting an app configured with a Test Store key, so Test Store also
requires the preview-only `EXPO_PUBLIC_MOTIF_REVENUECAT_ALLOW_TEST_STORE=true`;
a production build with no platform key refuses to configure billing rather than
shipping simulated purchases. Billing is unavailable on the web build; Capture
stays fully usable at Free there.

### After installing

Both packages are native modules, so a JS reload is not enough:

```bash
cd apps/capture
npx expo prebuild --clean   # regenerates ios/ + android/ (both are gitignored)
pnpm ios                    # or: pnpm android
```

Expo Go cannot run either package, so a development build is required whichever
store you point at. Test Store purchases are simulated by RevenueCat rather than
StoreKit or Play Billing, which is what removes the store-console setup; real
sandbox purchases still need a device signed into a sandbox store account.

## Bridge (desktop)

```bash
cd apps/bridge
pnpm dev            # Vite dev server for the frontend only
pnpm app:dev        # tauri dev — launches the native window (macOS/Windows/Linux)
pnpm app:build      # tauri build — produces native installers
pnpm build          # frontend production build → apps/bridge/dist
```

`tauri dev`/`tauri build` invoke the frontend build automatically
(`beforeDevCommand` / `beforeBuildCommand` in `src-tauri/tauri.conf.json`).
Bridge can log into the same Pro account to poll the account-scoped relay while
continuing to listen for local-network sync. Ideas from every Capture signed
into that account converge into the same Bridge Library. Its relay token is held
in memory for the current app session only.

## Where behavior goes (test seams)

Per the epic's testing decisions, domain logic lives in framework-agnostic cores
so it can be tested without a simulator, device, or window:

- **`@motif/shared`** (plain TypeScript, Vitest) — Idea lifecycle (auto-naming,
  construction), Tier rules, Library ordering, and — later — Offload transitions
  and share-export format selection.
- **Capture core** — `apps/capture/src/core` (plain TypeScript, Vitest) — the
  Capture-only recording session, Library waveform selection, and the screens'
  presentation logic (recording clock, level meter, Library filtering, relative
  capture labels, onboarding, sync figures). The Expo shell (`App.tsx`,
  `src/components`, `src/idea-storage`, `src/recording-config`) stays a thin
  adapter over it and `@motif/shared`.
- **`bridge-core`** (Rust, `cargo test`) — local-network discovery/transfer,
  cloud relay client, transcode orchestration, multi-device pairing. The Tauri
  commands layer (`src-tauri`) stays a thin adapter over it.

Everything shipped in this scaffold is a placeholder shell; feature work lands in
later tickets under epic `motif-6fu`.
