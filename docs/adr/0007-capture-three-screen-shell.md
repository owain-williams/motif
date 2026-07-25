# Capture is three screens over one token layer

Capture presents Record, Library and Sync — Record and Library as the two tabs, Sync pushed from the status pill on Record — plus a three-card first-run onboarding. It replaces the single scrolling screen that stacked the record button, pairing, settings and Library together.

The split follows what the app is for. Record holds nothing configurable, so the first tap after opening the app always starts a capture. Library is the flat, reverse-chronological list with search and Tag chips, and keeps only playing in the row — rename, tags, share, offload and delete sit behind a per-row actions sheet. Sync answers where an Idea went, and is where the account, recording format and location tagging live, because none of them is worth a tab.

Every colour, font and radius comes from `src/theme.ts`; the typefaces (Geist, Geist Mono, Instrument Serif) are loaded through `expo-font` and the app holds a black launch screen until they and the persisted settings are in, so nothing renders twice in two different faces. Icons are `react-native-svg` rather than glyphs or border tricks.

Presentation decisions that can be made without a device stay out of the components, following the test-seam pattern: the recording clock, the level meter's rolling window, Library filtering and empty-state copy, relative capture labels, the onboarding sequence and the Sync screen's figures are all pure modules in `src/core` with Vitest coverage. The screens under `src/components` render what those return.

## Consequences

The Library's per-row Tags do the work the source design gave to a star and a "Starred" chip. Motif has no favourite concept — Tags are the findability mechanism (CONTEXT.md) — and adding one means a new synced field in `@motif/shared`, in Bridge's Rust mirror and in the relay. That decision is deferred rather than made by the UI.

"Queued" on the Library row and the Sync screen is exactly `ideasToOffer` computed against the ids peers have reported holding, so the count can never disagree with what the next pass would send. It requires the sync transports to report the peer's manifest back to the caller, which they now do.

Recording enables live analysis (`enableProcessing`, 100 ms emissions) so the meter and the tenths-place clock have something real to show. That costs some CPU on every capture; `keepFullAnalysis` stays off so a long recording never accumulates its analysis in memory.
