import { describe, expect, it } from "vitest";
import {
  IDLE_METER,
  METER_BAR_COUNT,
  pushLevels,
  type MeterSample,
} from "./level-meter";

function samples(from: number, count: number, amplitude = 1): MeterSample[] {
  return Array.from({ length: count }, (_, index) => ({
    id: from + index,
    amplitude,
  }));
}

describe("pushLevels", () => {
  it("starts silent and full width", () => {
    expect(IDLE_METER.levels).toHaveLength(METER_BAR_COUNT);
    expect(IDLE_METER.levels.every((level) => level === 0)).toBe(true);
  });

  it("keeps the meter the same width as it fills", () => {
    const meter = pushLevels(IDLE_METER, samples(0, 3));
    expect(meter.levels).toHaveLength(METER_BAR_COUNT);
    expect(meter.levels.slice(-3)).toEqual([1, 1, 1]);
    expect(meter.levels.slice(0, -3).every((level) => level === 0)).toBe(true);
  });

  it("scrolls the oldest bars out once the window is full", () => {
    const filled = pushLevels(IDLE_METER, samples(0, METER_BAR_COUNT, 0.25));
    const scrolled = pushLevels(filled, samples(METER_BAR_COUNT, 2, 1));

    expect(scrolled.levels).toHaveLength(METER_BAR_COUNT);
    expect(scrolled.levels.slice(-2)).toEqual([1, 1]);
    expect(scrolled.levels.slice(0, -2)).toEqual(filled.levels.slice(2));
  });

  it("ignores points it has already shown, however they are re-delivered", () => {
    const meter = pushLevels(IDLE_METER, samples(0, 4));
    // The recorder re-sends the whole analysis so far plus one new point.
    const next = pushLevels(meter, samples(0, 5));

    expect(next.levels.slice(-5)).toEqual([1, 1, 1, 1, 1]);
    expect(next.levels.slice(-6, -5)).toEqual([0]);
    expect(next.lastPointId).toBe(4);
  });

  it("returns the same meter when nothing new arrived", () => {
    const meter = pushLevels(IDLE_METER, samples(0, 4));
    expect(pushLevels(meter, samples(0, 4))).toBe(meter);
    expect(pushLevels(meter, [])).toBe(meter);
  });

  it("opens up quiet material rather than reading as flat", () => {
    const meter = pushLevels(IDLE_METER, [{ id: 0, amplitude: 0.04 }]);
    const [bar] = meter.levels.slice(-1);
    expect(bar).toBeGreaterThan(0.04);
    expect(bar).toBeLessThanOrEqual(1);
  });

  it("clamps out-of-range and invalid amplitudes", () => {
    const meter = pushLevels(IDLE_METER, [
      { id: 0, amplitude: 4 },
      { id: 1, amplitude: -2 },
      { id: 2, amplitude: Number.NaN },
    ]);
    expect(meter.levels.slice(-3)).toEqual([1, 0, 0]);
  });
});
