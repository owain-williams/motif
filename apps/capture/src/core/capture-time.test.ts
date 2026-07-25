import { describe, expect, it } from "vitest";
import { formatCapturedAt } from "./capture-time";

const ZONE = "Europe/London";
/** Sunday 12 July 2026, 14:30 in London. */
const NOW = Date.parse("2026-07-12T14:30:00+01:00");

function at(iso: string): number {
  return Date.parse(iso);
}

describe("formatCapturedAt", () => {
  it("gives today's captures a time of day, with an unpadded hour", () => {
    expect(formatCapturedAt(at("2026-07-12T09:12:00+01:00"), NOW, ZONE)).toBe(
      "Today 9:12",
    );
    expect(formatCapturedAt(at("2026-07-12T00:05:00+01:00"), NOW, ZONE)).toBe(
      "Today 0:05",
    );
    expect(formatCapturedAt(at("2026-07-12T13:48:00+01:00"), NOW, ZONE)).toBe(
      "Today 13:48",
    );
  });

  it("names yesterday rather than dating it", () => {
    expect(formatCapturedAt(at("2026-07-11T23:55:00+01:00"), NOW, ZONE)).toBe(
      "Yesterday",
    );
  });

  it("compares calendar days, not elapsed hours", () => {
    // Five minutes earlier, but the day has turned.
    const justBeforeMidnight = at("2026-07-12T00:00:00+01:00") - 5 * 60_000;
    expect(
      formatCapturedAt(justBeforeMidnight, at("2026-07-12T00:05:00+01:00"), ZONE),
    ).toBe("Yesterday");
  });

  it("uses the weekday within the past week", () => {
    expect(formatCapturedAt(at("2026-07-10T08:00:00+01:00"), NOW, ZONE)).toBe("Fri");
    expect(formatCapturedAt(at("2026-07-07T08:00:00+01:00"), NOW, ZONE)).toBe("Tue");
  });

  it("dates anything a week or more back, so two Sundays never collide", () => {
    expect(formatCapturedAt(at("2026-07-05T08:00:00+01:00"), NOW, ZONE)).toBe(
      "5 Jul",
    );
  });

  it("adds the year only when it differs from now", () => {
    expect(formatCapturedAt(at("2026-03-12T08:00:00+00:00"), NOW, ZONE)).toBe(
      "12 Mar",
    );
    expect(formatCapturedAt(at("2025-12-30T08:00:00+00:00"), NOW, ZONE)).toBe(
      "30 Dec 2025",
    );
  });

  it("reads the day in the display zone", () => {
    // 23:30 in London on the 11th is already the 12th in Tokyo.
    const captured = at("2026-07-11T23:30:00+01:00");
    expect(formatCapturedAt(captured, NOW, ZONE)).toBe("Yesterday");
    expect(formatCapturedAt(captured, NOW, "Asia/Tokyo")).toBe("Today 7:30");
  });

  it("dates a capture stamped in the future rather than claiming it is today", () => {
    expect(formatCapturedAt(at("2026-08-01T08:00:00+01:00"), NOW, ZONE)).toBe(
      "1 Aug",
    );
  });
});
