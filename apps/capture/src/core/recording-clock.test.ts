import { describe, expect, it } from "vitest";
import { formatRecordingClock } from "./recording-clock";

describe("formatRecordingClock", () => {
  it("rests at zero before a recording starts", () => {
    expect(formatRecordingClock(0)).toBe("0:00.0");
  });

  it("shows tenths so a running capture visibly ticks", () => {
    expect(formatRecordingClock(100)).toBe("0:00.1");
    expect(formatRecordingClock(900)).toBe("0:00.9");
  });

  it("floors partial tenths rather than showing time not yet recorded", () => {
    expect(formatRecordingClock(1999)).toBe("0:01.9");
  });

  it("pads seconds but not minutes", () => {
    expect(formatRecordingClock(65_400)).toBe("1:05.4");
  });

  it("keeps counting minutes past an hour instead of adding a field", () => {
    expect(formatRecordingClock(3_723_500)).toBe("62:03.5");
  });

  it("rests at zero for negative or invalid input", () => {
    expect(formatRecordingClock(-500)).toBe("0:00.0");
    expect(formatRecordingClock(Number.NaN)).toBe("0:00.0");
  });
});
