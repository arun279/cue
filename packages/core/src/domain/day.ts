/**
 * Local-day grouping primitives shared by the Calendar (upcoming days) and the
 * Diary (watch-history days) so both bucket and shift days the same way: the one
 * source of truth for "which local day does this instant fall on".
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** `ms → "YYYY-MM-DD"` in `timeZone` (en-CA renders the ISO date order). */
function dayKeyFormatter(timeZone: string): (ms: number) => string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return (ms) => fmt.format(ms);
}

/**
 * The day-key `deltaDays` away from `key`. A date-only key parses as UTC
 * midnight, so this is whole-day arithmetic that never crosses a wall-clock
 * offset the way a local `Date` would.
 */
function shiftDayKey(key: string, deltaDays: number): string {
  return new Date(Date.parse(key) + deltaDays * DAY_MS).toISOString().slice(0, 10);
}

/** The local-day key ("YYYY-MM-DD") an instant falls on, without a labeler. */
export function dayKeyOf(timeZone: string, ms: number): string {
  return dayKeyFormatter(timeZone)(ms);
}

/** Buckets days by local key and labels them "Today" / an adjacent word / "Mon, Jan 5". */
interface DayLabeler {
  /** `ms → "YYYY-MM-DD"` local-day key: the bucket handle. */
  readonly keyOf: (ms: number) => string;
  /** A day's human label; `sampleMs` is any instant within the day, for the date fallback. */
  readonly label: (dayKey: string, sampleMs: number) => string;
}

/**
 * The shared local-day bucketer + labeler for the Calendar (upcoming) and the
 * Diary (watch history): one `Intl` key formatter, one "Mon, Jan 5" date
 * formatter, and the Today / adjacent-word / date resolution, built once. Only the
 * single neighboring day that earns a relative word differs: the Calendar looks
 * forward (`{ delta: 1, label: "Tomorrow" }`), the Diary looks back
 * (`{ delta: -1, label: "Yesterday" }`).
 */
export function dayLabeler(
  timeZone: string,
  now: number,
  adjacent: { readonly delta: number; readonly label: string },
): DayLabeler {
  const keyOf = dayKeyFormatter(timeZone);
  const todayKey = keyOf(now);
  const adjacentKey = shiftDayKey(todayKey, adjacent.delta);
  const labelFmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  return {
    keyOf,
    label: (dayKey, sampleMs) =>
      dayKey === todayKey
        ? "Today"
        : dayKey === adjacentKey
          ? adjacent.label
          : labelFmt.format(sampleMs),
  };
}
