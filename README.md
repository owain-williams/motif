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

The home screen is the core capture loop: a single record button that starts and
stops on tap, auto-saving each recording as an Idea (no naming prompt) into a
reverse-chronological Library. Each Library entry shows a waveform, name, and
duration; tapping it plays the audio, and it can be renamed or deleted in place.
The record/stop toggle lives in the tested `src/core` recording session; naming,
Idea construction, Library ordering, rename/delete, and the waveform come from
`@motif/shared`; audio persistence and playback wiring are in `src/idea-storage`
and `App.tsx`.

Capture can be used without an account at the Free tier. Its Account dialog also
supports Cognito email sign-up/confirmation and login; logged-in sessions expose
the account's Free/Basic/Pro tier. A temporary in-dialog tier control stands in
for billing during development. Basic/Pro Ideas are copied to the authenticated
cloud relay as well as using the existing local-network path when available;
Free never calls the relay.

The waveform is currently synthesized deterministically from the Idea id (a stable
placeholder); rendering the real recorded amplitude is tracked in motif-6fu.13.

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
Bridge can log into the same Basic/Pro account to poll the relay while continuing
to listen for local-network sync. Its relay token is held in memory for the
current app session only.

## Where behavior goes (test seams)

Per the epic's testing decisions, domain logic lives in framework-agnostic cores
so it can be tested without a simulator, device, or window:

- **`@motif/shared`** (plain TypeScript, Vitest) — Idea lifecycle (auto-naming,
  construction), Tier rules, Library ordering, and — later — Offload transitions
  and share-export format selection.
- **Capture core** — `apps/capture/src/core` (plain TypeScript, Vitest) — the
  Capture-only recording session (record/stop toggle, duration). The Expo shell
  (`App.tsx`, `src/idea-storage`, `src/recording-config`) stays a thin adapter
  over it and `@motif/shared`.
- **`bridge-core`** (Rust, `cargo test`) — local-network discovery/transfer,
  cloud relay client, transcode orchestration, multi-device pairing. The Tauri
  commands layer (`src-tauri`) stays a thin adapter over it.

Everything shipped in this scaffold is a placeholder shell; feature work lands in
later tickets under epic `motif-6fu`.
