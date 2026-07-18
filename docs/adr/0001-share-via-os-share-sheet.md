# Share via OS share sheet, not in-app social

Sharing an Idea with a friend uses the phone's native share sheet (Messages, WhatsApp, AirDrop, etc.) rather than an in-app friends/feed system. This avoids building accounts, a social graph, and moderation for v1, at the cost of a less integrated sharing experience. Shared Ideas are always transcoded to a compressed format regardless of the sender's tier, so a Pro user's uncompressed WAV is never sent as an oversized attachment.

## Consequences

If in-app social features are wanted later, they'll need new infrastructure — this isn't an extension point, it's a deliberate absence.
