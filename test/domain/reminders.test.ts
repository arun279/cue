import type { CalendarDay, CalendarRow } from "@domain/calendar";
import {
  diffReminders,
  type PlannedReminder,
  planReminders,
  REMINDER_HOUR,
  REMINDER_WINDOW_DAYS,
} from "@domain/reminders";
import { afterEach, describe, expect, it, vi } from "vitest";

const DAY_MS = 24 * 60 * 60 * 1000;

/** A local-day key, built from the device clock the planner also fires on. */
function keyOf(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function row(showTitle: string, season: number, number: number): CalendarRow {
  return {
    showId: 1,
    showTitle,
    season,
    number,
    episodeTitle: null,
    firstAired: "2026-01-01T00:00:00.000Z",
    ids: { trakt: 1 },
    posters: [],
    network: null,
    tmdbId: null,
    aired: false,
  };
}

/** A day `offset` days from `now` on the device clock, holding `rows`. */
function day(now: number, offset: number, rows: readonly CalendarRow[]): CalendarDay {
  const at = new Date(now);
  at.setDate(at.getDate() + offset);
  return { dayKey: keyOf(at), label: "", rows };
}

/** Midnight tonight, so every reminder hour in the window is unambiguously ahead. */
function midnight(): number {
  const at = new Date();
  at.setHours(0, 0, 0, 0);
  return at.getTime();
}

describe("planReminders", () => {
  it("emits one digest per day that has something airing", () => {
    const now = midnight();
    const plan = planReminders(
      [
        day(now, 1, [row("Severance", 2, 4)]),
        day(now, 2, []),
        day(now, 3, [row("Poker Face", 1, 2), row("The Pitt", 1, 5)]),
      ],
      { now },
    );
    expect(plan).toHaveLength(2);
    expect(plan.map((reminder) => reminder.body)).toEqual([
      "Severance S2 E4",
      "Poker Face and The Pitt",
    ]);
    expect(new Set(plan.map((reminder) => reminder.title))).toEqual(new Set(["Airing today"]));
  });

  it("fires at the reminder hour on the day it describes, in the device's own zone", () => {
    const now = midnight();
    const [reminder] = planReminders([day(now, 2, [row("Severance", 2, 4)])], { now });
    const at = new Date(reminder?.atMs ?? 0);
    expect(at.getHours()).toBe(REMINDER_HOUR);
    expect(at.getMinutes()).toBe(0);
    expect(keyOf(at)).toBe(day(now, 2, []).dayKey);
  });

  it("names two shows, then counts the rest", () => {
    const now = midnight();
    const rows = ["A", "B", "C", "D"].map((title) => row(title, 1, 1));
    const [reminder] = planReminders([day(now, 1, rows)], { now });
    expect(reminder?.body).toBe("A, B and 2 more");
  });

  it("counts shows, not episodes: a double bill names its show once", () => {
    const now = midnight();
    const [reminder] = planReminders([day(now, 1, [row("A", 1, 1), row("A", 1, 2)])], { now });
    expect(reminder?.body).toBe("A");
  });

  it("drops a digest whose hour has already passed today", () => {
    const at = new Date();
    at.setHours(REMINDER_HOUR + 1, 0, 0, 0);
    const now = at.getTime();
    const plan = planReminders([day(now, 0, [row("A", 1, 1)]), day(now, 1, [row("B", 1, 1)])], {
      now,
    });
    expect(plan.map((reminder) => reminder.body)).toEqual(["B S1 E1"]);
  });

  it("keeps today's digest while its hour is still ahead", () => {
    const at = new Date();
    at.setHours(REMINDER_HOUR - 1, 0, 0, 0);
    const now = at.getTime();
    const plan = planReminders([day(now, 0, [row("A", 1, 1)])], { now });
    expect(plan).toHaveLength(1);
  });

  it("stops at the window, so the pending set can never approach the iOS limit", () => {
    const now = midnight();
    // A full 28-day calendar with something airing every single day.
    const days = Array.from({ length: 28 }, (_, offset) =>
      day(now, offset, [row(`Show ${offset}`, 1, 1)]),
    );
    const plan = planReminders(days, { now });
    expect(plan.length).toBeLessThanOrEqual(REMINDER_WINDOW_DAYS);
    expect(plan.length).toBeGreaterThan(0);
    for (const reminder of plan) {
      expect(reminder.atMs).toBeGreaterThan(now);
      expect(reminder.atMs).toBeLessThanOrEqual(now + REMINDER_WINDOW_DAYS * DAY_MS);
    }
  });

  it("honours a caller's narrower window, measured from now", () => {
    const now = midnight();
    const days = Array.from({ length: 10 }, (_, offset) =>
      day(now, offset + 1, [row(`Show ${offset}`, 1, 1)]),
    );
    // From midnight, three days reach the third day's 00:00 but not its 09:00,
    // so tomorrow and the day after are in and the third day is not.
    expect(planReminders(days, { now, windowDays: 3 }).map((reminder) => reminder.body)).toEqual([
      "Show 0 S1 E1",
      "Show 1 S1 E1",
    ]);
  });

  it("orders the plan by fire time and gives each day a distinct, stable id", () => {
    const now = midnight();
    const days = [day(now, 3, [row("C", 1, 1)]), day(now, 1, [row("A", 1, 1)])];
    const plan = planReminders(days, { now });
    expect(plan.map((reminder) => reminder.atMs)).toEqual(
      [...plan.map((reminder) => reminder.atMs)].sort((a, b) => a - b),
    );
    expect(new Set(plan.map((reminder) => reminder.id)).size).toBe(plan.length);
    // Replanning the same calendar reproduces the same ids and fingerprints.
    expect(planReminders(days, { now })).toEqual(plan);
  });
});

describe("the digest hour across a daylight-saving shift", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("fires at the reminder hour on the device clock on both sides of it", () => {
    // The US spring-forward is 2026-03-08. A digest placed a fixed number of
    // hours from UTC midnight would land an hour out on one side of it, and the
    // day ids have to stay one apart per day whatever the offset does.
    vi.stubEnv("TZ", "America/New_York");
    const rows = [row("Severance", 2, 4)];

    const plan = planReminders(
      [
        { dayKey: "2026-03-07", label: "", rows },
        { dayKey: "2026-03-09", label: "", rows },
      ],
      { now: Date.parse("2026-03-06T12:00:00") },
    );

    expect(plan.map((reminder) => new Date(reminder.atMs).getHours())).toEqual([
      REMINDER_HOUR,
      REMINDER_HOUR,
    ]);
    expect((plan[1]?.id ?? 0) - (plan[0]?.id ?? 0)).toBe(2);
  });
});

