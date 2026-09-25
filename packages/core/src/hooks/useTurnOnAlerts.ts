import { useReminders } from "../ports/reminders";
import { usePrefs } from "../prefs/prefs-store";
import { showSnack } from "../stores/snackbar-store";

/**
 * Asks the OS and turns alerts on only if it allows them, from either place
 * that offers them. Either answer retires the Calendar's card: its question has
 * been put.
 */
export function useTurnOnAlerts(): () => Promise<void> {
  const reminders = useReminders();
  const setRemindersEnabled = usePrefs((state) => state.setRemindersEnabled);
  const answerAlertsCard = usePrefs((state) => state.answerAlertsCard);
  return async () => {
    answerAlertsCard();
    if (await reminders.requestPermission()) {
      setRemindersEnabled(true);
      return;
    }
    showSnack({ message: "Notifications are off for Cue. Turn them on in your phone's settings." });
  };
}
