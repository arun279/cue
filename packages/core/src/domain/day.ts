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

const LONGEST_OFFSET_MS = 15 * 60 * 60 * 1000;

export function startOfLocalDay(timeZone: string, dayKey: string): number {
  let before = Date.parse(dayKey) - LONGEST_OFFSET_MS;
  let within = Date.parse(dayKey) + LONGEST_OFFSET_MS;
  while (within - before > 1) {
    const middle = Math.floor((before + within) / 2);
    if (dayKeyOf(timeZone, middle) < dayKey) before = middle;
    else within = middle;
  }
  return within;
}

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

const NIGHT_ENDS_HOUR = 6;

export function airedLastNight(
  firstAiredMs: number | null,
  now: number,
  timeZone: string,
): boolean {
  if (firstAiredMs === null || firstAiredMs > now) return false;
  const aired = dayKeyOf(timeZone, firstAiredMs);
  if (aired === shiftDayKey(dayKeyOf(timeZone, now), -1)) return true;
  if (aired !== dayKeyOf(timeZone, now)) return false;
  return firstAiredMs - startOfLocalDay(timeZone, aired) < NIGHT_ENDS_HOUR * 3_600_000;
}
