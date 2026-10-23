import {
  CALENDAR_WINDOW_DAYS,
  type CalendarDay,
  type CalendarRow,
  episodeLine,
  isEpisodeRun,
} from "./calendar";
import { epCode } from "./model/library";
import { DAY_MS } from "./time";

export const SUMMARY_HOUR = 9;

// iOS keeps only the soonest 64 pending local notifications and discards the rest.
const PENDING_LIMIT = 64;

const SUMMARY_NAMED_SHOW_LIMIT = 2;

const SUMMARY_TITLE = "Airing today";

export interface PlannedReminder {
  readonly id: string;
  readonly atMs: number;
  readonly title: string;
  readonly body: string;
  readonly showId: number | null;
  readonly fingerprint: string;
}

export interface PendingReminder {
  readonly id: string;
  readonly fingerprint: string | null;
}

export interface ReminderDiff {
  readonly cancel: readonly string[];
  readonly schedule: readonly PlannedReminder[];
}

export interface PlanOptions {
  readonly now: number;
  readonly showIds: ReadonlySet<number>;
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

// An ISO date-time without an offset parses as local time, using that date's DST offset.
function summaryAt(dayKey: string): number {
  return Date.parse(`${dayKey}T${String(SUMMARY_HOUR).padStart(2, "0")}:00:00`);
}

function summaryBody(rows: readonly CalendarRow[]): string {
  const [only, ...rest] = rows;
  if (only !== undefined && rest.length === 0) {
    return `${only.showTitle} ${episodeLine(only).code}`;
  }
  const shows = [...new Set(rows.map((row) => row.showTitle))];
  if (shows.length <= SUMMARY_NAMED_SHOW_LIMIT) return shows.join(" and ");
  return `${shows.slice(0, SUMMARY_NAMED_SHOW_LIMIT).join(", ")} and ${shows.length - SUMMARY_NAMED_SHOW_LIMIT} more`;
}

// Android delivers inexact alarms up to an hour after the trigger.
function alertBody(row: CalendarRow): string {
  const count = row.episodes.length;
  if (count === 1) {
    return `${[epCode(row.season, row.number), row.episodeTitle].filter(Boolean).join(" ")} is out.`;
  }
  return isEpisodeRun(row.episodes)
    ? `${epCode(row.season, row.number)} to E${row.number + count - 1} are out.`
    : `${count} new episodes are out.`;
}

function alertFor(row: CalendarRow): PlannedReminder {
  return reminder(
    `${row.showId}@${row.firstAired}`,
    Date.parse(row.firstAired),
    row.showTitle,
    alertBody(row),
    row.showId,
  );
}

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
        : wanted.map(alertFor);
    })
    .filter(({ atMs }) => atMs > now && atMs <= horizon)
    .sort((a, b) => a.atMs - b.atMs)
    .slice(0, PENDING_LIMIT);
}

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
