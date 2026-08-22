import { planReminders, REMINDER_WINDOW_DAYS } from "@domain/reminders";
import { useCalendar } from "@ui/hooks/useCalendar";
import { usePrefs } from "@ui/prefs/prefs-store";
import { useReminders } from "@ui/runtime/reminders";
import { useEffect } from "react";

/**
 * Keeps the OS holding exactly the reminders the current calendar implies.
 * Mounted once in the app shell, so it re-plans whenever the shared calendar
 * window refetches or the local day flips, and it re-plans from scratch every
 * time: the plan is a pure function of the calendar, and the diff against what
 * is pending makes running it again free.
 *
 * The calendar read is the one the Up Next and Calendar screens already share,
 * so turning reminders on costs no extra Trakt call. Turning them off empties
 * the schedule, and so does signing out: the shell this hook lives in unmounts
 * when the session ends, and a former account's airings must not keep firing.
 */
export function useEpisodeReminders(): void {
  const reminders = useReminders();
  const enabled = usePrefs((state) => state.remindersEnabled);
  const { days, now, hasData } = useCalendar(REMINDER_WINDOW_DAYS, enabled);

  useEffect(() => {
    if (!enabled) {
      void reminders.cancelAll();
      return;
    }
    // An unanswered calendar is not an empty one. Planning from `days: []`
    // before the read lands, or while it keeps failing offline, would cancel
    // every pending digest and put nothing back. A calendar that loaded empty
    // does have `hasData`, and cancelling then is correct.
    if (!hasData) return;
    void reminders.reconcile(planReminders(days, { now }));
  }, [reminders, enabled, hasData, days, now]);

  useEffect(() => () => void reminders.cancelAll(), [reminders]);
}
