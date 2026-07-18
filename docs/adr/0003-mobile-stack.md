# Capture built with Expo; pnpm workspaces + Turborepo monorepo

Capture (mobile) is built with Expo/React Native rather than Flutter. Bridge (desktop) is Tauri, pairing a Rust core with a TypeScript web frontend — choosing Expo over Flutter means Capture and Bridge share one language for the sync protocol types, Idea metadata schema, and validation logic, instead of hand-maintaining parity between Dart and Rust/TS. The monorepo uses pnpm workspaces with Turborepo for orchestration; Bridge's Rust core stays a normal Cargo project untouched by the JS tooling.

## Consequences

Gives up some of Flutter's native-performance and audio-tooling maturity in exchange for cross-app code sharing.