describe("diffReminders", () => {
  const now = midnight();
  const plan = planReminders([day(now, 1, [row("A", 1, 1)]), day(now, 2, [row("B", 1, 1)])], {
    now,
  });
  const asPending = (reminders: readonly PlannedReminder[]) =>
    reminders.map((reminder) => ({ id: reminder.id, fingerprint: reminder.fingerprint }));

  it("schedules everything when nothing is pending", () => {
    expect(diffReminders(plan, [])).toEqual({ cancel: [], schedule: plan });
  });

  it("is idempotent: replanning an already-scheduled plan changes nothing", () => {
    expect(diffReminders(plan, asPending(plan))).toEqual({ cancel: [], schedule: [] });
  });

  it("reschedules only the day whose content moved", () => {
    const stale = asPending(plan).map((pending, index) =>
      index === 0 ? { ...pending, fingerprint: "an earlier line-up" } : pending,
    );
    const diff = diffReminders(plan, stale);
    expect(diff.cancel).toEqual([plan[0]?.id]);
    expect(diff.schedule).toEqual([plan[0]]);
  });

  it("cancels a pending digest the plan no longer wants", () => {
    const diff = diffReminders([], asPending(plan));
    expect(diff.cancel).toEqual(plan.map((reminder) => reminder.id));
    expect(diff.schedule).toEqual([]);
  });

  it("reschedules a notification an earlier build left without a fingerprint", () => {
    const diff = diffReminders(plan, [{ id: plan[0]?.id ?? 0, fingerprint: null }]);
    expect(diff.cancel).toEqual([plan[0]?.id]);
    expect(diff.schedule).toEqual(plan);
  });
});
