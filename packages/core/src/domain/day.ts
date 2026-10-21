import { DAY_MS } from "./time";

// en-CA formats dates as YYYY-MM-DD.
function dayKeyFormatter(timeZone: string): (ms: number) => string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return (ms) => fmt.format(ms);
}

const dayKeyFormatters = new Map<string, (ms: number) => string>();

function shiftDayKey(key: string, deltaDays: number): string {
  return new Date(Date.parse(key) + deltaDays * DAY_MS).toISOString().slice(0, 10);
}

const offsetFormatters = new Map<string, Intl.DateTimeFormat>();

// How far the zone's wall clock is ahead of UTC at that instant (negative west of UTC).
export function timeZoneOffsetMs(timeZone: string, ms: number): number {
  let fmt = offsetFormatters.get(timeZone);
  if (fmt === undefined) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    offsetFormatters.set(timeZone, fmt);
  }
  const part = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(fmt.formatToParts(ms).find((p) => p.type === type)?.value);
  const wall = Date.UTC(
    part("year"),
    part("month") - 1,
    part("day"),
    part("hour"),
    part("minute"),
    part("second"),
  );
  return wall - (ms - (ms % 1000));
}

// The instant the zone's local day `dayKey` begins.
export function startOfLocalDay(timeZone: string, dayKey: string): number {
  const midnightUtc = Date.parse(dayKey);
  const guess = midnightUtc - timeZoneOffsetMs(timeZone, midnightUtc);
  return midnightUtc - timeZoneOffsetMs(timeZone, guess);
}

// Calendar days from the local day of `fromMs` to the local day of `toMs`.
export function localDaysBetween(timeZone: string, fromMs: number, toMs: number): number {
  return dayOffset(dayKeyOf(timeZone, fromMs), dayKeyOf(timeZone, toMs));
}

export function dayOffset(fromKey: string, toKey: string): number {
  return Math.round((Date.parse(toKey) - Date.parse(fromKey)) / DAY_MS);
}

export function dayKeyOf(timeZone: string, ms: number): string {
  const cached = dayKeyFormatters.get(timeZone);
  if (cached !== undefined) return cached(ms);
  const formatter = dayKeyFormatter(timeZone);
  dayKeyFormatters.set(timeZone, formatter);
  return formatter(ms);
}

interface DayLabeler {
  readonly keyOf: (ms: number) => string;
  readonly label: (dayKey: string, sampleMs: number) => string;
}

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

// Before this hour, an episode that aired earlier today still aired "last night".
const NIGHT_ENDS_HOUR = 6;

// True for an episode that aired on the previous local day, or overnight before 6 am today.
export function airedLastNight(
  firstAiredMs: number | null,
  now: number,
  timeZone: string,
): boolean {
  if (firstAiredMs === null || firstAiredMs > now) return false;
  const days = localDaysBetween(timeZone, firstAiredMs, now);
  if (days === 1) return true;
  if (days !== 0) return false;
  const localHour =
    (firstAiredMs - startOfLocalDay(timeZone, dayKeyOf(timeZone, firstAiredMs))) / 3_600_000;
  return localHour < NIGHT_ENDS_HOUR;
}
