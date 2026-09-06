import { useEffect } from "react";
import { planReminders, REMINDER_WINDOW_DAYS } from "../domain/reminders";
import { useReminders } from "../ports/reminders";
import { usePrefs } from "../prefs/prefs-store";
import { useCalendar } from "./useCalendar";

/**
 * Keeps the OS holding exactly the reminders the current calendar implies.
 * Mounted once under the session runtime, so it re-plans whenever the shared
 * calendar window refetches or the local day flips, and it re-plans from scratch
 * every time: the plan is a pure function of the calendar, and the diff against
 * what is pending makes running it again free.
 *
 * The calendar read is the one the Up Next and Calendar screens already share,
 * so turning reminders on costs no extra Trakt call.
 */
export function useEpisodeReminders(): void {
  const reminders = useReminders();
  const enabled = usePrefs((state) => state.remindersEnabled);
  const { days, hasData } = useCalendar(REMINDER_WINDOW_DAYS, enabled);

  useEffect(() => {
    if (!enabled) return;
    // An unanswered calendar is not an empty one. Planning from `days: []`
    // before the read lands, or while it keeps failing offline, would cancel
    // every pending digest and put nothing back. A calendar that loaded empty
    // does have `hasData`, and cancelling then is correct.
    if (!hasData) return;
    // The wall clock, not the render clock: that one is stamped per local day,
    // so an afternoon re-plan would still read this morning's digest as ahead
    // and hand the OS a past date, which it delivers immediately.
    void reminders.reconcile(planReminders(days, { now: Date.now() }));
  }, [reminders, enabled, hasData, days]);

  useEffect(() => {
    if (!enabled) return;
    // Both ways out of a scheduled state land here: the switch going off, and
    // the shell unmounting when the session ends, since a former account's
    // airings must not keep firing.
    return () => void reminders.cancelAll();
  }, [reminders, enabled]);
}
