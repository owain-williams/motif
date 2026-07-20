import type { IdeaLocation } from "@motif/shared";

/**
 * Opt-in location tagging (motif-kka.3). When the user has enabled it in settings,
 * Capture attaches the device's last-known position to a new recording and
 * best-effort reverse-geocodes it to a place label. Everything here is pure and
 * framework-agnostic: the device shell injects the position reader and geocoder
 * (backed by expo-location) so this decision is unit-testable without hardware.
 */

/** A coordinate pair — the minimum a location tag needs. */
export interface GeoPosition {
  readonly lat: number;
  readonly lon: number;
}

/**
 * Reads the device's last-known/cached position without waiting for a fresh GPS
 * fix. Resolves `null` when no cached position or permission is available. Must
 * not block the record flow — it returns whatever the OS already has.
 */
export type LastKnownPositionReader = () => Promise<GeoPosition | null>;

/**
 * Best-effort reverse geocode of a position to a place label. Resolves `""`
 * (or rejects, which the resolver treats as `""`) when no label is available —
 * e.g. offline. Never blocks a save on a network round-trip failing.
 */
export type ReverseGeocoder = (position: GeoPosition) => Promise<string>;

export interface CaptureLocationInputs {
  /** The persisted opt-in toggle. When off, no location is ever captured. */
  readonly enabled: boolean;
  readonly readLastKnownPosition: LastKnownPositionReader;
  readonly reverseGeocode: ReverseGeocoder;
}

/**
 * Resolves the location to stamp on a freshly captured Idea, honouring the
 * opt-in toggle:
 *
 * - toggle off → `null` (no location is ever captured);
 * - no cached position (or the reader fails) → `null`;
 * - a position but geocoding fails/returns nothing → the coordinates with an
 *   empty label, so the save is never blocked on the network.
 *
 * A successful geocode yields the coordinates plus the trimmed place label.
 */
export async function resolveCaptureLocation(
  inputs: CaptureLocationInputs,
): Promise<IdeaLocation | null> {
  if (!inputs.enabled) return null;

  const position = await inputs.readLastKnownPosition().catch(() => null);
  if (!position) return null;

  const label = await inputs
    .reverseGeocode(position)
    .then((value) => value.trim())
    .catch(() => "");

  return { lat: position.lat, lon: position.lon, label };
}
