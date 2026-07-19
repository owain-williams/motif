import { syntheticWaveform } from "@motif/shared";

export const LIBRARY_WAVEFORM_BAR_COUNT = 24;

/**
 * Chooses the waveform shown for an Idea. Newly captured Ideas use peaks
 * extracted from their audio; the deterministic shape remains only as a
 * compatibility fallback for Ideas without a valid device-local sidecar.
 */
export function ideaWaveform(
  ideaId: string,
  persistedPeaks?: readonly number[],
): readonly number[] {
  if (
    persistedPeaks &&
    persistedPeaks.length > 0 &&
    persistedPeaks.every((peak) => Number.isFinite(peak) && peak >= 0 && peak <= 1)
  ) {
    return persistedPeaks;
  }
  return syntheticWaveform(ideaId, LIBRARY_WAVEFORM_BAR_COUNT);
}
