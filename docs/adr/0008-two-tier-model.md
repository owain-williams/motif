# Two tiers: Free and Pro

Motif has two account tiers — Free and Pro — replacing the Free/Basic/Pro split of ADR 0002. Free is unchanged: local-network sync only, no account, no cloud storage, mono AAC. Pro absorbs Basic, keeping the cloud relay both paid tiers already had and remaining the only tier that records stereo or uncompressed audio, while its cloud storage quota is deliberately **cut from 1TB to 150GB**. Basic was dropped because a middle tier differing from Pro only in quota did not earn its price point, and it forced a three-way branch through every tier check in Capture, Bridge, and the backend.

## Considered Options

The obvious collapse would have kept format as a fact of the tier — Pro means WAV, as it did before. Instead **audio format became a choice within Pro**, defaulting to AAC.

WAV-only Pro was rejected on arithmetic, but only once the quota came down — the reduction is what forces the choice, not uncompressed audio itself. At 1TB the question never arose: WAV-only Pro held roughly 1,730 hours of 44.1kHz/16-bit stereo. At 150GB it holds roughly 250 hours, against roughly 2,800 hours of 128kbps AAC at the same quota. A WAV-only Pro would therefore have stored *fewer hours than the Basic tier it replaces* (~470 hours at 25GB of AAC), which is a strange thing to sell as the upgrade. Motif exists to catch short hummed fragments, where uncompressed rarely earns its bytes — so AAC is what a Pro user gets without touching anything, and WAV is opted into for the takes that are worth it.

Making the quota float with usage (silently dropping to AAC near the limit) was also considered and rejected: it makes an Idea's format non-deterministic, so two Ideas recorded minutes apart could differ for reasons invisible to the user.

## Consequences

The 150GB meters every byte an account holds in cloud storage — its whole relay-synced Library, not just its offloaded Ideas. Offloading therefore frees device space and no quota; only deleting an Idea returns cloud storage. This makes the meter match what the storage actually costs to run, at the price of an Offloaded/quota relationship that reads as counter-intuitive until stated.

Because format is no longer implied by tier, nothing may infer an Idea's format from the account that recorded it — a single Pro Library can mix AAC and WAV freely. Any code that reasons about format must read it from the Idea. ADR 0001 is unaffected by this: shared Ideas are still always transcoded to a compressed format regardless of tier, a rule that simply becomes a no-op more often.

Accounts already stored as Basic are read as Pro rather than migrated, so no existing account silently loses cloud sync when the tier disappears.
