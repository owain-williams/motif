/**
 * Waveform bars for a Library entry (CONTEXT.md: each Idea shows a waveform).
 *
 * These heights are *synthesized* deterministically from a seed (the Idea id),
 * not decoded from the audio — a placeholder shape until real amplitude peaks
 * are captured (tracked separately). Being a pure function of the id, an Idea
 * renders an identical, stable waveform across re-renders, reloads, and both
 * Capture and Bridge.
 */

const DEFAULT_BAR_COUNT = 48;

/** Smallest bar height, so even quiet-looking bars stay visible. */
const MIN_HEIGHT = 0.12;

/** xmur3 string hash → 32-bit seed for the PRNG. */
function seedFrom(text: string): number {
  let h = 1779033703 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

/** mulberry32 PRNG: deterministic, uniform floats in [0, 1). */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Produces `barCount` bar heights in `(0, 1]`, derived deterministically from
 * `seed`. Pass the Idea id as the seed.
 */
export function syntheticWaveform(
  seed: string,
  barCount: number = DEFAULT_BAR_COUNT,
): number[] {
  const next = mulberry32(seedFrom(seed));
  const bars: number[] = [];
  for (let i = 0; i < barCount; i++) {
    bars.push(MIN_HEIGHT + next() * (1 - MIN_HEIGHT));
  }
  return bars;
}
