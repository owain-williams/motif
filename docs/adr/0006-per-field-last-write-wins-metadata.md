# Per-field last-write-wins for bidirectional Idea metadata edits

Sync was one-directional and copy-only (ADR 0002): Capture pushes new Ideas to Bridge, nothing flows back. Letting Bridge also edit metadata (name, tags, instrument, style, tempo, location) means edits can now originate on either device and must propagate both ways, which raises a conflict question sync never had before. We chose per-field last-write-wins by edit timestamp — each field carries its own `updatedAt`, and the newer edit wins independently per field — over two alternatives: surfacing conflicts to the user (rejected as disproportionate ceremony for a single-user tool with low-stakes fields), and a single whole-Idea timestamp (rejected because a stale edit to one field, e.g. a name change made just before a device went offline, would then clobber an unrelated, genuinely newer edit to a different field, e.g. a tag added after).

## Consequences

This trusts each device's clock for ordering; there's no vector-clock or causal tracking, so a device with a badly wrong clock could "win" a merge incorrectly. Accepted because this is personal-device sync (one account's own devices), not multi-user collaboration, where that failure mode would be more damaging.
