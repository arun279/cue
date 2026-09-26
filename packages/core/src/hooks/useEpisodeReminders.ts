import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { buildCalendarDays, CALENDAR_WINDOW_DAYS } from "../domain/calendar";
import { dayKeyOf } from "../domain/day";
import { planReminders } from "../domain/reminders";
import { DAY_MS, localTimeZone } from "../domain/time";
import { activeShowIds } from "../domain/up-next";
import { useAppVisibility } from "../ports/app-visibility";
import { useReminders } from "../ports/reminders";
import { usePrefs } from "../prefs/prefs-store";
import { calendarQuery } from "../queries/calendar";
import { useRuntime } from "../runtime/runtime";
import { useCoarseClock } from "./useCoarseClock";
import { useLibrarySnapshot } from "./useLibrarySnapshot";

/** Keeps the OS holding exactly the notifications the current calendar and Up Next imply. */
export function useEpisodeReminders(): void {
  const reminders = useReminders();
  const visibility = useAppVisibility();
  const enabled = usePrefs((state) => state.remindersEnabled);
  const summary = usePrefs((state) => state.dailySummary);
  const muted = usePrefs((state) => state.mutedShowIds);
  const runtime = useRuntime();
  const now = useCoarseClock(DAY_MS);
  const timeZone = localTimeZone();
  const startDate = dayKeyOf(timeZone, now);
  const calendar = useQuery({ ...calendarQuery(runtime, startDate), enabled });
  const library = useLibrarySnapshot(enabled);
  const days = useMemo(
    () =>
      calendar.data === undefined
        ? undefined
        : buildCalendarDays(calendar.data, now, timeZone, startDate, CALENDAR_WINDOW_DAYS),
    [calendar.data, now, timeZone, startDate],
  );
  const shows = library.data?.entries;
  const { thresholdMs } = library;

  useEffect(() => {
    // An unanswered read is not an empty one. Planning before both land, or
    // while they keep failing offline, would cancel every pending alert and put
    // nothing back. A calendar that loaded empty is an answer, and cancelling
    // then is correct.
    if (!enabled || days === undefined || shows === undefined) return;
    const reconcile = (): void => {
      // The wall clock, not the render clock: that one is stamped per local
      // day, so an afternoon re-plan would still read this morning's summary as
      // ahead and hand the OS a past date, which it delivers immediately.
      const at = Date.now();
      const audible = shows.filter((show) => !muted.includes(show.showId));
      const showIds = activeShowIds(audible, at, thresholdMs);
      void reminders.reconcile(planReminders(days, { now: at, showIds, summary }));
    };
    reconcile();
    return visibility.subscribe(() => {
      if (visibility.isVisible()) reconcile();
    });
  }, [reminders, visibility, enabled, days, shows, thresholdMs, muted, summary]);

  useEffect(() => {
    if (!enabled) return;
    // Both ways out of a scheduled state land here: the switch going off, and
    // the shell unmounting when the session ends, since a former account's
    // airings must not keep firing.
    return () => void reminders.cancelAll();
  }, [reminders, enabled]);
}
