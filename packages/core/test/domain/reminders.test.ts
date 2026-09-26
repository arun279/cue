import type { CalendarDay, CalendarRow } from "@cue/core/domain/calendar";
import {
  diffReminders,
  type PlannedReminder,
  type PlanOptions,
  planReminders,
  SUMMARY_HOUR,
} from "@cue/core/domain/reminders";
import { afterEach, describe, expect, it, vi } from "vitest";

const HOUR_MS = 60 * 60 * 1000;
const HARBOR = 8801;
const SALT = 8802;
const TIN = 8803;
const TITLES = new Map([
  [HARBOR, "Harbor Lights"],
  [SALT, "Salt Air"],
  [TIN, "Tin Harbour"],
]);

/** A local-day key, built from the device clock the planner also fires on. */
function keyOf(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Midnight tonight, so every air time in the window is unambiguously ahead. */
function midnight(): number {
  const at = new Date();
  at.setHours(0, 0, 0, 0);
  return at.getTime();
}

const NOW = midnight();

/** An episode of `showId` airing at `hour` local on the day `offset` days from now. */
function ep(
  showId: number,
  offset: number,
  hour: number,
  season: number,
  number: number,
  episodeTitle: string | null = null,
): CalendarRow {
  const at = new Date(NOW);
  at.setDate(at.getDate() + offset);
  at.setHours(hour);
  return {
    showId,
    showTitle: TITLES.get(showId) ?? "",
    season,
    number,
    episodeTitle,
    firstAired: at.toISOString(),
    ids: { trakt: showId * 1000 + number },
    posters: [],
    network: null,
    tmdbId: null,
    aired: false,
  };
}

/** The calendar's shape: rows bucketed by local day, in air order. */
function calendar(...rows: readonly CalendarRow[]): CalendarDay[] {
  const days = new Map<string, CalendarRow[]>();
  for (const row of [...rows].sort((a, b) => a.firstAired.localeCompare(b.firstAired))) {
    const key = keyOf(new Date(row.firstAired));
    days.set(key, [...(days.get(key) ?? []), row]);
  }
  return [...days].map(([dayKey, dayRows]) => ({ dayKey, label: "", rows: dayRows }));
}

const everyone: PlanOptions = { now: NOW, showIds: new Set(TITLES.keys()), summary: false };

const said = (plan: readonly PlannedReminder[]) =>
  plan.map(({ title, body }) => `${title}: ${body}`);

describe("an alert per show per air day", () => {
  it("names the one episode by code and title, or by code alone when it has no title", () => {
    const plan = planReminders(
      calendar(ep(HARBOR, 1, 21, 3, 6, "The Long Dark"), ep(SALT, 2, 20, 1, 4)),
      everyone,
    );
    expect(said(plan)).toEqual([
      "Harbor Lights: S3 E6 The Long Dark is out.",
      "Salt Air: S1 E4 is out.",
    ]);
  });

  it("fires at the air time itself, with no offset", () => {
    const tonight = ep(HARBOR, 1, 21, 3, 6);
    const [alert] = planReminders(calendar(tonight), everyone);
    expect(alert?.atMs).toBe(Date.parse(tonight.firstAired));
  });

  it("folds a season dropped at once into one alert that names the run", () => {
    const drop = [1, 2, 3, 4, 5, 6, 7, 8].map((number) => ep(HARBOR, 1, 3, 1, number));
    const plan = planReminders(calendar(...drop), everyone);
    expect(said(plan)).toEqual(["Harbor Lights: S1 E1 to E8 are out."]);
    expect(plan[0]?.atMs).toBe(Date.parse(drop[0]?.firstAired ?? ""));
  });

  it("counts a same-day batch that is not one run in one season", () => {
    const gap = planReminders(calendar(ep(HARBOR, 1, 20, 2, 1), ep(HARBOR, 1, 21, 2, 3)), everyone);
    const finaleAndPremiere = planReminders(
      calendar(ep(SALT, 1, 20, 1, 3), ep(SALT, 1, 21, 2, 1), ep(SALT, 1, 22, 2, 2)),
      everyone,
    );
    expect(said(gap)).toEqual(["Harbor Lights: 2 new episodes are out."]);
    expect(said(finaleAndPremiere)).toEqual(["Salt Air: 3 new episodes are out."]);
  });

  it("gives two shows on one day an alert each, and one show on two days an alert a day", () => {
    const plan = planReminders(
      calendar(ep(HARBOR, 1, 20, 1, 1), ep(SALT, 1, 21, 1, 1), ep(HARBOR, 2, 20, 1, 2)),
      everyone,
    );
    expect(said(plan)).toEqual([
      "Harbor Lights: S1 E1 is out.",
      "Salt Air: S1 E1 is out.",
      "Harbor Lights: S1 E2 is out.",
    ]);
    expect(new Set(plan.map((alert) => alert.id)).size).toBe(3);
  });

  it("alerts only for the shows it is given", () => {
    const plan = planReminders(calendar(ep(HARBOR, 1, 20, 1, 1), ep(SALT, 1, 21, 1, 1)), {
      ...everyone,
      showIds: new Set([SALT]),
    });
    expect(said(plan)).toEqual(["Salt Air: S1 E1 is out."]);
  });

  it("never announces a day again once its first episode has aired", () => {
    const double = calendar(ep(HARBOR, 0, 20, 1, 1), ep(HARBOR, 0, 21, 1, 2));
    expect(planReminders(double, { ...everyone, now: NOW + 20.5 * HOUR_MS })).toEqual([]);
  });

  it("plans the four weeks ahead and nothing past them", () => {
    const weekly = Array.from({ length: 6 }, (_, week) =>
      ep(HARBOR, 1 + week * 7, 21, 1, week + 1),
    );
    expect(said(planReminders(calendar(...weekly), everyone))).toHaveLength(4);
  });

  it("keeps the soonest 64 when the window holds more than iOS will", () => {
    const nightly = [HARBOR, SALT, TIN].flatMap((showId) =>
      Array.from({ length: 27 }, (_, day) => ep(showId, day + 1, 18 + showId - HARBOR, 1, day + 1)),
    );
    const plan = planReminders(calendar(...nightly), everyone);
    const latest = Math.max(...plan.map((alert) => alert.atMs));
    const dropped = nightly.map((row) => Date.parse(row.firstAired)).filter((at) => at > latest);

    expect(plan).toHaveLength(64);
    expect(dropped).toHaveLength(nightly.length - 64);
  });
});

describe("the daily summary instead", () => {
  const summary: PlanOptions = { ...everyone, summary: true };

  it("sends one morning notification per day, over the same shows", () => {
    const plan = planReminders(
      calendar(
        ep(HARBOR, 1, 21, 3, 6, "The Long Dark"),
        ep(HARBOR, 2, 20, 3, 7),
        ep(SALT, 2, 21, 1, 1),
        ep(TIN, 3, 20, 1, 1),
      ),
      { ...summary, showIds: new Set([HARBOR, SALT]) },
    );
    expect(said(plan)).toEqual([
      "Airing today: Harbor Lights S3 E6",
      "Airing today: Harbor Lights and Salt Air",
    ]);
    expect(plan.map((morning) => new Date(morning.atMs).getHours())).toEqual([
      SUMMARY_HOUR,
      SUMMARY_HOUR,
    ]);
  });

  it("names two shows, then counts the rest, and counts a double bill once", () => {
    const rows = [
      ep(HARBOR, 1, 20, 1, 1),
      ep(HARBOR, 1, 21, 1, 2),
      ep(SALT, 1, 21, 1, 1),
      ep(TIN, 1, 22, 1, 1),
    ];
    expect(said(planReminders(calendar(...rows), summary))).toEqual([
      "Airing today: Harbor Lights, Salt Air and 1 more",
    ]);
  });

  it("drops a day whose morning has passed", () => {
    const plan = planReminders(calendar(ep(HARBOR, 0, 21, 1, 1), ep(SALT, 1, 21, 1, 1)), {
      ...summary,
      now: NOW + (SUMMARY_HOUR + 1) * HOUR_MS,
    });
    expect(said(plan)).toEqual(["Airing today: Salt Air S1 E1"]);
  });

  it("is one reconcile away from the alerts, in either direction", () => {
    const days = calendar(ep(HARBOR, 1, 21, 1, 1), ep(SALT, 2, 21, 1, 1));
    const alerts = planReminders(days, everyone);
    const mornings = planReminders(days, summary);
    const held = (plan: readonly PlannedReminder[]) =>
      plan.map(({ id, fingerprint }) => ({ id, fingerprint }));

    expect(diffReminders(mornings, held(alerts))).toEqual({
      cancel: alerts.map((alert) => alert.id),
      schedule: mornings,
    });
    expect(diffReminders(alerts, held(mornings))).toEqual({
      cancel: mornings.map((morning) => morning.id),
      schedule: alerts,
    });
  });
});

describe("the summary hour across a daylight-saving shift", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("fires at the summary hour on the device clock on both sides of it", () => {
    // The US spring-forward is 2026-03-08. A summary placed a fixed number of
    // hours from UTC midnight would land an hour out on one side of it.
    vi.stubEnv("TZ", "America/New_York");
    const row = ep(HARBOR, 0, 21, 2, 4);
    const plan = planReminders(
      [
        { dayKey: "2026-03-07", label: "", rows: [row] },
        { dayKey: "2026-03-09", label: "", rows: [row] },
      ],
      { ...everyone, summary: true, now: Date.parse("2026-03-06T12:00:00") },
    );

    expect(plan.map((morning) => new Date(morning.atMs).getHours())).toEqual([
      SUMMARY_HOUR,
      SUMMARY_HOUR,
    ]);
  });
});

