/**
 * The live level meter on the Record screen — a fixed-width window of recent
 * loudness that scrolls left as the recorder emits analysis points.
 *
 * The recorder hands back whatever analysis it currently holds, which may be
 * the newest chunk or the whole recording so far, and may repeat points across
 * emissions. This module turns that into a stable window: it takes only points
 * it hasn't seen, so the meter advances exactly once per captured segment
 * rather than lurching forward whenever the shape of the delivery changes.
 */

/** Bars across the meter. Fixed, so the meter never reflows mid-recording. */
export const METER_BAR_COUNT = 44;

export interface LevelMeter {
  /** Bar heights in `[0, 1]`, oldest first. Always {@link METER_BAR_COUNT} long. */
  readonly levels: readonly number[];
  /** Highest analysis-point id already folded in; `-1` before any. */
  readonly lastPointId: number;
}

/** A recorder analysis point, narrowed to what the meter needs. */
export interface MeterSample {
  readonly id: number;
  readonly amplitude: number;
}

/** A silent, unstarted meter — also what a stopped recording resets to. */
export const IDLE_METER: LevelMeter = {
  levels: new Array<number>(METER_BAR_COUNT).fill(0),
  lastPointId: -1,
};

function barHeight(amplitude: number): number {
  if (!Number.isFinite(amplitude)) return 0;
  const clamped = Math.min(1, Math.max(0, amplitude));
  // Amplitude is linear, hearing is not: a hummed melody sits low enough that a
  // linear meter reads as flat. The square root opens up the quiet end so the
  // meter responds to the material Motif is actually for.
  return Math.sqrt(clamped);
}

/**
 * Folds newly captured analysis points into the meter, scrolling the window
 * left. Points at or below the last id seen are ignored as already shown.
 * Returns the meter unchanged when there is nothing new, so an idle emission
 * doesn't re-render the meter.
 */
export function pushLevels(
  meter: LevelMeter,
  samples: readonly MeterSample[],
): LevelMeter {
  const fresh = samples.filter((sample) => sample.id > meter.lastPointId);
  if (fresh.length === 0) return meter;
  const levels = [...meter.levels, ...fresh.map((sample) => barHeight(sample.amplitude))]
    .slice(-METER_BAR_COUNT);
  return {
    levels,
    lastPointId: fresh.reduce(
      (highest, sample) => Math.max(highest, sample.id),
      meter.lastPointId,
    ),
  };
}
