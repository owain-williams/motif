import * as Location from "expo-location";
import type {
  GeoPosition,
  LastKnownPositionReader,
  ReverseGeocoder,
} from "./core/capture-location";

/**
 * Device wiring for opt-in location tagging (motif-kka.3) — the thin expo-location
 * shell behind the pure `resolveCaptureLocation` decision in `core/location tag`. It
 * asks for foreground permission when the user enables the toggle, reads the
 * OS's last-known position (never a fresh fix, so the record flow never blocks),
 * and best-effort reverse-geocodes to a concise place label.
 */

/** How long a reverse geocode may take before the save proceeds label-less. */
const GEOCODE_TIMEOUT_MS = 4_000;

/**
 * Requests foreground location permission — called when the user turns the
 * location tag toggle on, so recording itself is never interrupted by a prompt.
 * Returns whether access was granted.
 */
export async function ensureLocationPermission(): Promise<boolean> {
  const { granted } = await Location.requestForegroundPermissionsAsync();
  return granted;
}

/** Reads the device's cached position without waiting for a fresh GPS fix. */
export const readLastKnownPosition: LastKnownPositionReader = async () => {
  const position = await Location.getLastKnownPositionAsync();
  if (!position) return null;
  return { lat: position.coords.latitude, lon: position.coords.longitude };
};

function conciseLabel(address: Location.LocationGeocodedAddress): string {
  return (
    address.city ??
    address.district ??
    address.subregion ??
    address.region ??
    address.name ??
    ""
  );
}

/**
 * Best-effort reverse geocode, bounded by {@link GEOCODE_TIMEOUT_MS} so a slow
 * network never stalls the save — on timeout it resolves to an empty label and
 * the coordinates are stored alone.
 */
export const reverseGeocode: ReverseGeocoder = async (position: GeoPosition) => {
  const lookup = Location.reverseGeocodeAsync({
    latitude: position.lat,
    longitude: position.lon,
  }).then((results) => (results[0] ? conciseLabel(results[0]) : ""));
  const timeout = new Promise<string>((resolve) => {
    setTimeout(() => resolve(""), GEOCODE_TIMEOUT_MS);
  });
  return Promise.race([lookup, timeout]);
};
