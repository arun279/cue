import { CALENDAR_WINDOW_DAYS, type CalendarDay, type CalendarRow } from "./calendar";
import { epCode } from "./model/library";
import { DAY_MS } from "./time";

/**
 * The local hour the daily summary fires. Morning, because the point is to plan
 * the evening, not to interrupt it.
 */
export const SUMMARY_HOUR = 9;

/**
 * iOS keeps the soonest-firing 64 pending notifications and silently discards
 * the rest, so the plan is cut to the same 64. Every foreground replans, which
 * reaches the dropped tail long before it would have fired.
 */
const PENDING_LIMIT = 64;

/** Shows the summary names before it counts the rest. */
const NAMED_SHOWS = 2;

const SUMMARY_TITLE = "Airing today";

/** One scheduled notification: what fires, when, and everything about it that can move. */
export interface PlannedReminder {
  /** The show and local day for an alert, the day alone for a summary: stable
   * across replans, and never shared between the two modes. */
  readonly id: string;
  readonly atMs: number;
  readonly title: string;
  readonly body: string;
  /** The show a tap opens; null for the summary, which names a day. */
  readonly showId: number | null;
  /** Content + time, folded into one value the diff can compare against what the
   * OS is already holding, so a replan reschedules only what actually moved. */
  readonly fingerprint: string;
}

/** A notification the OS is already holding, as the diff needs to see it. */
export interface PendingReminder {
  readonly id: string;
  /** `null` for anything scheduled without one, which reads as changed. */
  readonly fingerprint: string | null;
}

export interface ReminderDiff {
  readonly cancel: readonly string[];
  readonly schedule: readonly PlannedReminder[];
}

export interface PlanOptions {
  readonly now: number;
  /** The shows that may notify: the Up Next set, less the muted. */
  readonly showIds: ReadonlySet<number>;
  /** One morning summary per day instead of an alert per show per air day. */
  readonly summary: boolean;
}

function reminder(
  id: string,
  atMs: number,
  title: string,
  body: string,
  showId: number | null,
): PlannedReminder {
  return { id, atMs, title, body, showId, fingerprint: `${atMs}|${title}|${body}` };
}

/**
 * The instant `SUMMARY_HOUR` falls on that day, on the device's own clock: a
 * date-time with no offset designator is local time by the language's own rule,
 * which resolves the DST offset for that date rather than assuming today's. The
 * day keys come from the calendar grouped in the device's timezone, so the two
 * agree by construction.
 */
function summaryAt(dayKey: string): number {
  return Date.parse(`${dayKey}T${String(SUMMARY_HOUR).padStart(2, "0")}:00:00`);
}

function summaryBody(rows: readonly CalendarRow[]): string {
  const [only, ...rest] = rows;
  if (only !== undefined && rest.length === 0) {
    return `${only.showTitle} ${epCode(only.season, only.number)}`;
  }
  const shows = [...new Set(rows.map((row) => row.showTitle))];
  if (shows.length <= NAMED_SHOWS) return shows.join(" and ");
  return `${shows.slice(0, NAMED_SHOWS).join(", ")} and ${shows.length - NAMED_SHOWS} more`;
}

/**
 * One show's episodes on one day. It says "is out" and never "now", because
 * Android delivers inside the hour after the trigger rather than at it.
 */
function alertBody(first: CalendarRow, rest: readonly CalendarRow[]): string {
  if (rest.length === 0) {
    return `${[epCode(first.season, first.number), first.episodeTitle].filter(Boolean).join(" ")} is out.`;
  }
  const numbers = [first, ...rest].map((row) => row.number).sort((a, b) => a - b);
  const low = numbers[0] ?? first.number;
  const run =
    rest.every((row) => row.season === first.season) &&
    numbers.every((number, index) => number === low + index);
  return run
    ? `${epCode(first.season, low)} to E${low + rest.length} are out.`
    : `${rest.length + 1} new episodes are out.`;
}

function alertsFor(dayKey: string, rows: readonly CalendarRow[]): PlannedReminder[] {
  const byShow = new Map<number, CalendarRow[]>();
  for (const row of rows) byShow.set(row.showId, [...(byShow.get(row.showId) ?? []), row]);
  return [...byShow.values()].flatMap(([first, ...rest]) =>
    first === undefined
      ? []
      : [
          reminder(
            `${first.showId}@${dayKey}`,
            Date.parse(first.firstAired),
            first.showTitle,
            alertBody(first, rest),
            first.showId,
          ),
        ],
  );
}

/**
 * The notification set for a calendar window. By default one alert per show per
 * air day, fired when the day's first episode airs, so a season dropped at once
 * is one alert naming the run rather than a trickle the OS would throttle. With
 * `summary`, one "Airing today" notification each morning instead. Either way
 * only `showIds` count, only what still lies ahead inside the window is
 * planned, and only the soonest `PENDING_LIMIT` of it.
 */
export function planReminders(
  days: readonly CalendarDay[],
  { now, showIds, summary }: PlanOptions,
): readonly PlannedReminder[] {
  const horizon = now + CALENDAR_WINDOW_DAYS * DAY_MS;
  return days
    .flatMap(({ dayKey, rows }) => {
      const wanted = rows.filter((row) => showIds.has(row.showId));
      if (wanted.length === 0) return [];
      return summary
        ? [reminder(dayKey, summaryAt(dayKey), SUMMARY_TITLE, summaryBody(wanted), null)]
        : alertsFor(dayKey, wanted);
    })
    .filter(({ atMs }) => atMs > now && atMs <= horizon)
    .sort((a, b) => a.atMs - b.atMs)
    .slice(0, PENDING_LIMIT);
}

/**
 * What to change to make the OS hold exactly `planned`. Anything pending that
 * the plan no longer wants, or wants differently, is cancelled; everything the
 * plan wants that is not already pending unchanged is scheduled. Reminders are
 * the only notifications Cue schedules, so a pending id the plan does not name
 * has passed, emptied, been muted or belongs to the other mode, and cancelling
 * it is right.
 */
export function diffReminders(
  planned: readonly PlannedReminder[],
  pending: readonly PendingReminder[],
): ReminderDiff {
  const wanted = new Map(planned.map((reminder) => [reminder.id, reminder.fingerprint]));
  const unchanged = new Set<string>();
  const cancel: string[] = [];
  for (const held of pending) {
    if (wanted.get(held.id) === held.fingerprint) unchanged.add(held.id);
    else cancel.push(held.id);
  }
  return { cancel, schedule: planned.filter((reminder) => !unchanged.has(reminder.id)) };
}