describe("diffReminders", () => {
  const plan = planReminders(calendar(ep(HARBOR, 1, 21, 1, 1), ep(SALT, 2, 21, 1, 1)), everyone);
  const asPending = (reminders: readonly PlannedReminder[]) =>
    reminders.map((reminder) => ({ id: reminder.id, fingerprint: reminder.fingerprint }));

  it("schedules everything when nothing is pending", () => {
    expect(diffReminders(plan, [])).toEqual({ cancel: [], schedule: plan });
  });

  it("is idempotent: replanning an already-scheduled plan changes nothing", () => {
    expect(diffReminders(plan, asPending(plan))).toEqual({ cancel: [], schedule: [] });
  });

  it("reschedules only the alert whose content moved", () => {
    const stale = asPending(plan).map((pending, index) =>
      index === 0 ? { ...pending, fingerprint: "an earlier air time" } : pending,
    );
    const diff = diffReminders(plan, stale);
    expect(diff.cancel).toEqual([plan[0]?.id]);
    expect(diff.schedule).toEqual([plan[0]]);
  });

  it("cancels a pending alert the plan no longer wants", () => {
    const diff = diffReminders([], asPending(plan));
    expect(diff.cancel).toEqual(plan.map((reminder) => reminder.id));
    expect(diff.schedule).toEqual([]);
  });

  it("reschedules a notification held without a fingerprint", () => {
    const diff = diffReminders(plan, [{ id: plan[0]?.id ?? "", fingerprint: null }]);
    expect(diff.cancel).toEqual([plan[0]?.id]);
    expect(diff.schedule).toEqual(plan);
  });
});
