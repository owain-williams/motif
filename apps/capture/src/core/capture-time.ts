/**
 * When an Idea was captured, as a Library row says it: recent captures are
 * placed relative to now ("Today 9:12", "Yesterday", "Sun") and older ones by
 * date. The Library is reverse-chronological, so a row's job is to say how long
 * ago at a glance — not to state a full timestamp the user has to decode.
 *
 * All comparisons are by calendar day in the display time zone, so an Idea
 * captured at 23:55 reads as "Yesterday" five minutes later rather than
 * "Today".
 */

/** `YYYY-MM-DD` for an instant in `timeZone`, so days compare as calendar days. */
function calendarDay(at: number, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).format(at);
}

/** Midnight UTC on a `YYYY-MM-DD`, so subtracting two days is a clean day count. */
function parseDay(day: string): number {
  const [year, month, date] = day.split("-").map(Number);
  return Date.UTC(year ?? 1970, (month ?? 1) - 1, date ?? 1);
}

function daysApart(from: string, to: string): number {
  return Math.round((parseDay(from) - parseDay(to)) / 86_400_000);
}

/** `9:12` — 24-hour, unpadded hour, so the label stays compact. */
function timeOfDay(at: number, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).formatToParts(at);
  const value = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "00";
  return `${Number(value("hour"))}:${value("minute")}`;
}

/**
 * The relative capture label for a Library row.
 *
 * @param capturedAt Epoch milliseconds the Idea was captured.
 * @param now        Epoch milliseconds to read "today" from.
 * @param timeZone   IANA zone to render in; defaults to the runtime's zone.
 */
export function formatCapturedAt(
  capturedAt: number,
  now: number,
  timeZone?: string,
): string {
  const today = calendarDay(now, timeZone);
  const day = calendarDay(capturedAt, timeZone);
  // Negative for a capture stamped in the future — a device whose clock has
  // since been corrected backwards. It falls through to the dated form, which
  // is the one label that is never wrong.
  const elapsed = daysApart(today, day);

  if (elapsed === 0) return `Today ${timeOfDay(capturedAt, timeZone)}`;
  if (elapsed === 1) return "Yesterday";
  if (elapsed > 1 && elapsed < 7) {
    return new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone }).format(
      capturedAt,
    );
  }
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    // Only years other than the current one are worth the extra characters.
    year: today.slice(0, 4) === day.slice(0, 4) ? undefined : "numeric",
    timeZone,
  }).format(capturedAt);
}
