import type { CalendarDay } from "./calendar";
import { epCode } from "./model/library";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The local hour the digest fires. Morning, because the point is to plan the
 * evening, not to interrupt it; and because it keeps the notification more than
 * an hour away from the airings it describes, which is exactly the line Apple
 * draws for the Time Sensitive interruption level. This one stays Active.
 */
export const REMINDER_HOUR = 9;

/**
 * How far ahead the schedule reaches. One digest per day means the pending count
 * can never pass this, which keeps it an order of magnitude under the 64 pending
 * notifications iOS keeps (it silently discards the rest, with no error and no
 * callback), and inside Android's App Standby restricted bucket, where an app
 * gets one alarm a day. A fortnight is also about as far as a TV calendar is
 * worth trusting: schedules move.
 */
export const REMINDER_WINDOW_DAYS = 14;

/** Shows the body names before it counts the rest. */
const NAMED_SHOWS = 2;

const TITLE = "Airing today";

/** One scheduled digest: what fires, when, and everything about it that can move. */
export interface PlannedReminder {
  /** The local day it covers, as days since the epoch: stable across replans,
   * unique per day, and small enough for Android's 32-bit notification id. */
  readonly id: number;
  readonly atMs: number;
  readonly title: string;
  readonly body: string;
  /** Content + time, folded into one value the diff can compare against what the
   * OS is already holding, so a replan reschedules only what actually moved. */
  readonly fingerprint: string;
}

/** A notification the OS is already holding, as the diff needs to see it. */
export interface PendingReminder {
  readonly id: number;
  /** `null` for anything scheduled without one (an older build), which reads as
   * changed and is rescheduled. */
  readonly fingerprint: string | null;
}

export interface ReminderDiff {
  readonly cancel: readonly number[];
  readonly schedule: readonly PlannedReminder[];
}

/** Days since the epoch: a date-only day key parses as UTC midnight, so this is
 * exact Y-M-D arithmetic with no timezone in it. */
function dayId(dayKey: string): number {
  return Date.parse(dayKey) / DAY_MS;
}

/**
 * The instant `REMINDER_HOUR` falls on that day, on the device's own clock: a
 * date-time with no offset designator is local time by the language's own rule,
 * which resolves the DST offset for that date rather than assuming today's. The
 * day keys come from the calendar grouped in the device's timezone, so the two
 * agree by construction.
 */
function fireAt(dayKey: string): number {
  return Date.parse(`${dayKey}T${String(REMINDER_HOUR).padStart(2, "0")}:00:00`);
}

/**
 * What one day's digest says. A single episode is worth naming outright; past
 * that the shows are what the eye needs, and a long list on a lock screen is
 * truncated anyway.
 */
function digestBody({ rows }: CalendarDay): string {
  const [only, ...rest] = rows;
  if (only !== undefined && rest.length === 0) {
    return `${only.showTitle} ${epCode(only.season, only.number)}`;
  }
  const shows = [...new Set(rows.map((row) => row.showTitle))];
  if (shows.length <= NAMED_SHOWS) return shows.join(" and ");
  return `${shows.slice(0, NAMED_SHOWS).join(", ")} and ${shows.length - NAMED_SHOWS} more`;
}

/**
 * The notification set for a calendar window: one digest per day that has
 * something airing, at `REMINDER_HOUR` local, for every such day whose digest
 * still lies ahead and inside the window.
 *
 * One digest a day rather than one alert per episode. Per-episode alerts would
 * fire several times on a busy evening, which is the overuse both platforms
 * warn against; they would run at Android's inexact-alarm slack of up to an
 * hour, so an "airs now" alert would routinely be a lie; and across a full
 * calendar they can quietly pass the 64 iOS keeps. A morning digest is one
 * honest sentence a day, and an hour of slack on it changes nothing.
 */
export function planReminders(
  days: readonly CalendarDay[],
  options: { readonly now: number; readonly windowDays?: number },
): readonly PlannedReminder[] {
  const { now, windowDays = REMINDER_WINDOW_DAYS } = options;
  const horizon = now + windowDays * DAY_MS;
  return days
    .filter((day) => day.rows.length > 0)
    .map((day) => ({ day, atMs: fireAt(day.dayKey) }))
    .filter(({ atMs }) => atMs > now && atMs <= horizon)
    .sort((a, b) => a.atMs - b.atMs)
    .map(({ day, atMs }) => {
      const body = digestBody(day);
      return {
        id: dayId(day.dayKey),
        atMs,
        title: TITLE,
        body,
        fingerprint: `${atMs}|${TITLE}|${body}`,
      };
    });
}

/**
 * What to change to make the OS hold exactly `planned`. Anything pending that
 * the plan no longer wants, or wants differently, is cancelled; everything the
 * plan wants that is not already pending unchanged is scheduled. Reminders are
 * the only notifications Cue schedules, so a pending id the plan does not name is a
 * digest for a day that has passed or emptied, and cancelling it is right.
 */
export function diffReminders(
  planned: readonly PlannedReminder[],
  pending: readonly PendingReminder[],
): ReminderDiff {
  const wanted = new Map(planned.map((reminder) => [reminder.id, reminder.fingerprint]));
  const unchanged = new Set<number>();
  const cancel: number[] = [];
  for (const held of pending) {
    if (wanted.get(held.id) === held.fingerprint) unchanged.add(held.id);
    else cancel.push(held.id);
  }
  return { cancel, schedule: planned.filter((reminder) => !unchanged.has(reminder.id)) };
}
